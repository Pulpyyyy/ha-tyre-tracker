"""One selector per position. Choosing there is what performs the swap.

A vehicle offers two positions, front and rear. A set declared for all four
wheels appears in both selectors and takes both when chosen; a set declared
for an axle only appears in that one.
"""

from __future__ import annotations

from homeassistant.components.select import ENTITY_ID_FORMAT, SelectEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import TyreConfigEntry
from .const import ENTITY_SLUG, POSITIONS
from .coordinator import TyreCoordinator
from .entity import TyreEntity


async def async_setup_entry(
    hass: HomeAssistant, entry: TyreConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up one selector per position."""
    coordinator = entry.runtime_data
    async_add_entities(TyreMountedSelect(coordinator, p) for p in POSITIONS)


class TyreMountedSelect(TyreEntity, SelectEntity):
    """Which tyre set sits on one axle."""

    _attr_icon = "mdi:car-tire-alert"

    def __init__(self, coordinator: TyreCoordinator, position: str) -> None:
        """Set up the selector for one position."""
        super().__init__(
            coordinator,
            f"mounted_{position}",
            entity_id_format=ENTITY_ID_FORMAT,
            slug=ENTITY_SLUG[f"mounted_{position}"],
        )
        self._position = position
        self._attr_translation_key = f"mounted_{position}"

    @property
    def options(self) -> list[str]:
        """Every set in service: a pair goes on either axle."""
        return list(self.coordinator.options().values())

    @property
    def current_option(self) -> str | None:
        """Label of the set on this axle."""
        set_id = self.coordinator.data.mounted.get(self._position)
        if set_id is None:
            return None
        return self.coordinator.options().get(set_id)

    def _label(self) -> str:
        """The axle's name, in the language Home Assistant is set to."""
        return self.coordinator.words.get(
            f"position.{self._position}", self._position
        )

    @property
    def extra_state_attributes(self) -> dict:
        """The record of what is on this axle."""
        set_id = self.coordinator.data.mounted.get(self._position)
        tyre = self.coordinator.data.sets.get(set_id) if set_id else None
        if tyre is None:
            return {"position": self._label()}
        return {
            "position": self._label(),
            "set_id": tyre.set_id,
            "reference": tyre.reference,
            "season": tyre.season,
            "axle": tyre.axle,
            "size": tyre.size,
        }

    async def async_select_option(self, option: str) -> None:
        """Fit the chosen set to this axle."""
        await self.coordinator.async_mount(option, position=self._position)
