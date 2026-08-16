"""WebSocket API for the Tyre Tracker admin panel.

Five commands, all admin-only:

  tyre_tracker/config/get
      Every vehicle, its settings, its tyre sets — record and live counters
      together — plus the field table the panel builds its forms from.

  tyre_tracker/config/save {entry_id, section, data}
      Persists ONE section of ONE vehicle into its entry.
      - section "vehicle": the car's name, its odometer source, its rotation
        reminder. Data is a flat dict.
      - section "sets": the whole list of records, in the order the panel shows
        them. Adding, correcting, reordering and deleting are all this one call.

  tyre_tracker/action {entry_id, action, ...}
      What is *done* to a set rather than written about it: fitting, removing,
      rotating, separating, replacing, retiring, restoring, correcting a total,
      recording the odometer. Every one of them goes through the coordinator,
      which is the only thing that may touch a counter.

  tyre_tracker/vehicle/create {vehicle, odometer_entity?, initial_odometer?}
      Declares a new car. The entry is made by the config flow's import step,
      so the panel's dialog and the first-install form produce the same thing.

  tyre_tracker/vehicle/delete {entry_id}
      Removes a car, by removing its entry — the same call the integration
      page's own delete button makes, so the device, the entities and the
      store go exactly as they go from there (`async_remove_entry`).

This module is now the only writer of the configuration. The seventeen
``async_step_*`` of ``TyreTrackerOptionsFlow`` it grew out of were removed from
config_flow.py once it covered all of them — see the note at the top of that
file. Validation stayed on this side: what the panel sends is checked here, by
the same rules the flow applied, so nothing it can send lands in storage
unchecked.

The split between the two writing commands is the split between a record and a
counter. A record lives in ``entry.options`` and a save reloads the entry; a
counter lives in the store and only the coordinator knows how to move it — a
mount closes the outgoing set's mileage, a rotation re-files the pressure
sensors, a separation shares a total between two halves. Writing a record
through an action, or a counter through a save, would each lose exactly what
the other was written for.

The field table (bounds, units, steps, the options a selector offers) is SENT to
the panel rather than duplicated in JavaScript: one table, one place to change a
bound, and the forms cannot drift away from the validation that guards them.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from typing import Any, Final

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import ATTR_UNIT_OF_MEASUREMENT, UnitOfLength
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.storage import Store
from homeassistant.loader import async_get_integration
from homeassistant.util.unit_conversion import DistanceConverter

from .const import (
    AXLE_ALL,
    AXLE_PAIR,
    AXLES,
    CONF_AXLE,
    CONF_DOT,
    CONF_INITIAL_ODOMETER,
    CONF_INITIAL_TOTAL,
    CONF_LABEL,
    CONF_ODOMETER_ENTITY,
    CONF_PAIR,
    CONF_PRESSURE_FRONT,
    CONF_PRESSURE_REAR,
    CONF_PRICE,
    CONF_REFERENCE,
    CONF_ROTATION_INTERVAL,
    CONF_SEASON,
    CONF_SET_ID,
    CONF_SETS,
    CONF_SIZE,
    CONF_STORAGE,
    CONF_TPMS,
    CONF_VEHICLE,
    CONF_VEHICLE_ID,
    CONF_VEHICLES,
    CORNER_OF,
    CORNERS,
    DEFAULT_ROTATION_INTERVAL,
    DOMAIN,
    FALLBACK_VERSION,
    POSITION_FRONT,
    POSITION_REAR,
    POSITIONS,
    SEASON_SUMMER,
    SEASONS,
    SIDES,
    STORAGE_KEY,
    STORAGE_VERSION,
    TYRE_LIFE_YEARS,
    WS_ACTION,
    WS_CONFIG_GET,
    WS_CONFIG_SAVE,
    WS_VEHICLE_CREATE,
    WS_VEHICLE_DELETE,
)
_LOGGER = logging.getLogger(__name__)

_DATA_WS_REGISTERED = "ws_registered"

# The date code: two digits of week, two of year. `5399` is a fiction, `0023` is
# not — the week is what constrains it, the year cannot be argued with.
DOT_PATTERN = re.compile(r"^(0[1-9]|[1-4][0-9]|5[0-3])[0-9]{2}$")

# How long any typed-in field may be. A tyre reference is « Michelin
# CrossClimate 2 » — thirty characters, and the longest of them all.
TEXT_MAX: Final = 200

# ── The field tables ──────────────────────────────────────────────────────────
# What the panel draws its forms from. Bounds and steps are the ones the flow's
# selectors carried, kept here so the form and the check that guards it cannot
# say two different things.
#
# A pressure is asked in bar and nothing else: the figure is copied off a door
# sticker, and the sticker says bar — the comparison converts whatever the
# sensor publishes. Fifteen covers a truck; a car reads two-ish.
_SET_FIELDS: dict[str, dict[str, Any]] = {
    CONF_REFERENCE: {"type": "text", "required": True},
    CONF_SEASON: {"type": "select", "options": list(SEASONS), "default": SEASON_SUMMER},
    CONF_AXLE: {"type": "select", "options": list(AXLES), "default": AXLE_ALL},
    CONF_SIZE: {"type": "text"},
    CONF_PRESSURE_FRONT: {"type": "number", "min": 0, "max": 15, "step": 0.05, "unit": "bar"},
    CONF_PRESSURE_REAR: {"type": "number", "min": 0, "max": 15, "step": 0.05, "unit": "bar"},
    CONF_DOT: {"type": "text", "maxlength": 4},
    CONF_LABEL: {"type": "text"},
    CONF_PRICE: {"type": "number", "min": 0, "max": 100_000, "step": 0.01, "unit": "€"},
    CONF_STORAGE: {"type": "text"},
    # Only on a set that does not exist yet. Afterwards a total is corrected
    # through the `adjust` action, which also re-stamps the fitted set's mount
    # point — a plain field would silently skip that and lose the correction.
    CONF_INITIAL_TOTAL: {
        "type": "number", "min": 0, "max": 2_000_000, "step": 10, "unit": "km",
        "creating": True,
    },
}

_VEHICLE_FIELDS: dict[str, dict[str, Any]] = {
    CONF_VEHICLE: {"type": "text", "required": True},
    # The odometer may come from a sensor, or from nowhere at all — a car
    # without connected services is the ordinary case, and the reading is then
    # typed in from the card or from this panel.
    CONF_ODOMETER_ENTITY: {
        "type": "entity",
        "selector": {"entity": {"domain": ["sensor", "input_number", "number"]}},
    },
    # Zero says "never remind me", which is why the field goes down that far.
    CONF_ROTATION_INTERVAL: {
        "type": "number", "min": 0, "max": 100_000, "step": 500, "unit": "km",
        "default": DEFAULT_ROTATION_INTERVAL,
    },
}

# The odometer reading itself, asked by the `set_odometer` action.
_ODOMETER_FIELD: dict[str, Any] = {
    "type": "number", "min": 0, "max": 2_000_000, "step": 10, "unit": "km",
}

_ACTIONS = (
    "mount",
    "unmount",
    "rotate",
    "separate",
    "replace",
    "retire",
    "restore",
    "adjust",
    "set_odometer",
)


def async_register_websocket_api(hass: HomeAssistant) -> None:
    """Register the WS commands once (idempotent across entry reloads)."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get(_DATA_WS_REGISTERED):
        return
    websocket_api.async_register_command(hass, ws_config_get)
    websocket_api.async_register_command(hass, ws_config_save)
    websocket_api.async_register_command(hass, ws_action)
    websocket_api.async_register_command(hass, ws_vehicle_create)
    websocket_api.async_register_command(hass, ws_vehicle_delete)
    domain_data[_DATA_WS_REGISTERED] = True
    _LOGGER.debug("websocket_api: commands registered")


