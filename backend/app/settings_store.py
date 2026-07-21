"""Tiny persistent key-value store for runtime-toggleable hub settings.

Kept as a JSON file in DATA_DIR so toggles survive container restarts
without dragging in migrations for a single flag.
"""
from __future__ import annotations

import json
import threading
from typing import Any

from .config import settings

_DEFAULTS: dict[str, Any] = {
    # Rebuild the repo's game automatically after every successful `git push`.
    "auto_build": True,
}

_path = settings.db_path.parent / "settings.json"
_lock = threading.Lock()


def _load() -> dict[str, Any]:
    try:
        data = json.loads(_path.read_text())
    except (OSError, ValueError):
        data = {}
    return {**_DEFAULTS, **data}


def get(key: str) -> Any:
    with _lock:
        return _load().get(key, _DEFAULTS.get(key))


def set_(key: str, value: Any) -> None:
    with _lock:
        data = _load()
        data[key] = value
        _path.write_text(json.dumps(data, indent=2))
