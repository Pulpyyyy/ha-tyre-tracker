"""Config and options flows for Tyre Tracker.

One entry per vehicle. The tyre sets live in that entry's options, one record
each, and the `id` a record carries is what the mileage hangs from — a
reference can therefore be corrected without losing a kilometre.

Sets were subentries once. Home Assistant draws a device group per subentry,
and the vehicle's device belongs to none of them, so the integration page
listed « Alfa GT » once under the car and once under every tyre subentry: the
same five entities, counted again under a heading that promised something
else. Options cost a click on « Configurer » and give back a page that reads
top to bottom — the car, then its trains.

The forms are written to be read in the order one thinks: what the tyres are,
then what to do with them. Editing a set opens a menu rather than a form,
because "take it out of service" is a decision, not a field — burying it in a
checkbox at the bottom of an edit form would make an irreversible-looking act
look like a typo, and hiding it in a service call would make it unreachable
from the interface.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigEntryState,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.const import ATTR_UNIT_OF_MEASUREMENT, UnitOfLength
from homeassistant.core import callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import selector
from homeassistant.util.unit_conversion import DistanceConverter

from .const import (
    ATTR_ODOMETER,
    ATTR_POSITION,
    ATTR_TOTAL,
    AXLE_ALL,
    AXLE_PAIR,
    AXLES,
    CONF_AXLE,
    CONF_DOT,
    CONF_INITIAL_ODOMETER,
    CONF_INITIAL_TOTAL,
    CONF_LABEL,
    CONF_ODOMETER_ENTITY,
    CONF_PAIR,
    CONF_PRESSURE_FRONT,
    CONF_PRESSURE_REAR,
    CONF_PRICE,
    CONF_REFERENCE,
    CONF_ROTATION_INTERVAL,
    CONF_SEASON,
    CONF_SET_ID,
    CONF_SETS,
    CONF_SIZE,
    CONF_STORAGE,
    CONF_TPMS,
    CONF_VEHICLE,
    CORNER_OF,
    CORNERS,
    DEFAULT_ROTATION_INTERVAL,
    DOMAIN,
    POSITION_FRONT,
    POSITION_REAR,
    POSITIONS,
    SEASONS,
    SIDES,
)
from .i18n import Words, async_words

# The odometer may come from a sensor, or from nowhere at all — a car without
# connected services is the ordinary case, and the reading is then typed in.
ODOMETER_SELECTOR = selector.EntitySelector(
    selector.EntitySelectorConfig(domain=["sensor", "input_number", "number"])
)

# A list rather than a dropdown: three options, all visible at once, and the
# icons make the choice readable without opening anything.
SEASON_SELECTOR = selector.SelectSelector(
    selector.SelectSelectorConfig(
        options=list(SEASONS),
        translation_key="season",
        mode=selector.SelectSelectorMode.LIST,
    )
)

# Four wheels, or a pair. Not where it goes: a pair is fitted front or rear
# as one pleases, and moving it across is an ordinary rotation.
AXLE_SELECTOR = selector.SelectSelector(
    selector.SelectSelectorConfig(
        options=list(AXLES),
        translation_key="axle",
        mode=selector.SelectSelectorMode.LIST,
    )
)

# Which two wheels leave, when a set of four is separated. Named by the
# corners they sit at rather than by the axle alone: « front » on its own
# reads as a destination, and nothing is going anywhere.
PAIR_SELECTOR = selector.SelectSelector(
    selector.SelectSelectorConfig(
        options=list(POSITIONS),
        translation_key="pair",
        mode=selector.SelectSelectorMode.LIST,
    )
)

# Which end of the car a pair goes on. Asked only for a pair: a set of four
# takes both axles whatever one answers, and offering the choice would suggest
# it could be half-fitted.
POSITION_SELECTOR = selector.SelectSelector(
    selector.SelectSelectorConfig(
        options=list(POSITIONS),
        translation_key="position",
        mode=selector.SelectSelectorMode.LIST,
    )
)

ODOMETER_NUMBER = selector.NumberSelector(
    selector.NumberSelectorConfig(
        min=0, max=2_000_000, step=1, mode=selector.NumberSelectorMode.BOX
    )
)

PRICE_NUMBER = selector.NumberSelector(
    selector.NumberSelectorConfig(
        min=0, max=100_000, step=0.01, mode=selector.NumberSelectorMode.BOX
    )
)

# The placard figure, cold, in bar. Bar and not the sensor's unit: the target
# is copied off a sticker, and the sticker says bar — the comparison converts
# whatever the sensor publishes. Fifteen covers a truck; a car reads two-ish.
PRESSURE_NUMBER = selector.NumberSelector(
    selector.NumberSelectorConfig(
        min=0,
        max=15,
        step=0.05,
        mode=selector.NumberSelectorMode.BOX,
        unit_of_measurement="bar",
    )
)

# Zero says "never remind me", which is why the field goes down that far.
INTERVAL_NUMBER = selector.NumberSelector(
    selector.NumberSelectorConfig(
        min=0, max=100_000, step=500, mode=selector.NumberSelectorMode.BOX
    )
)

# One sensor per tyre, and it is the pressure that identifies it: temperature
# and battery are found on the same device rather than asked for again.
TPMS_SELECTOR = selector.EntitySelector(
    selector.EntitySelectorConfig(domain="sensor", device_class="pressure")
)


def _slots(axle: str, words: Words) -> tuple[tuple[str, str], ...]:
    """The sensor slots a set has, each with the name it is shown under.

    Four wheels are named by corner. A pair is named by side: which end of the
    car it sits at is decided when it is fitted, not when it is described.
    """
    if axle == AXLE_ALL:
        return tuple((corner, words(f"corner.{corner}")) for corner in CORNERS)
    return tuple((side, words(f"side.{side}")) for side in SIDES)


def _pair_tpms(tpms: dict[str, str], position: str) -> dict[str, str]:
    """The sensors of one axle, refiled by side.

    A set of four holds its sensors by corner. Split in two, each half holds
    them by side: which end of the car it sits at stops being part of its
    record the moment it becomes a pair, and a sensor left under « rear left »
    would be read at a corner the pair may no longer be at.
    """
    return {
        side: tpms[CORNER_OF[(position, side)]]
        for side in SIDES
        if tpms.get(CORNER_OF[(position, side)])
    }


# The date code: two digits of week, two of year. `5399` is a fiction, `0023`
# is not — the week is what constrains it, the year cannot be argued with.
DOT_PATTERN = re.compile(r"^(0[1-9]|[1-4][0-9]|5[0-3])[0-9]{2}$")


def _set_schema(defaults: dict[str, Any], creating: bool) -> vol.Schema:
    """The tyre set form.

    Field order follows the eye: what is written on the sidewall first — brand
    and model, then type, then size and date code — and the refinements after.
    """
    schema: dict[Any, Any] = {
        vol.Required(CONF_REFERENCE, default=defaults.get(CONF_REFERENCE, "")): str,
        vol.Required(CONF_SEASON, default=defaults.get(CONF_SEASON, SEASONS[0])): (
            SEASON_SELECTOR
        ),
        vol.Required(CONF_AXLE, default=defaults.get(CONF_AXLE, AXLES[0])): (
            AXLE_SELECTOR
        ),
        vol.Optional(
            CONF_SIZE, description={"suggested_value": defaults.get(CONF_SIZE)}
        ): str,
        # Next to the size, because both come off the same record of what the
        # tyre is: the sidewall says the dimension, the door sticker says what
        # it should be inflated to.
        vol.Optional(
            CONF_PRESSURE_FRONT,
            description={"suggested_value": defaults.get(CONF_PRESSURE_FRONT)},
        ): PRESSURE_NUMBER,
        vol.Optional(
            CONF_PRESSURE_REAR,
            description={"suggested_value": defaults.get(CONF_PRESSURE_REAR)},
        ): PRESSURE_NUMBER,
        vol.Optional(
            CONF_DOT, description={"suggested_value": defaults.get(CONF_DOT)}
        ): str,
        vol.Optional(
            CONF_LABEL, description={"suggested_value": defaults.get(CONF_LABEL)}
        ): str,
        vol.Optional(
            CONF_PRICE, description={"suggested_value": defaults.get(CONF_PRICE)}
        ): PRICE_NUMBER,
        vol.Optional(
            CONF_STORAGE, description={"suggested_value": defaults.get(CONF_STORAGE)}
        ): str,
    }
    if creating:
        # Only on creation. Afterwards a total is corrected through `adjust`,
        # which also re-stamps the fitted set's mount point — a plain field
        # here would silently skip that and lose the correction.
        schema[vol.Optional(CONF_INITIAL_TOTAL, default=defaults.get(CONF_INITIAL_TOTAL, 0))] = (
            ODOMETER_NUMBER
        )
    return vol.Schema(schema)


class TyreTrackerConfigFlow(ConfigFlow, domain=DOMAIN):
    """Add a vehicle."""

    # The schema 1.0.0 shipped with. Lower numbers belonged to internal betas
    # whose migrations were dropped at release: such an entry no longer loads,
    # and the vehicle is deleted and added again instead.
    VERSION = 3

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Name the vehicle and, optionally, point at its odometer."""
        errors: dict[str, str] = {}

        if user_input is not None:
            vehicle = user_input[CONF_VEHICLE].strip()
            if not vehicle:
                errors[CONF_VEHICLE] = "vehicle_required"
            else:
                await self.async_set_unique_id(vehicle.casefold())
                self._abort_if_unique_id_configured()
                words = await async_words(self.hass)
                return self.async_create_entry(
                    # The entry is the tracking, the device is the car. Naming
                    # both « Alfa GT » stacked the same word on two lines.
                    title=words.entry_title(vehicle),
                    data={CONF_VEHICLE: vehicle},
                    options={
                        CONF_ODOMETER_ENTITY: user_input.get(CONF_ODOMETER_ENTITY),
                        CONF_INITIAL_ODOMETER: user_input.get(CONF_INITIAL_ODOMETER),
                        CONF_ROTATION_INTERVAL: DEFAULT_ROTATION_INTERVAL,
                        CONF_SETS: [],
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
        )

    @staticmethod
    @callback
    def async_get_options_flow(entry: ConfigEntry) -> TyreTrackerOptionsFlow:
        """Everything about a vehicle is adjustable after the fact."""
        return TyreTrackerOptionsFlow()


class TyreTrackerOptionsFlow(OptionsFlow):
    """The vehicle, its odometer, and its tyre sets."""

    def __init__(self) -> None:
        """Nothing chosen yet."""
        self._set_id: str | None = None
        # Held between the odometer step and the resync it may open onto.
        self._pending_odometer: str | None = None

    # ----- the menu -----

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Offer what can be done to this vehicle.

        « Modifier un train » is left out when there is none: an option that
        opens on an empty list says nothing that its absence does not.
        """
        # Every step below reads the coordinator, which only exists while the
        # entry is loaded. During a failed setup « Configurer » would otherwise
        # open on an AttributeError dressed as « Unknown error ».
        if self.config_entry.state is not ConfigEntryState.LOADED:
            return self.async_abort(reason="not_loaded")
        options = ["vehicle", "odometer", "add"]
        if self._sets():
            options.append("manage")
        return self.async_show_menu(step_id="init", menu_options=options)

    # ----- the vehicle -----

    async def async_step_vehicle(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Rename the car.

        The name lives here rather than in the entry title, which now reads
        « Suivi d'Alfa GT ». It is the device's name, and through it the name
        of every entity — renaming here renames the lot.
        """
        entry = self.config_entry
        errors: dict[str, str] = {}
        current = entry.data.get(CONF_VEHICLE, "")

        interval = entry.options.get(CONF_ROTATION_INTERVAL, DEFAULT_ROTATION_INTERVAL)

        if user_input is not None:
            vehicle = str(user_input.get(CONF_VEHICLE, "")).strip()
            if not vehicle:
                errors[CONF_VEHICLE] = "vehicle_required"
            elif self._taken(vehicle):
                errors[CONF_VEHICLE] = "vehicle_exists"
            else:
                self.hass.config_entries.async_update_entry(
                    entry,
                    title=self._words().entry_title(vehicle),
                    data={**entry.data, CONF_VEHICLE: vehicle},
                    # The unique id follows the name it was made from. Left
                    # behind, it goes on standing for a car that no longer
                    # carries that name: adding « Alfa GT » again after
                    # renaming it would be refused as already configured, and
                    # the new name could be taken twice over.
                    unique_id=vehicle.casefold(),
                    options={
                        **entry.options,
                        CONF_ROTATION_INTERVAL: float(
                            user_input.get(CONF_ROTATION_INTERVAL) or 0
                        ),
                    },
                )
                return self.async_abort(reason="renamed")
            current = user_input.get(CONF_VEHICLE, "")
            interval = user_input.get(CONF_ROTATION_INTERVAL, interval)

        return self.async_show_form(
            step_id="vehicle",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_VEHICLE, default=current): str,
                    vol.Optional(
                        CONF_ROTATION_INTERVAL, default=interval
                    ): INTERVAL_NUMBER,
                }
            ),
            errors=errors,
        )

    async def async_step_odometer(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Point at the odometer, or stop pointing at it."""
        if user_input is not None:
            chosen = user_input.get(CONF_ODOMETER_ENTITY)
            # A source that reads below what has been recorded cannot simply
            # be adopted: `async_set_odometer` refuses backward steps, so the
            # tracking would freeze at the old figure and never move again.
            # The two readings are shown side by side instead.
            if chosen and self._reads_below(chosen) is not None:
                self._pending_odometer = chosen
                return await self.async_step_resync()
            return self._save({CONF_ODOMETER_ENTITY: chosen})

        return self.async_show_form(
            step_id="odometer",
            data_schema=vol.Schema(
                {
                    vol.Optional(
                        CONF_ODOMETER_ENTITY,
                        description={
                            "suggested_value": self.config_entry.options.get(
                                CONF_ODOMETER_ENTITY
                            )
                        },
                    ): ODOMETER_SELECTOR
                }
            ),
        )

    async def async_step_resync(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """The new source disagrees with what has been recorded.

        Both figures are real: one was typed in over months, the other is the
        dashboard. Taking the new one settles the fitted sets at the old
        reading first, so the kilometres they did run stay theirs.
        """
        entity_id = self._pending_odometer
        if entity_id is None:
            return await self.async_step_odometer()

        reading = self._reads_below(entity_id)
        coordinator = self._coordinator()

        if user_input is not None:
            if user_input.get("resync", True) and reading is not None:
                await coordinator.async_resync_odometer(reading)
            self._pending_odometer = None
            return self._save({CONF_ODOMETER_ENTITY: entity_id})

        return self.async_show_form(
            step_id="resync",
            data_schema=vol.Schema(
                {vol.Required("resync", default=True): selector.BooleanSelector()}
            ),
            description_placeholders={
                "entity": entity_id,
                "reading": _km(reading) if reading is not None else "—",
                "tracked": _km(coordinator.data.odometer or 0),
            },
        )

    def _taken(self, vehicle: str) -> bool:
        """True when another vehicle already answers to that name."""
        wanted = vehicle.casefold()
        return any(
            other.entry_id != self.config_entry.entry_id and other.unique_id == wanted
            for other in self.hass.config_entries.async_entries(DOMAIN)
        )

    def _reads_below(self, entity_id: str) -> float | None:
        """The entity's reading, when it sits below the recorded odometer.

        None when there is nothing to reconcile — no reading yet, or one that
        is ahead of the tracking, which is the ordinary case and needs no
        question asked.
        """
        tracked = self._coordinator().data.odometer
        if tracked is None:
            return None
        state = self.hass.states.get(entity_id)
        if state is None or state.state in ("unknown", "unavailable", ""):
            return None
        try:
            value = float(state.state)
        except (TypeError, ValueError):
            return None
        # Everything here is kilometres. A source in miles reads far below a
        # tracking in km and would raise the question every time, over a
        # difference that is only a unit.
        unit = state.attributes.get(ATTR_UNIT_OF_MEASUREMENT)
        if unit and unit != UnitOfLength.KILOMETERS:
            try:
                value = DistanceConverter.convert(
                    value, unit, UnitOfLength.KILOMETERS
                )
            except (HomeAssistantError, ValueError, TypeError):
                # The converter refuses an unrecognised unit with a
                # `HomeAssistantError`, which is not a `ValueError`: left out,
                # picking a sensor with an odd unit would break the step rather
                # than pass over a reading that cannot be compared.
                return None
        return round(value, 1) if value < tracked else None

    # ----- adding a set -----

    async def async_step_add(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Add a set."""
        errors: dict[str, str] = {}
        defaults: dict[str, Any] = {}

        if user_input is not None:
            data = _clean(user_input)
            errors = _errors(data)
            if not errors:
                return self._save({CONF_SETS: [*self._sets(), _with_id(data)]})
            # What was typed comes back as it was typed: a form that empties
            # itself on a rejected date code punishes the wrong field.
            defaults = data

        return self.async_show_form(
            step_id="add",
            data_schema=_set_schema(defaults, creating=True),
            errors=errors,
        )

    # ----- picking one -----

    async def async_step_manage(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Which set, before asking what to do with it."""
        sets = self._sets()

        if user_input is not None:
            self._set_id = user_input[CONF_SET_ID]
            return await self.async_step_actions()

        return self.async_show_form(
            step_id="manage",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_SET_ID): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=[
                                selector.SelectOptionDict(
                                    value=record[CONF_SET_ID],
                                    label=self._label(record),
                                )
                                for record in sets
                            ],
                            mode=selector.SelectSelectorMode.LIST,
                        )
                    )
                }
            ),
        )

    async def async_step_actions(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Offer what can be done to this set, given where it stands."""
        # The menu adapts: one cannot retire a set twice, nor restore one that
        # is in service. Showing an inert option would only invite a dead end.
        # Duplicating, on the other hand, always makes sense — including from a
        # retired set, which is what buying the same tyres again looks like.
        tyre = self._tyre()
        options: list[str] = []
        # Fitting is the commonest act of all, so it comes first. It is left
        # out for a set already covering every wheel it has — a four-wheel set
        # on the car has nowhere left to go — and for a retired one, which the
        # coordinator would refuse anyway. A fitted pair keeps the option: it
        # is how a pair changes ends.
        if tyre is not None and not self._retired():
            if not (tyre.axle == AXLE_ALL and self._is_mounted()):
                options.append("mount")
        options += ["edit", "tpms", "adjust"]
        # Rotating is only ever done to four wheels that are on the car. A
        # pair changes ends by being fitted to the other axle, and a set in
        # the garage has nothing to rotate.
        if tyre is not None and tyre.axle == AXLE_ALL and self._is_mounted():
            options.append("rotate")
        # Separating is the same shape of act as rotating — four wheels, on
        # the car or in the garage — minus the requirement of being fitted: a
        # set of four bought as four can be split on the shelf.
        if tyre is not None and tyre.axle == AXLE_ALL and not self._retired():
            options.append("separate")
        options.append("duplicate")
        options.append("restore" if self._retired() else "retire")
        options.append("delete")
        return self.async_show_menu(
            step_id="actions",
            menu_options=options,
            description_placeholders={
                "set": self._header(),
                "title": self._title(),
                "km": self._distance(),
            },
        )

    # ----- the running total -----

    async def async_step_adjust(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Write the set's total by hand, whenever it needs writing.

        Taking over a tracking kept elsewhere, a swap entered a month late, a
        second-hand set that arrives with kilometres already on it: the total
        is a figure one knows better than the integration does, and there is
        no moment at which it stops being correctable.
        """
        if self._record() is None:
            return self.async_abort(reason="unknown_set")

        if user_input is not None:
            await self._coordinator().async_adjust(
                self._set_id, float(user_input.get(ATTR_TOTAL) or 0)
            )
            return self.async_abort(reason="adjusted")

        tyre = self._tyre()
        current = self._coordinator().distance(tyre.set_id) if tyre else 0
        return self.async_show_form(
            step_id="adjust",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        ATTR_TOTAL, default=round(current or 0)
                    ): ODOMETER_NUMBER
                }
            ),
            description_placeholders={
                "set": self._header(),
                "title": self._title(),
                "km": self._distance(),
            },
        )

    # ----- the pressure sensors -----

    async def async_step_tpms(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Attach a pressure sensor to each tyre, or take one off.

        One sensor per tyre, held by the set rather than by the car: it is
        screwed to the wheel and travels with it. Emptying a field detaches
        that sensor — there is no separate removal to look for.
        """
        record = self._record()
        if record is None:
            return self.async_abort(reason="unknown_set")

        slots = _slots(record.get(CONF_AXLE) or AXLE_ALL, self._words())
        current = record.get(CONF_TPMS) or {}

        if user_input is not None:
            return self._save(
                {
                    CONF_SETS: self._replaced(
                        {
                            **record,
                            CONF_TPMS: {
                                slot: user_input[slot]
                                for slot, _ in slots
                                if user_input.get(slot)
                            },
                        }
                    )
                }
            )

        return self.async_show_form(
            step_id="tpms",
            data_schema=vol.Schema(
                {
                    vol.Optional(
                        slot, description={"suggested_value": current.get(slot)}
                    ): TPMS_SELECTOR
                    for slot, _ in slots
                }
            ),
            description_placeholders={
                "set": self._header(),
                "title": self._title(),
                "slots": ", ".join(label for _, label in slots),
            },
        )

    # ----- fitting -----

    async def async_step_mount(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Fit this set, closing the count of whatever it displaces.

        The two selectors and the card do this too, and all three come here in
        the end — `async_mount` is the only place a swap happens. This step
        exists so the flow is a complete path on its own: a vehicle can be set
        up, its sets described and one of them put on the car without leaving
        the configuration page.
        """
        coordinator = self._coordinator()
        tyre = self._tyre()
        if self._record() is None or tyre is None:
            return self.async_abort(reason="unknown_set")
        if tyre.retired:
            return self.async_abort(reason="not_mountable")

        # A set of four takes both axles whatever is asked, so it is not asked.
        pair = tyre.axle != AXLE_ALL

        if user_input is not None:
            await coordinator.async_mount(
                self._set_id,
                user_input.get(ATTR_ODOMETER),
                user_input.get(ATTR_POSITION) if pair else None,
            )
            return self.async_abort(reason="fitted")

        schema: dict[Any, Any] = {}
        if pair:
            schema[vol.Required(ATTR_POSITION, default=self._free_axle())] = (
                POSITION_SELECTOR
            )
        # Same rule as everywhere else: the reading is only worth asking for
        # when no sensor gives it. Fitting closes the outgoing set's count, and
        # that is the last moment to say at what mileage.
        if not coordinator.odometer_entity:
            schema[
                vol.Optional(
                    ATTR_ODOMETER,
                    description={"suggested_value": coordinator.data.odometer},
                )
            ] = ODOMETER_NUMBER

        # A set of four, on a car whose odometer reads itself, leaves nothing to
        # ask: the axle is not a question and the mileage is already known. The
        # form would show a title and a single confirm button — a step that only
        # repeats the one just taken, since « fit » was chosen from the menu
        # before. Do it and say it is done.
        if not schema:
            await coordinator.async_mount(self._set_id)
            return self.async_abort(reason="fitted")

        return self.async_show_form(
            step_id="mount",
            data_schema=vol.Schema(schema),
            description_placeholders={
                "set": self._header(),
                "title": self._title(),
                "km": self._distance(),
                "fitted": self._fitted(),
            },
        )

    # ----- rotating -----

    async def async_step_rotate(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Record a rotation: each wheel moves to the other end of its side."""
        coordinator = self._coordinator()
        if self._record() is None:
            return self.async_abort(reason="unknown_set")
        # The same rule the menu applies, checked again here: this step is
        # reachable by name, and the state can have moved since the menu was
        # drawn — a set taken off from a second tab. The coordinator refuses
        # out loud now, and a refusal raised inside a step reads as « unknown
        # error » rather than as the sentence it was written as.
        tyre = self._tyre()
        if tyre is None or tyre.axle != AXLE_ALL or not self._is_mounted():
            return self.async_abort(reason="not_rotatable")

        if user_input is not None:
            await coordinator.async_rotate(self._set_id, user_input.get(ATTR_ODOMETER))
            return self.async_abort(reason="rotated")

        schema = vol.Schema({})
        if not coordinator.odometer_entity:
            schema = vol.Schema(
                {
                    vol.Optional(
                        ATTR_ODOMETER,
                        description={"suggested_value": coordinator.data.odometer},
                    ): ODOMETER_NUMBER
                }
            )

        since = coordinator.km_since_rotation(self._set_id)
        return self.async_show_form(
            step_id="rotate",
            data_schema=schema,
            description_placeholders={
                "set": self._header(),
                "title": self._title(),
                "since": _km(since) if since is not None else "—",
            },
        )

    # ----- separating -----

    async def async_step_separate(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Turn a set of four into two pairs that share what it has run.

        One keeps its record and its id — it is the same set, minus two wheels
        — and the other is born with the same total. Neither is a copy: they
        are the two halves of something that was counted as one.
        """
        record = self._record()
        if record is None:
            return self.async_abort(reason="unknown_set")
        if (record.get(CONF_AXLE) or AXLE_ALL) != AXLE_ALL or self._retired():
            return self.async_abort(reason="not_separable")

        coordinator = self._coordinator()

        if user_input is not None:
            leaving = user_input.get(CONF_PAIR) or POSITION_FRONT
            staying = POSITION_REAR if leaving == POSITION_FRONT else POSITION_FRONT
            new_id = uuid.uuid4().hex

            shared = await coordinator.async_separate(
                self._set_id, new_id, leaving, user_input.get(ATTR_ODOMETER)
            )
            if shared is None:
                return self.async_abort(reason="not_separable")

            # What the four cost, split down the middle. Any other division
            # would need a figure nobody has, and leaving the whole price on
            # both halves would say each pair cost what the set did — which
            # is what `cost_per_1000` would then divide.
            price = record.get(CONF_PRICE)
            half = round(price / 2, 2) if price else None
            tpms = record.get(CONF_TPMS) or {}

            born = {
                **record,
                CONF_SET_ID: new_id,
                CONF_AXLE: AXLE_PAIR,
                CONF_LABEL: str(user_input.get(CONF_LABEL) or "").strip(),
                CONF_TPMS: _pair_tpms(tpms, leaving),
                CONF_PRICE: half,
                CONF_INITIAL_TOTAL: shared,
            }
            kept = {
                **record,
                CONF_AXLE: AXLE_PAIR,
                CONF_TPMS: _pair_tpms(tpms, staying),
                CONF_PRICE: half,
            }
            return self._save({CONF_SETS: [*self._replaced(kept), born]})

        schema: dict[Any, Any] = {
            vol.Required(CONF_PAIR, default=POSITION_FRONT): PAIR_SELECTOR,
            vol.Optional(CONF_LABEL): str,
        }
        # Only worth asking while the set is on the car: it is the reading the
        # shared total is closed at. In the garage the total is already closed
        # and today's odometer changes nothing about it.
        if self._is_mounted() and not coordinator.odometer_entity:
            schema[
                vol.Optional(
                    ATTR_ODOMETER,
                    description={"suggested_value": coordinator.data.odometer},
                )
            ] = ODOMETER_NUMBER

        return self.async_show_form(
            step_id="separate",
            data_schema=vol.Schema(schema),
            description_placeholders={
                "set": self._header(),
                "title": self._title(),
                "km": self._distance(),
            },
        )

    # ----- editing -----

    async def async_step_edit(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Correct the record. The counters are untouched — they live apart."""
        record = self._record()
        if record is None:
            return self.async_abort(reason="unknown_set")

        errors: dict[str, str] = {}
        defaults = dict(record)

        if user_input is not None:
            data = {**record, **_clean(user_input)}
            errors = _errors(data)
            if not errors and self._axle_conflict(data):
                errors[CONF_AXLE] = "axle_conflict"
            if not errors:
                return self._save({CONF_SETS: self._replaced(data)})
            defaults = data

        return self.async_show_form(
            step_id="edit",
            data_schema=_set_schema(defaults, creating=False),
            errors=errors,
            description_placeholders={
                "set": self._header(),
                "km": self._distance(),
            },
        )

    async def async_step_duplicate(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Open the add form with this set's record already filled in.

        A second pair of the same tyres, or the same reference bought again two
        years later: the sidewall is retyped identically every time. The copy
        gets an id of its own, therefore a counter of its own, starting where
        the form says and not where the original stands.
        """
        record = self._record()
        if record is None:
            return self.async_abort(reason="unknown_set")

        coordinator = self._coordinator()
        errors: dict[str, str] = {}
        # Replacing is only on offer while the original is on the car. Off it,
        # the copy is a second set bought alongside the first, and there is
        # nothing to take off.
        replaceable = self._is_mounted() and not self._retired()

        if user_input is not None:
            data = _clean(user_input)
            errors = _errors(data)
            # Replacing fits the copy exactly where the original stands, so
            # the copy must cover the same wheels: a pair staged on the two
            # positions a set of four held — or a set of four on one axle —
            # is a mounted state nothing else can express, and the next
            # reload would unpick it by dropping a set without settling it.
            if (
                not errors
                and replaceable
                and user_input.get("replace")
                and data.get(CONF_AXLE) != (record.get(CONF_AXLE) or AXLE_ALL)
            ):
                errors[CONF_AXLE] = "replace_axle"
            if not errors:
                new_id = uuid.uuid4().hex
                if replaceable and user_input.get("replace"):
                    # One act, in the order the garage does it: the old set
                    # comes off and closes its count at today's reading, the
                    # new one goes on at zero, in the same places.
                    positions = coordinator.positions_of(self._set_id)
                    await coordinator.async_retire(
                        self._set_id, user_input.get(ATTR_ODOMETER)
                    )
                    await coordinator.async_stage_replacement(new_id, positions)
                return self._save(
                    {CONF_SETS: [*self._sets(), {CONF_SET_ID: new_id, **data}]}
                )
            defaults = data
        else:
            defaults = dict(record)
            # The label is deliberately not carried over: it exists to tell two
            # sets apart, and a copy that inherits it would defeat its only job.
            defaults.pop(CONF_LABEL, None)
            # Nor the date code: a second set bought two years later shares the
            # reference, never the week it left the factory.
            defaults.pop(CONF_DOT, None)
            # Nor the sensors: they are screwed to the wheels of the set being
            # copied, and those wheels are not the new ones.
            defaults.pop(CONF_TPMS, None)
            # Nor what the original had already run. A copy stands for tyres
            # that have not turned yet — the whole point of copying a set is
            # to watch the second one wear against the first.
            defaults[CONF_INITIAL_TOTAL] = 0

        schema = _set_schema(defaults, creating=True)
        if replaceable:
            extra: dict[Any, Any] = {
                vol.Required("replace", default=True): selector.BooleanSelector()
            }
            if not coordinator.odometer_entity:
                extra[
                    vol.Optional(
                        ATTR_ODOMETER,
                        description={"suggested_value": coordinator.data.odometer},
                    )
                ] = ODOMETER_NUMBER
            schema = schema.extend(extra)

        return self.async_show_form(
            step_id="duplicate",
            data_schema=schema,
            errors=errors,
            description_placeholders={
                "set": self._header(),
                "title": self._title(),
                "km": self._distance(),
            },
        )

    # ----- lifecycle -----

    async def async_step_retire(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Take the set out of service, mileage frozen."""
        coordinator = self._coordinator()
        if self._record() is None:
            return self.async_abort(reason="unknown_set")

        if user_input is not None:
            await coordinator.async_retire(self._set_id, user_input.get(ATTR_ODOMETER))
            return self.async_abort(reason="retired")

        # The odometer is offered here because retiring a fitted set closes its
        # count: the last kilometres belong to it, and this is the only moment
        # one can still say how many.
        schema = vol.Schema({})
        if self._is_mounted() and not coordinator.odometer_entity:
            schema = vol.Schema(
                {
                    vol.Optional(
                        ATTR_ODOMETER,
                        description={"suggested_value": coordinator.data.odometer},
                    ): ODOMETER_NUMBER
                }
            )

        return self.async_show_form(
            step_id="retire",
            data_schema=schema,
            description_placeholders={
                "set": self._header(),
                "title": self._title(),
                "km": self._distance(),
            },
        )

    async def async_step_restore(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Put the set back into service."""
        if self._record() is None:
            return self.async_abort(reason="unknown_set")

        if user_input is not None:
            await self._coordinator().async_restore(self._set_id)
            return self.async_abort(reason="restored")

        return self.async_show_form(
            step_id="restore",
            data_schema=vol.Schema({}),
            description_placeholders={
                "set": self._header(),
                "title": self._title(),
                "km": self._distance(),
            },
        )

    async def async_step_delete(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Remove the set, its sensor and its device.

        The counters are not deleted with it: the store keeps them under the
        same id, so a set removed by accident and added back finds its
        kilometres again. What goes is the record and everything Home Assistant
        drew from it.
        """
        if self._record() is None:
            return self.async_abort(reason="unknown_set")

        if user_input is not None:
            return self._save(
                {
                    CONF_SETS: [
                        record
                        for record in self._sets()
                        if record.get(CONF_SET_ID) != self._set_id
                    ]
                }
            )

        return self.async_show_form(
            step_id="delete",
            data_schema=vol.Schema({}),
            description_placeholders={
                "set": self._header(),
                "title": self._title(),
                "km": self._distance(),
            },
        )

    # ----- the options themselves -----

    def _sets(self) -> list[dict[str, Any]]:
        """The records, as stored."""
        return [dict(record) for record in self.config_entry.options.get(CONF_SETS, [])]

    def _record(self) -> dict[str, Any] | None:
        """The record being worked on."""
        for record in self._sets():
            if record.get(CONF_SET_ID) == self._set_id:
                return record
        return None

    def _replaced(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        """The records, with this one rewritten in place.

        In place, and not appended: the order of the list is the order of the
        page, and a set that jumps to the bottom every time it is corrected
        would make the list unreadable by the third edit.
        """
        return [
            data if record.get(CONF_SET_ID) == self._set_id else record
            for record in self._sets()
        ]

    def _save(self, changes: dict[str, Any]) -> ConfigFlowResult:
        """Write the options back, leaving alone what this step did not touch."""
        return self.async_create_entry(data={**self.config_entry.options, **changes})

    # ----- reading the live state -----

    def _coordinator(self):
        """The vehicle's coordinator, which owns the counters."""
        return self.config_entry.runtime_data

    def _tyre(self):
        """This set, as the coordinator knows it."""
        if self._set_id is None:
            return None
        return self._coordinator().data.sets.get(self._set_id)

    def _retired(self) -> bool:
        tyre = self._tyre()
        return bool(tyre and tyre.retired)

    def _is_mounted(self) -> bool:
        tyre = self._tyre()
        return bool(tyre and self._coordinator().is_mounted(tyre.set_id))

    def _free_axle(self) -> str:
        """Where a pair would go by default.

        A pair already on the car has one move worth suggesting: the other end.
        Offering the axle it sits on would propose doing nothing, which is
        exactly what `async_mount` then does. A pair in the garage goes to the
        bare axle — suggesting the occupied one would make fitting look like
        the way to displace what is there, when the ordinary case is the empty
        end of the car.
        """
        coordinator = self._coordinator()
        on = coordinator.positions_of(self._set_id) if self._set_id else []
        if on:
            return next((p for p in POSITIONS if p not in on), POSITION_FRONT)
        return next(
            (p for p in POSITIONS if coordinator.data.mounted.get(p) is None),
            POSITION_FRONT,
        )

    def _header(self) -> str:
        """The line every step about one set opens with.

        Which set, how many tyres, what it has run, where it stands — always
        those four, always in that order, on every screen that acts on a set.
        Built here rather than spelt out in each translation: the same sentence
        written eleven times in two languages is the same sentence until the
        day one of them is touched, and a form whose heading changes shape from
        one step to the next reads as eleven unrelated screens.

        It frees the prose below, too. No step has to say « {title} has run
        {km} km » before getting to its point, because the line above already
        did — so what is left in each description is what that step alone does.
        """
        tyre = self._tyre()
        title = self._title()
        if tyre is None:
            return f"**{title}**"

        coordinator = self._coordinator()
        words = self._words()
        bits = []
        axle = words.get(f"axle.{tyre.axle}")
        if axle:
            bits.append(axle)
        km = coordinator.distance(tyre.set_id)
        if km is not None:
            bits.append(f"{_km(km)} km")

        if tyre.retired:
            bits.append(words("status.retired"))
        else:
            # Named ends rather than a bare « fitted »: half the decisions taken
            # on these screens — fitting a pair, separating, rotating — turn on
            # which end it is. How the two words join is the language's affair:
            # French writes « monté à l'avant », English « fitted at the front ».
            on = [
                position
                for position in POSITIONS
                if coordinator.data.mounted.get(position) == tyre.set_id
            ]
            if len(on) == len(POSITIONS):
                bits.append(words("status.mounted"))
            elif on:
                bits.append(
                    words("status.mounted_at", position=words(f"position.{on[0]}"))
                )
            else:
                bits.append(words("status.removed"))

        return f"**{title}** — " + " · ".join(bits)

    def _fitted(self) -> str:
        """What the car carries right now, both axles named."""
        coordinator = self._coordinator()
        labels = coordinator.options()
        words = self._words()
        return " · ".join(
            f"{words(f'position.{position}').capitalize()} : "
            f"{labels.get(coordinator.data.mounted.get(position)) or '—'}"
            for position in POSITIONS
        )

    def _axle_conflict(self, data: dict[str, Any]) -> bool:
        """True when growing this set to four wheels would declare six.

        A pair fitted to one axle, promoted to a set of four while the other
        axle still carries something else, leaves the store describing six
        tyres on a car. Nothing refuses it at the time — and at the next
        reload `_normalise` puts the four-wheel set back on both axles, which
        drops the other pair without settling its count: kilometres actually
        run disappear. Refusing the edit is the cheapest place to stop that.
        """
        record = self._record() or {}
        if data.get(CONF_AXLE) != AXLE_ALL or record.get(CONF_AXLE) == AXLE_ALL:
            return False
        if not self._is_mounted():
            return False
        mounted = self._coordinator().data.mounted
        return any(
            sid is not None and sid != self._set_id for sid in mounted.values()
        )

    def _words(self) -> Words:
        """The vocabulary this vehicle speaks, held by its coordinator."""
        return self._coordinator().words

    def _title(self) -> str:
        """What this set is called, for the confirmation texts."""
        record = self._record()
        return _title(record, self._words()) if record else "—"

    def _label(self, record: dict[str, Any]) -> str:
        """A line in the picker: the name, how many wheels, and what it has run.

        Two sets can share a reference — a spare pair, a second-hand set — and
        the count and the kilometres are then the only things telling them
        apart. Four wheels is spelt out here as much as two: in a list where
        pairs and full sets sit side by side, the silence that means "the
        ordinary case" elsewhere would only read as an unanswered question.
        """
        words = self._words()
        parts = [_title(record, words)]
        wheels = words.get(f"axle.{record.get(CONF_AXLE) or AXLE_ALL}")
        if wheels:
            parts.append(wheels)
        tyre = self._coordinator().data.sets.get(record.get(CONF_SET_ID))
        if tyre is None:
            return " · ".join(parts)
        km = self._coordinator().distance(tyre.set_id)
        if km is not None:
            parts.append(f"{_km(km)} km")
        if tyre.retired:
            parts.append(words("status.history"))
        elif self._coordinator().is_mounted(tyre.set_id):
            parts.append(words("status.mounted"))
        return " · ".join(parts)

    def _distance(self) -> str:
        """Mileage, for the confirmation texts. Never a bare number."""
        tyre = self._tyre()
        if tyre is None:
            return "—"
        km = self._coordinator().distance(tyre.set_id)
        return _km(km) if km is not None else "—"


def _km(value: float) -> str:
    """A distance as it is written here: thin-spaced thousands."""
    return f"{value:,.0f}".replace(",", " ")


def _with_id(data: dict[str, Any]) -> dict[str, Any]:
    """A record with a fresh id.

    The id is what the mileage hangs from, and nothing else refers to it: it
    never has to be readable, only stable.
    """
    return {CONF_SET_ID: uuid.uuid4().hex, **data}


def _clean(user_input: dict[str, Any]) -> dict[str, Any]:
    """Trim what was typed, and drop what was left blank."""
    data = {
        CONF_REFERENCE: str(user_input.get(CONF_REFERENCE, "")).strip(),
        CONF_SEASON: user_input.get(CONF_SEASON, SEASONS[0]),
        CONF_AXLE: user_input.get(CONF_AXLE, AXLES[0]),
        CONF_SIZE: str(user_input.get(CONF_SIZE, "") or "").strip(),
        CONF_DOT: _dot(user_input.get(CONF_DOT)),
        CONF_LABEL: str(user_input.get(CONF_LABEL, "") or "").strip(),
        CONF_PRICE: float(user_input.get(CONF_PRICE) or 0) or None,
        CONF_PRESSURE_FRONT: float(user_input.get(CONF_PRESSURE_FRONT) or 0) or None,
        CONF_PRESSURE_REAR: float(user_input.get(CONF_PRESSURE_REAR) or 0) or None,
        CONF_STORAGE: str(user_input.get(CONF_STORAGE, "") or "").strip(),
    }
    if CONF_INITIAL_TOTAL in user_input:
        data[CONF_INITIAL_TOTAL] = float(user_input[CONF_INITIAL_TOTAL] or 0)
    return data


def _dot(raw: Any) -> str:
    """The four digits of the date code, whatever was typed around them.

    A sidewall carries a long DOT code — plant, size code, then the date at the
    end — and one reads it through a wheel arch, in the dark. « DOT U2LL LMLR
    3223 », « 32/23 » and « 3223 » must all land on the same four digits
    rather than on an error message about a format nobody was told about.
    """
    digits = re.sub(r"\D", "", str(raw or ""))
    return digits[-4:] if len(digits) >= 4 else digits


def _errors(data: dict[str, Any]) -> dict[str, str]:
    """What cannot be accepted as typed.

    A date code is refused rather than kept as it came: half a code says
    nothing, and a wrong one would age the set by whole years.
    """
    if data.get(CONF_DOT) and not DOT_PATTERN.match(data[CONF_DOT]):
        return {CONF_DOT: "dot_invalid"}
    return {}


def _title(data: dict[str, Any], words: Words) -> str:
    """What the set is called in the interface."""
    return data.get(CONF_LABEL) or data.get(CONF_REFERENCE) or words("set.fallback")
