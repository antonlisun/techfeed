# TechFeed

A Google Discover–style security and tech newsfeed, running at [techfeed.info](https://techfeed.info). Pulls 18 RSS/Atom feeds (BleepingComputer and peers,
plus CISA and NIST), collapses the same story reported by multiple outlets, and renders a
Chrome-Discover lookalike with source, subject, time and sort filters.

The deployed site is **fully static** — a GitHub Action fetches the feeds every 30 minutes and
commits `site/data/feed.json`. Nothing runs at request time, so there's no server to host.
Python 3 standard library only, no dependencies, no build step.

```
sources.json                  ← the feed list (add feeds here)
sources.py                    loads and validates sources.json
build.py                      fetch + dedupe -> site/data/feed.json
feeds.py                      fetching, parsing, de-duplication
server.py                     local dev only
site/                         ← the deployable folder
  config.js                   ← subjects, time ranges, data location
  index.html  styles.css  app.js
  data/feed.json              the payload the page loads (built by CI)
  data/images.json            URL -> og:image memo, committed so CI doesn't re-scrape
.github/workflows/refresh.yml the 30-minute cron
netlify.toml                  publish dir + skip-deploy rule
```

## Adding a feed

Append to the `sources` array in `sources.json`. Two keys are required:

```json
{ "name": "Cisco Talos", "url": "https://blog.talosintelligence.com/rss/" }
```

Optional keys: `category` (groups the source in the filter panel, default `News`), `color`
(the avatar colour — derived from the name if omitted, stable across runs), and `enabled`
(set `false` to keep a feed configured but out of the build). RSS 2.0 and Atom both work.
Re-run `build.py`, or restart the dev server, to pick it up. A malformed entry fails the build
with a message naming the source, rather than being silently skipped.

Three feeds ship disabled, each with a `_note` explaining why: **CISA ICS Advisories** (30
vendor advisories a day would crowd out everything else), **NIST News** (all of NIST, including
construction safety and metrology), and **Sophos News** (stopped responding). Flip `enabled` to
`true` on any of them.

## Deploy

### Getting it onto GitHub from a GUI

Using GitHub Desktop, no terminal needed:

1. Install **GitHub Desktop** (<https://desktop.github.com>) and sign in.
2. **File → Add Local Repository…** → choose the `techfeed` folder. It will say the folder
   isn't a Git repository and offer to **create a repository** — do that, leaving the defaults.
   The `.gitignore` here is already correct.
3. Enter a summary in the bottom-left box and click **Commit to main**.
4. Click **Publish repository**. **Uncheck "Keep this code private"** (see the Actions-minutes
   note below) and name it `techfeed`.

The repo, the refresh workflow and the Netlify config all go up together.

### Netlify

1. Push the repo to GitHub — **public**. Actions minutes are unlimited on public repos; a
   private repo gets 2,000/month and a 30-minute cron runs to roughly 1,400–2,900, so it may
   not fit. Keep it private only if you also drop the cron to hourly.
2. In Netlify: **Add new site → Import an existing project**, pick the repo. `netlify.toml`
   already sets the publish directory to `site` with no build command.
3. Open **Actions** in GitHub and enable workflows, then run **Refresh feed** once to confirm
   it can commit.
4. Edit `repo` in `site/config.js`:

   ```js
   repo: { owner: "your-username", name: "techfeed", branch: "main" },
   ```

5. **Site configuration → Domain management → Add a domain** → `techfeed.info`. Netlify will
   either walk you through pointing your registrar's nameservers at Netlify DNS (simplest), or
   give you records to add at your registrar:

   | Type  | Name  | Value                    |
   |-------|-------|--------------------------|
   | A     | `@`   | `75.2.60.5`              |
   | CNAME | `www` | `your-site.netlify.app`  |

   Confirm the apex value against what Netlify shows you — it's the number they publish for
   your account, not a universal constant. HTTPS is provisioned automatically once DNS
   resolves; allow up to an hour. Netlify redirects `www` to the apex on its own.

Step 4 matters. `netlify.toml` tells Netlify to **skip deploys for data-only commits** —
otherwise 48 feed refreshes a day would burn through the 300 free build minutes a month. With
deploys skipped, the `feed.json` Netlify serves goes stale, so the page falls back to reading
the fresh one directly from `raw.githubusercontent.com` (which sends permissive CORS headers
and caches for ~5 minutes). UI changes still deploy normally.

### GitHub Pages

Settings → Pages → deploy from `main` / `/site`. Leave `REPO` blank — Pages republishes on
every commit, so the same-origin `data/feed.json` is always current.

## Local development

Live fetch on every request, no CI involved:

```bash
python3 server.py
```

<http://localhost:8765>. It serves `site/` and answers `data/feed.json` from a live fetch, so
the page behaves exactly as it does deployed. The first request takes ~15s while it fetches
every feed; after that it's cached for 4 minutes.

Or build the static payload and serve the folder as-is — identical to production:

```bash
python3 build.py
python3 -m http.server 8799 --directory site
```

## Configuring

Everything tunable lives in two files, neither of which is code you have to read:

- `sources.json` — the feeds (see above).
- `site/config.js` — subjects, time ranges, where the data is fetched from, and rendering
  batch sizes. Adding a subject is one line:

  ```js
  { label: "Insider threat", test: /insider|disgruntled|rogue employee/i },
  ```

  Each subject becomes both a chip and a filter, matched against the headline, summary and the
  feed's own category tags.

**Refresh cadence** is the `cron` line in `.github/workflows/refresh.yml`. GitHub commonly runs
scheduled jobs several minutes late, so intervals under ~15 minutes aren't meaningful.

## Filters

The funnel button in the search bar opens a panel with:

- **Sources** — grouped by category, with per-source story counts. Sources with nothing recent
  are dimmed and labelled, so an empty feed is distinguishable from one you switched off.
- **Published** — any time / 24 hours / 3 days / week.
- **Sort by** — newest, or most covered (stories carrying the most duplicate reports first).

Subjects are the chip row and are multi-select — picking Ransomware and Phishing shows stories
matching either. "Top stories" clears them. A card's ⋮ menu can also mute a source or solo it
("Only show BleepingComputer"); both write to the same source filter, so the panel always
reflects what the menu did. Everything persists in `localStorage`, and the funnel shows a badge
counting active filter groups.

## How de-duplication works

Four passes:

1. **Canonical URL** — host + path, minus `www.`, query strings and trailing slashes.
2. **Rarity-weighted title overlap** — titles are lowercased, stripped of stopwords and
   stemmed, then compared as token sets weighted by inverse document frequency. Rare words
   ("Unisoc", "Gunra") dominate the score; ubiquitous ones ("critical", "flaw") barely move it.
3. **Entity gate** — at least one shared word must be both rare *and* absent from `GENERIC`, a
   list of newsroom vocabulary that is rare in any single day's headlines but identifies
   nothing. Without this, "Anubis ransomware: what you need to know" merges with "What Boards
   Need to Know About Tech Risk" on the strength of "need to know".
4. **Time window** — only stories published within 4 days of each other can merge.

The earliest report keeps the card; the rest become the "N sources covering this" chip, and the
survivor inherits an image or a longer summary from a duplicate if it lacks one.

On a typical run this merges ~16 groups out of ~335 fetched stories, including a five-source
cluster on a single news event. The thresholds are deliberately tuned to under-merge: showing
one story twice is a smaller failure than silently hiding a story. One known imperfection —
two different vendors disclosing near-identically-worded breaches on the same day can still
collapse into one card.

## Images

Several feeds (BleepingComputer among them) ship no images, so items without one get their
`og:image` scraped from the article page — capped at 70 lookups per build, memoised in
`site/data/images.json`, and committed, so CI only pays that cost for genuinely new stories.

## Resilience and scale

If a source times out or rate-limits, its stories don't vanish from the site: the build carries
forward that source's items from the previous `feed.json` until they're 7 days old. And if the
stories haven't changed since the last run, `build.py` rewrites nothing, so the cron doesn't
fill the history with empty commits.

The feed is capped at 180 stories, but plain recency sorting doesn't scale as sources are
added — a wire service posting 40 times a day pushes Krebs and CISA News off the end entirely,
since every one of their stories ranks below today's copy. So each source gets first claim on
up to 3 slots (for anything published in the last 14 days) before the rest is filled by
recency. Add a dozen more feeds and the quiet ones will still be represented.

## UI

Search, topic chips, per-card overflow menu (open, copy link, hide source + undo), read-state
dimming, infinite scroll, pull-to-refresh, light/dark themes, and a "N new stories" pill when a
background refresh finds something. Preferences live in `localStorage`.