# ── Reading the entry ─────────────────────────────────────────────────────────

def _single_entry(hass: HomeAssistant) -> ConfigEntry | None:
    """The one entry the integration keeps, or None before it exists."""
    entries = hass.config_entries.async_entries(DOMAIN)
    return entries[0] if entries else None


def _vehicles(entry: ConfigEntry) -> list[dict[str, Any]]:
    """Every vehicle record, in the order they were added."""
    return [
        dict(record)
        for record in entry.options.get(CONF_VEHICLES, [])
        if record.get(CONF_VEHICLE_ID)
    ]


def _vehicle(entry: ConfigEntry, vehicle_id: str) -> dict[str, Any] | None:
    """One vehicle's record, by the id the panel addresses it with."""
    for record in _vehicles(entry):
        if record[CONF_VEHICLE_ID] == vehicle_id:
            return record
    return None


def _coordinator(entry: ConfigEntry, vehicle_id: str):
    """The vehicle's coordinator, or None while the entry is not loaded.

    Every live figure hangs from it, and it only exists between a successful
    setup and the unload. The panel therefore has to draw a vehicle whose setup
    failed — with its records, and without its counters — rather than break on
    it: that page is where one goes to fix what broke.
    """
    if entry.state is not ConfigEntryState.LOADED:
        return None
    coordinators = getattr(entry, "runtime_data", None) or {}
    return coordinators.get(vehicle_id)


def _records(vehicle: dict[str, Any]) -> list[dict[str, Any]]:
    """The tyre set records of one vehicle, in the order they are shown."""
    return [dict(record) for record in vehicle.get(CONF_SETS, [])]


def _by_id(records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(record.get(CONF_SET_ID)): record for record in records if record.get(CONF_SET_ID)}


