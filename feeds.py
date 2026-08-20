"""Fetching, parsing and de-duplication of RSS/Atom feeds. Standard library only."""

import gzip
import html
import io
import math
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/125.0 Safari/537.36")

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "media": "http://search.yahoo.com/mrss/",
    "content": "http://purl.org/rss/1.0/modules/content/",
    "dc": "http://purl.org/dc/elements/1.1/",
}

TAG_RE = re.compile(r"<[^>]+>")
IMG_RE = re.compile(r"""<img[^>]+src=["']([^"']+)["']""", re.I)
WS_RE = re.compile(r"\s+")


# --------------------------------------------------------------------------- fetch

def fetch(url, timeout=12):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
        "Accept-Encoding": "gzip",
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
    return raw


# --------------------------------------------------------------------------- parse helpers

def text_of(el):
    if el is None:
        return ""
    return WS_RE.sub(" ", html.unescape("".join(el.itertext()))).strip()


def strip_html(s, limit=220):
    if not s:
        return ""
    s = TAG_RE.sub(" ", s)
    s = html.unescape(s)
    s = WS_RE.sub(" ", s).strip()
    if len(s) > limit:
        cut = s[:limit].rsplit(" ", 1)[0]
        s = cut + "…"
    return s


def parse_date(s):
    if not s:
        return None
    s = s.strip()
    try:
        dt = parsedate_to_datetime(s)
    except (TypeError, ValueError):
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def find_image(item, body_html):
    """Pull a lead image out of an RSS/Atom item, trying the usual suspects."""
    for path in ("media:content", "media:thumbnail"):
        for el in item.findall(path, NS):
            url = el.get("url")
            medium = (el.get("medium") or "").lower()
            typ = (el.get("type") or "").lower()
            if url and (medium == "image" or typ.startswith("image") or not (medium or typ)):
                return url
    for el in item.findall("enclosure"):
        if (el.get("type") or "").startswith("image") and el.get("url"):
            return el.get("url")
    for el in item.findall("atom:link", NS):
        if el.get("rel") == "enclosure" and (el.get("type") or "").startswith("image"):
            return el.get("href")
    if body_html:
        m = IMG_RE.search(body_html)
        if m:
            return html.unescape(m.group(1))
    return None


def item_link(item):
    link = item.find("link")
    if link is not None:
        if link.text and link.text.strip():
            return link.text.strip()
        if link.get("href"):
            return link.get("href")
    best = None
    for el in item.findall("atom:link", NS):
        rel = el.get("rel") or "alternate"
        if rel == "alternate" and el.get("href"):
            return el.get("href")
        if el.get("href") and best is None:
            best = el.get("href")
    if best:
        return best
    guid = item.find("guid")
    if guid is not None and (guid.text or "").startswith("http"):
        return guid.text.strip()
    return None


def parse_feed(raw, source):
    """Return a list of item dicts from raw RSS or Atom bytes."""
    root = ET.fromstring(raw)
    nodes = root.findall(".//item") or root.findall(".//atom:entry", NS)
    out = []
    for it in nodes:
        title = text_of(it.find("title")) or text_of(it.find("atom:title", NS))
        link = item_link(it)
        if not title or not link:
            continue

        body = ""
        for path in ("content:encoded", "description", "atom:content", "atom:summary"):
            el = it.find(path, NS) if ":" in path else it.find(path)
            if el is not None and (el.text or len(el)):
                body = "".join(el.itertext())
                if path in ("content:encoded", "atom:content"):
                    break
        summary_src = it.find("description")
        if summary_src is None:
            summary_src = it.find("atom:summary", NS)
        summary = strip_html("".join(summary_src.itertext()) if summary_src is not None else body)

        published = None
        for path in ("pubDate", "atom:published", "atom:updated", "dc:date", "updated", "published"):
            el = it.find(path, NS) if ":" in path else it.find(path)
            published = parse_date(text_of(el))
            if published:
                break

        author = ""
        for path in ("dc:creator", "author/atom:name", "atom:author/atom:name", "author"):
            author = text_of(it.find(path, NS) if ":" in path else it.find(path))
            if author:
                break

        tags = [text_of(c) for c in it.findall("category")]
        tags += [c.get("term", "") for c in it.findall("atom:category", NS)]
        tags = list(dict.fromkeys(t for t in tags if t and len(t) < 40))[:6]

        out.append({
            "tags": tags,
            "title": title,
            "link": urllib.parse.urljoin(source["url"], link),
            "summary": summary,
            "image": find_image(it, body),
            "published": published.isoformat() if published else None,
            "_dt": published,
            "author": author[:60],
            "source": source["name"],
            "color": source["color"],
            "domain": urllib.parse.urlparse(link).netloc.replace("www.", ""),
        })
    return out


def fetch_source(source):
    try:
        return parse_feed(fetch(source["url"]), source), None
    except (urllib.error.URLError, urllib.error.HTTPError, ET.ParseError,
            TimeoutError, OSError, ValueError) as exc:
        return [], f"{type(exc).__name__}: {exc}"


