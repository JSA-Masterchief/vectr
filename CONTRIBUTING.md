# Contributing to Vectr

Thanks for considering a contribution — this project is meant to stay
free and hackable, and community fixes to data-provider quirks are
especially welcome.

## Ground rules

- No build step, no framework, on purpose. Keep contributions in plain
  HTML/CSS/JS unless a proposal to change that is discussed in an issue
  first.
- Keep the data-provider logic isolated in `js/opensky.js`. If you're
  adding/swapping a provider, match the existing flight object shape so
  the rest of the app doesn't need to change.
- No paid APIs in the default code path. Anything that costs money
  (e.g. an LLM call) must be opt-in and clearly documented as such.
- Don't check in secrets. This project should never need an `.env` for
  its default (Phases 1–3) functionality.

## Getting set up

```bash
git clone https://github.com/<you>/vectr.git
cd vectr
python3 -m http.server 8080
```

No install step. Edit files, refresh the browser.

## Making a change

1. Fork and branch from `main`: `git checkout -b fix/short-description`.
2. Make your change. Keep commits small and focused.
3. Test manually in both dark and light mode, and at a mobile viewport
   width (≤560px).
4. Update `CHANGELOG.md` under "Unreleased."
5. Open a pull request using the PR template — describe what you tested.

## Reporting bugs / data issues

Please use the **Bug report** issue template. OpenSky's live data is
inherently flaky (aircraft drop off signal, callsigns are sometimes
blank) — if you're not sure whether something is a Vectr bug or an
upstream data gap, say so in the report; we'd rather investigate than
have you self-filter.

## Feature requests

Please use the **Feature request** template, and mention which roadmap
phase (see README §7) your idea fits, or whether it's a new one.
