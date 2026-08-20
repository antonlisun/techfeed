"""Loader for `sources.json`.

Adding a feed means adding two keys to that file — a name and a url. Everything else
has a sensible default, so this module exists to apply those defaults and to fail
loudly on a typo rather than silently dropping a feed.
"""

import colorsys
import hashlib
import json
from pathlib import Path

CONFIG = Path(__file__).parent / "sources.json"

DEFAULT_CATEGORY = "News"
CATEGORY_ORDER = ["News", "Government", "Vendor research", "Analysis"]


class SourceConfigError(ValueError):
    """Raised when sources.json can't be used as written."""


def auto_color(name):
    """A stable, readable avatar colour for feeds that don't specify one."""
    digest = hashlib.sha1(name.encode("utf-8")).digest()
    hue = digest[0] / 255.0
    r, g, b = colorsys.hls_to_rgb(hue, 0.38, 0.62)
    return "#%02x%02x%02x" % (round(r * 255), round(g * 255), round(b * 255))


def load_sources(path=CONFIG, include_disabled=False):
    try:
        raw = json.loads(Path(path).read_text())
    except FileNotFoundError:
        raise SourceConfigError(f"{path} not found")
    except ValueError as exc:
        raise SourceConfigError(f"{path} is not valid JSON: {exc}") from exc

    entries = raw.get("sources") if isinstance(raw, dict) else raw
    if not isinstance(entries, list):
        raise SourceConfigError(f'{path} must hold a "sources" list')

    out = []
    seen = set()
    for i, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise SourceConfigError(f"source #{i + 1} is not an object")

        name = (entry.get("name") or "").strip()
        url = (entry.get("url") or "").strip()
        if not name or not url:
            raise SourceConfigError(f'source #{i + 1} needs both "name" and "url"')
        if not url.startswith(("http://", "https://")):
            raise SourceConfigError(f"{name}: url must be http(s), got {url!r}")
        if name.lower() in seen:
            raise SourceConfigError(f"duplicate source name: {name}")
        seen.add(name.lower())

        if not entry.get("enabled", True) and not include_disabled:
            continue

        out.append({
            "name": name,
            "url": url,
            "color": entry.get("color") or auto_color(name),
            "category": entry.get("category") or DEFAULT_CATEGORY,
            "enabled": bool(entry.get("enabled", True)),
        })

    if not out:
        raise SourceConfigError(f"{path} has no enabled sources")
    return out


def category_sort_key(category):
    """Known categories keep a curated order; new ones fall in alphabetically after."""
    if category in CATEGORY_ORDER:
        return (0, CATEGORY_ORDER.index(category), "")
    return (1, 0, category.lower())


# Loaded once at import so callers can keep doing `from sources import SOURCES`.
SOURCES = load_sources()
