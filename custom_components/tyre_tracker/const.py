"""Constants for Tyre Tracker."""

from __future__ import annotations

from typing import Final

DOMAIN: Final = "tyre_tracker"

# The schema the released integration ships with. Held here rather than only on
# the flow class so `async_migrate_entry` can answer without importing it.
# 4 is the single-entry schema: ONE entry for the integration, every vehicle a
# record in its options. Lower numbers were one entry per vehicle and belong to
# the betas; such an entry no longer loads.
CONFIG_VERSION: Final = 4

# The manifest is the single place the version is written. The card resource
# carries it as `?v=`, so an upgrade invalidates the browser cache on its own.
# Read through `async_get_integration`, which already holds the parsed manifest:
# opening the file here would be disk I/O at import time, for a string Home
# Assistant has in hand.
FALLBACK_VERSION: Final = "0.0.0"

# Frontend. The card ships with the integration and is served from its own
# folder: a HACS install brings it along, with nothing to copy into `www/`.
URL_BASE: Final = "/tyre_tracker_frontend"
CARD_FILENAME: Final = "tyres-card.js"

# JS modules published to the Lovelace resources. The file holds both the card
# and the floorplan badge — one module, two custom elements.
#
# The admin panel is NOT in this list, and must never be: a Lovelace resource is
# loaded into every dashboard of the house, and the panel is a page of its own.
# It travels the same way — served from the integration's folder, with the same
# `?v=` — but through `frontend.async_register_built_in_panel`.
JSMODULES: Final[list[dict[str, str]]] = [
    {"name": "Tyres Card", "filename": CARD_FILENAME},
]

# ── Admin panel ───────────────────────────────────────────────────────────────
# Everything the integration is configured with is edited here: the config flow
# creates a vehicle and stops there, and the options flow — seventeen steps of
# menus and forms — was removed once this covered all of them.
#
# Reachable three ways: the sidebar (see below), the vehicle device's
# `configuration_url`, and http://ha:8123/tyre-tracker directly.
ADMIN_JS: Final = "tyre-tracker-admin.js"
PANEL_URL_PATH: Final = "tyre-tracker"
PANEL_NAME: Final = "tyre-tracker-panel"  # the custom element ADMIN_JS defines
# Declaring a sidebar title is what lets each user show or hide the entry from
# Home Assistant's own sidebar editor (long-press the sidebar header). A panel
# without a title is not merely hidden: nobody can bring it back. Not
# translated — `async_register_built_in_panel` takes a literal string.
PANEL_SIDEBAR_TITLE: Final = "Tyre Tracker"
PANEL_SIDEBAR_ICON: Final = "mdi:tire"

# WebSocket API — the panel's only way in and out. Four commands write:
# `config/save` for what is recorded, `action` for what is done to a set, and
# `vehicle/create` / `vehicle/delete` for the car itself — the first is the
# config flow's import step in panel clothing, the second removes the entry,
# which is what the integration page's own delete button does.
WS_CONFIG_GET: Final = f"{DOMAIN}/config/get"
WS_CONFIG_SAVE: Final = f"{DOMAIN}/config/save"
WS_ACTION: Final = f"{DOMAIN}/action"
WS_VEHICLE_CREATE: Final = f"{DOMAIN}/vehicle/create"
WS_VEHICLE_DELETE: Final = f"{DOMAIN}/vehicle/delete"

# The vehicles, in the single entry's options. One record each, carrying its
# own stable `id`: the key its store, its devices and its entity unique_ids
# hang from — everything a config entry's entry_id used to provide when each
# vehicle was an entry of its own.
CONF_VEHICLES: Final = "vehicles"
CONF_VEHICLE_ID: Final = "id"

# Vehicle record fields
CONF_VEHICLE: Final = "vehicle"
CONF_ODOMETER_ENTITY: Final = "odometer_entity"
# Where the counter stood when tracking started. Only read while the store is
# empty: afterwards the odometer is a recorded reading, not a setting.
CONF_INITIAL_ODOMETER: Final = "initial_odometer"

# Tyre sets, in the entry options. One record per set, each carrying its own
# `id` — the stable key the mileage hangs from, so a reference can be
# corrected without losing a kilometre. Subentries did the same job and gave
# Home Assistant a device group per set, which listed the vehicle once per
# group: the same car, drawn as many times as it had tyres.
CONF_SETS: Final = "sets"
CONF_SET_ID: Final = "id"

