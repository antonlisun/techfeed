#!/usr/bin/env python3
"""Local dev server for TechFeed.

    python3 server.py [--port 8765]

Serves `site/` and answers `data/feed.json` from a live fetch, so the page behaves
exactly as it does once deployed — where that same path is a file built by CI.
In production nothing here runs; the site is static. Standard library only.
"""

import argparse
import json
import mimetypes
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from feeds import build_feed
from sources import SOURCES

STATIC = Path(__file__).parent / "site"
CACHE_FILE = Path(__file__).parent / ".cache.json"
IMG_CACHE_FILE = STATIC / "data" / "images.json"
TTL = 240  # seconds; below the client's 5-minute poll so a poll always gets fresh data

_lock = threading.Lock()
_cache = {"data": None, "at": 0}
_images = {}


def load_disk_cache():
    if CACHE_FILE.exists():
        try:
            blob = json.loads(CACHE_FILE.read_text())
            _cache["data"], _cache["at"] = blob["data"], blob["at"]
        except (ValueError, KeyError, OSError):
            pass
    if IMG_CACHE_FILE.exists():
        try:
            _images.update(json.loads(IMG_CACHE_FILE.read_text()))
        except (ValueError, OSError):
            pass


def get_feed(force=False):
    with _lock:
        fresh = _cache["data"] and (time.time() - _cache["at"]) < TTL
        if fresh and not force:
            return _cache["data"], True

        data = build_feed(SOURCES, image_cache=_images)
        if not data["items"] and _cache["data"]:
            return _cache["data"], True  # every feed failed; keep serving the last good one

        _cache["data"], _cache["at"] = data, time.time()
        try:
            CACHE_FILE.write_text(json.dumps({"data": data, "at": _cache["at"]}))
            trimmed = dict(list(_images.items())[-2000:])
            IMG_CACHE_FILE.write_text(json.dumps(trimmed))
        except OSError:
            pass
        return data, False


class Handler(BaseHTTPRequestHandler):
    server_version = "TechFeed/1.0"

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)

    def _send(self, code, body, ctype, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        path = url.path

        if path in ("/api/feed", "/data/feed.json"):
            force = parse_qs(url.query).get("refresh", ["0"])[0] == "1"
            try:
                data, cached = get_feed(force=force)
            except Exception as exc:  # never take the whole server down over a bad feed
                self._send(502, json.dumps({"error": str(exc)}).encode(), "application/json")
                return
            payload = dict(data, cached=cached)
            self._send(200, json.dumps(payload).encode(), "application/json; charset=utf-8",
                       {"Cache-Control": "no-store"})
            return

        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        target = (STATIC / rel).resolve()
        if not str(target).startswith(str(STATIC.resolve())) or not target.is_file():
            self._send(404, b"Not found", "text/plain")
            return

        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript",):
            ctype += "; charset=utf-8"
        self._send(200, target.read_bytes(), ctype, {"Cache-Control": "no-cache"})

    do_HEAD = do_GET


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()

    load_disk_cache()
    threading.Thread(target=lambda: get_feed(force=not _cache["data"]), daemon=True).start()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"TechFeed running at http://localhost:{args.port}  ({len(SOURCES)} sources)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
