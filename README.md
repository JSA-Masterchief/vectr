# ✈️ Vectr — Free, Open-Source Real-Time Flight Tracker

Vectr is a zero-cost, static-site flight tracker. Type a flight number or
callsign, and it plots the aircraft live on a map using public ADS-B data —
altitude, speed, heading, vertical rate, squawk, and a heuristic "AI
Insights" panel that reads the telemetry in plain English.

**No backend. No API keys. No hosting bill.** It's a static site you can
deploy to GitHub Pages in about two minutes.

> ⚠️ **Not for operational or safety-critical use.** Data comes from the
> free, crowdsourced OpenSky Network and is delayed / incomplete by design.
> Don't use this to make real aviation decisions.

---

## 1. Why it's free — the data source decision

The single hardest constraint on this project is that **flight data is
usually paywalled.** Here's the comparison that led to the current design:

| Source | Cost | Coverage | Auth for basic use | Verdict |
|---|---|---|---|---|
| **OpenSky Network** (`/api/states/all`) | Free | Global ADS-B, crowdsourced receiver network | None for anonymous, low-volume use; free account raises limits | ✅ **Chosen.** Best free global coverage, genuinely free tier, browser-callable. |
| ADS-B Exchange | Free tier removed / now commercial (RapidAPI) | Global, very complete | API key required, paid | ❌ Not truly free anymore for meaningful volume. |
| adsb.lol / airplanes.live | Free, community-run | Global, good | None | 🟡 Good backup/alternate provider — see "Swapping providers" below. |
| FlightAware AeroAPI | Free tier very limited (personal use quota) | Excellent, includes flight plans | API key required | 🟡 Great for Phase 3+ if you're willing to register. |
| AviationStack / FlightLabs | Free tier limited to ~100 req/month | Decent | API key required | 🟡 Fine for low-traffic side features, not live tracking. |

**Decision:** ship on OpenSky's anonymous REST endpoint. It needs no key,
supports being called directly from a static site, and gives real global
live positions. The tradeoffs, honestly stated:

- No official "search by flight number" endpoint — Vectr fetches the full
  live state vector list and matches callsigns client-side.