def _sets_rev(records: list[dict[str, Any]]) -> str:
    """A short print of the stored set list, as it stands right now.

    The panel edits one set and saves the whole list, rebuilt from the copy it
    was handed. Anything that touched that list meanwhile is therefore about to
    be written over — and one thing does so on its own: a rotation re-files
    every pressure sensor of a set into the options (`_persist_tpms`), so a
    panel left open on an editor would put the old corners back and the sensors
    would be read at wheels they are no longer on.

    Hashing what is stored, rather than stamping a counter, means nothing has
    to be kept anywhere: two panels agree when they hold the same list, whoever
    wrote it and however it got there.
    """
    payload = json.dumps(records, sort_keys=True, default=str, ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def _slots_of(axle: str) -> tuple[str, ...]:
    """Where a set's sensors sit: four corners, or two sides.

    A pair holds them by side, because which end of the car it sits at is
    decided when it is fitted and not when it is described.
    """
    return CORNERS if axle == AXLE_ALL else SIDES


def _set_payload(record: dict[str, Any], coordinator) -> dict[str, Any]:
    """One tyre set: what it is, and — when the vehicle is loaded — where it stands.

    The record and the counters are sent together but stay separate under
    `live`: the panel writes the first and asks for the second, and a field it
    could not tell apart would eventually be posted back as a record.
    """
    axle = record.get(CONF_AXLE) or AXLE_ALL
    payload: dict[str, Any] = {
        CONF_SET_ID: record.get(CONF_SET_ID),
        CONF_REFERENCE: record.get(CONF_REFERENCE) or "",
        CONF_SEASON: record.get(CONF_SEASON) or SEASON_SUMMER,
        CONF_AXLE: axle,
        CONF_SIZE: record.get(CONF_SIZE) or "",
        CONF_DOT: record.get(CONF_DOT) or "",
        CONF_LABEL: record.get(CONF_LABEL) or "",
        CONF_PRICE: record.get(CONF_PRICE),
        CONF_PRESSURE_FRONT: record.get(CONF_PRESSURE_FRONT),
        CONF_PRESSURE_REAR: record.get(CONF_PRESSURE_REAR),
        CONF_STORAGE: record.get(CONF_STORAGE) or "",
        CONF_TPMS: dict(record.get(CONF_TPMS) or {}),
        "slots": list(_slots_of(axle)),
    }

    set_id = str(record.get(CONF_SET_ID) or "")
    tyre = coordinator.data.sets.get(set_id) if coordinator else None
    if tyre is None:
        payload["live"] = None
        return payload

    payload["live"] = {
        "title": tyre.title,
        "icon": tyre.icon,
        "total": tyre.total,
        "distance": coordinator.distance(set_id),
        "retired": tyre.retired,
        "retired_at": tyre.retired_at,
        "mounted": coordinator.is_mounted(set_id),
        "positions": coordinator.positions_of(set_id),
        "mounted_since": tyre.mounted_since,
        "rotated_at": tyre.rotated_at,
        "km_since_rotation": coordinator.km_since_rotation(set_id),
        "rotation_due": coordinator.rotation_due(set_id),
        "age_years": tyre.age_years,
        "aged": tyre.aged,
        "manufactured_on": tyre.manufactured_on,
        "cost_per_1000": coordinator.cost_per_1000(set_id),
        # Read here rather than left to the panel: a pair fitted at the rear
        # reads at the rear, and only the vehicle knows where it sits.
        "tpms": coordinator.tpms(set_id),
    }
    return payload


def _vehicle_payload(entry: ConfigEntry, vehicle: dict[str, Any]) -> dict[str, Any]:
    """One vehicle, whole: what it is, what it carries, what it has run.

    The key stays named `entry_id` on the wire: it was the config entry's id
    when each vehicle was one, and the panel treats it as the opaque address
    it always was. It now carries the vehicle record's id.
    """
    vehicle_id = vehicle[CONF_VEHICLE_ID]
    coordinator = _coordinator(entry, vehicle_id)
    records = _records(vehicle)
    name = vehicle.get(CONF_VEHICLE) or vehicle_id
    return {
        "entry_id": vehicle_id,
        "title": name,
        CONF_VEHICLE: name,
        "loaded": coordinator is not None,
        "state": entry.state.value,
        CONF_ODOMETER_ENTITY: vehicle.get(CONF_ODOMETER_ENTITY),
        CONF_ROTATION_INTERVAL: vehicle.get(
            CONF_ROTATION_INTERVAL, DEFAULT_ROTATION_INTERVAL
        ),
        CONF_INITIAL_ODOMETER: vehicle.get(CONF_INITIAL_ODOMETER),
        "odometer": coordinator.data.odometer if coordinator else None,
        "mounted": (
            dict(coordinator.data.mounted) if coordinator else {p: None for p in POSITIONS}
        ),
        # The last manoeuvres, as the coordinator already keeps them: enough to
        # explain a suspicious total, which is exactly what one comes here for.
        "history": list(coordinator.data.history) if coordinator else [],
        "sets": [_set_payload(record, coordinator) for record in records],
        # What the panel sends back when it saves the list, so a save built on
        # a copy that has since been overtaken is refused rather than applied.
        "sets_rev": _sets_rev(records),
    }


def _schema() -> dict[str, Any]:
    """The tables the panel renders its forms and its car plan from."""
    return {
        "seasons": list(SEASONS),
        "axles": list(AXLES),
        "positions": list(POSITIONS),
        "corners": list(CORNERS),
        "sides": list(SIDES),
        # Which corner a side lands on, given the axle a pair sits on. The panel
        # draws a car and has to place two sensors on four wheels.
        "corner_of": {f"{position}.{side}": corner for (position, side), corner
                      in CORNER_OF.items()},
        "set_fields": _SET_FIELDS,
        "vehicle_fields": _VEHICLE_FIELDS,
        "odometer_field": _ODOMETER_FIELD,
        "actions": list(_ACTIONS),
        "tyre_life_years": TYRE_LIFE_YEARS,
        "defaults": {CONF_ROTATION_INTERVAL: DEFAULT_ROTATION_INTERVAL},
    }


# ── Writing ───────────────────────────────────────────────────────────────────

def _persist_vehicles(
    hass: HomeAssistant, entry: ConfigEntry, vehicles: list[dict[str, Any]]
) -> None:
    """Write the vehicle records back, leaving the rest of the options alone.

    `async_update_entry` compares what it is given to what is stored, so a save
    that changes nothing fires no reload at all.
    """
    hass.config_entries.async_update_entry(
        entry, options={**entry.options, CONF_VEHICLES: vehicles}
    )


def _persist_sets(
    hass: HomeAssistant,
    entry: ConfigEntry,
    vehicle_id: str,
    records: list[dict[str, Any]],
) -> None:
    """Write one vehicle's set records back; the other vehicles travel as they are."""
    _persist_vehicles(
        hass,
        entry,
        [
            {**vehicle, CONF_SETS: records}
            if vehicle.get(CONF_VEHICLE_ID) == vehicle_id
            else vehicle
            for vehicle in _vehicles(entry)
        ],
    )


def _taken(entry: ConfigEntry, vehicle_id: str | None, vehicle: str) -> bool:
    """True when another vehicle already answers to that name.

    `vehicle_id` is the one being renamed and therefore excused from the
    comparison; None when a vehicle is being created, where every record counts.
    """
    wanted = vehicle.casefold()
    return any(
        record[CONF_VEHICLE_ID] != vehicle_id
        and str(record.get(CONF_VEHICLE) or "").casefold() == wanted
        for record in _vehicles(entry)
    )


def _dot(raw: Any) -> str:
    """The four digits of the date code, whatever was typed around them.

    A sidewall carries a long DOT code — plant, size code, then the date at the
    end — and one reads it through a wheel arch, in the dark. « DOT U2LL LMLR
    3223 », « 32/23 » and « 3223 » must all land on the same four digits rather
    than on an error message about a format nobody was told about.
    """
    digits = re.sub(r"\D", "", str(raw or ""))
    return digits[-4:] if len(digits) >= 4 else digits


def _text(raw: Any) -> str:
    """What was typed, trimmed, and no longer than a field can mean.

    The bound is not a validation — nobody types two hundred characters of
    reference by mistake — it is a floor under what a paste can do: a record
    lands in the entry options, in a device name and in an entity's attributes,
    and none of those has any use for a novel.
    """
    return str(raw or "").strip()[:TEXT_MAX]


def _positive(raw: Any) -> float | None:
    """A figure that only means something above zero, or nothing at all.

    Zero is not a price and not a target pressure: it is the empty field a
    number box hands back, and storing it would divide a free set over its
    kilometres, or flag every tyre as overinflated.
    """
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _clean_record(raw: dict[str, Any]) -> dict[str, Any]:
    """Trim what was typed, and reduce what was left blank to nothing."""
    return {
        CONF_REFERENCE: _text(raw.get(CONF_REFERENCE)),
        CONF_SEASON: raw.get(CONF_SEASON) if raw.get(CONF_SEASON) in SEASONS else SEASONS[0],
        CONF_AXLE: raw.get(CONF_AXLE) if raw.get(CONF_AXLE) in AXLES else AXLES[0],
        CONF_SIZE: _text(raw.get(CONF_SIZE)),
        CONF_DOT: _dot(raw.get(CONF_DOT)),
        CONF_LABEL: _text(raw.get(CONF_LABEL)),
        CONF_PRICE: _positive(raw.get(CONF_PRICE)),
        CONF_PRESSURE_FRONT: _positive(raw.get(CONF_PRESSURE_FRONT)),
        CONF_PRESSURE_REAR: _positive(raw.get(CONF_PRESSURE_REAR)),
        CONF_STORAGE: _text(raw.get(CONF_STORAGE)),
    }


def _clean_tpms(raw: Any, axle: str) -> tuple[dict[str, str], bool]:
    """The sensors kept for the slots this set actually has, and whether one is doubled.

    One sensor is screwed to one wheel. The same entity under two slots is a
    slip of the picker, and it reads as two tyres agreeing perfectly — the one
    thing a pressure alarm can never catch, since a wheel losing its air would
    be reported as two.
    """
    slots = _slots_of(axle)
    chosen = {
        slot: _text(entity_id)
        for slot, entity_id in (raw or {}).items()
        if slot in slots and _text(entity_id)
    }
    return chosen, len(set(chosen.values())) != len(chosen)


def _validate_sets(
    hass: HomeAssistant,
    entry: ConfigEntry,
    vehicle: dict[str, Any],
    items: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], str | None]:
    """The records as they will be stored, or the code of what cannot be accepted.

    An error names the offending row by index: the panel edits one set at a
    time, but it saves the whole list, and « the reference is missing » says
    nothing on a page showing five sets.
    """
    coordinator = _coordinator(entry, vehicle[CONF_VEHICLE_ID])
    stored = _by_id(_records(vehicle))
    out: list[dict[str, Any]] = []
    seen: set[str] = set()

    for index, raw in enumerate(items):
        record = _clean_record(raw)

        # A reference is refused for being blank: a set with neither reference
        # nor label falls back to the word « Set », which every other nameless
        # set also answers to — in a list whose whole job is telling them apart.
        if not record[CONF_REFERENCE]:
            return [], f"reference_required:{index}"
        # Half a date code says nothing, and a wrong one would age the set by
        # whole years.
        if record[CONF_DOT] and not DOT_PATTERN.match(record[CONF_DOT]):
            return [], f"dot_invalid:{index}"

        # The id is what the mileage hangs from. A record arriving without one
        # is a set being declared; one arriving with an id nobody knows is a
        # record the panel invented, and it is given a fresh id rather than
        # adopting counters that may belong to a set deleted long ago.
        set_id = _text(raw.get(CONF_SET_ID))
        known = set_id in stored
        if not set_id or set_id in seen:
            set_id = uuid.uuid4().hex
            known = False
        seen.add(set_id)
        record[CONF_SET_ID] = set_id

        tpms, doubled = _clean_tpms(raw.get(CONF_TPMS), record[CONF_AXLE])
        if doubled:
            return [], f"tpms_duplicate:{index}"
        record[CONF_TPMS] = tpms

        if known:
            # What the set arrived with is written once, when it is declared.
            # Carried over verbatim: the coordinator only reads it while the
            # store is empty, and rewriting it from the panel would silently
            # change what a set restored from a backup starts at.
            previous = stored[set_id]
            if CONF_INITIAL_TOTAL in previous:
                record[CONF_INITIAL_TOTAL] = previous[CONF_INITIAL_TOTAL]
            if error := _axle_conflict(coordinator, set_id, previous, record):
                return [], f"{error}:{index}"
        elif (initial := raw.get(CONF_INITIAL_TOTAL)) not in (None, ""):
            try:
                record[CONF_INITIAL_TOTAL] = float(initial)
            except (TypeError, ValueError):
                return [], f"initial_total_invalid:{index}"

        out.append(record)

    return out, None


