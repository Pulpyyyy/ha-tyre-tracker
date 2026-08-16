"""Publication of the two pieces of frontend shipped with the integration.

The card lives inside the integration rather than in `www/`: HACS delivers
`custom_components/tyre_tracker/` and nothing else, so anything the card needs
has to travel with it. Installing the integration is then the whole setup —
no file to copy, no resource to add by hand.

Sequence taken from KipK's guide on embedding a Lovelace card in an
integration (https://forum.hacf.fr/t/74074): the static path is always
registered, and the Lovelace resource is only touched in storage mode.

The admin panel travels the same way and is registered differently, at the
bottom of this file: it is a *page*, not a card, so no Lovelace resource is
involved — a resource is loaded into every dashboard of the house, and this one
belongs to a single address. It declares a sidebar title, which is what puts it
in the sidebar AND — the actual reason — what makes it appear in Home
Assistant's own sidebar editor (long-press the sidebar header). A panel without
a title is not merely hidden: nobody can bring it back. Declaring it is
therefore what turns the sidebar entry into a per-USER choice, stored in each
user's frontend settings, rather than an integration-wide one we would have to
persist and re-apply.
"""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant, callback
from homeassistant.loader import async_get_integration

from ..const import (
    ADMIN_JS,
    CARD_FILENAME,
    DOMAIN,
    FALLBACK_VERSION,
    JSMODULES,
    PANEL_NAME,
    PANEL_SIDEBAR_ICON,
    PANEL_SIDEBAR_TITLE,
    PANEL_URL_PATH,
    URL_BASE,
)

try:  # Home Assistant 2024.11 and later
    from homeassistant.components.lovelace.const import LOVELACE_DATA
except ImportError:  # pragma: no cover - older cores
    LOVELACE_DATA = "lovelace"

_LOGGER = logging.getLogger(__name__)

class JSModuleRegistration:
    """Serves the JavaScript modules and references them in Lovelace."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialise the registrar."""
        self.hass = hass
        self.lovelace = hass.data.get(LOVELACE_DATA)
        # Filled in by `_async_version`, which is the only caller that can
        # await. Until then nothing here needs it.
        self._version = FALLBACK_VERSION

    async def _async_version(self) -> str:
        """The version in the manifest, as Home Assistant already parsed it.

        The card carries it as `?v=`, which is what makes an upgrade visible to
        a browser holding the old module. Read from the loader rather than from
        the file: the manifest is parsed once at discovery, and opening it again
        would be disk I/O for a string that is already in memory.
        """
        try:
            integration = await async_get_integration(self.hass, DOMAIN)
        except Exception:  # noqa: BLE001 - a missing integration is not our problem
            return FALLBACK_VERSION
        self._version = str(integration.version or FALLBACK_VERSION)
        return self._version

    @property
    def _mode(self) -> str:
        """How Lovelace holds its resources: storage or yaml.

        `resource_mode` first: it is the field that decides where resources
        live, and the one Home Assistant kept when `mode` — which only ever
        described the dashboards — stopped being carried in that object.
        """
        return getattr(
            self.lovelace, "resource_mode", getattr(self.lovelace, "mode", "yaml")
        )

    async def async_register(self) -> None:
        """Serve the files, then reference the modules in Lovelace."""
        await self._async_register_path()
        version = await self._async_version()

        if self.lovelace is None:
            # Said out loud rather than passed over: without this, the card is
            # served and never referenced, and nothing anywhere says why.
            _LOGGER.warning(
                "Lovelace unavailable: add the resource by hand -> "
                "url: %s/%s?v=%s , type: module",
                URL_BASE,
                CARD_FILENAME,
                version,
            )
            return

        if self._mode != "storage":
            _LOGGER.info(
                "Lovelace in YAML mode: add the resource by hand -> "
                "url: %s/%s?v=%s , type: module",
                URL_BASE,
                CARD_FILENAME,
                version,
            )
            return

        await self._async_register_modules()

    async def _async_register_path(self) -> None:
        """Serve the modules, one declared path each.

        The files rather than the folder that holds them. A static path is
        served outside Home Assistant's authentication — the same regime as
        `www/` — so publishing the directory published this package with it:
        `__init__.py` and the compiled bytecode beside it were downloadable by
        anyone who could reach the server. Nothing secret lives there, but
        nothing asked to be readable either.

        Cached, too: the URL carries `?v=` and changes at every upgrade, which
        is what makes a long cache safe. Without it the browser revalidates the
        whole module on every dashboard load, for a file that only changes when
        the version does.
        """
        here = Path(__file__).parent
        try:
            await self.hass.http.async_register_static_paths(
                [
                    StaticPathConfig(
                        f"{URL_BASE}/{module['filename']}",
                        str(here / module["filename"]),
                        True,
                    )
                    for module in JSMODULES
                ]
            )
            _LOGGER.debug("Path registered: %s", URL_BASE)
        except (RuntimeError, ValueError):
            _LOGGER.debug("Path already registered: %s", URL_BASE)

    async def _async_load_resources(self) -> None:
        """Bring the resource collection in from storage.

        It loads on first use and not before: waiting for `loaded` to turn
        true on its own is waiting for a browser to ask for the list, which on
        a headless start never happens. `async_get_info` is that first use —
        it loads the collection and returns, so the list read just below is
        the real one rather than an empty stand-in.
        """
        resources = self.lovelace.resources
        if getattr(resources, "loaded", True):
            return
        await resources.async_get_info()

    async def _async_register_modules(self) -> None:
        """Create the resource, or move it to the current version.

        The `?v=` suffix is what makes an upgrade visible: without it the
        browser keeps serving the module it already has, and the new card
        never loads until the cache is cleared by hand.
        """
        await self._async_load_resources()

        existing = [
            resource
            for resource in self.lovelace.resources.async_items()
            if str(resource.get("url", "")).startswith(URL_BASE)
        ]

        for module in JSMODULES:
            url = f"{URL_BASE}/{module['filename']}?v={self._version}"
            registered = False

            for resource in existing:
                if self._get_path(resource["url"]) != self._get_path(url):
                    continue
                registered = True
                if resource["url"] != url:
                    _LOGGER.info("Resource %s: updating to %s", resource["url"], url)
                    await self.lovelace.resources.async_update_item(
                        resource["id"], {"res_type": "module", "url": url}
                    )
                break

            if not registered:
                _LOGGER.info("Registering %s (%s)", module["name"], url)
                await self.lovelace.resources.async_create_item(
                    {"res_type": "module", "url": url}
                )

    async def async_unregister(self) -> None:
        """Remove the resources when the integration is deleted."""
        if self.lovelace is None or self._mode != "storage":
            return
        await self._async_load_resources()
        for module in JSMODULES:
            url = f"{URL_BASE}/{module['filename']}"
            for resource in [
                item
                for item in self.lovelace.resources.async_items()
                if self._get_path(str(item.get("url", ""))) == url
            ]:
                await self.lovelace.resources.async_delete_item(resource["id"])

    @staticmethod
    def _get_path(url: str) -> str:
        """Path without the query parameters."""
        return url.split("?")[0]


