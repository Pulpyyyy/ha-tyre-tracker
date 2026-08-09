
"""Tyre Tracker — mileage per tyre set, per vehicle.

Answers "how far has this set run", where snowtire answers "is it time to
swap". The two complement each other: one watches the odometer, the other the
weather forecast.

One config entry per vehicle. Each carries its own set list, its own store and
its own device, so two cars never share a total. The services are registered
as entity services on the platform (see sensor.py) rather than on the domain:
targeting a vehicle is then the caller's business, and a swap on the Alfa
cannot move the Clio's counters.

The Lovelace card lives here too, under `frontend/`: the integration serves it
and registers the resource itself, so installing it from HACS is the whole
setup — see frontend/__init__.py.
"""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED, Platform
from homeassistant.core import CoreState, HomeAssistant, callback
from homeassistant.helpers import (
    config_validation as cv,
    device_registry as dr,
)
from homeassistant.helpers.storage import Store
from homeassistant.helpers.typing import ConfigType

from .const import (
    CONF_INITIAL_ODOMETER,
    CONF_ODOMETER_ENTITY,
    CONF_ROTATION_INTERVAL,
    CONF_SET_ID,
    CONF_SETS,
    CONF_VEHICLE,
    DEFAULT_ROTATION_INTERVAL,
    DOMAIN,
    STORAGE_KEY,
    STORAGE_VERSION,
)
from .coordinator import TyreCoordinator
from .frontend import JSModuleRegistration
from .i18n import async_words

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

PLATFORMS: list[Platform] = [Platform.SELECT, Platform.NUMBER, Platform.SENSOR]

type TyreConfigEntry = ConfigEntry[TyreCoordinator]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Publish the card once, whatever the number of vehicles."""

    async def _setup_frontend(_event=None) -> None:
        await JSModuleRegistration(hass).async_register()

    # Before EVENT_HOMEASSISTANT_STARTED, hass.data["lovelace"] does not exist
    # yet: registering the resource would be silently dropped.
    if hass.state is CoreState.running:
        await _setup_frontend()
    else:
        hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STARTED, _setup_frontend)

    return True


async def async_setup_entry(hass: HomeAssistant, entry: TyreConfigEntry) -> bool:
    """Set up one vehicle."""
    sets = _sets_from_options(entry)
    # Read before anything else is built: the coordinator, the devices and the
    # states are all composed from these words, and every one of them is made
    # once, here.
    words = await async_words(hass)
    coordinator = TyreCoordinator(
        hass,
        entry_id=entry.entry_id,
        # The vehicle's name lives in `data`, not in the entry title: the title
        # reads « Suivi d'Alfa GT » and would name the device after the
        # tracking rather than after the car. It is renamed from the options,
        # which retitle the entry to match.
        vehicle=entry.data.get(CONF_VEHICLE) or entry.title,
        sets=sets,
        odometer_entity=entry.options.get(
            CONF_ODOMETER_ENTITY, entry.data.get(CONF_ODOMETER_ENTITY)
        ),
        words=words,
        # The same default the options form shows, so a vehicle configured
        # before the reminder existed behaves as that form says it does.
        rotation_interval=entry.options.get(
            CONF_ROTATION_INTERVAL, DEFAULT_ROTATION_INTERVAL
        ),
        initial_odometer=entry.options.get(CONF_INITIAL_ODOMETER),
    )
    await coordinator.async_load()
    entry.runtime_data = coordinator

    # Nothing clears away a deleted set's device on its own: the record lives
    # in the options, and dropping it there would leave the device and its
    # sensor behind — a train that no longer exists, still listed under the car.
    _async_prune_devices(hass, entry, sets)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def async_remove_config_entry_device(
    hass: HomeAssistant, entry: TyreConfigEntry, device: dr.DeviceEntry
) -> bool:
    """Let a tyre set be deleted from its own page.

    The vehicle is refused: it is the entry itself, and deleting the entry is
    how one gets rid of it. A set is dropped from the options, which reloads
    the entry and clears away what it left.
    """
    set_id = _set_id_of(entry, device)
    if set_id is None:
        return False

    hass.config_entries.async_update_entry(
        entry,
        options={
            **entry.options,
            CONF_SETS: [
                record
                for record in entry.options.get(CONF_SETS, [])
                if record.get(CONF_SET_ID) != set_id
            ],
        },
    )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: TyreConfigEntry) -> bool:
    """Tear one vehicle down."""
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        await entry.runtime_data.async_unload()
    return unloaded


async def async_remove_entry(hass: HomeAssistant, entry: TyreConfigEntry) -> None:
    """Drop the vehicle's store, and the Lovelace resource with the last one.

    The store goes with the entry: the counters only mean something to a
    vehicle that still exists, and a file left behind for every deleted entry
    accumulates in `.storage` for ever.

    The entry being removed is skipped rather than counted: Home Assistant
    calls this before striking it off its own list, so a plain "are there any
    left" counts the one on its way out and never finds the list empty — the
    resource would outlive the last vehicle, pointing at a card no longer
    served.
    """
    await Store(hass, STORAGE_VERSION, f"{STORAGE_KEY}.{entry.entry_id}").async_remove()
    if any(
        other.entry_id != entry.entry_id
        for other in hass.config_entries.async_entries(DOMAIN)
    ):
        return
    await JSModuleRegistration(hass).async_unregister()


def _sets_from_options(entry: TyreConfigEntry) -> list[dict]:
    """One record per tyre set, in the order they were added.

    Each carries its own `id`: the stable key the mileage hangs from, where the
    reference and the label are free to change. A record without one is skipped
    rather than given a fresh id — that would be a new set, with a counter from
    zero, standing where an old one used to be.
    """
    return [
        dict(record)
        for record in entry.options.get(CONF_SETS, [])
        if record.get(CONF_SET_ID)
    ]


def _set_id_of(entry: TyreConfigEntry, device: dr.DeviceEntry) -> str | None:
    """The set a device stands for, or None if it is the vehicle's."""
    prefix = f"{entry.entry_id}_"
    for domain, identifier in device.identifiers:
        if domain == DOMAIN and identifier.startswith(prefix):
            return identifier[len(prefix) :]
    return None


@callback
def _async_prune_devices(
    hass: HomeAssistant, entry: TyreConfigEntry, sets: list[dict]
) -> None:
    """Clear away the devices of sets that are gone.

    Detaching the entry is enough: a device left with no entry behind it is
    removed by Home Assistant, and its entities with it.
    """
    registry = dr.async_get(hass)
    known = {
        (DOMAIN, entry.entry_id),
        *((DOMAIN, f"{entry.entry_id}_{record[CONF_SET_ID]}") for record in sets),
    }
    for device in dr.async_entries_for_config_entry(registry, entry.entry_id):
        if not device.identifiers & known:
            registry.async_update_device(
                device.id, remove_config_entry_id=entry.entry_id
            )


async def _async_reload(hass: HomeAssistant, entry: TyreConfigEntry) -> None:
    """Options changed: reload rather than patch entities in place."""
    await hass.config_entries.async_reload(entry.entry_id)
