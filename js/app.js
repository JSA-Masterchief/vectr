/**
 * app.js — Vectr flight tracker
 * ------------------------------------------------------------
 * Ties together OpenSky (data), Airports (static lookup/geo),
 * and Leaflet (map) into the search → track → insight flow.
 * No build step: everything runs as plain ES2017+ in the browser.
 */
(() => {
  'use strict';

  // ---------- DOM refs ----------
  const heroSection = document.getElementById('heroSection');
  const appView = document.getElementById('appView');
  const emptyTip = document.getElementById('emptyTip');
  const searchForm = document.getElementById('searchForm');
  const searchInput = document.getElementById('searchInput');
  const searchStatus = document.getElementById('searchStatus');
  const historyChips = document.getElementById('historyChips');
  const backBtn = document.getElementById('backBtn');
  const recenterBtn = document.getElementById('recenterBtn');
  const autoRefreshBtn = document.getElementById('autoRefreshBtn');
  const favoriteFlightBtn = document.getElementById('favoriteFlightBtn');
  const shareFlightBtn = document.getElementById('shareFlightBtn');
  const favoriteChips = document.getElementById('favoriteChips');
  const lastUpdatedEl = document.getElementById('lastUpdated');
  const themeToggle = document.getElementById('themeToggle');

  const flapCallsign = document.getElementById('flapCallsign');
  const flightSub = document.getElementById('flightSub');
  const statusPill = document.getElementById('statusPill');
  const originCode = document.getElementById('originCode');
  const originCity = document.getElementById('originCity');
  const destCode = document.getElementById('destCode');
  const destCity = document.getElementById('destCity');
  const teleAlt = document.getElementById('teleAlt');
  const teleSpeed = document.getElementById('teleSpeed');
  const teleHeading = document.getElementById('teleHeading');
  const teleVrate = document.getElementById('teleVrate');
  const teleSquawk = document.getElementById('teleSquawk');
  const telePos = document.getElementById('telePos');
  const aiInsights = document.getElementById('aiInsights');

  // ---------- State ----------
  const REFRESH_MS = 15000; // how often we fetch REAL data from OpenSky
  const INTERP_MS = 1000; // how often we nudge the marker between real fetches
  let map, marker, pathLine;
  let currentIcao24 = null;
  let currentCallsign = null;
  let refreshTimer = null;
  let interpTimer = null;
  let autoRefreshOn = true;
  let trackSamples = []; // {lat,lon,ts,alt,speed}
  let lastKnown = null; // dead-reckoning baseline: {lat,lon,headingDeg,speedMs,vrateMs,altM,ts}
  const HISTORY_KEY = 'vectr.searchHistory';
  const THEME_KEY = 'vectr.theme';

  // ---------- Theme ----------
  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    themeToggle.textContent = theme === 'dark' ? '◐' : '◑';
    localStorage.setItem(THEME_KEY, theme);
  }
  applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
  themeToggle.addEventListener('click', () => {
    const next = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });

  // ---------- Search history (localStorage) ----------
  function getHistory() {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    } catch {
      return [];
    }
  }
  function pushHistory(callsign) {
    let h = getHistory().filter((c) => c !== callsign);
    h.unshift(callsign);
    h = h.slice(0, 6);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
    renderHistory();
  }
  function renderHistory() {
    const h = getHistory();
    historyChips.innerHTML = '';
    if (!h.length) {
      historyChips.parentElement.style.display = 'none';
      return;
    }
    historyChips.parentElement.style.display = 'flex';
    h.forEach((cs) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = cs;
      chip.addEventListener('click', () => trackFlight(cs));
      historyChips.appendChild(chip);
    });
  }
  renderHistory();

  function renderFavorites() {
    const flights = Favorites.getFlights();
    const airports = Favorites.getAirports();
    favoriteChips.innerHTML = '';
    if (!flights.length && !airports.length) {
      favoriteChips.parentElement.style.display = 'none';
      return;
    }
    favoriteChips.parentElement.style.display = 'flex';
    flights.forEach((cs) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = `✈ ${cs}`;
      chip.addEventListener('click', () => trackFlight(cs));
      favoriteChips.appendChild(chip);
    });
    airports.forEach((a) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = `🛫 ${a.code}`;
      chip.title = a.name || '';
      chip.addEventListener('click', () => {
        if (window.VectrOpenAirportByCode) {
          Views.show('airport');
          window.VectrOpenAirportByCode(a.code);
        }
      });
      favoriteChips.appendChild(chip);
    });
  }
  renderFavorites();

  // ---------- Map ----------
  function initMap() {
    if (map) return;
    map = L.map('map', { zoomControl: true, attributionControl: true }).setView([20, 0], 2);
    const tileUrl = document.body.getAttribute('data-theme') === 'dark'
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    L.tileLayer(tileUrl, {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);
  }

  function planeDivIcon(heading) {
    return L.divIcon({
      className: 'plane-marker-wrap',
      html: `<div class="plane-icon" style="transform:rotate(${heading}deg); font-size:26px; line-height:1;">✈</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });
  }

  function updateMarker(lat, lon, headingDeg) {
    const latlng = [lat, lon];
    if (!marker) {
      marker = L.marker(latlng, { icon: planeDivIcon(headingDeg || 0) }).addTo(map);
    } else {
      marker.setLatLng(latlng);
      marker.setIcon(planeDivIcon(headingDeg || 0));
    }
  }

  // Position-only update for interpolation ticks. Deliberately doesn't
  // touch the icon (setIcon() recreates the marker's DOM element, which
  // would reset the CSS transition on every tick and make the motion
  // stutter instead of glide).
  function moveMarkerTo(lat, lon) {
    if (marker) marker.setLatLng([lat, lon]);
  }

  function updatePath() {
    const pts = trackSamples.map((s) => [s.lat, s.lon]);
    if (pathLine) map.removeLayer(pathLine);
    if (pts.length > 1) {
      pathLine = L.polyline(pts, { color: '#2DD9C4', weight: 2, opacity: 0.7 }).addTo(map);
    }
  }

  // ---------- Dead reckoning (smooth motion between real fetches) ----------
  // OpenSky only gives us a true position every ~15s. FlightRadar24 and
  // similar tools make the plane look continuously in motion by
  // projecting its position forward from its last known speed + heading
  // in between real updates. We do the same thing here, client-side,
  // for free — no extra API calls, just simple flat-earth geometry.
  function projectPosition(base, elapsedSec) {
    if (!base || base.speedMs == null || base.headingDeg == null) return null;
    const distM = base.speedMs * elapsedSec;
    if (!isFinite(distM) || distM === 0) return { lat: base.lat, lon: base.lon };
    const R = 6371000;
    const bearingRad = (base.headingDeg * Math.PI) / 180;
    const dLat = (distM * Math.cos(bearingRad)) / R;
    const dLon = (distM * Math.sin(bearingRad)) / (R * Math.cos((base.lat * Math.PI) / 180));
    return {
      lat: base.lat + (dLat * 180) / Math.PI,
      lon: base.lon + (dLon * 180) / Math.PI,
    };
  }

  function startInterpolation() {
    clearInterval(interpTimer);
    interpTimer = setInterval(() => {
      if (!lastKnown || !map || lastKnown.onGround) return;
      const elapsedSec = (Date.now() - lastKnown.ts) / 1000;
      const projected = projectPosition(lastKnown, elapsedSec);
      if (!projected) return;
      moveMarkerTo(projected.lat, projected.lon);

      // Nudge the altitude readout live too, using the last known
      // vertical rate, so it doesn't look frozen between fetches.
      if (lastKnown.altM != null && lastKnown.vrateMs != null) {
        const projectedAltM = lastKnown.altM + lastKnown.vrateMs * elapsedSec;
        teleAlt.textContent = fmtAlt(projectedAltM);
      }
    }, INTERP_MS);
  }

  recenterBtn.addEventListener('click', () => {
    if (marker) map.setView(marker.getLatLng(), Math.max(map.getZoom(), 5), { animate: true });
  });

  autoRefreshBtn.addEventListener('click', () => {
    autoRefreshOn = !autoRefreshOn;
    autoRefreshBtn.classList.toggle('active', autoRefreshOn);
    autoRefreshBtn.textContent = `↻ Auto-refresh: ${autoRefreshOn ? 'On' : 'Off'}`;
    if (autoRefreshOn) scheduleRefresh();
    else clearTimeout(refreshTimer);
  });

  // ---------- Split-flap callsign header ----------
  function renderFlap(text) {
    flapCallsign.innerHTML = '';
    text.split('').forEach((ch) => {
      const span = document.createElement('span');
      span.className = 'flap-char';
      span.textContent = ch;
      flapCallsign.appendChild(span);
    });
  }

  // ---------- Formatting helpers ----------
  const mToFt = (m) => (m == null ? null : m * 3.28084);
  const msToKmh = (ms) => (ms == null ? null : ms * 3.6);
  const msToKt = (ms) => (ms == null ? null : ms * 1.94384);

  function fmtAlt(m) {
    if (m == null) return '—';
    return `${Math.round(mToFt(m)).toLocaleString()} ft`;
  }
  function fmtSpeed(ms) {
    if (ms == null) return '—';
    return `${Math.round(msToKmh(ms))} km/h · ${Math.round(msToKt(ms))} kt`;
  }
  function fmtHeading(deg) {
    if (deg == null) return '—';
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const idx = Math.round(deg / 45) % 8;
    return `${Math.round(deg)}° ${dirs[idx]}`;
  }
  function fmtVrate(ms) {
    if (ms == null || Math.abs(ms) < 0.3) return 'Level flight';
    const fpm = Math.round(ms * 196.85);
    return `${fpm > 0 ? '+' : ''}${fpm} ft/min`;
  }
  function fmtPos(lat, lon) {
    if (lat == null || lon == null) return '—';
    return `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`;
  }

  // ---------- AI Insights (on-device heuristics, no external API/cost) ----------
  function buildInsights(flight, originGuess, destGuess) {
    const notes = [];
    const altFt = mToFt(flight.baro_altitude || flight.geo_altitude || 0) || 0;
    const spdKt = msToKt(flight.velocity) || 0;
    const vrate = flight.vertical_rate || 0;

    // Phase of flight
    if (flight.on_ground) {
      notes.push('Transponder reports the aircraft is on the ground — likely taxiing, or just landed / about to depart.');
    } else if (vrate > 3) {
      notes.push(`Climbing at roughly ${Math.round(vrate * 196.85)} ft/min — consistent with departure climb-out or a step climb.`);
    } else if (vrate < -3) {
      notes.push(`Descending at roughly ${Math.round(Math.abs(vrate) * 196.85)} ft/min — likely approaching its destination.`);
    } else if (altFt > 28000) {
      notes.push('Level at cruise altitude with a stable vertical rate — the flight looks to be in its cruise phase.');
    } else if (altFt > 0) {
      notes.push('Flying below typical cruise altitude with a level vertical rate — could be in a holding pattern, terminal airspace, or a shorter regional hop.');
    }

    // Speed character
    if (spdKt > 0) {
      if (spdKt > 480) notes.push(`Ground speed of ${Math.round(spdKt)} kt is on the fast side — a strong tailwind may be helping it along.`);
      else if (spdKt < 250 && altFt > 10000) notes.push(`Ground speed of ${Math.round(spdKt)} kt is fairly slow for this altitude — possibly a headwind, or the aircraft is maneuvering.`);
    }

    // Nearest airport / route guess
    if (destGuess && destGuess.distanceKm < 400) {
      notes.push(`Currently ${Math.round(destGuess.distanceKm)} km from ${destGuess.airport.iata || destGuess.airport.icao} (${destGuess.airport.city || destGuess.airport.name}) — a plausible destination if it's still descending.`);
    }
    if (originGuess) {
      notes.push(`Nearest major airport to its own reporting country context is an estimate only — Vectr infers routes from proximity, not from a filed flight plan.`);
    }

    if (!notes.length) {
      notes.push('Not enough live telemetry yet to characterize this flight — check back after the next refresh.');
    }
    return notes;
  }

  // ---------- Core: track a flight ----------
  async function trackFlight(rawQuery) {
    const query = rawQuery.trim();
    if (!query) return;

    searchStatus.textContent = 'Searching live ADS-B feed…';
    searchStatus.style.color = 'var(--amber)';

    await Airlines.load();
    const candidates = Airlines.expandQuery(query);

    let matches;
    try {
      matches = await OpenSky.findByFlightNumber(candidates);
    } catch (err) {
      console.error(err);
      searchStatus.textContent = 'Could not reach the OpenSky Network right now. It may be rate-limiting anonymous requests — try again shortly.';
      searchStatus.style.color = 'var(--red)';
      return;
    }

    if (!matches.length) {
      const tried = candidates.join(' / ');
      searchStatus.textContent = `No aircraft currently broadcasting a callsign matching ${tried}. It may not be airborne right now.`;
      searchStatus.style.color = 'var(--amber)';
      return;
    }

    const flight = matches[0];
    currentIcao24 = flight.icao24;
    pushHistory(flight.callsign || query.toUpperCase());
    searchStatus.textContent = '';

    Views.show('app');
    initMap();

    trackSamples = [];
    await renderFlight(flight);
    scheduleRefresh();
  }

  async function renderFlight(flight) {
    await Airports.load();

    currentCallsign = flight.callsign || currentCallsign;
    if (currentCallsign) setUrlParam('flight', currentCallsign);
    updateFavoriteButton();

    renderFlap(flight.callsign || '——');
    flightSub.textContent = `${flight.origin_country || 'Unknown origin country'} · ICAO24 ${flight.icao24}`;

    if (flight.on_ground) {
      statusPill.textContent = 'ON GROUND';
      statusPill.className = 'status-pill warn';
    } else if (flight.baro_altitude == null) {
      statusPill.textContent = 'NO DATA';
      statusPill.className = 'status-pill bad';
    } else {
      statusPill.textContent = 'AIRBORNE';
      statusPill.className = 'status-pill';
    }

    teleAlt.textContent = fmtAlt(flight.baro_altitude ?? flight.geo_altitude);
    teleSpeed.textContent = fmtSpeed(flight.velocity);
    teleHeading.textContent = fmtHeading(flight.true_track);
    teleVrate.textContent = fmtVrate(flight.vertical_rate);
    teleSquawk.textContent = flight.squawk || '—';
    telePos.textContent = fmtPos(flight.latitude, flight.longitude);

    let destGuess = null;
    if (flight.latitude != null && flight.longitude != null) {
      destGuess = Airports.nearest(flight.latitude, flight.longitude);
      if (destGuess) {
        destCode.textContent = destGuess.airport.iata || destGuess.airport.icao;
        destCity.textContent = `${destGuess.airport.city || ''} (${Math.round(destGuess.distanceKm)} km away)`;
      }
      originCode.textContent = flight.origin_country ? flight.origin_country.slice(0, 3).toUpperCase() : '—';
      originCity.textContent = flight.origin_country || 'Registered country';

      updateMarker(flight.latitude, flight.longitude, flight.true_track || 0);
      map.panTo([flight.latitude, flight.longitude]);
      if (map.getZoom() < 4) map.setZoom(5);

      // Reset the dead-reckoning baseline to this real, authoritative
      // position so interpolation never drifts for more than one
      // refresh interval.
      lastKnown = {
        lat: flight.latitude,
        lon: flight.longitude,
        headingDeg: flight.true_track,
        speedMs: flight.velocity,
        vrateMs: flight.vertical_rate,
        altM: flight.baro_altitude ?? flight.geo_altitude,
        onGround: !!flight.on_ground,
        ts: Date.now(),
      };
      startInterpolation();

      trackSamples.push({ lat: flight.latitude, lon: flight.longitude, ts: Date.now() });
      trackSamples = trackSamples.slice(-200);
      updatePath();
    }

    aiInsights.innerHTML = '';
    buildInsights(flight, null, destGuess).forEach((note) => {
      const li = document.createElement('li');
      li.textContent = note;
      aiInsights.appendChild(li);
    });

    lastUpdatedEl.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    if (!autoRefreshOn || !currentIcao24) return;
    refreshTimer = setTimeout(async () => {
      try {
        const flight = await OpenSky.getByIcao24(currentIcao24);
        if (flight) await renderFlight(flight);
        else lastUpdatedEl.textContent = 'Lost live signal for this aircraft — it may have landed or gone out of range.';
      } catch (err) {
        console.error(err);
      } finally {
        scheduleRefresh();
      }
    }, REFRESH_MS);
  }

  // ---------- Shareable URL params ----------
  function setUrlParam(key, value) {
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set(key, value);
    window.history.replaceState({}, '', url);
  }
  function clearUrlParams() {
    const url = new URL(window.location.href);
    url.search = '';
    window.history.replaceState({}, '', url);
  }

  // ---------- Favorites + share ----------
  function updateFavoriteButton() {
    const fav = currentCallsign && Favorites.isFlightFavorited(currentCallsign);
    favoriteFlightBtn.textContent = fav ? '★ Favorited' : '☆ Favorite';
    favoriteFlightBtn.classList.toggle('active', !!fav);
  }
  favoriteFlightBtn.addEventListener('click', () => {
    if (!currentCallsign) return;
    Favorites.toggleFlight(currentCallsign);
    updateFavoriteButton();
    renderFavorites();
  });
  shareFlightBtn.addEventListener('click', async () => {
    if (!currentCallsign) return;
    setUrlParam('flight', currentCallsign);
    const shareText = shareFlightBtn.textContent;
    try {
      await navigator.clipboard.writeText(window.location.href);
      shareFlightBtn.textContent = '✓ Link copied';
    } catch {
      shareFlightBtn.textContent = window.location.href;
    }
    setTimeout(() => (shareFlightBtn.textContent = shareText), 1800);
  });

  // ---------- Events ----------
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    trackFlight(searchInput.value);
  });

  backBtn.addEventListener('click', () => {
    clearTimeout(refreshTimer);
    clearInterval(interpTimer);
    lastKnown = null;
    currentIcao24 = null;
    currentCallsign = null;
    clearUrlParams();
    Views.show('home');
    searchInput.value = '';
    searchInput.focus();
  });

  Views.show('home');

  // Exposed so the Airport Explorer board can jump straight into
  // tracking a flight it found nearby.
  window.VectrTrackFlight = trackFlight;
  // Exposed so airport favoriting (in airportview.js) can refresh
  // this same home-screen favorites row.
  window.VectrRenderFavorites = renderFavorites;
})();