def _axle_conflict(
    coordinator, set_id: str, previous: dict[str, Any], record: dict[str, Any]
) -> str | None:
    """Refuse to grow a fitted pair to four wheels while the other axle is taken.

    A pair fitted to one axle, promoted to a set of four while the other axle
    still carries something else, leaves the store describing six tyres on a
    car. Nothing refuses it at the time — and at the next reload the
    coordinator puts the four-wheel set back on both axles, which drops the
    other pair without settling its count: kilometres actually run disappear.
    Refusing the save is the cheapest place to stop that.
    """
    if coordinator is None:
        return None
    if record[CONF_AXLE] != AXLE_ALL or (previous.get(CONF_AXLE) or AXLE_ALL) == AXLE_ALL:
        return None
    if not coordinator.is_mounted(set_id):
        return None
    if any(sid is not None and sid != set_id for sid in coordinator.data.mounted.values()):
        return "axle_conflict"
    return None


def _reads_below(hass: HomeAssistant, coordinator, entity_id: str) -> float | None:
    """The entity's reading, when it sits below the recorded odometer.

    None when there is nothing to reconcile — no reading yet, or one that is
    ahead of the tracking, which is the ordinary case and needs no question
    asked. `async_set_odometer` refuses a backward step, so adopting such a
    source without settling first would freeze the tracking at the old figure
    and never move again.
    """
    if coordinator is None or coordinator.data.odometer is None:
        return None
    state = hass.states.get(entity_id)
    if state is None or state.state in ("unknown", "unavailable", ""):
        return None
    try:
        value = float(state.state)
    except (TypeError, ValueError):
        return None
    # Everything here is kilometres. A source in miles reads far below a
    # tracking in km and would raise the question every time, over a difference
    # that is only a unit.
    unit = state.attributes.get(ATTR_UNIT_OF_MEASUREMENT)
    if unit and unit != UnitOfLength.KILOMETERS:
        try:
            value = DistanceConverter.convert(value, unit, UnitOfLength.KILOMETERS)
        except (HomeAssistantError, ValueError, TypeError):
            # The converter refuses an unrecognised unit with a
            # `HomeAssistantError`, which is not a `ValueError`: left out,
            # picking a sensor with an odd unit would break the save rather
            # than pass over a reading that cannot be compared.
            return None
    return round(value, 1) if value < coordinator.data.odometer else None


