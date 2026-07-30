# ✈️ Vectr — Free, Open-Source Real-Time Flight Tracker

Vectr is a zero-cost flight tracker. Type a flight number or callsign and
it plots the aircraft live on a map — altitude, speed, heading, vertical
rate, squawk, a route estimate, and an on-device "AI Insights" panel that
reads the telemetry in plain English. It also includes an Airport
Explorer for checking live inbound/outbound traffic at any major hub, with
an optional real scheduled timetable.

**No backend. No required API keys. No hosting bill.** It runs as plain
static files, deployable to GitHub Pages, Vercel, Netlify, or Cloudflare
Pages in a couple of minutes.

> ⚠️ **Not for operational or safety-critical use.** Live data comes from
> the free, crowdsourced OpenSky Network and is delayed / incomplete by
> design. Don't use this to make real aviation decisions.

---

## Features

- **Live flight search.** Enter a flight number the way you'd see it on a
  boarding pass (`BA15`, `UA123`) or a raw ADS-B callsign (`BAW15`,
  `UAL123`) — Vectr resolves airline IATA codes to their ICAO callsign
  prefix automatically.
- **Interactive live map.** Rotating aircraft marker, session flight path,
  auto-refresh every 15 seconds (toggleable), manual recenter.
- **Telemetry panel.** Altitude, ground speed, heading, vertical rate,
  squawk, live position, plus a nearest-major-airport route estimate.
- **AI Insights.** Plain-English read on the aircraft's current phase of
  flight (climb / cruise / descent / ground), speed character, and
  proximity to a likely destination — computed entirely on-device from
  the live telemetry, no external API call.
- **Airport Explorer.** Search any of ~260 major airports and see a live
  board of aircraft currently classified as likely arrivals, likely
  departures, or other nearby traffic — inferred from live position data.
  Optionally add your own free AeroDataBox key to show a real scheduled
  timetable (flight numbers, terminals, gates, times) alongside it.
- **Search history, dark/light theme, fully responsive layout.**

---

## How search works

Live ADS-B callsigns are usually the airline's 3-letter ICAO code plus
the flight number (`BAW15`), not the 2-letter IATA code most people think
in (`BA15`). Vectr bundles a public airline code dataset
(`data/airlines.json`, ~780 carriers) so either form works, and it's
tolerant of the zero-padding some transponders add (`UAL123` vs
`UAL0123`).

There's no public "search by flight number" endpoint for live positions,
so Vectr fetches OpenSky's live state-vector list and matches on the
resolved callsign client-side.

## Airport Explorer

Click **✈ Airports**, search a code or city, and you get two layers:

1. **Live Board (free, no signup).** Queries OpenSky with a bounding box
   around the airport and classifies nearby aircraft as likely arrivals,
   likely departures, or other nearby traffic, based on current altitude,
   vertical rate, and whether the aircraft's heading points toward or
   away from the field. This is an inference from live position data, not
   an official schedule — the UI says so. Refreshes every 20 seconds.
