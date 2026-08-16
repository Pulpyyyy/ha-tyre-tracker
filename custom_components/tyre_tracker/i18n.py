"""The words the integration assembles itself.

Home Assistant translates what it owns: entity names, flow labels, service
descriptions, the message of an exception. It does not translate what a
component composes — a device model, a sensor state built from two set names,
the line every step of the options flow opens with. Those are strings this code
builds, and no `strings.json` key can reach them.

So the integration keeps its own vocabulary files, one per language, under
`words/` — beside `translations/` and following the same language selection,
but out of it: hassfest validates the Home Assistant translation files against
a fixed schema, and a section of ours has no place in it. Read once per
language, from the executor, and kept for the run.

The fallback is English rather than the key: a vocabulary missing a word should
read oddly in one language, not show `status.mounted` in the middle of a
sentence.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Final

from homeassistant.core import HomeAssistant

from .const import DOMAIN

WORDS_DIR: Final = Path(__file__).parent / "words"
FALLBACK_LANGUAGE: Final = "en"

# Where the loaded vocabularies sit, one per language asked for.
DATA_WORDS: Final = f"{DOMAIN}_words"


class Words:
    """One language's vocabulary, read as a path.

    `words("status.mounted")` rather than a chain of `.get`, because every
    caller here knows exactly which word it wants and none of them has anything
    useful to do if it is missing.
    """

    def __init__(self, table: dict[str, Any], fallback: dict[str, Any]) -> None:
        """Hold a language, and the English to fall back on."""
        self._table = table
        self._fallback = fallback

    def __call__(self, path: str, **placeholders: object) -> str:
        """The word at that path, with its placeholders filled in."""
        value = _walk(self._table, path)
        if not isinstance(value, str):
            value = _walk(self._fallback, path)
        if not isinstance(value, str):
            return path
        if not placeholders:
            return value
        try:
            return value.format(**placeholders)
        except (KeyError, IndexError, ValueError):
            # A translation carrying a placeholder the caller does not have is
            # a mistake in the file, not a reason to lose the sentence.
            return value

    def get(self, path: str, default: str = "") -> str:
        """The word at that path, or a default. For lookups that may miss."""
        value = _walk(self._table, path)
        if not isinstance(value, str):
            value = _walk(self._fallback, path)
        return value if isinstance(value, str) else default

def _walk(table: dict[str, Any], path: str) -> Any:
    """Follow a dotted path into nested dicts. None when it leads nowhere."""
    node: Any = table
    for step in path.split("."):
        if not isinstance(node, dict):
            return None
        node = node.get(step)
    return node


def _read(language: str) -> dict[str, Any]:
    """One language's vocabulary file. Empty when there is none."""
    path = WORDS_DIR / f"{language}.json"
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle) or {}
    except (OSError, ValueError):
        return {}


def _load(language: str) -> Words:
    """Build a vocabulary. Runs in the executor: it opens files."""
    fallback = _read(FALLBACK_LANGUAGE)
    # « fr-CA » and « pt-BR » carry a region this integration has no separate
    # file for. The base language is the right answer, and the only one that
    # keeps a regional setting from silently reading English.
    table = _read(language) or _read(language.split("-")[0].split("_")[0])
    return Words(table, fallback)


async def async_words(hass: HomeAssistant, language: str | None = None) -> Words:
    """The vocabulary for a language, read once and kept.

    Defaults to the language Home Assistant is set to, which is what names the
    devices and composes the states — server-side text, in the server's
    language. What a browser displays is the card's business, and the card
    picks its own from the user's own setting.
    """
    language = language or hass.config.language or FALLBACK_LANGUAGE
    cache: dict[str, Words] = hass.data.setdefault(DATA_WORDS, {})
    if (known := cache.get(language)) is not None:
        return known
    words = await hass.async_add_executor_job(_load, language)
    cache[language] = words
    return words