async def _save_vehicle(
    hass: HomeAssistant,
    entry: ConfigEntry,
    record: dict[str, Any],
    data: dict[str, Any],
) -> tuple[dict[str, Any], str | None]:
    """The car's own settings: its name, its odometer source, its reminder.

    Returns what to send back — either the acknowledgement, or the question the
    odometer raised. Two readings that contradict each other are not an error:
    both figures are real, one was typed in over months and the other is the
    dashboard, and only the owner can say which one the tracking continues on.
    The panel asks, then sends the same save again with `resync` answered.
    """
    vehicle_id = record[CONF_VEHICLE_ID]
    vehicle = _text(data.get(CONF_VEHICLE))
    if not vehicle:
        return {}, "vehicle_required"
    if _taken(entry, vehicle_id, vehicle):
        return {}, "vehicle_exists"

    try:
        interval = float(data.get(CONF_ROTATION_INTERVAL) or 0)
    except (TypeError, ValueError):
        return {}, "interval_invalid"
    if not 0 <= interval <= 100_000:
        return {}, "interval_invalid"

    chosen = _text(data.get(CONF_ODOMETER_ENTITY)) or None
    coordinator = _coordinator(entry, vehicle_id)
    current = record.get(CONF_ODOMETER_ENTITY)

    if chosen and chosen != current:
        reading = _reads_below(hass, coordinator, chosen)
        if reading is not None:
            answer = data.get("resync")
            if answer is None:
                return {
                    "saved": False,
                    "resync": {
                        "entity_id": chosen,
                        "reading": reading,
                        "tracked": coordinator.data.odometer,
                    },
                }, None
            if answer:
                # Settle the fitted sets at the old reading first, so the
                # kilometres they did run stay theirs, then count again from
                # the new source.
                await coordinator.async_resync_odometer(reading)

    _persist_vehicles(
        hass,
        entry,
        [
            {
                **other,
                CONF_VEHICLE: vehicle,
                CONF_ODOMETER_ENTITY: chosen,
                CONF_ROTATION_INTERVAL: interval,
            }
            if other.get(CONF_VEHICLE_ID) == vehicle_id
            else other
            for other in _vehicles(entry)
        ],
    )
    return {"saved": True}, None