# --------------------------------------------------------------------------- lead images

OG_RE = re.compile(
    r"""<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["']"""
    r"""[^>]+content=["']([^"']+)["']""", re.I)
OG_RE_REV = re.compile(
    r"""<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']"""
    r"""(?:og:image(?::secure_url)?|twitter:image(?::src)?)["']""", re.I)


def fetch_og_image(url, timeout=8, cap=250_000):
    """Some feeds (BleepingComputer among them) ship no images — read og:image off the page."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if not (resp.headers.get_content_type() or "").startswith("text/html"):
                return None
            head = resp.read(cap).decode("utf-8", "replace")
    except Exception:
        return None
    m = OG_RE.search(head) or OG_RE_REV.search(head)
    if not m:
        return None
    img = html.unescape(m.group(1)).strip()
    if img.startswith("//"):
        img = "https:" + img
    return urllib.parse.urljoin(url, img) if img else None


def enrich_images(items, cache, budget=70, workers=10):
    """Fill in missing lead images, memoised across refreshes via `cache`."""
    todo = []
    for item in items:
        if item["image"]:
            continue
        if item["link"] in cache:
            item["image"] = cache[item["link"]]
        elif len(todo) < budget:
            todo.append(item)

    if not todo:
        return
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for item, img in zip(todo, pool.map(lambda i: fetch_og_image(i["link"]), todo)):
            cache[item["link"]] = img
            item["image"] = img


# --------------------------------------------------------------------------- de-duplication

STOP = {
    "a", "an", "the", "of", "in", "on", "for", "to", "and", "or", "with", "as", "at",
    "by", "from", "is", "are", "was", "were", "be", "been", "it", "its", "that", "this",
    "new", "after", "over", "into", "amid", "via", "how", "why", "what", "says", "said",
    "report", "reports", "us", "u", "s", "you", "your", "can", "will", "more", "than",
}

SUFFIXES = ("ings", "ing", "edly", "ed", "es", "s")


def stem(word):
    for suf in SUFFIXES:
        if word.endswith(suf) and len(word) - len(suf) >= 4:
            return word[: -len(suf)]
    return word


def tokens(title):
    words = re.findall(r"[a-z0-9]+", title.lower())
    return {stem(w) for w in words if w not in STOP and len(w) > 1}


def canon_url(url):
    p = urllib.parse.urlparse(url)
    host = p.netloc.lower().removeprefix("www.")
    path = p.path.rstrip("/").lower()
    return host + path


# Words that are rare in any one day's headlines but carry no identifying power.
# They still count toward the overlap score; they just can't be the *reason* two
# stories merge — otherwise "what you need to know" pairs unrelated articles.
GENERIC = {stem(w) for w in """
know need want say tell ask claim reveal show find
active actively exploit exploited exploiting exploitation
critical severe serious major massive huge widespread
flaw flaws bug bugs vulnerability vulnerabilities weakness
attack attacks attacker attackers hack hacked hacker hackers breach breached
warn warns warning alert alerts flag flags urge urges
patch patched patches fix fixed fixes update updates upgrade mitigate mitigation
secure security cyber cybersecurity defense defence protect protection
data leak leaked leaks expose exposed exposure
threat threats risk risks danger incident
malware malicious infect infected campaign payload
ransomware ransom extortion
report reports research researcher researchers study analysis
million billion thousand record hundreds
user users customer customers account accounts victim victims
service services tool tools platform system systems software app apps
company companies firm business enterprise organization organizations vendor
new latest first top best worst biggest
guide tips help support
week month year day days today
release released launch launched announce announced
target targets targeted targeting
steal stolen theft
phishing scam fraud
government agency agencies federal state national
bypass bypasses evade
disclosure disclosed disclose
gang group crew actor actors
million access remote code execution
""".split()}


def idf_weights(items):
    """Rarity weight per token, so 'unisoc' counts and 'critical flaw' barely does."""
    df = {}
    for item in items:
        for tok in item["_tok"]:
            df[tok] = df.get(tok, 0) + 1
    n = max(len(items), 1)
    weights = {tok: math.log(1 + n / count) for tok, count in df.items()}
    # a token is "distinctive" when it shows up in no more than ~6 headlines
    return weights, math.log(1 + n / 6)


def similar(a, b, weights, rare_cut):
    """True when two headlines almost certainly describe the same story.

    Overlap is scored by token rarity rather than token count: two headlines sharing
    'critical', 'flaw' and 'exploited' are not the same story, while two sharing
    'Unisoc' very likely are. At least one distinctive token must be common to both.
    """
    inter = a & b
    if len(inter) < 2:
        return False
    if not any(weights.get(t, 0.0) >= rare_cut and t not in GENERIC for t in inter):
        return False

    wa = sum(weights.get(t, 0.0) for t in a)
    wb = sum(weights.get(t, 0.0) for t in b)
    wi = sum(weights.get(t, 0.0) for t in inter)
    if wa <= 0 or wb <= 0:
        return False

    containment = wi / min(wa, wb)
    jaccard = wi / (wa + wb - wi)
    return containment >= 0.40 or jaccard >= 0.30


def dedupe(items):
    """Collapse repeats of the same story, keeping the earliest report as primary."""
    items = sorted(items, key=lambda i: i["_dt"] or datetime.min.replace(tzinfo=timezone.utc))
    for item in items:
        item["_tok"] = tokens(item["title"])
    weights, rare_cut = idf_weights(items)

    kept = []
    by_url = {}
    window = timedelta(days=4)

    for item in items:
        cu = canon_url(item["link"])

        primary = by_url.get(cu)
        if primary is None:
            for cand in reversed(kept):
                if cand["source"] == item["source"]:
                    continue
                if item["_dt"] and cand["_dt"] and abs(item["_dt"] - cand["_dt"]) > window:
                    continue
                if similar(cand["_tok"], item["_tok"], weights, rare_cut):
                    primary = cand
                    break

        if primary is not None:
            if not primary["image"] and item["image"]:
                primary["image"] = item["image"]
            if len(item["summary"]) > len(primary["summary"]):
                primary["summary"] = item["summary"]
            if not any(o["source"] == item["source"] for o in primary["also"]):
                primary["also"].append({
                    "source": item["source"], "link": item["link"], "color": item["color"],
                })
        else:
            item["also"] = []
            kept.append(item)
            by_url[cu] = item

    return kept


def guarantee_variety(items, limit, per_source=3, max_age=timedelta(days=14)):
    """Trim to `limit` without letting prolific feeds crowd out quiet ones.

    Straight recency sorting means adding sources pushes the likes of Krebs and CISA
    News off the end entirely — they publish a few times a month, so every one of
    their stories ranks below today's wire copy. Each source gets first claim on a
    few slots; whatever is left is filled by recency.
    """
    if len(items) <= limit:
        return items

    cutoff = datetime.now(timezone.utc) - max_age
    reserved, counts = [], {}
    for item in items:
        source = item["source"]
        if counts.get(source, 0) >= per_source:
            continue
        if item["_dt"] and item["_dt"] < cutoff:
            continue
        counts[source] = counts.get(source, 0) + 1
        reserved.append(item)

    picked = set(id(i) for i in reserved[:limit])
    for item in items:
        if len(picked) >= limit:
            break
        picked.add(id(item))

    return [i for i in items if id(i) in picked]


def spread_sources(items, gap=2):
    """Avoid long runs from one source, the way a real feed interleaves publishers."""
    remaining = list(items)
    out = []
    while remaining:
        pick = 0
        recent = [i["source"] for i in out[-gap:]]
        for idx, cand in enumerate(remaining[:6]):
            if cand["source"] not in recent:
                pick = idx
                break
        out.append(remaining.pop(pick))
    return out


# --------------------------------------------------------------------------- public API

def carry_forward(collected, previous, errors, max_age=timedelta(days=7)):
    """Re-add stories from sources that failed this run.

    A feed that rate-limits or times out shouldn't blank itself out of the site until
    it recovers, so its last known stories ride along until they age out.
    """
    if not (errors and previous):
        return 0

    have = {canon_url(i["link"]) for i in collected}
    cutoff = datetime.now(timezone.utc) - max_age
    revived = 0

    for old in previous:
        if old.get("source") not in errors or not old.get("link"):
            continue
        if canon_url(old["link"]) in have:
            continue
        when = parse_date(old.get("published"))
        if not when or when < cutoff:
            continue
        item = {k: v for k, v in old.items() if k != "also"}
        item["_dt"] = when
        collected.append(item)
        revived += 1

    return revived


def build_feed(sources, limit=180, image_cache=None, previous=None):
    errors = {}
    collected = []
    with ThreadPoolExecutor(max_workers=len(sources)) as pool:
        for source, (items, err) in zip(sources, pool.map(fetch_source, sources)):
            if err:
                errors[source["name"]] = err
            collected.extend(items)

    revived = carry_forward(collected, previous, errors)

    merged = dedupe(collected)
    merged.sort(key=lambda i: i["_dt"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    merged = spread_sources(guarantee_variety(merged, limit))
    enrich_images(merged, image_cache if image_cache is not None else {})

    for item in merged:
        item.pop("_dt", None)
        item.pop("_tok", None)

    counts = {}
    for item in merged:
        counts[item["source"]] = counts.get(item["source"], 0) + 1

    return {
        "items": merged,
        "sources": [
            {
                "name": s["name"],
                "color": s["color"],
                "category": s["category"],
                "count": counts.get(s["name"], 0),
            }
            for s in sources
        ],
        "errors": errors,
        "revived": revived,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "total": len(collected),
    }
