
"""Tyre Tracker — mileage per tyre set, per vehicle.

Answers "how far has this set run", where snowtire answers "is it time to
swap". The two complement each other: one watches the odometer, the other the
weather forecast.

ONE config entry for the whole integration. Each vehicle is a record in its
options, and keeps everything it had when it was an entry of its own: a
coordinator, a store of its counters, a device, its entities — all keyed by
the record's stable id. Two cars still never share a total; what they share
is the entry, which is what lets the manifest declare `single_config_entry`
and Home Assistant retire the « add » button instead of this integration
answering it with a step that did nothing.

The services are registered as entity services on the platform (see sensor.py)
rather than on the domain: targeting a vehicle is then the caller's business,
and a swap on the Alfa cannot move the Clio's counters.

The Lovelace card lives here too, under `frontend/`: the integration serves it
and registers the resource itself, so installing it from HACS is the whole
setup — see frontend/__init__.py.

Configuration happens in the admin panel at /tyre-tracker, served from the
same folder: the config flow declares the first vehicle and stops there, and
the panel's WebSocket commands (see websocket_api.py) write everything else —
the records into the entry options, the manoeuvres through the coordinators.
"""

from __future__ import annotations

import logging

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
    CONFIG_VERSION,
    CONF_INITIAL_ODOMETER,
    CONF_ODOMETER_ENTITY,
    CONF_ROTATION_INTERVAL,
    CONF_SET_ID,
    CONF_SETS,
    CONF_VEHICLE,
    CONF_VEHICLE_ID,
    CONF_VEHICLES,
    DEFAULT_ROTATION_INTERVAL,
    DOMAIN,
    STORAGE_KEY,
    STORAGE_VERSION,
)
from .coordinator import TyreCoordinator
from .frontend import (
    JSModuleRegistration,
    async_register_panel,
    async_unregister_panel,
)
from .i18n import async_words
from .websocket_api import async_register_websocket_api

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

PLATFORMS: list[Platform] = [Platform.SELECT, Platform.NUMBER, Platform.SENSOR]

# One coordinator per vehicle, keyed by the vehicle record's id.
type TyreConfigEntry = ConfigEntry[dict[str, TyreCoordinator]]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Publish the card and the panel once, whatever the number of vehicles."""
    # The panel and its commands are the integration's own configuration
    # interface: they are registered before any vehicle is, so that a car added
    # from the sidebar has somewhere to be described the moment it exists.
    # Neither depends on Lovelace, so neither waits for it.
    async_register_websocket_api(hass)
    await async_register_panel(hass)

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
    """Set up every vehicle the entry holds."""
    # Both are idempotent, and both are done again here rather than only in
    # `async_setup`: that one runs once per start, and a fresh install has to
    # bring the editor up without a restart.
    async_register_websocket_api(hass)
    await async_register_panel(hass)

    # Read before anything else is built: the coordinators, the devices and
    # the states are all composed from these words, and every one of them is
    # made once, here.
    words = await async_words(hass)

    coordinators: dict[str, TyreCoordinator] = {}
    for record in _vehicle_records(entry):
        vehicle_id = record[CONF_VEHICLE_ID]
        coordinator = TyreCoordinator(
            hass,
            # The vehicle's id plays the part the config entry's id played
            # when each vehicle was an entry: store key, device identifiers,
            # event payloads all hang from it.
            entry_id=vehicle_id,
            vehicle=record.get(CONF_VEHICLE) or vehicle_id,
            sets=[
                dict(item)
                for item in record.get(CONF_SETS, [])
                # A record without an id would be a new set, with a counter
                # from zero, standing where an old one used to be.
                if item.get(CONF_SET_ID)
            ],
            odometer_entity=record.get(CONF_ODOMETER_ENTITY),
            words=words,
            rotation_interval=record.get(
                CONF_ROTATION_INTERVAL, DEFAULT_ROTATION_INTERVAL
            ),
            initial_odometer=record.get(CONF_INITIAL_ODOMETER),
            config_entry_id=entry.entry_id,
        )
        await coordinator.async_load()
        # Registered the moment the coordinator starts listening, and not left
        # to `async_unload_entry`: a setup that fails below never reaches
        # that, and the odometer, TPMS and registry subscriptions would go on
        # firing at a coordinator nothing holds any more.
        entry.async_on_unload(coordinator.async_unload)
        coordinators[vehicle_id] = coordinator

    entry.runtime_data = coordinators

    # Nothing clears away a deleted vehicle's or set's device on its own: the
    # records live in the options, and dropping one there would leave the
    # device and its entities behind.
    _async_prune_devices(hass, entry)

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def async_remove_config_entry_device(
    hass: HomeAssistant, entry: TyreConfigEntry, device: dr.DeviceEntry
) -> bool:
    """Let a tyre set be deleted from its own page.

    A vehicle is refused: deleting a car is the editor's business (or the
    whole entry's), not a device page's. A set is dropped from its vehicle's
    record, which reloads the entry and clears away what it left.
    """
    owner = _owner_of(entry, device)
    if owner is None:
        return False
    vehicle_record, set_id = owner
    if set_id is None:
        return False

    hass.config_entries.async_update_entry(
        entry,
        options={
            **entry.options,
            CONF_VEHICLES: [
                {
                    **record,
                    CONF_SETS: [
                        item
                        for item in record.get(CONF_SETS, [])
                        if item.get(CONF_SET_ID) != set_id
                    ],
                }
                if record.get(CONF_VEHICLE_ID) == vehicle_record[CONF_VEHICLE_ID]
                else record
                for record in _vehicle_records(entry)
            ],
        },
    )
    return True


async def async_migrate_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Refuse an entry this release cannot read, in a sentence.

    Lower numbers were written when each vehicle was an entry of its own, by
    the betas; there is nothing to convert such an entry from. Without this,
    Home Assistant reports « Migration handler not found », which says what is
    missing rather than what to do about it.

    A higher number means a downgrade, which is refused for the opposite
    reason: the options were written by a release that knew more than this one.
    """
    if entry.version < CONFIG_VERSION:
        _LOGGER.error(
            "tyre_tracker: %r was configured by a pre-release version "
            "(schema %s, this release reads %s) and cannot be converted. "
            "Delete every Tyre Tracker entry, then add the integration once — "
            "the vehicles are re-declared in its editor, and their mileage "
            "typed back in from the totals their sensors showed",
            entry.title,
            entry.version,
            CONFIG_VERSION,
        )
    else:
        _LOGGER.error(
            "tyre_tracker: %r was configured by a newer version (schema %s, "
            "this release reads %s). Upgrade the integration again, or delete "
            "the entry and add it back",
            entry.title,
            entry.version,
            CONFIG_VERSION,
        )
    return False


