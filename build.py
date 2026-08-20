#!/usr/bin/env python3
"""Build the static feed payload.

Run locally or from CI:

    python3 build.py

Writes `site/data/feed.json` (what the site loads) and `site/data/images.json`
(a URL -> og:image memo, committed so CI doesn't re-scrape known articles).
"""

import json
from pathlib import Path

from feeds import build_feed
from sources import SOURCES

ROOT = Path(__file__).parent
DATA = ROOT / "site" / "data"
FEED_FILE = DATA / "feed.json"
IMAGES_FILE = DATA / "images.json"

# Fields the UI never reads — dropped to keep the payload small.
DROP = ("author", "domain")
MAX_IMAGE_MEMOS = 1500


def load_json(path, fallback=None):
    try:
        return json.loads(path.read_text())
    except (ValueError, OSError):
        return {} if fallback is None else fallback


def signature(data):
    """Everything that matters to a reader, ignoring build timestamps."""
    return [(i.get("link"), i.get("title"), i.get("image"), len(i.get("also", [])))
            for i in data.get("items", [])]


def main():
    DATA.mkdir(parents=True, exist_ok=True)

    images = load_json(IMAGES_FILE) if IMAGES_FILE.exists() else {}
    previous = load_json(FEED_FILE, {}).get("items", []) if FEED_FILE.exists() else []

    data = build_feed(SOURCES, image_cache=images, previous=previous)

    for item in data["items"]:
        for field in DROP:
            item.pop(field, None)

    # Only rewrite when the stories actually changed — `fetchedAt` alone moves every
    # run, and committing that on every cron tick would bury the history in noise.
    if FEED_FILE.exists() and signature(load_json(FEED_FILE)) == signature(data):
        print(f"{len(data['items'])} stories, unchanged since last build")
        return

    FEED_FILE.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))

    live = {k: v for k, v in list(images.items())[-MAX_IMAGE_MEMOS:]}
    IMAGES_FILE.write_text(json.dumps(live, separators=(",", ":"), sort_keys=True))

    merged = sum(len(i["also"]) for i in data["items"])
    size = FEED_FILE.stat().st_size / 1024
    print(f"{len(data['items'])} stories from {data['total']} fetched "
          f"({merged} duplicates merged), {size:.0f} KB")
    if data["errors"]:
        for name, err in data["errors"].items():
            print(f"  warning: {name}: {err}")
        print(f"  carried {data['revived']} stories forward from failed sources")


if __name__ == "__main__":
    main()
