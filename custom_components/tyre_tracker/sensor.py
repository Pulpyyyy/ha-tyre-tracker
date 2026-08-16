"""One sensor per tyre set, plus one for the fitted set.

A set's sensor carries its mileage. The fitted-set sensor adds nothing to the
model — it only saves an automation or a card from having to work out which
set is on the car.
"""

from __future__ import annotations

import voluptuous as vol

from homeassistant.components.sensor import (
    ENTITY_ID_FORMAT,
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.const import MAX_LENGTH_STATE_STATE, UnitOfLength
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv, entity_platform
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import TyreConfigEntry
from .const import (
    ATTR_ODOMETER,
    ATTR_POSITION,
    CORNERS,
    ENTITY_SLUG,
    POSITION_FRONT,
    POSITION_REAR,
    POSITIONS,
    ATTR_SET,
    ATTR_TOTAL,
    SERVICE_ADJUST,
    SERVICE_MOUNT,
    SERVICE_RESTORE,
    SERVICE_RETIRE,
    SERVICE_ROTATE,
    SERVICE_SET_ODOMETER,
    SERVICE_UNMOUNT,
)
from .coordinator import TyreCoordinator, TyreSet
from .entity import TyreEntity, TyreSetEntity


def _fits(value: str | None) -> str | None:
    """A state within the length Home Assistant accepts.

    Two references named in full on two axles — nothing forbids a hundred
    characters in either — go past the 255 a state may hold, and the write is
    refused outright: the entity would show as unavailable for having too much
    to say. The name is cut rather than the state lost. Every field it is built
    from is readable in the attributes anyway, uncut.
    """
    if value is None or len(value) <= MAX_LENGTH_STATE_STATE:
        return value
    return value[: MAX_LENGTH_STATE_STATE - 1] + "…"


async def async_setup_entry(
    hass: HomeAssistant, entry: TyreConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up one sensor per set, plus the fitted-set sensor — per vehicle."""
    for coordinator in entry.runtime_data.values():
        # One sensor per set, each on the set's own device. Deleting a set is
        # the entry's business now: see `_async_prune_devices` in __init__.py,
        # which clears away what a removed set leaves behind.
        async_add_entities(
            [TyreSetSensor(coordinator, tyre) for tyre in coordinator.sets]
        )
        async_add_entities([TyreMountedSensor(coordinator)])

    # Entity services rather than domain services: with several vehicles the
    # caller must say which one, and Home Assistant does that routing for us.
    # The fitted-set sensor is the target — it is the one entity that always
    # exists, whatever the odometer source.
    platform = entity_platform.async_get_current_platform()
    platform.async_register_entity_service(
        SERVICE_MOUNT,
        {
            vol.Required(ATTR_SET): cv.string,
            vol.Optional(ATTR_ODOMETER): vol.Coerce(float),
            vol.Optional(ATTR_POSITION): vol.In(POSITIONS),
        },
        "async_mount",
    )
    platform.async_register_entity_service(
        SERVICE_SET_ODOMETER,
        {vol.Required(ATTR_ODOMETER): vol.Coerce(float)},
        "async_record_odometer",
    )
    platform.async_register_entity_service(
        SERVICE_UNMOUNT,
        {
            vol.Optional(ATTR_POSITION): vol.In(POSITIONS),
            vol.Optional(ATTR_ODOMETER): vol.Coerce(float),
        },
        "async_unmount",
    )
    platform.async_register_entity_service(
        SERVICE_RETIRE,
        {
            vol.Required(ATTR_SET): cv.string,
            vol.Optional(ATTR_ODOMETER): vol.Coerce(float),
        },
        "async_retire",
    )
    platform.async_register_entity_service(
        SERVICE_RESTORE,
        {vol.Required(ATTR_SET): cv.string},
        "async_restore",
    )
    platform.async_register_entity_service(
        SERVICE_ADJUST,
        {
            vol.Required(ATTR_SET): cv.string,
            vol.Required(ATTR_TOTAL): vol.Coerce(float),
        },
        "async_adjust",
    )
    platform.async_register_entity_service(
        SERVICE_ROTATE,
        {
            vol.Required(ATTR_SET): cv.string,
            vol.Optional(ATTR_ODOMETER): vol.Coerce(float),
        },
        "async_rotate",
    )


class TyreSetSensor(TyreSetEntity, SensorEntity):
    """Kilometres run by one tyre set."""

    # The set is the device, so the entity only has to say what it measures.
    # Naming it after the reference too would read « Michelin CrossClimate 2
    # Michelin CrossClimate 2 » — the device already carries that name, and
    # editing the reference renames it there.
    _attr_translation_key = "mileage"
    _attr_device_class = SensorDeviceClass.DISTANCE
    _attr_native_unit_of_measurement = UnitOfLength.KILOMETERS
    # TOTAL_INCREASING rather than TOTAL: a tyre total never comes down, and a
    # downward correction should read as a reset, not as negative consumption.
    _attr_state_class = SensorStateClass.TOTAL_INCREASING

    def __init__(self, coordinator: TyreCoordinator, tyre: TyreSet) -> None:
        """Set up the sensor for one set."""
        super().__init__(
            coordinator,
            f"set_{tyre.set_id}",
            tyre,
            entity_id_format=ENTITY_ID_FORMAT,
            slug=ENTITY_SLUG["mileage"],
        )
        self._set_id = tyre.set_id

    @property
    def _tyre(self):
        """The record, which the options may have edited since setup."""
        return self.coordinator.data.sets.get(self._set_id)

    @property
    def icon(self) -> str:
        """Season icon."""
        tyre = self._tyre
        return tyre.icon if tyre else "mdi:tire"

    @property
    def native_value(self) -> float | None:
        """Total kilometres, live while fitted."""
        return self.coordinator.distance(self._set_id)

    @property
    def extra_state_attributes(self) -> dict:
        """Enough to explain the number without opening the store."""
        tyre = self._tyre
        if tyre is None:
            return {}
        return {
            "mounted": self.coordinator.is_mounted(self._set_id),
            "positions": [
                self.coordinator.words.get(f"position.{x}", x)
                for x in self.coordinator.positions_of(self._set_id)
            ],
            "axle": tyre.axle,
            "reference": tyre.reference,
            "season": tyre.season,
            "size": tyre.size,
            "dot": tyre.dot,
            # The two figures the sidewall alone can give: how old the rubber
            # is, and whether it is past the age tyres are changed at. A set
            # that spends half its life in a garage reaches that age long
            # before its mileage says anything.
            "manufactured_on": tyre.manufactured_on,
            "age_years": tyre.age_years,
            "aged": tyre.aged,
            "price": tyre.price,
            "cost_per_1000km": self.coordinator.cost_per_1000(self._set_id),
            "storage": tyre.storage,
            "tpms": self.coordinator.tpms(self._set_id),
            "km_since_rotation": self.coordinator.km_since_rotation(self._set_id),
            "rotation_due": self.coordinator.rotation_due(self._set_id),
            "rotated_at": tyre.rotated_at,
            "total_at_removal": round(tyre.total, 1),
            "odometer_at_mount": tyre.mounted_at,
            "mounted_since": tyre.mounted_since,
            "retired": tyre.retired,
            "retired_at": tyre.retired_at,
            "retired_odometer": tyre.retired_odometer,
        }


class TyreMountedSensor(TyreEntity, SensorEntity):
    """The fitted set, and what it has run."""

    # The icon lives in `icons.json`, with every other fixed one. Set here as
    # well it would simply win, and the file would describe an entity it no
    # longer decorates.
    _attr_translation_key = "current"

    def __init__(self, coordinator: TyreCoordinator) -> None:
        """Set up the fitted-set sensor."""
        super().__init__(
            coordinator,
            "current",
            entity_id_format=ENTITY_ID_FORMAT,
            slug=ENTITY_SLUG["current"],
        )

    @property
    def native_value(self) -> str | None:
        """What is on the car: one name when the four wheels match, else both.

        Saying « Alpin 5 » when the rear runs something else would be a lie
        the rest of the card could not undo.
        """
        labels = self.coordinator.options()
        front = self.coordinator.data.mounted.get(POSITION_FRONT)
        rear = self.coordinator.data.mounted.get(POSITION_REAR)
        if front and front == rear:
            return _fits(labels.get(front))
        if not front and not rear:
            return None
        parts = []
        words = self.coordinator.words
        for position, sid in ((POSITION_FRONT, front), (POSITION_REAR, rear)):
            # « AV » in French, « F » in English: an abbreviation is not a
            # translation of the long word cut short, it is its own word.
            short = words(f"position_short.{position}")
            parts.append(f"{short} : {labels.get(sid, '—') if sid else '—'}")
        return _fits(" · ".join(parts))

    @property
    def extra_state_attributes(self) -> dict:
        """Everything a card needs, in one read."""
        data = self.coordinator.data
        labels = self.coordinator.options()
        # Built once and read twice: by corner just below, by set further down.
        # A set of four is fitted to both positions, so asking for each view
        # separately walked the same four sensors three times over — on a state
        # write a connected car triggers every few seconds.
        readings = self.coordinator.all_tpms()
        pressures = self.coordinator.pressures(readings)

        fitted = {}
        for position in POSITIONS:
            sid = data.mounted.get(position)
            tyre = data.sets.get(sid) if sid else None
            fitted[position] = (
                None
                if tyre is None
                else {
                    "id": tyre.set_id,
                    "label": labels.get(tyre.set_id, tyre.title),
                    "reference": tyre.reference,
                    "season": tyre.season,
                    # How many tyres this is. Read from here rather than looked
                    # up in `sets` below: a card showing what is on the car has
                    # this entry in hand, and « four wheels » or « a pair » is
                    # half of what fitted means.
                    "axle": tyre.axle,
                    "km": self.coordinator.distance(tyre.set_id),
                    "mounted_since": tyre.mounted_since,
                }
            )

        return {
            # Where a record is edited: the card carries no form of its own any
            # more, it opens the panel at /tyre-tracker on this very vehicle —
            # and, when a set was touched, on that set. `id` below is the set's.
            # Those two fields are all the card needs to build the address: no
            # entity-registry lookup, no second round trip.
            "entry_id": self.coordinator.entry_id,
            # The car's own name. The card heads itself with it, and cannot
            # get it from the entity: the friendly name is « <car> Tyres »,
            # which would read the tracking rather than the vehicle. The
            # device carries it too, but reaching a device from a card costs
            # a registry round trip for a string we already hold.
            "vehicle": self.coordinator.vehicle,
            "odometer": data.odometer,
            # Whether the car reads its own counter. A card that knows this
            # stops asking for a figure it already has — which is the same rule
            # the flow follows, and the only thing it needed to be told.
            "odometer_auto": bool(self.coordinator.odometer_entity),
            "fitted": fitted,
            # Read by corner rather than by set: this is the car's own view,
            # the one a drawing of four wheels needs.
            "pressures": pressures,
            # The corners whose tyre is called wrong — by the TPMS's own
            # verdict or by the set's target band. An automation triggers on
            # this list without parsing `pressures`, and an empty list means
            # « nothing wrong », not « nothing judged ».
            "pressure_alarm": [
                corner
                for corner in CORNERS
                if (pressures.get(corner) or {}).get("alarm")
            ],
            "rotation_interval": self.coordinator.rotation_interval,
            "sets": [
                {
                    "id": tyre.set_id,
                    "label": labels.get(tyre.set_id, tyre.title),
                    "reference": tyre.reference,
                    "season": tyre.season,
                    "size": tyre.size,
                    "dot": tyre.dot,
                    "km": self.coordinator.distance(tyre.set_id),
                    "mounted": self.coordinator.is_mounted(tyre.set_id),
                    "axle": tyre.axle,
                    # The slots themselves — « front », « rear » — and not their
                    # French labels. A card decides with this field before it
                    # shows anything: whether a pair still has an end free, and
                    # which end to name when taking it off. Translated here, the
                    # comparison it needs is against a word that changes with
                    # the language, and the axle it hands back to a service is
                    # one the service does not accept.
                    "positions": self.coordinator.positions_of(tyre.set_id),
                    "mounted_since": tyre.mounted_since,
                    "retired": tyre.retired,
                    "retired_at": tyre.retired_at,
                    "age_years": tyre.age_years,
                    "aged": tyre.aged,
                    "price": tyre.price,
                    "cost_per_1000km": self.coordinator.cost_per_1000(tyre.set_id),
                    "storage": tyre.storage,
                    "tpms": readings.get(tyre.set_id, {}),
                    "rotation_due": self.coordinator.rotation_due(tyre.set_id),
                    "km_since_rotation": self.coordinator.km_since_rotation(
                        tyre.set_id
                    ),
                }
                for tyre in self.coordinator.sets
            ],
            "last_swap": data.history[-1] if data.history else None,
        }

    # ----- entity services -----

    async def async_mount(
        self,
        tyre_set: str,
        odometer: float | None = None,
        position: str | None = None,
    ) -> None:
        """Fit a set, optionally on a named axle and recording the odometer."""
        await self.coordinator.async_mount(tyre_set, odometer, position)

    async def async_record_odometer(self, odometer: float) -> None:
        """Record the odometer without swapping.

        Strict: this figure was typed on purpose, and a reading below the last
        one is refused out loud rather than passed over. An automation that
        records the wrong counter has to hear about it.
        """
        await self.coordinator.async_set_odometer(odometer, strict=True)

    async def async_adjust(self, tyre_set: str, total: float) -> None:
        """Set a tyre set's running total by hand."""
        await self.coordinator.async_adjust(tyre_set, total)

    async def async_unmount(
        self, position: str | None = None, odometer: float | None = None
    ) -> None:
        """Take tyres off a position, or off the car entirely."""
        await self.coordinator.async_unmount(position, odometer)

    async def async_retire(self, tyre_set: str, odometer: float | None = None) -> None:
        """Take a set out of service, freezing its mileage."""
        await self.coordinator.async_retire(tyre_set, odometer)

    async def async_restore(self, tyre_set: str) -> None:
        """Put a retired set back into service."""
        await self.coordinator.async_restore(tyre_set)

    async def async_rotate(self, tyre_set: str, odometer: float | None = None) -> None:
        """Record a rotation on a fitted four-wheel set."""
        await self.coordinator.async_rotate(tyre_set, odometer)