CONF_REFERENCE: Final = "reference"
CONF_SEASON: Final = "season"
CONF_LABEL: Final = "label"
CONF_SIZE: Final = "size"
CONF_AXLE: Final = "axle"
# The four digits stamped on the sidewall: week and year of manufacture. A
# tyre ages whether it runs or not, and this is the only place that says how
# old it is — no odometer will ever tell.
CONF_DOT: Final = "dot"
CONF_INITIAL_TOTAL: Final = "initial_total"
# What the set cost, for the whole set. Divided by what it ran, it says which
# reference was actually the cheapest — a tyre lasting a fifth longer for half
# again the price is a bad buy, and no mileage total says so on its own.
CONF_PRICE: Final = "price"
# Where the set sits when it is off the car. Written down because it is the
# question one asks six months later, and nothing else in the record answers it.
CONF_STORAGE: Final = "storage"
# One pressure sensor per tyre, kept under the set: the sensor is screwed to
# the wheel, so it travels with the set and not with the car.
CONF_TPMS: Final = "tpms"
# What each axle should be inflated to, cold, in bar — the door-sticker
# figures. They live in the set's record, next to its size: a winter set and
# a summer set on the same car may carry different placards. Filled in, any
# pressure sensor becomes an alarm; empty, only a companion alarm entity
# published by the TPMS itself can say a tyre is wrong.
CONF_PRESSURE_FRONT: Final = "pressure_front"
CONF_PRESSURE_REAR: Final = "pressure_rear"
# Which pair of a set of four leaves it, when the set is separated in two.
# An axle rather than a side: a car is split front and rear, never lengthwise.
CONF_PAIR: Final = "pair"

# Vehicle-wide. Kilometres between two rotations, 0 to say nothing about it.
CONF_ROTATION_INTERVAL: Final = "rotation_interval"
DEFAULT_ROTATION_INTERVAL: Final = 10_000

SEASON_SUMMER: Final = "summer"
SEASON_WINTER: Final = "winter"
SEASON_ALL: Final = "all_season"

SEASONS: Final = (SEASON_SUMMER, SEASON_WINTER, SEASON_ALL)

# How many wheels a set covers. Not where it goes — a pair is mounted front
# or rear as one pleases, and moving it from one axle to the other is an
# ordinary rotation, not a different set.
AXLE_ALL: Final = "all"
AXLE_PAIR: Final = "pair"

AXLES: Final = (AXLE_ALL, AXLE_PAIR)

# The two positions a vehicle offers. A four-wheel set fills both; a pair
# fills exactly one, and may be moved between them.
POSITION_FRONT: Final = "front"
POSITION_REAR: Final = "rear"

POSITIONS: Final = (POSITION_FRONT, POSITION_REAR)

# The four corners of the car. One tyre each, therefore one pressure sensor
# each: a set of four carries four, a pair carries two.
CORNER_FRONT_LEFT: Final = "front_left"
CORNER_FRONT_RIGHT: Final = "front_right"
CORNER_REAR_LEFT: Final = "rear_left"
CORNER_REAR_RIGHT: Final = "rear_right"

CORNERS: Final = (
    CORNER_FRONT_LEFT,
    CORNER_FRONT_RIGHT,
    CORNER_REAR_LEFT,
    CORNER_REAR_RIGHT,
)

# A pair has a left and a right, and no fixed axle: which corners it occupies
# is decided by where it is fitted, not by the record. Its sensors are
# therefore held by side, and read as corners only once the pair is on the car.
SIDE_LEFT: Final = "left"
SIDE_RIGHT: Final = "right"

SIDES: Final = (SIDE_LEFT, SIDE_RIGHT)

# Which corner a side lands on, given the axle the pair sits on.
CORNER_OF: Final = {
    (POSITION_FRONT, SIDE_LEFT): CORNER_FRONT_LEFT,
    (POSITION_FRONT, SIDE_RIGHT): CORNER_FRONT_RIGHT,
    (POSITION_REAR, SIDE_LEFT): CORNER_REAR_LEFT,
    (POSITION_REAR, SIDE_RIGHT): CORNER_REAR_RIGHT,
}

# A rotation moves each wheel to the other end of the same side. Front to back
# rather than crosswise: a directional tyre cannot change side without being
# unmounted from its rim, and this pattern is the one every set accepts.
ROTATION_SWAP: Final = {
    CORNER_FRONT_LEFT: CORNER_REAR_LEFT,
    CORNER_REAR_LEFT: CORNER_FRONT_LEFT,
    CORNER_FRONT_RIGHT: CORNER_REAR_RIGHT,
    CORNER_REAR_RIGHT: CORNER_FRONT_RIGHT,
}

# Shown on a set taken out of service: it keeps its mileage, frozen. An
# archive box rather than a worn tyre — what is kept is the record.
RETIRED_ICON: Final = "mdi:archive-outline"

# The three markings found on a sidewall: a sun, a snowflake, and the two
# together. `weather-snowy-rainy` described a forecast, not a tyre.
#
# The sun is `white-balance-sunny` and not `weather-sunny`: the latter draws a
# ring, and a ring shrunk to the 15 px of a floor-plan badge is a smudge of the
# same weight as a snowflake. A filled disc against an open six-armed star is a
# difference of mass, which survives any size.
SEASON_ICONS: Final = {
    SEASON_SUMMER: "mdi:white-balance-sunny",
    SEASON_WINTER: "mdi:snowflake",
    SEASON_ALL: "mdi:sun-snowflake",
}