2. **Scheduled timetable (optional).** Real flight numbers, terminals,
   gates, and scheduled times require licensed schedule data — no
   provider gives this away globally with zero signup. Vectr integrates
   [AeroDataBox](https://aerodatabox.com/), which has a genuine free tier
   (a few hundred calls/month via RapidAPI, more via API.market). Add
   your own key from the "⚙ Schedule key" button; it's stored only in
   your browser's `localStorage` and sent only to AeroDataBox — never to
   any other server. Because this is a static site with no backend, the
   key is visible in your own browser's network tab like any client-side
   key on a no-backend site, so don't reuse a key you need to keep secret
   from people using your own deployment.

---

## Architecture

Vectr is framework-free: plain HTML/CSS/JS, no build step, no bundler.
"Deploy" is just "push to GitHub, turn on Pages."

```
Browser
 ├─ index.html            → page shell: hero, tracker view, airport explorer view
 ├─ css/styles.css         → design system (tokens, dark/light themes)
 ├─ js/views.js            → router switching between the top-level views
 ├─ js/airports.js         → loads data/airports.json, search + nearest-airport math
 ├─ js/airlines.js         → loads data/airlines.json, IATA→ICAO code resolution
 ├─ js/opensky.js          → OpenSky REST wrapper (the only live-position data file)
 ├─ js/aerodatabox.js      → optional schedule provider (needs the user's own free key)
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

### Why this data source

OpenSky Network's anonymous REST endpoint is the only source that's
genuinely free, keyless, global, and callable directly from a browser.
The tradeoffs: rate limits exist and can change on OpenSky's end; there's
no official flight-number search (handled client-side, see above); no
route/schedule data (handled via nearest-airport estimate, and now the
optional AeroDataBox layer); no historical/replay tracks on the anonymous
tier (Vectr builds a track polyline only for the current browser
session).

All live-position provider logic lives in `js/opensky.js` behind
`fetchAllStates()`, `findByFlightNumber()`, `getByIcao24()`, and
`fetchStatesInBbox()`. To swap in a different provider, reimplement those
functions returning the same flight object shape (`icao24, callsign,
latitude, longitude, baro_altitude, velocity, true_track, vertical_rate,
on_ground, squawk, origin_country`) and nothing else needs to change.

### Why no backend

A backend would only be needed for: server-side API keys, historical data
storage, or user accounts — none of which the current feature set needs.
If you add accounts, cross-device saved searches, or notifications later,
a free-tier option like Cloudflare Workers + D1, Supabase, or Vercel
Functions + KV would be a good fit; none of it is required for anything
currently in the app.

### Upgrading AI Insights to a real LLM

The AI panel is deliberately free (on-device heuristics, no external
call). If you want actual natural-language generation instead, add a
small serverless function (Vercel/Netlify/Cloudflare Worker, all free
tier) that holds your LLM API key server-side and proxies a prompt built
from the same telemetry object already in `app.js`. Keeping the key
server-side is the only reason this project would ever need a backend.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Structure | Plain HTML5 | No build step, simplest possible deploy |
| Styling | Hand-written CSS, custom properties | Full control of the dark "ATC radar" design system |
| Map | [Leaflet.js](https://leafletjs.com/) + CARTO free tiles | Free, no API key, lightweight for this scope |
| Data | [OpenSky Network REST API](https://openskynetwork.github.io/opensky-api/rest.html) | Genuinely free, keyless, global live data |
| Fonts | Space Grotesk (display), JetBrains Mono (telemetry), Inter (body) | Distinct identity; mono face reads as flight-computer data |
| Hosting | GitHub Pages (or Vercel/Netlify/Cloudflare Pages) | Free, static |

---

## Running it locally

No build tools needed. Any static file server works:

```bash
git clone https://github.com/<you>/vectr.git
cd vectr
python3 -m http.server 8080
# open http://localhost:8080
```

(Opening `index.html` directly via `file://` mostly works, but some
browsers block `fetch()` of local JSON over `file://` — use a local
server to be safe.)

---

## Deployment (GitHub Pages)

1. Push this repo to GitHub.
2. **Settings → Pages → Source → Deploy from a branch.**
3. Branch: `main`, folder: `/ (root)`. Save.
4. Live at `https://<you>.github.io/vectr/` within a minute.

No environment variables, secrets, or build step required. For
Vercel/Netlify/Cloudflare Pages, import the repo with **framework preset:
"Other/Static"** and no build command.

---

## Known limitations

- Anonymous OpenSky access is rate-limited and can be tightened without
  notice — the tradeoff for zero-cost, keyless data.
- Only currently-airborne (or very recently reporting) flights are
  findable — no "future scheduled flight" lookup without a paid
  schedules API (see the optional AeroDataBox integration for that).
- Origin/destination shown on the tracker are **estimates** (nearest
  major airport to current position), not the filed flight plan — the UI
  says so explicitly.
- The airport dataset covers ~260 major hubs, not every airfield — small
  regional strips won't show up as a nearest-airport match.
- The Airport Explorer's live board is an inference from position data,
  not an official schedule, unless you've added an AeroDataBox key.

## What's next

Ideas not yet implemented: dedicated airline pages, aircraft-type lookup
by ICAO24, flight replay/history (needs a registered OpenSky account for
historical tracks), user accounts and saved searches across devices,
push notifications.

## License

MIT — see [LICENSE](LICENSE). Flight data © The OpenSky Network, used
under their terms. Map tiles © OpenStreetMap contributors, styled by
CARTO. Airport reference data derived from the public
[mwgg/Airports](https://github.com/mwgg/Airports) dataset. Airline
reference data derived from the public
[OpenFlights](https://github.com/jpatokal/openflights) dataset.
