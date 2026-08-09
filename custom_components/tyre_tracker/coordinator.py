"""The tracking itself: how far each tyre set has run.

The model is two numbers per set:

  * `total`      — kilometres already run by that set, frozen when it was
                   last removed;
  * `mounted_at` — the vehicle odometer when it was fitted.

So the fitted set reads `total + (odometer - mounted_at)`, and a swap is just
closing that count on the outgoing set and stamping the starting point of the
incoming one. One subtraction, a handful of times a year.

State lives in a `Store` rather than in entity state. A mileage total is
accumulated, never recomputed: losing it to a failed restart or an entity
rename would be unrecoverable, since last spring's odometer exists nowhere
else.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, timedelta

from homeassistant.components.sensor import SensorDeviceClass
from homeassistant.const import ATTR_UNIT_OF_MEASUREMENT, UnitOfLength, UnitOfPressure
from homeassistant.core import HomeAssistant, State, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util
from homeassistant.util.unit_conversion import DistanceConverter, PressureConverter

from .const import (
    AXLE_ALL,
    CONF_SET_ID,
    CONF_SETS,
    CONF_TPMS,
    CORNER_OF,
    CORNERS,
    DATA_HISTORY,
    DATA_MOUNTED,
    DATA_MOUNTED_AT,
    DATA_MOUNTED_SINCE,
    DATA_ODOMETER,
    DATA_RETIRED_AT,
    DATA_RETIRED_ODOMETER,
    DATA_ROTATED_AT,
    DATA_ROTATED_ODOMETER,
    DATA_SETS,
    DATA_TOTAL,
    DOMAIN,
    EVENT_ADJUSTED,
    EVENT_MOUNTED,
    EVENT_RESTORED,
    EVENT_RETIRED,
    EVENT_ROTATED,
    EVENT_SEPARATED,
    EVENT_UNMOUNTED,
    HISTORY_LENGTH,
    MAX_STEP_KM,
    POSITION_FRONT,
    POSITION_REAR,
    POSITIONS,
    PRESSURE_HIGH_RATIO,
    PRESSURE_LOW_RATIO,
    RETIRED_ICON,
    ROTATION_SWAP,
    SAVE_DELAY,
    SEASON_ICONS,
    SEASON_SUMMER,
    SIDES,
    STORAGE_KEY,
    STORAGE_VERSION,
    TPMS_STALE_HOURS,
    TYRE_LIFE_YEARS,
)
from .i18n import Words

_LOGGER = logging.getLogger(__name__)


def _mounted_from_store(stored: object) -> dict[str, str | None]:
    """Read the fitted positions back, whatever shape the store holds.

    A store written before axles existed carries a single set id: it was on
    all four wheels, so both positions take it.
    """
    if isinstance(stored, dict):
        return {p: stored.get(p) for p in POSITIONS}
    return {p: stored if isinstance(stored, str) else None for p in POSITIONS}


def _refuse(key: str, **placeholders: object) -> ServiceValidationError:
    """A refusal the caller can see.

    A service that logs its refusal and returns has succeeded, as far as the
    automation that called it is concerned: the script carries on, the swap
    never happened, and the line in the log is read by nobody. Raising is what
    puts the refusal where the mistake was made — in the trace of the
    automation, under the step that asked for it.
    """
    return ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key=key,
        translation_placeholders={k: str(v) for k, v in placeholders.items()},
    )


def _positive(raw: object) -> float | None:
    """A figure that only means something above zero, or nothing at all.

    Zero is not a price and not a target pressure: it is the empty field a
    number selector hands back, and treating it as one would divide a free
    set over its kilometres, or flag every tyre as overinflated.
    """
    try:
        value = float(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


@dataclass
class TyreSet:
    """One tyre set: what it is, and how far it has run.

    `set_id` is the subentry id. The mileage hangs from it and not from the
    reference, so correcting « Michelin Alpin 5 » into « Michelin Alpin 6 »
    keeps the kilometres. Reference, season and label come from the subentry
    and are refreshed at every load; only the three counters are persisted.
    """

    set_id: str
    label: str = ""
    reference: str = ""
    season: str = SEASON_SUMMER
    axle: str = AXLE_ALL
    size: str = ""
    # Week and year of manufacture, `WWYY` as read on the sidewall. Empty when
    # it was never typed in — most sets are entered without turning a wheel
    # over to look.
    dot: str = ""
    # What the whole set cost. None when it was never typed in — a second-hand
    # set, or one whose invoice is long gone.
    price: float | None = None
    # What each axle should read, cold, in bar — the door-sticker figures.
    # None when never typed in: the alarm then rests on whatever verdict the
    # TPMS itself publishes.
    pressure_front: float | None = None
    pressure_rear: float | None = None
    # Where it waits when it is off the car.
    storage: str = ""
    # One pressure sensor per tyre, held by the slot it occupies: the four
    # corners for a set of four, left and right for a pair.
    tpms: dict[str, str] = field(default_factory=dict)
    total: float = 0.0
    mounted_at: float | None = None
    mounted_since: str | None = None
    # Taken out of service. The set stays visible and keeps its mileage, but
    # it can no longer be fitted and its total no longer moves.
    retired_at: str | None = None
    retired_odometer: float | None = None
    # Last rotation, and the odometer it was done at. A set that has never
    # been rotated counts from the day it was fitted.
    rotated_at: str | None = None
    rotated_odometer: float | None = None

    @property
    def retired(self) -> bool:
        """True once the set has been taken out of service."""
        return self.retired_at is not None

    @property
    def slots(self) -> tuple[str, ...]:
        """Where this set's sensors sit: four corners, or two sides."""
        return CORNERS if self.axle == AXLE_ALL else SIDES

    @property
    def manufactured_on(self) -> str | None:
        """The Monday of the week stamped on the sidewall, as a date.

        A DOT gives a week, not a day. The Monday is close enough for an age
        counted in years, and it is the only reading that never lands in the
        wrong year.
        """
        if len(self.dot) != 4 or not self.dot.isdigit():
            return None
        week, year = int(self.dot[:2]), int(self.dot[2:])
        if not 1 <= week <= 53:
            return None
        # Two digits of year, on a tyre one is holding: 2000 onwards. A casing
        # from the nineties is long past the point where its age is news.
        try:
            monday = date.fromisocalendar(2000 + year, week, 1)
        except ValueError:
            return None
        return monday.isoformat()

    @property
    def age_years(self) -> float | None:
        """How old the rubber is, in years. None without a date code."""
        made = self.manufactured_on
        if made is None:
            return None
        return round((date.today() - date.fromisoformat(made)).days / 365.25, 1)

    @property
    def aged(self) -> bool:
        """True once the casing is past the age tyres are replaced at."""
        age = self.age_years
        return age is not None and age >= TYRE_LIFE_YEARS

    @property
    def title(self) -> str:
        """What to call it on screen."""
        return self.label or self.reference or self.set_id

    @property
    def icon(self) -> str:
        """Season icon, or the worn tyre once out of service."""
        if self.retired:
            return RETIRED_ICON
        return SEASON_ICONS.get(self.season, SEASON_ICONS[SEASON_SUMMER])

    def as_dict(self) -> dict:
        """Serialise the counters. The rest belongs to the subentry."""
        return {
            DATA_TOTAL: self.total,
            DATA_MOUNTED_AT: self.mounted_at,
            DATA_MOUNTED_SINCE: self.mounted_since,
            DATA_RETIRED_AT: self.retired_at,
            DATA_RETIRED_ODOMETER: self.retired_odometer,
            DATA_ROTATED_AT: self.rotated_at,
            DATA_ROTATED_ODOMETER: self.rotated_odometer,
        }


