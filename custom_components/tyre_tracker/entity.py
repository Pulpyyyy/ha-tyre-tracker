"""Shared base: the vehicle's device, and one device per tyre set.

The three platforms show the same state in different shapes. They share their
device attachment and their coordinator subscription — written once rather
than three times.

Two devices, not one. What belongs to the car — the odometer, the two axle
selectors, what is fitted — hangs from the vehicle. A tyre set is a thing one
buys, stores in a garage and throws away, so it gets a device of its own,
attached to the car through `via_device`. Hanging a set's sensor on the
vehicle device instead made Home Assistant list the same « Alfa GT » once
under the vehicle and once under every tyre subentry: the same five entities,
counted again under a heading that promised a different device.
"""

from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity import Entity, async_generate_entity_id

from .const import AXLE_PAIR, DOMAIN
from .coordinator import TyreCoordinator, TyreSet
from .i18n import Words


class TyreEntity(Entity):
    """An entity of the vehicle itself."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(
        self,
        coordinator: TyreCoordinator,
        key: str,
        *,
        entity_id_format: str | None = None,
        slug: str | None = None,
    ) -> None:
        """Attach to the vehicle's device.

        `slug` pins the entity_id in English. Left out, Home Assistant falls
        back to building one from the translated name — which is exactly the
        drift this exists to stop. See `ENTITY_SLUG` in const.py.
        """
        self.coordinator = coordinator
        self._attr_unique_id = f"{coordinator.entry_id}_{key}"
        if entity_id_format and slug:
            self._pin(entity_id_format, coordinator.vehicle, slug)
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, coordinator.entry_id)},
            name=coordinator.vehicle,
            manufacturer="Tyre Tracker",
            # The second line of the row, and the only place where a list of
            # devices can say what this one is. One word that separates it
            # from the trains sitting under it — « Kilométrage par jeu de
            # pneus » described the integration, which the column beside it
            # already names.
            #
            # `DeviceInfo` takes a plain string, which no `translations/` key
            # can reach on its own — so the integration reads the word itself,
            # in the language Home Assistant is set to. See `i18n.py`.
            model=coordinator.words("device.vehicle"),
        )

    def _pin(self, entity_id_format: str, device_name: str, slug: str) -> None:
        """Choose the entity_id, rather than let the display name choose it.

        Setting it before the entity is added is what makes the registry take
        it. It only decides the first time: an entity already registered keeps
        the id it has, so a name the owner chose by hand survives.
        """
        self.entity_id = async_generate_entity_id(
            entity_id_format, f"{device_name} {slug}", hass=self.coordinator.hass
        )

    async def async_added_to_hass(self) -> None:
        """Subscribe while on the bus."""
        await super().async_added_to_hass()
        self.async_on_remove(self.coordinator.add_listener(self.async_write_ha_state))


class TyreSetEntity(TyreEntity):
    """An entity of one tyre set, on a device of its own."""

    def __init__(
        self,
        coordinator: TyreCoordinator,
        key: str,
        tyre: TyreSet,
        *,
        entity_id_format: str | None = None,
        slug: str | None = None,
    ) -> None:
        """Attach to the set's device, itself attached to the vehicle."""
        super().__init__(coordinator, key)
        # The set names its own entities, not the car: `sensor.pirelli_mileage`
        # and not `sensor.alfa_gt_mileage`, which four sets would all want.
        if entity_id_format and slug:
            self._pin(entity_id_format, tyre.title, slug)
        # What is written on the sidewall, read as a device would be: the
        # first word of the reference is the maker, the size is the model, and
        # the date code is the nearest thing a tyre has to a serial number.
        brand = tyre.reference.split(" ", 1)[0]
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, f"{coordinator.entry_id}_{tyre.set_id}")},
            name=tyre.title,
            manufacturer=brand or "Tyre Tracker",
            model=_set_model(tyre, coordinator.words),
            serial_number=tyre.dot or None,
            via_device=(DOMAIN, coordinator.entry_id),
        )


def _set_model(tyre: TyreSet, words: Words) -> str:
    """The set's second line: what one would ask for at the counter.

    Size, season, and — only when it is a pair — how many wheels it covers.
    Four wheels is the ordinary case and saying so on every row would drown
    the one line that matters. The name above already says which set it is;
    this says which tyres they are.
    """
    parts = [tyre.size] if tyre.size else []
    parts.append(words.get(f"season.{tyre.season}") or words("device.tyre_set"))
    if tyre.axle == AXLE_PAIR:
        parts.append(words(f"axle.{AXLE_PAIR}"))
    return " · ".join(parts)
