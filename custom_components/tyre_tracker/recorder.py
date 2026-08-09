"""Exclusion of the large attributes from the history.

The fitted-set sensor carries everything a card needs — the whole set list,
the pressures, the last swap — and writes its state on every odometer tick of
a connected car. Recording those blobs would grow the database for readings
the history graph never shows: only the state, the kilometres, is worth
keeping.
"""

from __future__ import annotations

from homeassistant.core import HomeAssistant, callback


@callback
def exclude_attributes(hass: HomeAssistant) -> set[str]:
    """These structures are recomputed live and mean nothing in the history."""
    return {"sets", "fitted", "pressures", "tpms", "last_swap"}
