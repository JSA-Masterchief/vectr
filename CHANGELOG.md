# Changelog

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Airport Explorer: search any of ~260 major airports by IATA/ICAO code
  or city.
- Free, keyless "Live Board" — infers likely arrivals/departures near an
  airport from live OpenSky bounding-box queries (altitude, vertical
  rate, heading relative to the field).
- Optional real scheduled timetable via AeroDataBox (bring-your-own free
  RapidAPI/API.market key, stored only in `localStorage`).
- Flight-number resolution: typing an IATA-style flight number (`BA15`)
  now also searches its ICAO callsign form (`BAW15`), using a bundled
  public airline-code dataset (`data/airlines.json`).

## [0.1.0] — 2026-07-30

### Added
- Initial public release of Vectr.
- Landing page with radar-styled hero and flight search.
- Live callsign search against OpenSky Network's public state-vector API.
- Interactive Leaflet map with rotating aircraft marker and session flight
  path polyline.
- Telemetry panel: altitude, ground speed, heading, vertical rate, squawk,
  live position.
- Nearest-major-airport route estimate using an offline dataset of ~260
  airports.
- On-device "AI Insights" panel (heuristic, no external API/cost).
- Auto-refresh (15s) with manual toggle, recenter control.
- Search history via localStorage.
- Dark/light theme toggle.
- Fully responsive layout, mobile-friendly panel stacking.
- Project documentation: README (architecture, provider comparison,
  deployment guide, roadmap), CONTRIBUTING, LICENSE (MIT), issue and PR
  templates.
