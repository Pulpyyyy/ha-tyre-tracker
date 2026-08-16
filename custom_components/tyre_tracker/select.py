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
    """Set up one selector per position, for every vehicle."""
    async_add_entities(
        TyreMountedSelect(coordinator, p)
        for coordinator in entry.runtime_data.values()
        for p in POSITIONS
    )


class TyreMountedSelect(TyreEntity, SelectEntity):
    """Which tyre set sits on one axle."""

    # The icon lives in `icons.json`, with every other fixed one.

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
    def _bare(self) -> str:
        """What an axle carrying nothing is called.

        An option and not an empty state: a select with no way back offers
        every manoeuvre except the one a garage starts with, and taking the
        wheels off would have meant reaching for a service call while the
        selector that put them on sat right there.
        """
        return self.coordinator.words("status.bare")

    @property
    def options(self) -> list[str]:
        """Every set in service, and the choice of carrying none."""
        return [self._bare, *self.coordinator.options().values()]

    @property
    def current_option(self) -> str | None:
        """Label of the set on this axle, or the bare axle."""
        set_id = self.coordinator.data.mounted.get(self._position)
        if set_id is None:
            return self._bare
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
        """Fit the chosen set to this axle, or take off what is there.

        The sets are looked up before the bare choice is considered, rather
        than after: a set may legitimately be labelled with the same word, and
        the one thing worse than an unreachable option is one that quietly
        does the opposite.
        """
        for set_id, label in self.coordinator.options().items():
            if label == option:
                await self.coordinator.async_mount(set_id, position=self._position)
                return
        if option == self._bare:
            await self.coordinator.async_unmount(self._position)