async def async_register_panel(hass: HomeAssistant) -> None:
    """Serve the admin JS and (re-)register the panel.

    Admin-only: the page writes the integration's configuration — the vehicles,
    their tyre sets, and the manoeuvres done to them.
    """
    # The file only, never the folder that holds it: a static path is served
    # outside Home Assistant's authentication, and this package must not travel
    # with the module it serves.
    try:
        await hass.http.async_register_static_paths(
            [
                StaticPathConfig(
                    f"{URL_BASE}/{ADMIN_JS}",
                    str(Path(__file__).parent / ADMIN_JS),
                    True,
                )
            ]
        )
        _LOGGER.debug("Panel path registered: %s/%s", URL_BASE, ADMIN_JS)
    except (RuntimeError, ValueError):
        _LOGGER.debug("Panel path already registered: %s/%s", URL_BASE, ADMIN_JS)

    # `?v=` comes from the manifest, as Home Assistant already parsed it: it is
    # what makes an upgrade visible to a browser holding the old module.
    try:
        integration = await async_get_integration(hass, DOMAIN)
        version = str(integration.version or FALLBACK_VERSION)
    except Exception:  # noqa: BLE001 - a missing integration is not our problem
        version = FALLBACK_VERSION

    frontend.async_register_built_in_panel(
        hass,
        component_name="custom",
        frontend_url_path=PANEL_URL_PATH,
        sidebar_title=PANEL_SIDEBAR_TITLE,
        sidebar_icon=PANEL_SIDEBAR_ICON,
        require_admin=True,
        config={
            "_panel_custom": {
                "name": PANEL_NAME,
                "module_url": f"{URL_BASE}/{ADMIN_JS}?v={version}",
                "embed_iframe": False,
                "trust_external": False,
            }
        },
        update=True,  # idempotent across entry reloads
    )
    _LOGGER.debug("Panel registered at /%s (v%s)", PANEL_URL_PATH, version)


@callback
def async_unregister_panel(hass: HomeAssistant) -> None:
    """Remove the panel when the last vehicle is deleted."""
    try:
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
    except Exception:  # noqa: BLE001 — a panel already gone is fine
        pass