# ── The actions ───────────────────────────────────────────────────────────────

async def _run_action(
    hass: HomeAssistant, entry: ConfigEntry, vehicle: dict[str, Any], msg: dict[str, Any]
) -> dict[str, Any]:
    """Do to a set what cannot be done by writing a record.

    Every one of them goes through the coordinator, which refuses out loud: a
    set in the history one tries to fit, a pair one tries to rotate, an
    odometer going backwards. Those refusals travel to the panel as they are —
    see `ws_action`, which turns them into an error carrying the same key the
    services already answer with.
    """
    coordinator = _coordinator(entry, vehicle[CONF_VEHICLE_ID])
    if coordinator is None:
        raise vol.Invalid("not_loaded")

    action = msg["action"]
    set_id = msg.get("set_id")
    odometer = msg.get("odometer")

    if action == "set_odometer":
        if odometer is None:
            raise vol.Invalid("odometer_required")
        # `strict`, because someone typed this on purpose: a reading below the
        # recorded one is told it was refused rather than silently dropped.
        await coordinator.async_set_odometer(float(odometer), strict=True)
        return {"done": True}

    if action == "unmount":
        await coordinator.async_unmount(msg.get("position"), odometer)
        return {"done": True}

    if action == "mount":
        await coordinator.async_mount(set_id, odometer, msg.get("position"))
        return {"done": True}

    if action == "rotate":
        await coordinator.async_rotate(set_id, odometer)
        return {"done": True}

    if action == "retire":
        await coordinator.async_retire(set_id, odometer)
        return {"done": True}

    if action == "restore":
        await coordinator.async_restore(set_id)
        return {"done": True}

    if action == "adjust":
        await coordinator.async_adjust(set_id, float(msg.get("total") or 0))
        return {"done": True}

    if action == "separate":
        return await _separate(hass, entry, vehicle, coordinator, msg)

    if action == "replace":
        return await _replace(hass, entry, vehicle, coordinator, msg)

    raise vol.Invalid(f"unknown_action:{action}")


async def _separate(
    hass, entry: ConfigEntry, vehicle: dict[str, Any], coordinator, msg
) -> dict[str, Any]:
    """Turn a set of four into two pairs that share what it has run.

    One keeps its record and its id — it is the same set, minus two wheels —
    and the other is born with the same total. Neither is a copy: they are the
    two halves of something that was counted as one.
    """
    set_id = msg.get("set_id")
    records = _records(vehicle)
    record = _by_id(records).get(str(set_id))
    if record is None:
        raise vol.Invalid("unknown_set")

    leaving = msg.get(CONF_PAIR) or POSITION_FRONT
    new_id = uuid.uuid4().hex

    shared = await coordinator.async_separate(
        set_id, new_id, leaving, msg.get("odometer")
    )
    if shared is None:
        raise vol.Invalid("not_separable")

    staying = POSITION_REAR if leaving == POSITION_FRONT else POSITION_FRONT
    # What the four cost, split down the middle. Any other division would need
    # a figure nobody has, and leaving the whole price on both halves would say
    # each pair cost what the set did — which is what the panel then divides by
    # the kilometres to compare two references.
    price = record.get(CONF_PRICE)
    half = round(price / 2, 2) if price else None
    tpms = record.get(CONF_TPMS) or {}

    born = {
        **record,
        CONF_SET_ID: new_id,
        CONF_AXLE: AXLE_PAIR,
        CONF_LABEL: _text(msg.get(CONF_LABEL)),
        CONF_TPMS: _pair_tpms(tpms, leaving),
        CONF_PRICE: half,
        CONF_INITIAL_TOTAL: shared,
    }
    kept = {
        **record,
        CONF_AXLE: AXLE_PAIR,
        CONF_TPMS: _pair_tpms(tpms, staying),
        CONF_PRICE: half,
    }
    _persist_sets(
        hass,
        entry,
        vehicle[CONF_VEHICLE_ID],
        [kept if r.get(CONF_SET_ID) == set_id else r for r in records] + [born],
    )
    return {"done": True, "set_id": new_id, "shared": shared}


def _pair_tpms(tpms: dict[str, str], position: str) -> dict[str, str]:
    """The sensors of one axle, refiled by side.

    A set of four holds its sensors by corner. Split in two, each half holds
    them by side: which end of the car it sits at stops being part of its
    record the moment it becomes a pair, and a sensor left under « rear left »
    would be read at a corner the pair may no longer be at.
    """
    return {
        side: tpms[CORNER_OF[(position, side)]]
        for side in SIDES
        if tpms.get(CORNER_OF[(position, side)])
    }