@dataclass
class TyreData:
    """The whole tracked state, as persisted.

    `mounted` maps each position to the set that occupies it. A set declared
    for all four wheels appears in both, which is what lets one ask "what is
    on the front" and "which sets are running" with the same structure.
    """

    sets: dict[str, TyreSet] = field(default_factory=dict)
    mounted: dict[str, str | None] = field(
        default_factory=lambda: {p: None for p in POSITIONS}
    )
    odometer: float | None = None
    history: list[dict] = field(default_factory=list)


class TyreCoordinator:
    """Holds the state, persists it, and notifies whoever displays it."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry_id: str,
        vehicle: str,
        sets: list[dict],
        odometer_entity: str | None,
        words: Words,
        rotation_interval: float = 0,
        initial_odometer: float | None = None,
    ) -> None:
        """Set up the coordinator for one vehicle.

        `sets` is one dict per configured set: id, label, reference, season,
        axle, size, dot, price, storage, tpms.
        """
        self.hass = hass
        self.entry_id = entry_id
        self.vehicle = vehicle
        # The words this vehicle speaks. Held here rather than looked up where
        # they are needed: the entities, the flow and the sensor state all
        # compose text, and all of them already hold the coordinator.
        self.words = words
        self.odometer_entity = odometer_entity
        self.rotation_interval = float(rotation_interval or 0)
        self._initial_odometer = initial_odometer
        self._configured = list(sets)
        self._store: Store = Store(hass, STORAGE_VERSION, f"{STORAGE_KEY}.{entry_id}")
        self._listeners: list[Callable[[], None]] = []
        self._unsub_odometer: Callable[[], None] | None = None
        self._unsub_tpms: Callable[[], None] | None = None
        # Counters of sets no longer configured, kept verbatim so that
        # re-adding a set finds its mileage again.
        self._orphans: dict[str, dict] = {}
        # The sibling sensors of each TPMS entity, once looked up. Resolving
        # them walks the entity registry, and the whole set of readings is
        # rebuilt every time a single pressure moves — several times over, since
        # the card reads them both by set and by corner.
        self._companion_cache: dict[str, dict[str, str]] = {}
        self._unsub_registry: Callable[[], None] | None = None
        # Whether the stuck-odometer warning has been given for the current
        # episode. Reset the moment a reading is accepted again.
        self._odometer_complained = False
        self.data = TyreData()

    # ----- lifecycle -----

    async def async_load(self) -> None:
        """Read persisted state back, and fill in what is missing."""
        stored = await self._store.async_load() or {}
        counters = stored.get(DATA_SETS) or {}

        # The record comes from the entry options, the counters from the store.
        # A set added afterwards starts from zero; a set removed from the
        # configuration keeps its counters in the store untouched, so putting
        # it back later restores the mileage instead of starting over.
        sets: dict[str, TyreSet] = {}
        for item in self._configured:
            set_id = item["id"]
            saved = counters.get(set_id, {})
            sets[set_id] = TyreSet(
                set_id=set_id,
                label=item.get("label") or "",
                reference=item.get("reference") or "",
                season=item.get("season") or SEASON_SUMMER,
                axle=item.get("axle") or AXLE_ALL,
                size=item.get("size") or "",
                dot=item.get("dot") or "",
                price=_positive(item.get("price")),
                pressure_front=_positive(item.get("pressure_front")),
                pressure_rear=_positive(item.get("pressure_rear")),
                storage=item.get("storage") or "",
                # Only the slots this set actually has: an axle changed from
                # four wheels to a pair leaves corner entries behind, and a
                # sensor filed under a corner the set no longer owns would be
                # read at a position it is not at.
                tpms={
                    slot: entity
                    for slot, entity in (item.get("tpms") or {}).items()
                    if entity
                    and slot in (CORNERS if (item.get("axle") or AXLE_ALL) == AXLE_ALL else SIDES)
                },
                total=float(
                    saved.get(DATA_TOTAL, item.get("initial_total") or 0.0) or 0.0
                ),
                mounted_at=saved.get(DATA_MOUNTED_AT),
                mounted_since=saved.get(DATA_MOUNTED_SINCE),
                retired_at=saved.get(DATA_RETIRED_AT),
                retired_odometer=saved.get(DATA_RETIRED_ODOMETER),
                rotated_at=saved.get(DATA_ROTATED_AT),
                rotated_odometer=saved.get(DATA_ROTATED_ODOMETER),
            )

        self._orphans = {k: v for k, v in counters.items() if k not in sets}

        self.data = TyreData(
            sets=sets,
            mounted=_mounted_from_store(stored.get(DATA_MOUNTED)),
            # The reading typed in when the vehicle was added, until a real one
            # replaces it. Read only while the store holds nothing: after that
            # the odometer is a record, and a setting must not overwrite it.
            odometer=stored.get(DATA_ODOMETER, self._initial_odometer),
            history=list(stored.get(DATA_HISTORY) or []),
        )

        # Never leave a retired or unknown set fitted: a reload must not resume
        # counting kilometres on a tyre that has been thrown away. Whatever is
        # taken off here is settled first — a deleted set keeps its counters in
        # the store, and the kilometres run since it was fitted are real. This
        # is the last moment they can still be added: dropped instead, they
        # would exist nowhere.
        stale = {
            sid
            for sid in self.data.mounted.values()
            if sid is not None and (sid not in sets or sets[sid].retired)
        }
        settled = False
        for position in POSITIONS:
            if self.data.mounted.get(position) in stale:
                self.data.mounted[position] = None
        for sid in stale:
            settled = self._settle_stale_mount(sid, sets) or settled

        # A store written before this rule could hold the forbidden mix — a
        # four-wheel set on one axle only. Put it back on both: that is what it
        # was, and dropping it instead would lose kilometres it did run.
        for position in POSITIONS:
            sid = self.data.mounted.get(position)
            tyre = sets.get(sid) if sid else None
            if tyre is not None and tyre.axle == AXLE_ALL:
                for every in POSITIONS:
                    self.data.mounted[every] = sid
                break

        if self.odometer_entity:
            self._unsub_odometer = async_track_state_change_event(
                self.hass, [self.odometer_entity], self._odometer_changed
            )
            self._read_odometer(self.hass.states.get(self.odometer_entity))

        # The pressures are read on demand, but nothing would redraw the card
        # when one moves: the sensors are outside this integration and its
        # entities have no reason to write their state again.
        watched = sorted(
            {
                entity
                for tyre in sets.values()
                for entity in tyre.tpms.values()
                if entity
            }
        )
        if watched:
            # The alarm a dock publishes beside its pressure moves on its own
            # schedule: watched too, or a flat flagged by the TPMS itself
            # would wait for the pressure figure to move before anything
            # redrew or any automation heard of it.
            alarms = sorted(
                {
                    alarm
                    for entity in watched
                    if (alarm := self._companions(entity).get("alarm"))
                }
            )
            self._unsub_tpms = async_track_state_change_event(
                self.hass, [*watched, *alarms], self._tpms_changed
            )
            # The cached siblings are only true as long as the registry says so:
            # a sensor moved to another device, or a temperature entity enabled
            # after the fact, changes what a wheel reads.
            self._unsub_registry = self.hass.bus.async_listen(
                er.EVENT_ENTITY_REGISTRY_UPDATED, self._registry_changed
            )

        # Written down straight away rather than left in memory: a starting
        # point that only exists until the next restart would be stamped again
        # at a higher reading, and the kilometres in between would go nowhere.
        # A settled orphan is in the same position — its total only just moved.
        if self._start_pending() or settled:
            await self._async_save()

    def _settle_stale_mount(self, sid: str, sets: dict[str, TyreSet]) -> bool:
        """Close the count of a set found fitted that can no longer run.

        Two ways a mounted set stops being mountable between two loads: its
        record was deleted — the options flow and the device page both just
        drop it and reload — or an old store holds it retired and fitted at
        once. Either way its kilometres since fitting are settled into
        whatever remains of it: the orphaned counters for a deleted set, the
        record itself for a retired one. Without this, deleting a fitted set
        loses everything it ran since it went on, and its orphan keeps a
        `mounted_at` that would credit phantom kilometres if the id ever came
        back.

        True when a total moved and the store should be written.
        """
        tyre = sets.get(sid)
        record = None if tyre is not None else self._orphans.get(sid)
        if tyre is None and record is None:
            return False

        mounted_at = tyre.mounted_at if tyre is not None else record.get(DATA_MOUNTED_AT)
        run = 0.0
        if mounted_at is not None and self.data.odometer is not None:
            run = max(0.0, self.data.odometer - mounted_at)
            if run > MAX_STEP_KM:
                _LOGGER.warning(
                    "tyre_tracker %s: %s km credited to %r in one go — mount "
                    "odometer is almost certainly wrong, nothing added",
                    self.vehicle,
                    round(run),
                    tyre.title if tyre is not None else sid,
                )
                run = 0.0

        if tyre is not None:
            tyre.total = round(tyre.total + run, 1)
            tyre.mounted_at = None
            tyre.mounted_since = None
        else:
            record[DATA_TOTAL] = round(
                float(record.get(DATA_TOTAL) or 0.0) + run, 1
            )
            record[DATA_MOUNTED_AT] = None
            record[DATA_MOUNTED_SINCE] = None
        return True

    async def async_unload(self) -> None:
        """Drop the state subscriptions, and write down what was waiting."""
        if self._unsub_odometer:
            self._unsub_odometer()
            self._unsub_odometer = None
        if self._unsub_tpms:
            self._unsub_tpms()
            self._unsub_tpms = None
        if self._unsub_registry:
            self._unsub_registry()
            self._unsub_registry = None
        # A delayed save still pending would be dropped with the store: an
        # options change reloads the entry, and the reading taken a moment
        # earlier has to survive that.
        await self._async_save()

    @callback
    def _payload(self) -> dict:
        """The state as it goes to disk."""
        # Trimmed in memory as well as on the way out. Only the last few swaps
        # are ever written, and a list that grows all session long beside a file
        # that stays short is two histories that disagree.
        del self.data.history[: -HISTORY_LENGTH or None]
        # Copies, not the live containers. The store hands what it is given to
        # a thread to encode, and what is still being written to here would be
        # read from there at the same moment.
        return {
            DATA_SETS: {
                **self._orphans,
                **{sid: s.as_dict() for sid, s in self.data.sets.items()},
            },
            DATA_MOUNTED: dict(self.data.mounted),
            DATA_ODOMETER: self.data.odometer,
            DATA_HISTORY: [dict(entry) for entry in self.data.history],
        }

    async def _async_save(self) -> None:
        """Persist the current state, now.

        For everything that could not be worked out again: a swap, a removal,
        a starting point. Losing one of those loses kilometres nothing else
        records.
        """
        await self._store.async_save(self._payload())

    @callback
    def _schedule_save(self) -> None:
        """Persist within the minute.

        For the odometer alone, and only when it is merely climbing: the figure
        is republished by its source every few seconds while the car moves, and
        the worst a delay can cost is the last minute of a reading that comes
        back on its own. `Store` writes what is pending when Home Assistant
        stops, so a clean shutdown loses nothing at all.
        """
        self._store.async_delay_save(self._payload, SAVE_DELAY)

    # ----- reading -----

    @property
    def sets(self) -> list[TyreSet]:
        """Configured sets, in configuration order."""
        return list(self.data.sets.values())

    def options(self) -> dict[str, str]:
        """Fittable set id -> label. Retired sets are left out: they can be
        read, not mounted.

        Duplicated titles get their size or season back.

        Two sets may legitimately carry the same reference — a spare pair, a
        second-hand set — and a select cannot offer the same option twice.
        """
        live = [t for t in self.data.sets.values() if not t.retired]
        seen: dict[str, int] = {}
        for tyre in live:
            seen[tyre.title] = seen.get(tyre.title, 0) + 1

        out: dict[str, str] = {}
        used: set[str] = set()
        for tyre in live:
            label = tyre.title
            if seen[label] > 1:
                extra = (
                    tyre.size
                    or self.words.get(f"axle.{tyre.axle}")
                    or self.words.get(f"season.{tyre.season}", tyre.season)
                )
                label = f"{label} ({extra})"
            while label in used:
                label = f"{label} ."
            used.add(label)
            out[tyre.set_id] = label
        return out

    def find(self, ref: str) -> TyreSet | None:
        """A set by id, or failing that by title — services take a name."""
        if ref in self.data.sets:
            return self.data.sets[ref]
        for set_id, label in self.options().items():
            if label == ref:
                return self.data.sets[set_id]
        for tyre in self.data.sets.values():
            if tyre.title == ref:
                return tyre
        return None

    def positions_of(self, set_id: str) -> list[str]:
        """The positions a set currently occupies. Empty when it is off."""
        return [p for p in POSITIONS if self.data.mounted.get(p) == set_id]

    def is_mounted(self, set_id: str) -> bool:
        """True when the set is running, on either axle."""
        return bool(self.positions_of(set_id))

    def distance(self, set_id: str) -> float | None:
        """Kilometres run by a set, including the fitted one since it went on.

        A set fitted front and rear has run those kilometres once, not twice:
        both axles cover the same road.
        """
        tyre = self.data.sets.get(set_id)
        if tyre is None:
            return None
        if not self.is_mounted(set_id):
            return round(tyre.total, 1)
        return round(tyre.total + self._rolling(tyre), 1)

    def _rolling(self, tyre: TyreSet) -> float:
        """What the fitted set has run since it went on. Never negative."""
        if tyre.mounted_at is None or self.data.odometer is None:
            return 0.0
        return max(0.0, self.data.odometer - tyre.mounted_at)

    def cost_per_1000(self, set_id: str) -> float | None:
        """What a thousand kilometres cost on this set.

        The figure that compares two references. It only means something once
        the set has run far enough for the division to settle, so a set barely
        fitted is left without one rather than credited with an absurd rate.
        """
        tyre = self.data.sets.get(set_id)
        if tyre is None or tyre.price is None:
            return None
        km = self.distance(set_id) or 0.0
        if km < 1000:
            return None
        return round(tyre.price / km * 1000, 2)

    def km_since_rotation(self, set_id: str) -> float | None:
        """Kilometres run since the last rotation.

        Counted from whichever came last, the rotation or the fitting. A set
        rotated at 100 000, put away for a winter and fitted again at 150 000
        has not run those fifty thousand — another set did — and counting from
        the rotation alone would call for a rotation the day it goes back on.

        Only a fitted set has an answer: off the car it runs nothing, and the
        vehicle's odometer climbing without it means nothing to its tyres.
        """
        tyre = self.data.sets.get(set_id)
        if tyre is None or self.data.odometer is None:
            return None
        marks = [x for x in (tyre.rotated_odometer, tyre.mounted_at) if x is not None]
        if not marks or not self.is_mounted(set_id):
            return None
        return round(max(0.0, self.data.odometer - max(marks)), 1)

    def rotation_due(self, set_id: str) -> bool:
        """True once a fitted set has run its interval since last rotated."""
        if not self.rotation_interval or not self.is_mounted(set_id):
            return False
        tyre = self.data.sets.get(set_id)
        # A pair swaps axles instead of rotating: the two tyres change ends by
        # being fitted to the other axle, which the mount already records.
        if tyre is None or tyre.axle != AXLE_ALL:
            return False
        since = self.km_since_rotation(set_id)
        return since is not None and since >= self.rotation_interval

    # ----- tyre pressure -----

    def slot_label(self, tyre: TyreSet, slot: str) -> str:
        """What a sensor slot is called, from where the set stands.

        A pair holds its sensors by side, because which end of the car they
        are at is decided when it is fitted. Once it is on, « gauche » is a
        corner and is named as one.
        """
        if slot in CORNERS:
            return self.words(f"corner.{slot}")
        for position in self.positions_of(tyre.set_id):
            corner = CORNER_OF.get((position, slot))
            if corner:
                return self.words(f"corner.{corner}")
        return self.words.get(f"side.{slot}", slot)

    def tpms(self, set_id: str) -> dict[str, dict]:
        """Every reading this set's sensors give, by slot.

        One entity is configured per tyre — the pressure one. Temperature and
        battery are found on the same device rather than asked for again:
        three pickers per wheel to say the same thing is a form nobody fills
        in twice.
        """
        tyre = self.data.sets.get(set_id)
        if tyre is None:
            return {}
        out: dict[str, dict] = {}
        for slot in tyre.slots:
            entity_id = tyre.tpms.get(slot)
            if not entity_id:
                continue
            reading = {
                "label": self.slot_label(tyre, slot),
                "entity_id": entity_id,
                **self._readings(entity_id),
            }
            # Two ways a tyre is called wrong, folded into one flag: the
            # verdict the TPMS publishes itself, and the reading measured
            # against the set's target. Either speaking is enough. Both
            # silent leaves None — nothing could judge, which is not the
            # same as « fine ». Distinct from `stale` on purpose: a tyre at
            # 1.4 bar needs air, a tyre whose cell died needs a sensor.
            judges = [
                j
                for j in (
                    reading.get("alarm"),
                    self._threshold_alarm(tyre, slot, reading),
                )
                if j is not None
            ]
            reading["alarm"] = any(judges) if judges else None
            out[slot] = reading
        return out

    def pressures(self) -> dict[str, dict]:
        """What each corner of the car reads, from whatever is fitted to it.

        The sets hold the sensors; the car has the corners. This is where the
        two meet — a pair's left tyre is the front left or the rear left
        depending on the axle it was fitted to, and only the car knows which.
        """
        out: dict[str, dict] = {}
        for position in POSITIONS:
            set_id = self.data.mounted.get(position)
            tyre = self.data.sets.get(set_id) if set_id else None
            if tyre is None:
                continue
            for slot, reading in self.tpms(tyre.set_id).items():
                corner = slot if tyre.axle == AXLE_ALL else CORNER_OF.get(
                    (position, slot)
                )
                if corner:
                    out[corner] = {
                        **reading,
                        "label": self.words(f"corner.{corner}"),
                        "set_id": tyre.set_id,
                    }
        return out

    def _readings(self, entity_id: str) -> dict:
        """Pressure, and whatever the same device says beside it."""
        found = self._companions(entity_id)
        out: dict = {}
        for key, source in found.items():
            state = self.hass.states.get(source)
            if key == "alarm":
                # A problem entity says on or off, not a figure. Unknown is
                # kept as None: an absent verdict is not an acquittal.
                out[key] = (
                    None
                    if state is None
                    or state.state in ("unknown", "unavailable", "")
                    else state.state == "on"
                )
                continue
            if state is None or state.state in ("unknown", "unavailable", ""):
                out[key] = None
                continue
            try:
                out[key] = float(state.state)
            except (TypeError, ValueError):
                out[key] = None
                continue
            if key == "pressure":
                out["unit"] = state.attributes.get(ATTR_UNIT_OF_MEASUREMENT)
            elif key == "temperature":
                # Carried for the same reason as the pressure's: the card used
                # to write « °C » whatever the sensor said, so a probe
                # reporting Fahrenheit read « 64 °C » on a summer morning.
                out["temperature_unit"] = state.attributes.get(
                    ATTR_UNIT_OF_MEASUREMENT
                )
        out.setdefault("pressure", None)
        # A sensor that has stopped reporting is the ordinary end of a TPMS:
        # the cell dies, the entity keeps its last value, and nothing says so
        # unless the age of the reading is carried alongside it.
        #
        # `last_reported` and not `last_changed`: a pressure that holds steady
        # for a week is a sensor doing its job, and reading the moment the
        # figure last moved would file it as dead. What is wanted is the moment
        # it last spoke, which is exactly what a dead cell stops doing.
        state = self.hass.states.get(found.get("pressure", entity_id))
        heard = state.last_reported if state else None
        out["last_seen"] = heard.isoformat() if heard else None
        out["available"] = bool(state and state.state not in ("unknown", "unavailable"))
        # Silent, whatever it still shows. The two ways a TPMS goes quiet — the
        # entity dropping out, and the entity freezing on its last value — read
        # the same on a card, so they are answered as one.
        out["stale"] = not out["available"] or (
            heard is not None
            and dt_util.utcnow() - heard > timedelta(hours=TPMS_STALE_HOURS)
        )
        return out

    def _companions(self, entity_id: str) -> dict[str, str]:
        """The chosen entity, and its siblings on the same TPMS device."""
        if (cached := self._companion_cache.get(entity_id)) is not None:
            return cached
        found = self._resolve_companions(entity_id)
        self._companion_cache[entity_id] = found
        return found

    def _resolve_companions(self, entity_id: str) -> dict[str, str]:
        """Walk the registry for what sits beside a pressure sensor."""
        wanted = {
            SensorDeviceClass.PRESSURE: "pressure",
            SensorDeviceClass.TEMPERATURE: "temperature",
            SensorDeviceClass.BATTERY: "battery",
        }
        found: dict[str, str] = {}

        registry = er.async_get(self.hass)
        entry = registry.async_get(entity_id)
        if entry is not None and entry.device_id:
            for other in er.async_entries_for_device(
                registry, entry.device_id, include_disabled_entities=False
            ):
                # A dock usually publishes its verdict beside the figure — a
                # `problem` entity per wheel. Found, not asked for, exactly
                # like the temperature: it costs nothing to declare.
                if other.domain == "binary_sensor":
                    device_class = other.device_class or other.original_device_class
                    if device_class == "problem" and "alarm" not in found:
                        found["alarm"] = other.entity_id
                    continue
                key = wanted.get(other.device_class or other.original_device_class)
                if key and key not in found:
                    found[key] = other.entity_id

        # No registry entry, or a device that carries nothing else: whatever
        # was chosen is read as the pressure, which is what it was chosen for.
        found.setdefault("pressure", entity_id)
        return found

    def _target_for(self, tyre: TyreSet, slot: str) -> float | None:
        """What this slot should read, from the set's record.

        A corner names its own axle. A side only has one once the pair is on
        the car — off it, there is nothing to measure against, and a pair in
        the garage is judged by its own TPMS alone.
        """
        if slot in CORNERS:
            position = slot.split("_", 1)[0]
        else:
            on = self.positions_of(tyre.set_id)
            position = on[0] if len(on) == 1 else None
        if position == POSITION_FRONT:
            return tyre.pressure_front
        if position == POSITION_REAR:
            return tyre.pressure_rear
        return None

    def _threshold_alarm(self, tyre: TyreSet, slot: str, reading: dict) -> bool | None:
        """The reading measured against the set's target band.

        None when nothing can judge — no target, no reading, or no unit. The
        unit is required rather than assumed: a sensor publishing kPa read as
        bar would flag every tyre on the car, and a false alarm is how an
        alarm gets unplugged.
        """
        target = self._target_for(tyre, slot)
        pressure = reading.get("pressure")
        unit = reading.get("unit")
        if target is None or pressure is None or not unit:
            return None
        try:
            bar = PressureConverter.convert(pressure, unit, UnitOfPressure.BAR)
        except (HomeAssistantError, ValueError, TypeError):
            return None
        return not (
            target * PRESSURE_LOW_RATIO <= bar <= target * PRESSURE_HIGH_RATIO
        )

    # ----- writing -----

    async def async_set_odometer(self, value: float, strict: bool = False) -> None:
        """Record the vehicle's current odometer.

        `strict` marks the readings someone typed on purpose — the service, the
        number box. Those are told when they are refused. A reading that merely
        comes along with a swap is not: the swap is what was asked for, and it
        goes ahead on the figure already recorded.
        """
        if value is None:
            return
        value = float(value)
        # An odometer does not go backwards. A lower value is a typo: refusing
        # it beats freezing every running total at zero.
        if self.data.odometer is not None and value < self.data.odometer:
            if strict:
                raise _refuse(
                    "odometer_backwards",
                    value=round(value),
                    tracked=round(self.data.odometer),
                )
            _LOGGER.warning(
                "tyre_tracker %s: odometer %s below last reading %s — ignored",
                self.vehicle,
                value,
                self.data.odometer,
            )
            return
        if self.data.odometer == value:
            return
        self.data.odometer = value
        self._start_pending()
        await self._async_save()
        self._notify()

    @callback
    def _start_pending(self) -> bool:
        """Give a starting point to a fitted set that never got one.

        A set fitted while the counter was still unknown — a car with no
        odometer entity, before the first reading was typed in — was stamped
        with nothing, and a set without a starting point accumulates nothing.
        It would have sat at its initial total for good, whatever was typed
        afterwards, and said nothing about why.

        The first reading is that starting point. Not zero: the kilometres run
        before anyone wrote a figure down are unknowable, and crediting the
        whole odometer to a set fitted last week would be worse than losing
        the handful it did run. What was already on the tyres belongs in the
        set's initial total, which is asked for when it is declared.
        """
        if self.data.odometer is None:
            return False
        now = dt_util.utcnow().isoformat()
        stamped = False
        for tyre in self.data.sets.values():
            if tyre.mounted_at is None and self.is_mounted(tyre.set_id):
                tyre.mounted_at = self.data.odometer
                tyre.mounted_since = tyre.mounted_since or now
                stamped = True
        return stamped

    async def async_mount(
        self, ref: str, odometer: float | None = None, position: str | None = None
    ) -> None:
        """Fit a set, closing the count of whatever it displaces.

        A set declared for all four wheels takes both positions. One declared
        for an axle takes that axle only, which is what lets a front set and a
        rear set run together.
        """
        incoming = self.find(ref)
        if incoming is None:
            raise _refuse("unknown_set", set=ref, vehicle=self.vehicle)
        if incoming.retired:
            raise _refuse("set_retired", set=incoming.title)

        targets = self._targets(incoming, position)

        if odometer is not None:
            await self.async_set_odometer(odometer)

        before = dict(self.data.mounted)
        if [p for p in POSITIONS if before.get(p) == incoming.set_id] == targets:
            return

        # A pair moved from one axle to the other must leave the first: it is
        # two tyres, and rotating them does not make four.
        for slot in POSITIONS:
            if self.data.mounted.get(slot) == incoming.set_id and slot not in targets:
                self.data.mounted[slot] = None

        # A car carries either one set of four, or two pairs — never a mix.
        # Fitting a pair therefore takes a four-wheel set off entirely: half of
        # it cannot stay on the other axle, since half a set of four is not a
        # set of four. The freed axle is left bare rather than guessed at.
        for slot in targets:
            displaced = self.data.mounted.get(slot)
            if displaced and displaced != incoming.set_id:
                other = self.data.sets.get(displaced)
                if other is not None and other.axle == AXLE_ALL:
                    for every in POSITIONS:
                        if self.data.mounted.get(every) == displaced:
                            self.data.mounted[every] = None

        for slot in targets:
            self.data.mounted[slot] = incoming.set_id

        now = dt_util.utcnow()

        # Close the count of every set that no longer holds a position. A set
        # that was front and rear is settled once: both axles ran the same road.
        added: dict[str, float] = {}
        for sid in {v for v in before.values() if v}:
            if sid == incoming.set_id or self.is_mounted(sid):
                continue
            outgoing = self.data.sets.get(sid)
            if outgoing is None:
                continue
            run = self._rolling(outgoing)
            if run > MAX_STEP_KM:
                _LOGGER.warning(
                    "tyre_tracker %s: %s km credited to %r in one go — mount "
                    "odometer is almost certainly wrong, nothing added",
                    self.vehicle,
                    round(run),
                    outgoing.title,
                )
                run = 0.0
            outgoing.total = round(outgoing.total + run, 1)
            outgoing.mounted_at = None
            outgoing.mounted_since = None
            added[sid] = round(run, 1)

        # Only stamp a start when the set was not already running elsewhere:
        # fitting a front set to the rear as well must not restart its count.
        if incoming.mounted_at is None:
            incoming.mounted_at = self.data.odometer
            incoming.mounted_since = now.isoformat()

        self.data.history.append(
            {
                "at": now.isoformat(),
                "to": incoming.set_id,
                "positions": targets,
                "from": {p: before.get(p) for p in POSITIONS},
                "odometer": self.data.odometer,
                "added": added,
            }
        )

        await self._async_save()
        self._notify()

        # Fired after the state is settled, so an automation reading `km` off
        # the payload sees the total the swap has just closed, not the one it
        # was about to close.
        for sid, run in added.items():
            outgoing = self.data.sets.get(sid)
            if outgoing is not None:
                self._fire(EVENT_UNMOUNTED, outgoing, added=run, replaced_by=incoming.set_id)
        self._fire(EVENT_MOUNTED, incoming, positions=targets)

    def _targets(self, tyre: TyreSet, position: str | None) -> list[str]:
        """The positions a set takes when fitted."""
        if tyre.axle == AXLE_ALL:
            # Asking for one axle only still means both: a four-wheel set is
            # not half-fitted, and pretending otherwise would leave the other
            # axle silently on the previous tyres.
            return list(POSITIONS)
        # A pair goes where it is asked. With no position given — a service
        # call that does not say — it takes the front, the axle one names
        # first when speaking of tyres.
        return [position or POSITIONS[0]]

    async def async_adjust(self, ref: str, total: float) -> None:
        """Correct a set's total by hand — migration, or a mis-entered swap."""
        tyre = self.find(ref)
        if tyre is None:
            raise _refuse("unknown_set", set=ref, vehicle=self.vehicle)
        before = self.distance(tyre.set_id)
        tyre.total = round(float(total), 1)
        # Restart the fitted set from the current odometer, otherwise the
        # correction is immediately undone by the distance already counted.
        if self.is_mounted(tyre.set_id):
            tyre.mounted_at = self.data.odometer
        await self._async_save()
        self._notify()
        self._fire(EVENT_ADJUSTED, tyre, previous=before)

    async def async_unmount(
        self, position: str | None = None, odometer: float | None = None
    ) -> None:
        """Take tyres off without putting others on — the car on jacks.

        Without this the only way to free a position would be to fit something
        else, which is not always what happened.
        """
        if odometer is not None:
            await self.async_set_odometer(odometer)

        slots = [position] if position else list(POSITIONS)

        # Taking off one axle of a four-wheel set takes the whole set off: two
        # of its tyres cannot stay behind on their own.
        for slot in list(slots):
            sid = self.data.mounted.get(slot)
            tyre = self.data.sets.get(sid) if sid else None
            if tyre is not None and tyre.axle == AXLE_ALL:
                slots = list(POSITIONS)
                break

        freed = {self.data.mounted.get(p) for p in slots if self.data.mounted.get(p)}
        for slot in slots:
            self.data.mounted[slot] = None

        now = dt_util.utcnow()
        settled: list[tuple[TyreSet, float]] = []
        for sid in freed:
            # A set still holding the other axle keeps running: only settle
            # what has actually come off the car.
            if self.is_mounted(sid):
                continue
            tyre = self.data.sets.get(sid)
            if tyre is None:
                continue
            run = self._rolling(tyre)
            if run > MAX_STEP_KM:
                _LOGGER.warning(
                    "tyre_tracker %s: %s km credited to %r in one go — mount "
                    "odometer is almost certainly wrong, nothing added",
                    self.vehicle,
                    round(run),
                    tyre.title,
                )
                run = 0.0
            tyre.total = round(tyre.total + run, 1)
            tyre.mounted_at = None
            tyre.mounted_since = None
            self.data.history.append(
                {
                    "at": now.isoformat(),
                    "from": sid,
                    "positions": slots,
                    "odometer": self.data.odometer,
                    "added": round(run, 1),
                    "unmounted": True,
                }
            )
            settled.append((tyre, round(run, 1)))

        await self._async_save()
        self._notify()

        for tyre, run in settled:
            self._fire(EVENT_UNMOUNTED, tyre, added=run, positions=slots)

    async def async_retire(self, ref: str, odometer: float | None = None) -> None:
        """Take a set out of service. It keeps its mileage, frozen.

        A worn set is not deleted: its total is the only record of how long
        that reference lasted, and it is exactly what one wants to compare
        against the next one. Deleting the subentry remains possible for
        whoever does not want the history.
        """
        tyre = self.find(ref)
        if tyre is None:
            raise _refuse("unknown_set", set=ref, vehicle=self.vehicle)
        if tyre.retired:
            return

        if odometer is not None:
            await self.async_set_odometer(odometer)

        # Close the count first, exactly as a swap would: the kilometres run
        # since it was fitted belong to it. The positions it held are left
        # empty rather than filled at random — the car is on jacks, and only
        # the owner knows what goes back on.
        if self.is_mounted(tyre.set_id):
            tyre.total = round(tyre.total + self._rolling(tyre), 1)
            tyre.mounted_at = None
            tyre.mounted_since = None
            for position in self.positions_of(tyre.set_id):
                self.data.mounted[position] = None

        tyre.retired_at = dt_util.utcnow().isoformat()
        tyre.retired_odometer = self.data.odometer

        self.data.history.append(
            {
                "at": tyre.retired_at,
                "from": tyre.set_id,
                "odometer": self.data.odometer,
                "retired": True,
            }
        )

        await self._async_save()
        self._notify()
        self._fire(EVENT_RETIRED, tyre)

    async def async_restore(self, ref: str) -> None:
        """Put a set back into service — a retirement entered by mistake."""
        tyre = self.find(ref)
        if tyre is None:
            raise _refuse("unknown_set", set=ref, vehicle=self.vehicle)
        if not tyre.retired:
            return
        tyre.retired_at = None
        tyre.retired_odometer = None
        await self._async_save()
        self._notify()
        self._fire(EVENT_RESTORED, tyre)

    async def async_rotate(self, ref: str, odometer: float | None = None) -> None:
        """Record a rotation: each wheel moves to the other end of its side.

        Nothing about the mileage changes — the set has run what it has run,
        wherever each tyre sat. What is recorded is the date and the odometer,
        which is what the next reminder counts from, and the pressure sensors
        follow their wheels: a sensor that was on the front left reports from
        the rear left afterwards, and reading it as a front tyre would put the
        pressure of one corner under the label of another.
        """
        tyre = self.find(ref)
        if tyre is None:
            raise _refuse("unknown_set", set=ref, vehicle=self.vehicle)
        if not self.is_mounted(tyre.set_id):
            raise _refuse("not_mounted", set=tyre.title)
        if tyre.axle != AXLE_ALL:
            # Two tyres change ends by being fitted to the other axle, which
            # is a mount and is already recorded as one.
            raise _refuse("pair_not_rotatable", set=tyre.title)

        if odometer is not None:
            await self.async_set_odometer(odometer)

        since = self.km_since_rotation(tyre.set_id)
        tyre.tpms = {
            ROTATION_SWAP.get(slot, slot): entity for slot, entity in tyre.tpms.items()
        }
        tyre.rotated_at = dt_util.utcnow().isoformat()
        tyre.rotated_odometer = self.data.odometer

        self.data.history.append(
            {
                "at": tyre.rotated_at,
                "from": tyre.set_id,
                "odometer": self.data.odometer,
                "rotated": True,
                "after": since,
            }
        )

        await self._async_save()
        self._notify()
        self._fire(EVENT_ROTATED, tyre, after=since)
        # Written last, because it reloads the entry: the sensor mapping lives
        # in the options, not in the store, and a reload would otherwise read
        # the old corners straight back over the rotation.
        self._persist_tpms(tyre)

    async def async_resync_odometer(self, value: float) -> None:
        """Take a new reading as the truth, wherever the old one stood.

        `async_set_odometer` refuses a value below the last one, and rightly:
        an odometer does not go backwards, and accepting a typo would freeze
        every running total. But changing the source does move it backwards —
        a figure typed by hand, then a sensor reading the real dashboard. The
        fitted sets are settled at the old reading first, so the kilometres
        they did run are theirs, and restarted from the new one.
        """
        value = float(value)
        for tyre in self.data.sets.values():
            if not self.is_mounted(tyre.set_id):
                continue
            run = self._rolling(tyre)
            if run > MAX_STEP_KM:
                run = 0.0
            tyre.total = round(tyre.total + run, 1)
            tyre.mounted_at = value
        self.data.odometer = value
        await self._async_save()
        self._notify()

    async def async_separate(
        self, set_id: str, new_id: str, pair: str, odometer: float | None = None
    ) -> float | None:
        """Split a set of four into two pairs, at today's reading.

        Keeping two tyres and replacing the other two is an ordinary thing to
        do, and it leaves two sets where the record holds one. Both inherit
        the mileage of the four — those kilometres were run on all of them,
        and crediting them to one pair while the other restarts at zero would
        be false twice over. From here each pair counts for itself.

        The counters of the pair that leaves are laid down in the store under
        the id its record is about to carry, as a replacement's are: the
        record itself is only born when the flow writes the options, and the
        reload that follows finds the mileage waiting for it.

        Returns the total both pairs start from, or None when the set is not
        one that can be separated.
        """
        tyre = self.data.sets.get(set_id)
        if tyre is None or tyre.axle != AXLE_ALL or tyre.retired:
            _LOGGER.error(
                "tyre_tracker %s: %r cannot be separated — a set of four in "
                "service is what splits in two",
                self.vehicle,
                set_id,
            )
            return None

        if odometer is not None:
            await self.async_set_odometer(odometer)

        was_mounted = self.is_mounted(set_id)

        # Close the count once, on the set as it still is. What the four
        # wheels ran together is the figure both pairs carry away.
        run = self._rolling(tyre)
        if run > MAX_STEP_KM:
            _LOGGER.warning(
                "tyre_tracker %s: %s km credited to %r in one go — mount "
                "odometer is almost certainly wrong, nothing added",
                self.vehicle,
                round(run),
                tyre.title,
            )
            run = 0.0
        shared = round(tyre.total + run, 1)
        tyre.total = shared

        now = dt_util.utcnow()
        keep = POSITION_REAR if pair == POSITION_FRONT else POSITION_FRONT

        if was_mounted:
            # Neither pair comes off: the car keeps its four wheels, and what
            # changes is that they are now counted as two sets. Each restarts
            # from the current reading so the shared total is not counted
            # twice — once in `total`, once in what has rolled since.
            tyre.mounted_at = self.data.odometer
            self.data.mounted[keep] = set_id
            self.data.mounted[pair] = new_id
        else:
            tyre.mounted_at = None
            tyre.mounted_since = None

        self._orphans[new_id] = {
            DATA_TOTAL: shared,
            DATA_MOUNTED_AT: self.data.odometer if was_mounted else None,
            DATA_MOUNTED_SINCE: (
                tyre.mounted_since if was_mounted else None
            ),
            DATA_RETIRED_AT: None,
            DATA_RETIRED_ODOMETER: None,
            # The same wheels as a moment ago: they were rotated when the set
            # was, and the reminder has no reason to start again.
            DATA_ROTATED_AT: tyre.rotated_at,
            DATA_ROTATED_ODOMETER: tyre.rotated_odometer,
        }

        self.data.history.append(
            {
                "at": now.isoformat(),
                "from": set_id,
                "to": new_id,
                "positions": [pair],
                "odometer": self.data.odometer,
                "added": round(run, 1),
                "separated": True,
            }
        )

        await self._async_save()
        self._notify()
        self._fire(
            EVENT_SEPARATED,
            tyre,
            added=round(run, 1),
            pair=pair,
            new_set_id=new_id,
            shared=shared,
        )
        return shared

    async def async_stage_replacement(
        self, new_id: str, positions: list[str], odometer: float | None = None
    ) -> None:
        """Fit a set that does not exist yet.

        Replacing tyres is one act — the old ones come off, the new ones go on
        — but the new set is only born when the options are written, and the
        options are only written when the flow ends. So its counters are laid
        down in the store first, under the id the record is about to carry:
        the reload that follows finds them there and the set comes up fitted,
        at zero, from today's odometer.
        """
        if odometer is not None:
            await self.async_set_odometer(odometer)
        now = dt_util.utcnow()
        self._orphans[new_id] = {
            DATA_TOTAL: 0.0,
            DATA_MOUNTED_AT: self.data.odometer,
            DATA_MOUNTED_SINCE: now.isoformat(),
            DATA_RETIRED_AT: None,
            DATA_RETIRED_ODOMETER: None,
            DATA_ROTATED_AT: None,
            DATA_ROTATED_ODOMETER: None,
        }
        for position in positions:
            self.data.mounted[position] = new_id
        await self._async_save()

    @callback
    def _persist_tpms(self, tyre: TyreSet) -> None:
        """Write a set's sensor mapping back into the entry options."""
        entry = self.hass.config_entries.async_get_entry(self.entry_id)
        if entry is None:
            return
        self.hass.config_entries.async_update_entry(
            entry,
            options={
                **entry.options,
                CONF_SETS: [
                    {**record, CONF_TPMS: dict(tyre.tpms)}
                    if record.get(CONF_SET_ID) == tyre.set_id
                    else record
                    for record in entry.options.get(CONF_SETS, [])
                ],
            },
        )

    # ----- tracked odometer -----

    @callback
    def _tpms_changed(self, event) -> None:
        """A pressure moved: nothing to store, but the card is now stale."""
        self._notify()

    @callback
    def _registry_changed(self, event) -> None:
        """An entity moved, was renamed or disabled: forget what sat beside it."""
        self._companion_cache.clear()

    @callback
    def _odometer_changed(self, event) -> None:
        """Follow the odometer entity, when one is configured."""
        if not self._read_odometer(event.data.get("new_state")):
            return
        if self._start_pending():
            # A starting point that only exists in memory would be stamped
            # again, at a higher reading, after a restart — and the kilometres
            # in between would go nowhere. Written at once, not within the
            # minute. A reading merely climbing can wait.
            self.hass.async_create_task(self._async_save())
        else:
            self._schedule_save()
        self._notify()

    def _read_odometer(self, state: State | None) -> bool:
        """Take a reading from a state object. True when it changed."""
        if state is None or state.state in ("unknown", "unavailable", ""):
            return False
        try:
            value = float(state.state)
        except (TypeError, ValueError):
            return False

        # Everything here is kilometres. A source in miles would otherwise be
        # added to the totals as if it were km, and nothing would say so.
        unit = state.attributes.get(ATTR_UNIT_OF_MEASUREMENT)
        if unit and unit != UnitOfLength.KILOMETERS:
            try:
                value = DistanceConverter.convert(
                    value, unit, UnitOfLength.KILOMETERS
                )
            except (HomeAssistantError, ValueError, TypeError):
                # `HomeAssistantError` is the one that actually comes: an
                # unrecognised unit is refused by the converter itself, and it
                # does not descend from `ValueError`. Left out, the refusal
                # would climb out of a bus callback at every state change.
                _LOGGER.warning(
                    "tyre_tracker %s: odometer %s reports %r, which is not a "
                    "length — reading ignored",
                    self.vehicle,
                    self.odometer_entity,
                    unit,
                )
                return False

        if self.data.odometer is not None and value < self.data.odometer:
            # Said once per episode, not once per reading: a source stuck below
            # the tracking republishes every few seconds, and a warning at that
            # rate is a log nobody reads. Silent, the tracking freezes without
            # a word — re-selecting the odometer source is what resyncs it.
            if not self._odometer_complained:
                self._odometer_complained = True
                _LOGGER.warning(
                    "tyre_tracker %s: odometer %s reads %s, below the tracked "
                    "%s — readings ignored until it passes it. If the source "
                    "is right, re-select it in the options to resync",
                    self.vehicle,
                    self.odometer_entity,
                    round(value),
                    round(self.data.odometer),
                )
            return False
        if (
            self.data.odometer is not None
            and value - self.data.odometer > MAX_STEP_KM
        ):
            # A sensor glitch — 999 999 for a frame — must not become the
            # reading everything else is « below »: accepted, it would freeze
            # the tracking at a figure the car will never reach.
            if not self._odometer_complained:
                self._odometer_complained = True
                _LOGGER.warning(
                    "tyre_tracker %s: odometer %s jumped from %s to %s in one "
                    "reading — ignored as a glitch. If the car really ran "
                    "that far, re-select the source in the options to resync",
                    self.vehicle,
                    self.odometer_entity,
                    round(self.data.odometer),
                    round(value),
                )
            return False
        if self.data.odometer == value:
            return False
        self._odometer_complained = False
        self.data.odometer = round(value, 1)
        # The starting point a fitted set may still be waiting for is stamped by
        # the caller: it decides whether that is worth a write of its own. See
        # `_odometer_changed`, and `async_load` for the first reading of all.
        return True

    # ----- events -----

    @callback
    def _fire(self, event: str, tyre: TyreSet | None = None, **extra) -> None:
        """Announce what just happened, for automations to trigger on.

        The payload says which vehicle, which set and where the odometer
        stood: enough to write the automation without reading anything back.
        """
        payload = {
            "entry_id": self.entry_id,
            "vehicle": self.vehicle,
            "odometer": self.data.odometer,
            **extra,
        }
        if tyre is not None:
            payload |= {
                "set_id": tyre.set_id,
                "tyre_set": tyre.title,
                "reference": tyre.reference,
                "season": tyre.season,
                "km": self.distance(tyre.set_id),
            }
        self.hass.bus.async_fire(event, payload)

    # ----- subscriptions -----

    @callback
    def add_listener(self, listener: Callable[[], None]) -> Callable[[], None]:
        """Subscribe to state changes. Returns the unsubscribe callback."""
        self._listeners.append(listener)

        def remove() -> None:
            if listener in self._listeners:
                self._listeners.remove(listener)

        return remove

    @callback
    def _notify(self) -> None:
        """Tell every entity to write its state."""
        for listener in list(self._listeners):
            listener()