async def async_unload_entry(hass: HomeAssistant, entry: TyreConfigEntry) -> bool:
    """Tear every vehicle down.

    The coordinators let go through the `async_on_unload` registered at setup,
    which Home Assistant runs once the platforms are down — so a setup that
    failed halfway is cleaned up by the same path as one that succeeded.
    """
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def async_remove_entry(hass: HomeAssistant, entry: TyreConfigEntry) -> None:
    """Drop every vehicle's store, and the frontend with them.

    The stores go with the entry: the counters only mean something to vehicles
    that still exist, and files left behind accumulate in `.storage` for ever.
    The entry's own id is covered too — it is the store key a pre-single-entry
    vehicle wrote under, and deleting such an entry lands here as well.

    The panel and the card resource go at the same moment: this entry is the
    only one there is, and a sidebar entry opening on a page that can only say
    « no vehicle » would be an invitation to nothing.
    """
    for record in _vehicle_records(entry):
        await Store(
            hass, STORAGE_VERSION, f"{STORAGE_KEY}.{record[CONF_VEHICLE_ID]}"
        ).async_remove()
    await Store(hass, STORAGE_VERSION, f"{STORAGE_KEY}.{entry.entry_id}").async_remove()
    await JSModuleRegistration(hass).async_unregister()
    async_unregister_panel(hass)


def _vehicle_records(entry: ConfigEntry) -> list[dict]:
    """One record per vehicle, in the order they were added.

    Each carries its own `id`: the stable key everything the vehicle owns
    hangs from. A record without one is skipped rather than given a fresh id —
    that would be a new car, with counters from zero, standing where an old
    one used to be.
    """
    return [
        dict(record)
        for record in entry.options.get(CONF_VEHICLES, [])
        if record.get(CONF_VEHICLE_ID)
    ]


def _owner_of(
    entry: TyreConfigEntry, device: dr.DeviceEntry
) -> tuple[dict, str | None] | None:
    """The vehicle a device belongs to, and the set's id when it is a set's.

    None when the device is nobody's — another integration's, or a vehicle
    deleted since the page was drawn.
    """
    records = _vehicle_records(entry)
    for domain, identifier in device.identifiers:
        if domain != DOMAIN:
            continue
        for record in records:
            vehicle_id = record[CONF_VEHICLE_ID]
            if identifier == vehicle_id:
                return record, None
            if identifier.startswith(f"{vehicle_id}_"):
                return record, identifier[len(vehicle_id) + 1 :]
    return None


@callback
def _async_prune_devices(hass: HomeAssistant, entry: TyreConfigEntry) -> None:
    """Clear away the devices of vehicles and sets that are gone.

    Detaching the entry is enough: a device left with no entry behind it is
    removed by Home Assistant, and its entities with it.
    """
    registry = dr.async_get(hass)
    known: set[tuple[str, str]] = set()
    for record in _vehicle_records(entry):
        vehicle_id = record[CONF_VEHICLE_ID]
        known.add((DOMAIN, vehicle_id))
        known.update(
            (DOMAIN, f"{vehicle_id}_{item[CONF_SET_ID]}")
            for item in record.get(CONF_SETS, [])
            if item.get(CONF_SET_ID)
        )
    for device in dr.async_entries_for_config_entry(registry, entry.entry_id):
        if not device.identifiers & known:
            registry.async_update_device(
                device.id, remove_config_entry_id=entry.entry_id
            )


async def _async_reload(hass: HomeAssistant, entry: TyreConfigEntry) -> None:
    """Options changed: reload rather than patch entities in place."""
    await hass.config_entries.async_reload(entry.entry_id)