async def _replace(
    hass, entry: ConfigEntry, vehicle: dict[str, Any], coordinator, msg
) -> dict[str, Any]:
    """Take the fitted set off and put a new one on, in one act.

    The order the garage does it in: the old set comes off and closes its count
    at today's reading, the new one goes on at zero, in the same places. The
    new set is only born when the options are written, so its counters are laid
    down in the store first, under the id the record is about to carry.
    """
    set_id = str(msg.get("set_id") or "")
    records = _records(vehicle)
    original = _by_id(records).get(set_id)
    if original is None:
        raise vol.Invalid("unknown_set")

    record = _clean_record(msg.get("record") or {})
    if not record[CONF_REFERENCE]:
        raise vol.Invalid("reference_required:0")
    if record[CONF_DOT] and not DOT_PATTERN.match(record[CONF_DOT]):
        raise vol.Invalid("dot_invalid:0")
    # Replacing fits the copy exactly where the original stands, so the copy
    # must cover the same wheels: a pair staged on the two positions a set of
    # four held is a mounted state nothing else can express, and the next
    # reload would unpick it by dropping a set without settling it.
    if record[CONF_AXLE] != (original.get(CONF_AXLE) or AXLE_ALL):
        raise vol.Invalid("replace_axle")
    if not coordinator.is_mounted(set_id):
        raise vol.Invalid("not_replaceable")

    tpms, doubled = _clean_tpms(msg.get("record", {}).get(CONF_TPMS), record[CONF_AXLE])
    if doubled:
        raise vol.Invalid("tpms_duplicate:0")
    record[CONF_TPMS] = tpms

    new_id = uuid.uuid4().hex
    record[CONF_SET_ID] = new_id
    try:
        total = float(msg.get("record", {}).get(CONF_INITIAL_TOTAL) or 0)
    except (TypeError, ValueError):
        total = 0.0
    record[CONF_INITIAL_TOTAL] = total

    positions = coordinator.positions_of(set_id)
    await coordinator.async_retire(set_id, msg.get("odometer"))
    # The figure the form asked for, carried through: the counters staged here
    # are what the reload reads back, and they take precedence over the
    # record's `initial_total` — left to default, a second-hand set declared
    # with 20 000 km already on it would have come up at zero.
    await coordinator.async_stage_replacement(new_id, positions, total=total)
    _persist_sets(hass, entry, vehicle[CONF_VEHICLE_ID], [*records, record])
    return {"done": True, "set_id": new_id}


# ── Commands ──────────────────────────────────────────────────────────────────

