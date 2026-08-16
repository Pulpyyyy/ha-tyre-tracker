"""Two figures one types rather than reads: the odometer, and a set's total.

The odometer box is only offered when no odometer entity is configured —
otherwise the value would follow that sensor and typing into it would mean
nothing. A set's total, on the other hand, is always typeable: it is a figure
one knows better than the integration does, and there is no moment at which it
stops being correctable.
"""

from __future__ import annotations

from homeassistant.components.number import (
    ENTITY_ID_FORMAT,
    NumberEntity,
    NumberMode,
)
from homeassistant.const import EntityCategory, UnitOfLength
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import TyreConfigEntry
from .const import DOMAIN, ENTITY_SLUG
from .coordinator import TyreCoordinator, TyreSet
from .entity import TyreEntity, TyreSetEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: TyreConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up the manual odometer, and one total box per set — per vehicle."""
    for coordinator in entry.runtime_data.values():
        if not coordinator.odometer_entity:
            async_add_entities([TyreOdometerNumber(coordinator)])
        else:
            # The box a manual configuration created earlier. With a sensor now
            # reading the counter it will never be offered again, and left in
            # the registry it sits on the vehicle's page as « unavailable » for
            # ever. Unique ids hang from the vehicle's id, not the entry's.
            registry = er.async_get(hass)
            stale = registry.async_get_entity_id(
                "number", DOMAIN, f"{coordinator.entry_id}_odometer"
            )
            if stale:
                registry.async_remove(stale)
        async_add_entities(
            [TyreSetTotalNumber(coordinator, tyre) for tyre in coordinator.sets]
        )


class TyreOdometerNumber(TyreEntity, NumberEntity):
    """The vehicle's odometer."""

    # The icon lives in `icons.json`, with every other fixed one.
    _attr_translation_key = "odometer"
    _attr_mode = NumberMode.BOX
    _attr_native_unit_of_measurement = UnitOfLength.KILOMETERS
    _attr_native_min_value = 0
    _attr_native_max_value = 2_000_000
    _attr_native_step = 1

    def __init__(self, coordinator: TyreCoordinator) -> None:
        """Set up the odometer box."""
        super().__init__(
            coordinator,
            "odometer",
            entity_id_format=ENTITY_ID_FORMAT,
            slug=ENTITY_SLUG["odometer"],
        )

    @property
    def native_value(self) -> float | None:
        """Last recorded odometer."""
        return self.coordinator.data.odometer

    async def async_set_native_value(self, value: float) -> None:
        """Record a new reading.

        Strict: a figure below the last one is refused with a word rather than
        in the log. The box would otherwise snap back to what it showed, and
        nothing on screen would say why.
        """
        await self.coordinator.async_set_odometer(value, strict=True)


class TyreSetTotalNumber(TyreSetEntity, NumberEntity):
    """A set's running total, typed in.

    It shows what the sensor beside it shows — deliberately. The sensor is
    what a history graph and the statistics read; this is the same figure with
    a cursor in it, on the set's own page, so correcting it takes a keystroke
    rather than a service call.
    """

    # The icon lives in `icons.json`, with every other fixed one.
    _attr_translation_key = "total"
    _attr_mode = NumberMode.BOX
    _attr_native_unit_of_measurement = UnitOfLength.KILOMETERS
    _attr_native_min_value = 0
    _attr_native_max_value = 2_000_000
    _attr_native_step = 1
    # Off the main page: it is a correction, not a reading, and it sits next
    # to the sensor that says the same thing.
    _attr_entity_category = EntityCategory.CONFIG

    def __init__(self, coordinator: TyreCoordinator, tyre: TyreSet) -> None:
        """Set up the total box for one set."""
        super().__init__(
            coordinator,
            f"total_{tyre.set_id}",
            tyre,
            entity_id_format=ENTITY_ID_FORMAT,
            slug=ENTITY_SLUG["total"],
        )
        self._set_id = tyre.set_id

    @property
    def native_value(self) -> float | None:
        """Total kilometres, live while fitted."""
        return self.coordinator.distance(self._set_id)

    async def async_set_native_value(self, value: float) -> None:
        """Write the total, and restart the count from here."""
        await self.coordinator.async_adjust(self._set_id, value)
