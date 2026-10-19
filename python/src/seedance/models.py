"""Seedance model names and the KreatorFlow API ids they map to."""

from __future__ import annotations

from typing import Dict

#: Friendly model names you can pass as ``model=``, mapped to the KreatorFlow API model id.
#: Any other value (for example ``"kreator-video-pro"``) is sent to the API unchanged.
MODEL_ALIASES: Dict[str, str] = {
    "seedance-2.5": "kreator-video-seedance-2-5",
    "seedance-2-5": "kreator-video-seedance-2-5",
    "seedance-2.0": "kreator-video-seedance-2",
    "seedance-2": "kreator-video-seedance-2",
    "seedance-2.0-fast": "kreator-video-seedance-2-fast",
    "seedance-2-fast": "kreator-video-seedance-2-fast",
    "seedance-2.0-mini": "kreator-video-seedance-2-mini",
    "seedance-2-mini": "kreator-video-seedance-2-mini",
}

DEFAULT_MODEL = "seedance-2.0"

#: Final job statuses. A job in any other status is still running.
TERMINAL_STATUSES = frozenset({"completed", "failed", "canceled", "blocked"})

#: Every status a job can have, in the order a job moves through them.
JOB_STATUSES = ("created", "queued", "processing", "completed", "failed", "canceled", "blocked")


def resolve_model(model: str) -> str:
    """Return the KreatorFlow API model id for a friendly name such as ``"seedance-2.0"``."""
    key = model.strip()
    return MODEL_ALIASES.get(key.lower(), key)