# The entry is titled after the integration — « Tyre Tracker », plainly. It is
# one entry for every vehicle, and a car's name belongs to its device, which is
# what names the entities: « Alfa GT Odometer ». The per-vehicle titles of the
# one-entry-per-car era (« Suivi d'Alfa GT », with the French elision worked
# out in `words/`) went with the era.


# The last word of each entity_id, in English whatever the interface speaks.
#
# Home Assistant builds an entity_id from the *translated* name, in the
# language the server happens to be set to: the same integration gives
# `sensor.alfa_gt_pneumatiques` in Paris and `sensor.alfa_gt_reifen` in Berlin.
# Nothing then travels — not a blueprint, not an example in the documentation,
# not two bug reports about the same entity.
#
# So the identifier is pinned and the label is translated, which is the split
# the rest of Home Assistant already makes. The words below are fixed here and
# not read from `en.json`: an entity_id is an address, and an address must not
# move because someone polished a display name.
ENTITY_SLUG: Final = {
    "current": "tyres",
    "odometer": "odometer",
    "mounted_front": "front_set",
    "mounted_rear": "rear_set",
    "mileage": "mileage",
    "total": "total",
}

# Storage
STORAGE_VERSION: Final = 1
STORAGE_KEY: Final = DOMAIN

# Seconds a reading waits before it is written down. Only the odometer takes
# this delay: a connected car pushes its counter every few seconds while it is
# moving, and a file rewritten at that rate wears out the card Home Assistant
# runs from. A manoeuvre — fitting, removing, retiring — is written at once,
# because it is the thing that must never be lost.
SAVE_DELAY: Final = 60

# A pressure sensor that has said nothing for this long is treated as silent,
# whatever it still shows. A dead TPMS cell rarely goes unavailable: the entity
# keeps its last value for ever, and only the age of that value says so.
TPMS_STALE_HOURS: Final = 24

# The band around the target pressure inside which a tyre is left alone.
# Asymmetric on purpose: air is only ever lost, so the low side is what the
# alarm is for — regulations put the mandatory warning at 20 % under placard,
# and 15 % rings a little before the law would. The high side is wider
# because driving warms a tyre by 10–15 % on its own, and an alarm that
# fires on every motorway run would be unplugged within the week.
PRESSURE_LOW_RATIO: Final = 0.85
PRESSURE_HIGH_RATIO: Final = 1.30

# Stored state keys
DATA_SETS: Final = "sets"
DATA_MOUNTED: Final = "mounted"
DATA_ODOMETER: Final = "odometer"
DATA_TOTAL: Final = "total"
DATA_MOUNTED_AT: Final = "mounted_at"
DATA_MOUNTED_SINCE: Final = "mounted_since"
DATA_RETIRED_AT: Final = "retired_at"
DATA_RETIRED_ODOMETER: Final = "retired_odometer"
DATA_HISTORY: Final = "history"
DATA_ROTATED_AT: Final = "rotated_at"
DATA_ROTATED_ODOMETER: Final = "rotated_odometer"

# Services
SERVICE_MOUNT: Final = "mount"
SERVICE_SET_ODOMETER: Final = "set_odometer"
SERVICE_ADJUST: Final = "adjust"
SERVICE_RETIRE: Final = "retire"
SERVICE_RESTORE: Final = "restore"
SERVICE_UNMOUNT: Final = "unmount"
SERVICE_ROTATE: Final = "rotate"

ATTR_SET: Final = "tyre_set"
ATTR_ODOMETER: Final = "odometer"
ATTR_TOTAL: Final = "total"
ATTR_POSITION: Final = "position"

# Events. One per thing that happens to a set, so an automation can be written
# against a trigger rather than against a template watching an attribute.
EVENT_MOUNTED: Final = f"{DOMAIN}_mounted"
EVENT_UNMOUNTED: Final = f"{DOMAIN}_unmounted"
EVENT_RETIRED: Final = f"{DOMAIN}_retired"
EVENT_RESTORED: Final = f"{DOMAIN}_restored"
EVENT_ROTATED: Final = f"{DOMAIN}_rotated"
EVENT_ADJUSTED: Final = f"{DOMAIN}_adjusted"
EVENT_SEPARATED: Final = f"{DOMAIN}_separated"

# A tyre hardens with age whether it runs or not, and the rubber is considered
# past it around ten years — a figure the odometer will never reach on a set
# that spends half its life in a garage.
TYRE_LIFE_YEARS: Final = 10

# A single swap never adds more than this. Beyond it the odometer reading is
# wrong, and accepting it would corrupt the running total for good.
MAX_STEP_KM: Final = 100_000

# Swaps kept for review. Enough to explain a suspicious total, not a log.
HISTORY_LENGTH: Final = 20