@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): WS_CONFIG_GET})
@websocket_api.async_response
async def ws_config_get(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return every vehicle, and the tables the panel draws its forms from."""
    try:
        integration = await async_get_integration(hass, DOMAIN)
        version = str(integration.version or FALLBACK_VERSION)
    except Exception:  # noqa: BLE001
        version = FALLBACK_VERSION

    entry = _single_entry(hass)
    connection.send_result(msg["id"], {
        "version": version,
        "vehicles": (
            [_vehicle_payload(entry, record) for record in _vehicles(entry)]
            if entry is not None
            else []
        ),
        "schema": _schema(),
    })


@websocket_api.require_admin
@websocket_api.websocket_command({
    vol.Required("type"): WS_CONFIG_SAVE,
    vol.Required("entry_id"): str,
    vol.Required("section"): vol.In(("vehicle", "sets")),
    vol.Required("data"): vol.Any(list, dict),
    # The print of the list the panel started from. Optional: a caller that
    # does not carry one is taken at its word, as it was before this existed.
    vol.Optional("sets_rev"): str,
})
@websocket_api.async_response
async def ws_config_save(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Persist one section of one vehicle."""
    entry = _single_entry(hass)
    vehicle = _vehicle(entry, msg["entry_id"]) if entry else None
    if entry is None or vehicle is None:
        connection.send_error(msg["id"], "unknown_entry", "no such vehicle")
        return
    name = vehicle.get(CONF_VEHICLE) or msg["entry_id"]

    if msg["section"] == "vehicle":
        if not isinstance(msg["data"], dict):
            connection.send_error(msg["id"], "invalid_format", "vehicle expects a dict")
            return
        result, error = await _save_vehicle(hass, entry, vehicle, dict(msg["data"]))
        if error:
            connection.send_error(msg["id"], "invalid_config", error)
            return
        _LOGGER.debug("websocket_api: saved the settings of %s", name)
        connection.send_result(msg["id"], result)
        return

    if not isinstance(msg["data"], list):
        connection.send_error(msg["id"], "invalid_format", "sets expects a list")
        return

    # The whole list is being replaced. If it moved under the panel since it was
    # read — a rotation re-filing the sensors, a second browser, the device page
    # dropping a set — this save would silently undo that, so it is refused and
    # the panel is told to read again. See `_sets_rev`.
    expected = msg.get("sets_rev")
    if expected is not None and expected != _sets_rev(_records(vehicle)):
        _LOGGER.debug("websocket_api: refused a stale set list for %s", name)
        connection.send_error(msg["id"], "invalid_config", "sets_stale")
        return

    records, error = _validate_sets(
        hass, entry, vehicle, [dict(item) for item in msg["data"]]
    )
    if error:
        connection.send_error(msg["id"], "invalid_config", error)
        return
    _persist_sets(hass, entry, vehicle[CONF_VEHICLE_ID], records)
    _LOGGER.debug("websocket_api: saved %d set(s) of %s", len(records), name)
    connection.send_result(msg["id"], {"saved": True, "count": len(records)})


@websocket_api.require_admin
@websocket_api.websocket_command({
    vol.Required("type"): WS_ACTION,
    vol.Required("entry_id"): str,
    vol.Required("action"): vol.In(_ACTIONS),
    vol.Optional("set_id"): str,
    vol.Optional("position"): vol.In(POSITIONS),
    vol.Optional(CONF_PAIR): vol.In(POSITIONS),
    vol.Optional(CONF_LABEL): str,
    vol.Optional("odometer"): vol.Any(None, vol.Coerce(float)),
    vol.Optional("total"): vol.Coerce(float),
    vol.Optional("record"): dict,
})
@websocket_api.async_response
async def ws_action(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Fit, remove, rotate, separate, replace, retire, restore, correct."""
    entry = _single_entry(hass)
    vehicle = _vehicle(entry, msg["entry_id"]) if entry else None
    if entry is None or vehicle is None:
        connection.send_error(msg["id"], "unknown_entry", "no such vehicle")
        return

    try:
        result = await _run_action(hass, entry, vehicle, msg)
    except vol.Invalid as err:
        # The refusals this module raises itself, as codes the panel already
        # has a sentence for.
        connection.send_error(msg["id"], "invalid_action", str(err.msg or err))
        return
    except HomeAssistantError as err:
        # The coordinator's own refusals. The translation key travels as the
        # error code, so the panel says the same sentence the service does;
        # the message follows for anything it has never heard of.
        connection.send_error(
            msg["id"], getattr(err, "translation_key", None) or "action_failed", str(err)
        )
        return

    _LOGGER.debug(
        "websocket_api: %s on %s", msg["action"], vehicle.get(CONF_VEHICLE)
    )
    connection.send_result(msg["id"], result)


@websocket_api.require_admin
@websocket_api.websocket_command({
    vol.Required("type"): WS_VEHICLE_CREATE,
    vol.Required(CONF_VEHICLE): str,
    vol.Optional(CONF_ODOMETER_ENTITY): vol.Any(None, str),
    vol.Optional(CONF_INITIAL_ODOMETER): vol.Any(None, vol.Coerce(float)),
})
@websocket_api.async_response
async def ws_vehicle_create(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Declare a new vehicle, from the panel's own dialog.

    A record appended to the one entry's options: the reload that follows
    builds its coordinator, its device and its entities, exactly as the first
    vehicle's were. The name is checked here first, to answer with the same
    codes the panel's other refusals carry.
    """
    entry = _single_entry(hass)
    if entry is None:
        # The panel is only served while the entry exists; this is the race of
        # a page left open across the integration's removal.
        connection.send_error(msg["id"], "unknown_entry", "no such vehicle")
        return

    vehicle = _text(msg.get(CONF_VEHICLE))
    if not vehicle:
        connection.send_error(msg["id"], "invalid_config", "vehicle_required")
        return
    if _taken(entry, None, vehicle):
        connection.send_error(msg["id"], "invalid_config", "vehicle_exists")
        return

    record = {
        CONF_VEHICLE_ID: uuid.uuid4().hex,
        CONF_VEHICLE: vehicle,
        CONF_ODOMETER_ENTITY: _text(msg.get(CONF_ODOMETER_ENTITY)) or None,
        CONF_INITIAL_ODOMETER: msg.get(CONF_INITIAL_ODOMETER),
        CONF_ROTATION_INTERVAL: DEFAULT_ROTATION_INTERVAL,
        CONF_SETS: [],
    }
    _persist_vehicles(hass, entry, [*_vehicles(entry), record])

    _LOGGER.debug("websocket_api: created vehicle %s", vehicle)
    connection.send_result(msg["id"], {"entry_id": record[CONF_VEHICLE_ID]})


@websocket_api.require_admin
@websocket_api.websocket_command({
    vol.Required("type"): WS_VEHICLE_DELETE,
    vol.Required("entry_id"): str,
})
@websocket_api.async_response
async def ws_vehicle_delete(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Remove a vehicle, from the panel's own vehicle tab.

    The record leaves the options — the reload that follows unloads its
    coordinator and prunes its devices and entities — and its store goes with
    it: the counters only mean something to a vehicle that still exists.

    The entry itself stays, however many vehicles remain: it is the
    integration, not a car. Deleting the last vehicle leaves an empty garage,
    and the panel's own « no vehicle yet » screen to declare the next one in.
    """
    entry = _single_entry(hass)
    vehicle = _vehicle(entry, msg["entry_id"]) if entry else None
    if entry is None or vehicle is None:
        connection.send_error(msg["id"], "unknown_entry", "no such vehicle")
        return

    vehicle_id = vehicle[CONF_VEHICLE_ID]
    kept = [
        record
        for record in _vehicles(entry)
        if record[CONF_VEHICLE_ID] != vehicle_id
    ]
    # The coordinator is told first: the reload that follows the options write
    # unloads it, and its final save would put the file just removed straight
    # back. A discarded coordinator lets go without writing.
    coordinator = _coordinator(entry, vehicle_id)
    if coordinator is not None:
        coordinator.discard()
    await Store(hass, STORAGE_VERSION, f"{STORAGE_KEY}.{vehicle_id}").async_remove()
    _persist_vehicles(hass, entry, kept)

    _LOGGER.debug("websocket_api: removed vehicle %s", vehicle.get(CONF_VEHICLE))
    connection.send_result(msg["id"], {
        "removed": True,
        "remaining": len(kept),
        "require_restart": False,
    })
