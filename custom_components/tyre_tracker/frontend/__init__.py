"""Publication of the Lovelace card shipped with the integration.

The card lives inside the integration rather than in `www/`: HACS delivers
`custom_components/tyre_tracker/` and nothing else, so anything the card needs
has to travel with it. Installing the integration is then the whole setup —
no file to copy, no resource to add by hand.

Sequence taken from KipK's guide on embedding a Lovelace card in an
integration (https://forum.hacf.fr/t/74074): the static path is always
registered, and the Lovelace resource is only touched in storage mode.
"""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from ..const import CARD_FILENAME, INTEGRATION_VERSION, JSMODULES, URL_BASE

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

        if self.lovelace is None:
            # Said out loud rather than passed over: without this, the card is
            # served and never referenced, and nothing anywhere says why.
            _LOGGER.warning(
                "Lovelace unavailable: add the resource by hand -> "
                "url: %s/%s?v=%s , type: module",
                URL_BASE,
                CARD_FILENAME,
                INTEGRATION_VERSION,
            )
            return

        if self._mode != "storage":
            _LOGGER.info(
                "Lovelace in YAML mode: add the resource by hand -> "
                "url: %s/%s?v=%s , type: module",
                URL_BASE,
                CARD_FILENAME,
                INTEGRATION_VERSION,
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
            url = f"{URL_BASE}/{module['filename']}?v={INTEGRATION_VERSION}"
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