- The callsign an aircraft actually broadcasts uses the airline's
  **3-letter ICAO code** (`BAW15`), not the 2-letter **IATA code** most
  people think in (`BA15`). FlightRadar24 and similar sites bridge this
  with an airline code lookup table — Vectr does the same, for free,
  using the public [OpenFlights airline dataset](https://github.com/jpatokal/openflights)
  (~780 active carriers, `data/airlines.json`). Type either form and it
  resolves, and it's tolerant of the zero-padding some transponders add
  (`UAL123` vs `UAL0123`).
- No route/schedule data (origin/destination airport, scheduled times) —
  Vectr estimates a likely destination by finding the nearest airport in a
  built-in offline dataset of ~260 major airports, and says so explicitly.
- No historical/replay tracks on the anonymous tier — Vectr builds up a
  track polyline only for the current browser session.
- Anonymous rate limits are real and can change on OpenSky's end. If you
  outgrow them, register a free OpenSky account for higher limits, or swap
  in adsb.lol (very similar response shape) — see below.

### Swapping providers later

All provider logic lives in **`js/opensky.js`** behind two functions:
`fetchAllStates()` and `findByCallsign()`/`getByIcao24()`. To switch
providers, reimplement those functions to return the same flight object
shape (`icao24, callsign, latitude, longitude, baro_altitude, velocity,
true_track, vertical_rate, on_ground, squawk, origin_country`) and nothing
else in the app needs to change.

---

## 2. Airport Explorer (departures & arrivals)

Click **✈ Airports** in the top bar and search any of the ~260 major hubs
in `data/airports.json`. Two layers of data, stacked so the free one
always works:

1. **Live Board (free, no signup, on by default).** Queries OpenSky's
   `/api/states/all` with a bounding box around the airport, then
   classifies each nearby aircraft as a likely arrival, likely departure,
   or other nearby traffic — from its current altitude, vertical rate,
   and whether its heading points toward or away from the field. This is
   an **inference from live position data**, not an official schedule,
   and the UI says so explicitly. Refreshes every 20s.
2. **Scheduled timetable (optional, bring-your-own free key).** Real
   flight numbers, terminals, gates, and scheduled/estimated times need
   licensed schedule data — there is no provider that gives this away
   globally with zero signup (see the comparison table in §1). The best
   free tier we found is [AeroDataBox](https://aerodatabox.com/) via
   RapidAPI (a few hundred free calls/month) or API.market (a much larger
   free quota). Add your own key from the "⚙ Schedule key" button; it's
   stored only in `localStorage` and sent only to AeroDataBox's API —
   Vectr's own static hosting never sees or stores it. Because this is a
   pure static site with no backend, the key is visible in your own
   browser's network tab, same as any client-side API key on a
   no-backend site — don't reuse a key you need to keep secret from
   people using your own deployment.

## 3. Architecture

Vectr is intentionally **framework-free**: plain HTML/CSS/JS, no build
step, no bundler. That was a deliberate choice for this brief — it means
"deploy" is literally "push to GitHub, flip on Pages," with nothing to
break in a build pipeline, and anyone can read the source without tooling.

```
Browser
 ├─ index.html            → page shell: hero, tracker view, airport explorer view
 ├─ css/styles.css         → design system (tokens, dark/light themes)
 ├─ js/views.js            → tiny router switching between the 3 top-level views
 ├─ js/airports.js         → loads data/airports.json, search + nearest-airport math
 ├─ js/airlines.js         → loads data/airlines.json, IATA→ICAO code resolution
 ├─ js/opensky.js          → OpenSky REST wrapper (the ONLY live-position data file)
 ├─ js/aerodatabox.js      → OPTIONAL schedule provider (needs the user's own free key)
 ├─ js/app.js              → flight tracker: search flow, map, telemetry, AI insights
 ├─ js/airportview.js      → airport explorer: search, live board, schedule panel
 ├─ data/airports.json     → offline dataset, ~260 major airports (lat/lon/IATA)
 └─ data/airlines.json     → offline dataset, ~780 active airlines (IATA/ICAO codes)

External services:
 ├─ opensky-network.org/api/states/all   → live aircraft state vectors (no key)
 ├─ aerodatabox.p.rapidapi.com           → optional scheduled timetables (user's own free key)
 ├─ basemaps.cartocdn.com                → free dark/light map tiles (no key)
 └─ unpkg.com                            → Leaflet.js + CSS (CDN, no key)
```

### Data flow

1. User types a callsign → `app.js` calls `OpenSky.findByCallsign()`.
2. `opensky.js` fetches (and caches for 9s) the entire global state vector
   list, then filters client-side for a callsign match.
3. First match is rendered: Leaflet marker + rotation from `true_track`,
   telemetry cards, a nearest-major-airport route guess from
   `airports.js`, and a set of heuristic "AI Insights" computed entirely
   on-device from the numbers already on screen (climb/descent phase,
   speed character, proximity to a major airport). **No LLM call, no
   cost, no API key** — this keeps the "AI feature" genuinely free while
   still being useful. (See §6 for how to upgrade this to a real LLM if
   you're willing to pay for one.)
4. Every 15s, if auto-refresh is on, the same aircraft (`icao24`) is
   re-fetched and the UI updates in place, building a session-local track
   polyline.

### Why no backend?

A backend would be needed for: server-side API keys, historical data
storage, or user accounts. None of Phase 1–3 need that — OpenSky's public
endpoint is directly browser-callable. If you build Phase 4 (accounts,
saved searches across devices, notifications), see §7 for a free-tier
backend recommendation.

---

## 4. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Structure | Plain HTML5 | No build step = simplest possible deploy to Pages |
| Styling | Hand-written CSS, custom properties | Full control of the dark "ATC radar" design system, no framework overhead |
| Map | [Leaflet.js](https://leafletjs.com/) + CARTO free tiles | Free, no API key, lightweight vs. MapLibre+vector tiles for this scope |
| Data | [OpenSky Network REST API](https://openskynetwork.github.io/opensky-api/rest.html) | Only source with genuinely free, keyless, global live data |
| Fonts | Space Grotesk (display), JetBrains Mono (telemetry), Inter (body) | Distinct identity; mono face reads as flight-computer/departure-board data |
| Hosting | GitHub Pages | Free, matches the "deployable by anyone" requirement exactly |

---

## 5. Running it locally

No build tools needed. Any static file server works, e.g.:

```bash
git clone https://github.com/<you>/vectr.git
cd vectr
python3 -m http.server 8080
# open http://localhost:8080
```

(Opening `index.html` directly via `file://` will work for most of it, but
some browsers block `fetch()` of local JSON over `file://` — use a local
server to be safe.)

---

## 6. Deployment guide (GitHub Pages)

1. Push this repo to GitHub (see §10 for the commit plan).
2. On GitHub: **Settings → Pages → Source → Deploy from a branch**.
3. Branch: `main`, folder: `/ (root)`. Save.
4. Your site is live at `https://<you>.github.io/vectr/` within a minute.

No environment variables, no secrets, no build step required. If you'd
rather use Vercel/Netlify/Cloudflare Pages, just import the repo with
**framework preset: "Other/Static"** and no build command — it works
as-is.

### Upgrading the AI Insights panel to a real LLM (optional, has a cost)

The current AI panel is deliberately free (on-device heuristics). If you
want actual natural-language generation (e.g. "explain this delay" in
Phase 5), you'd add a tiny serverless function (Vercel/Netlify function or
Cloudflare Worker — all have free tiers) that holds your Anthropic/OpenAI
API key server-side and proxies a prompt built from the same telemetry
object already in `app.js`. Keeping the key server-side is the only reason
you'd need any backend at all for this project.

---

## 7. If you ever need a backend (Phase 4+)

Accounts, cross-device saved searches, and push notifications need a
server. Recommendation, in order of fit:

1. **Cloudflare Workers + D1** (free tier: generous request quota, SQLite-
   compatible DB) — best fit for a lightweight accounts/favorites API.
2. **Supabase free tier** — if you want auth + Postgres + realtime
   subscriptions without writing your own backend at all.
3. **Vercel Functions + Vercel Postgres/KV free tier** — good if you're
   already deploying the frontend there.

None of this is needed for Phases 1–3.

---

## 8. Roadmap

- **Phase 1 — done in this drop:** landing page, live search, interactive
  map, telemetry panel, responsive layout, dark/light theme.
- **Phase 2 — done in this drop:** auto-refresh, session flight path,
  search history (localStorage).
- **Phase 3 — done in this drop:** Airport Explorer with a free live-board
  (inferred arrivals/departures from OpenSky) and an optional real
  scheduled timetable (AeroDataBox, bring-your-own free key). Still open:
  dedicated airline pages, aircraft-type lookup by ICAO24 (needs an
  aircraft-type database — candidate: OpenSky's own metadata endpoint),
  and flight replay (blocked on a free historical-track source — OpenSky's
  `/flights/aircraft` needs a registered account; revisit once you have
  one).
- **Phase 4:** accounts/favorites/notifications — needs a backend, see §7.
- **Phase 5:** AI features — the free heuristic panel ships now; anything
  needing real natural-language generation needs a paid LLM call behind a
  serverless proxy (see §6), so treat it as opt-in/self-funded.

## 9. Known limitations

- Anonymous OpenSky access is rate-limited and can be tightened without
  notice on their end — this is the tradeoff for zero-cost, keyless data.
- Only currently-airborne (or very recently reporting) flights are
  findable — there's no "future scheduled flight" lookup without a paid
  schedules API.
- Origin/destination shown are **estimates** (nearest major airport to
  current position), not the filed flight plan — this is called out in
  the UI itself, not just in these docs.
- The airport dataset covers ~260 major hubs, not every airfield — small
  regional strips won't show up as a nearest-airport match.

## 10. Suggested commit plan (for uploading to GitHub)

You can also just push everything as one commit — it's a solo static-site
project and there's no wrong way to do this. If you'd like a clean,
readable history instead, here's a sensible 3-day split:

| Day | Commit message | Files |
|---|---|---|
| Day 1 | `chore: project scaffolding` | `.gitignore`, `LICENSE`, `.github/ISSUE_TEMPLATE/*`, `.github/PULL_REQUEST_TEMPLATE.md` |
| Day 1 | `docs: architecture, provider comparison, roadmap` | `README.md` |
| Day 2 | `feat: landing page, tracker layout, design system` | `index.html`, `css/styles.css` |
| Day 2 | `feat: OpenSky live-position data layer` | `js/opensky.js` |
| Day 2 | `feat: airline/airport reference data + lookups` | `data/airports.json`, `data/airlines.json`, `js/airports.js`, `js/airlines.js` |
| Day 3 | `feat: flight tracker — map, telemetry, AI insights` | `js/views.js`, `js/app.js` |
| Day 3 | `feat: airport explorer — live board + optional schedule` | `js/airportview.js`, `js/aerodatabox.js` |
| Day 3 | `docs: contributing guide + changelog` | `CONTRIBUTING.md`, `CHANGELOG.md` |
| Day 3 | Enable **Settings → Pages → Deploy from branch → main / (root)** | — |

Everything in the zip goes at the **repo root** (not nested in a
subfolder) — that's what GitHub Pages expects with the root-folder
setting above.

## License

MIT — see [LICENSE](LICENSE). Flight data © The OpenSky Network,
used under their terms. Map tiles © OpenStreetMap contributors, styled by
CARTO. Airport reference data derived from the public
[mwgg/Airports](https://github.com/mwgg/Airports) dataset.
