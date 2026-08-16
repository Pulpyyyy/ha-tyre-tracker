"""Config flow for Tyre Tracker.

One entry for the whole integration, created exactly once. The form asks what
the panel cannot exist without: a first vehicle — its name, the entity its
odometer is read from if any, and where that counter stands today. Everything
else, and every vehicle after this one, is done in the admin panel served at
``/tyre-tracker`` (see ``frontend/`` and ``websocket_api.py``), which writes
the vehicle records this entry's options hold.

Once the entry exists, the flow turns signpost: the button on the integration
page reads « Open the editor », and pressing it answers with a single link to
the panel. It is the one thing that button can do — a config flow always
answers with a dialog, and Home Assistant offers no way to navigate from one —
and it was chosen over hiding the button (`single_config_entry`), so the page
everyone knows keeps a door to the page everything happens in.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers import selector

from .const import (
    CONF_INITIAL_ODOMETER,
    CONF_ODOMETER_ENTITY,
    CONF_ROTATION_INTERVAL,
    CONF_SETS,
    CONF_VEHICLE,
    CONF_VEHICLE_ID,
    CONF_VEHICLES,
    CONFIG_VERSION,
    DEFAULT_ROTATION_INTERVAL,
    DOMAIN,
    PANEL_URL_PATH,
)

_LOGGER = logging.getLogger(__name__)

# The odometer may come from a sensor, or from nowhere at all — a car without
# connected services is the ordinary case, and the reading is then typed in.
ODOMETER_SELECTOR = selector.EntitySelector(
    selector.EntitySelectorConfig(domain=["sensor", "input_number", "number"])
)

ODOMETER_NUMBER = selector.NumberSelector(
    selector.NumberSelectorConfig(
        min=0, max=2_000_000, step=1, mode=selector.NumberSelectorMode.BOX
    )
)


class TyreTrackerConfigFlow(ConfigFlow, domain=DOMAIN):
    """The one entry, opened on the first vehicle's form."""

    VERSION = CONFIG_VERSION

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Name the first vehicle; afterwards, point at the editor."""
        # The entry exists: the only useful answer is the way to the page
        # where everything happens. A link, not a form — a second entry is not
        # a thing this integration has.
        if self._async_current_entries():
            _LOGGER.debug("config_flow: pointing the user at /%s", PANEL_URL_PATH)
            return self.async_abort(
                reason="open_editor",
                description_placeholders={"url": f"/{PANEL_URL_PATH}"},
            )

        # The race the check above cannot see: two dialogs open at once, both
        # started while there was nothing.
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        errors: dict[str, str] = {}

        if user_input is not None:
            vehicle = user_input[CONF_VEHICLE].strip()
            if not vehicle:
                errors[CONF_VEHICLE] = "vehicle_required"
            else:
                _LOGGER.debug("config_flow: creating the entry, first vehicle %r", vehicle)
                return self.async_create_entry(
                    title="Tyre Tracker",
                    data={},
                    options={
                        CONF_VEHICLES: [
                            {
                                CONF_VEHICLE_ID: uuid.uuid4().hex,
                                CONF_VEHICLE: vehicle,
                                CONF_ODOMETER_ENTITY: user_input.get(CONF_ODOMETER_ENTITY),
                                CONF_INITIAL_ODOMETER: user_input.get(CONF_INITIAL_ODOMETER),
                                CONF_ROTATION_INTERVAL: DEFAULT_ROTATION_INTERVAL,
                                CONF_SETS: [],
                            }
                        ]
                    },
                )

        defaults = user_input or {}
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_VEHICLE, default=defaults.get(CONF_VEHICLE, "")
                    ): str,
                    vol.Optional(
                        CONF_ODOMETER_ENTITY,
                        description={
                            "suggested_value": defaults.get(CONF_ODOMETER_ENTITY)
                        },
                    ): ODOMETER_SELECTOR,
                    # Asked here because a set fitted before the counter is
                    # known starts from nothing: it is stamped with whatever
                    # the odometer said at the time, and that is zero.
                    vol.Optional(
                        CONF_INITIAL_ODOMETER,
                        description={
                            "suggested_value": defaults.get(CONF_INITIAL_ODOMETER)
                        },
                    ): ODOMETER_NUMBER,
                }
            ),
            errors=errors,
            description_placeholders={"url": f"/{PANEL_URL_PATH}"},
        )
