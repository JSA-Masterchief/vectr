/**
 * airportview.js
 * ------------------------------------------------------------
 * The "which flights are at this airport" feature. Two layers:
 *
 *  1. Free, keyless "Live Board" — queries OpenSky's state
 *     vectors within a bounding box around the airport, then
 *     classifies each aircraft as a likely arrival / departure /
 *     other nearby traffic using altitude, vertical rate, and
 *     whether its heading points toward or away from the field.
 *     This is an inference, not a schedule, and the UI says so.
 *
 *  2. Optional real "Scheduled timetable" — if the user has added
 *     their own free AeroDataBox key (see aerodatabox.js), shows
 *     actual flight numbers, terminals, gates, and scheduled
 *     times for the selected airport.
 * ------------------------------------------------------------
 */
(() => {
  'use strict';

  const navAirportsBtn = document.getElementById('navAirports');
  const airportBackBtn = document.getElementById('airportBackBtn');
  const searchForm = document.getElementById('airportSearchForm');
  const searchInput = document.getElementById('airportSearchInput');
  const emptyState = document.getElementById('airportEmptyState');
  const content = document.getElementById('airportContent');
  const airportNameEl = document.getElementById('airportName');
  const airportMetaEl = document.getElementById('airportMeta');
  const boardList = document.getElementById('boardList');
  const boardUpdated = document.getElementById('boardUpdated');
  const tabs = Array.from(document.querySelectorAll('.board-tab'));
  const settingsBtn = document.getElementById('airportSettingsBtn');
  const scheduleGate = document.getElementById('scheduleGate');
  const scheduleContent = document.getElementById('scheduleContent');
  const addKeyBtn = document.getElementById('addKeyBtn');

  const keyModal = document.getElementById('keyModal');
  const keyInput = document.getElementById('keyInput');
  const keySaveBtn = document.getElementById('keySaveBtn');
  const keyClearBtn = document.getElementById('keyClearBtn');
  const keyCancelBtn = document.getElementById('keyCancelBtn');

  const expandMapBtn = document.getElementById('expandMapBtn');
  const mapModal = document.getElementById('mapModal');
  const mapModalTitle = document.getElementById('mapModalTitle');
  const mapModalCloseBtn = document.getElementById('mapModalCloseBtn');
  const favoriteAirportBtn = document.getElementById('favoriteAirportBtn');
  const shareAirportBtn = document.getElementById('shareAirportBtn');

  let fullMap = null;
  let fullMapMarkers = [];

  let miniMap = null;
  let miniMarker = null;
  let currentAirport = null;
  let currentTab = 'arrivals';
  let boardTimer = null;
  let lastClassified = { arrivals: [], departures: [], nearby: [] };

  const BOARD_REFRESH_MS = 20000;
  const BBOX_DEG = 1.1; // roughly ~120km box, adjusted for longitude below

  // ---------- Navigation ----------
  navAirportsBtn.addEventListener('click', () => {
    Views.show('airport');
    searchInput.focus();
  });
  airportBackBtn.addEventListener('click', () => {
    clearTimeout(boardTimer);
    clearUrlParams();
    Views.show('home');
  });

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
    if (!currentAirport) return;
    const code = currentAirport.iata || currentAirport.icao;
    const fav = Favorites.isAirportFavorited(code);
    favoriteAirportBtn.textContent = fav ? '★ Favorited' : '☆ Favorite';
    favoriteAirportBtn.classList.toggle('active', fav);
  }
  favoriteAirportBtn.addEventListener('click', () => {
    if (!currentAirport) return;
    const code = currentAirport.iata || currentAirport.icao;
    Favorites.toggleAirport(code, currentAirport.name);
    updateFavoriteButton();
    if (window.VectrRenderFavorites) window.VectrRenderFavorites();
  });
  shareAirportBtn.addEventListener('click', async () => {
    if (!currentAirport) return;
    const code = currentAirport.iata || currentAirport.icao;
    setUrlParam('airport', code);
    const original = shareAirportBtn.textContent;
    try {
      await navigator.clipboard.writeText(window.location.href);
      shareAirportBtn.textContent = '✓ Link copied';
    } catch {
      shareAirportBtn.textContent = window.location.href;
    }
    setTimeout(() => (shareAirportBtn.textContent = original), 1800);
  });

  // ---------- Airport search ----------
  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    if (!q) return;
    await Airports.load();
    const match = findAirport(q);
    if (!match) {
      emptyState.hidden = false;
      content.hidden = true;
      emptyState.querySelector('p').textContent = `No major airport found matching "${q}". Vectr's offline dataset covers ~260 large hubs, not every airfield.`;
      return;
    }
    selectAirport(match);
  });

  function findAirport(q) {
    return Airports.search(q);
  }

  async function selectAirport(airport) {
    currentAirport = airport;
    emptyState.hidden = true;
    content.hidden = false;
    airportNameEl.textContent = `${airport.name} (${airport.iata || airport.icao})`;
    airportMetaEl.textContent = `${airport.city || ''}${airport.city ? ', ' : ''}${airport.country || ''} · ${airport.lat.toFixed(2)}°, ${airport.lon.toFixed(2)}° · ${airport.tz || ''}`;

    const code = airport.iata || airport.icao;
    setUrlParam('airport', code);
    updateFavoriteButton();

    initMiniMap(airport);
    resetSchedulePanel();
    await refreshBoard();
    scheduleBoardRefresh();
    if (AeroDataBox.hasKey()) loadSchedule(airport);
  }

  // ---------- Mini map ----------
  function initMiniMap(airport) {
    if (!miniMap) {
      miniMap = L.map('airportMiniMap', { zoomControl: false, attributionControl: false });
    }
    const tileUrl = document.body.getAttribute('data-theme') === 'dark'
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    miniMap.eachLayer((l) => miniMap.removeLayer(l));
    L.tileLayer(tileUrl, { subdomains: 'abcd', maxZoom: 19 }).addTo(miniMap);
    miniMap.setView([airport.lat, airport.lon], 9);
    miniMarker = L.circleMarker([airport.lat, airport.lon], {
      radius: 6, color: '#2DD9C4', fillColor: '#2DD9C4', fillOpacity: 1,
    }).addTo(miniMap);
    setTimeout(() => miniMap.invalidateSize(), 50);
  }

  function openFullMap() {
    if (!currentAirport) return;
    mapModalTitle.textContent = `${currentAirport.name} — live traffic`;
    mapModal.hidden = false;
    mapModal.style.display = 'flex';

    if (!fullMap) {
      fullMap = L.map('fullMap', { zoomControl: true, attributionControl: false });
    }
    const tileUrl = document.body.getAttribute('data-theme') === 'dark'
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    fullMap.eachLayer((l) => fullMap.removeLayer(l));
    L.tileLayer(tileUrl, { subdomains: 'abcd', maxZoom: 19 }).addTo(fullMap);
    fullMap.setView([currentAirport.lat, currentAirport.lon], 8);

    L.circleMarker([currentAirport.lat, currentAirport.lon], {
      radius: 8, color: '#F5A623', fillColor: '#F5A623', fillOpacity: 1,
    }).bindTooltip(currentAirport.name, { permanent: false }).addTo(fullMap);

    fullMapMarkers = [];
    const all = [
      ...lastClassified.arrivals.map((f) => ({ ...f, kind: 'arrival' })),
      ...lastClassified.departures.map((f) => ({ ...f, kind: 'departure' })),
      ...lastClassified.nearby.map((f) => ({ ...f, kind: 'nearby' })),
    ];
    const colors = { arrival: '#2DD9C4', departure: '#F2555A', nearby: '#9FB0C0' };
    all.forEach((f) => {
      if (f.latitude == null || f.longitude == null) return;
      const marker = L.circleMarker([f.latitude, f.longitude], {
        radius: 6, color: colors[f.kind], fillColor: colors[f.kind], fillOpacity: 0.9,
      })
        .bindTooltip(`${f.callsign || 'Unknown'} · ${f.kind}`, { permanent: false })
        .addTo(fullMap);
      marker.on('click', () => {
        if (f.callsign && window.VectrTrackFlight) {
          closeFullMap();
          Views.show('app');
          window.VectrTrackFlight(f.callsign);
        }
      });
      fullMapMarkers.push(marker);
    });

    setTimeout(() => fullMap.invalidateSize(), 60);
  }

  function closeFullMap() {
    mapModal.hidden = true;
    mapModal.style.display = 'none';
  }

  expandMapBtn.addEventListener('click', openFullMap);
  mapModalCloseBtn.addEventListener('click', closeFullMap);
  mapModal.addEventListener('click', (e) => {
    if (e.target === mapModal) closeFullMap();
  });

  // ---------- Live board (free, OpenSky bbox) ----------
  function bearingDeg(lat1, lon1, lat2, lon2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    const x =
      Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
    const deg = (Math.atan2(y, x) * 180) / Math.PI;
    return (deg + 360) % 360;
  }

  function angleDiff(a, b) {
    let d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  let consecutiveFailures = 0;

  async function refreshBoard() {
    if (!currentAirport) return;
    const a = currentAirport;
    const latPad = BBOX_DEG;
    const lonPad = BBOX_DEG / Math.max(Math.cos((a.lat * Math.PI) / 180), 0.15);

    let states;
    try {
      states = await OpenSky.fetchStatesInBbox(a.lat - latPad, a.lat + latPad, a.lon - lonPad, a.lon + lonPad);
      consecutiveFailures = 0;
    } catch (err) {
      console.error(err);
      consecutiveFailures += 1;
      const msg = Views.describeDualFailure(err) + ' This board will keep retrying automatically at a slower pace.';
      boardList.innerHTML = `<p class="board-empty">${msg}</p>`;
      boardUpdated.textContent = `Last attempt failed at ${new Date().toLocaleTimeString()}`;
      return;
    }

    const arrivals = [];
    const departures = [];
    const nearby = [];

    states.forEach((f) => {
      if (f.latitude == null || f.longitude == null) return;
      const distKm = Airports.haversineKm(a.lat, a.lon, f.latitude, f.longitude);
      if (distKm > 110) return;
      const bearingToAirport = bearingDeg(f.latitude, f.longitude, a.lat, a.lon);
      const headingMatch = f.true_track != null ? angleDiff(f.true_track, bearingToAirport) : 180;
      const enriched = { ...f, distKm, headingMatch };

      const vrate = f.vertical_rate || 0;
      if (!f.on_ground && vrate < -1.5 && headingMatch < 65) {
        arrivals.push(enriched);
      } else if ((!f.on_ground && vrate > 1.5 && headingMatch > 115) || (f.on_ground && distKm < 6)) {
        departures.push(enriched);
      } else {
        nearby.push(enriched);
      }
    });

    arrivals.sort((x, y) => x.distKm - y.distKm);
    departures.sort((x, y) => x.distKm - y.distKm);
    nearby.sort((x, y) => x.distKm - y.distKm);

    lastClassified = { arrivals, departures, nearby };
    renderBoard();
    boardUpdated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  }

  function renderBoard() {
    const rows = lastClassified[currentTab] || [];
    if (!rows.length) {
      boardList.innerHTML = `<p class="board-empty">No aircraft currently classified as "${currentTab}" within range. Try again shortly, or pick a busier hub.</p>`;
      return;
    }
    boardList.innerHTML = '';
    rows.slice(0, 25).forEach((f) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'board-row';
      const altFt = f.baro_altitude != null ? Math.round(f.baro_altitude * 3.28084).toLocaleString() : '—';
      const spdKt = f.velocity != null ? Math.round(f.velocity * 1.94384) : '—';
      row.innerHTML = `
        <span class="board-callsign">${f.callsign || '—'}</span>
        <span class="board-detail">${f.origin_country || ''}</span>
        <span class="board-detail">${altFt} ft</span>
        <span class="board-detail">${spdKt} kt</span>
        <span class="board-detail">${Math.round(f.distKm)} km away</span>
      `;
      row.addEventListener('click', () => {
        if (f.callsign && window.VectrTrackFlight) {
          Views.show('app');
          window.VectrTrackFlight(f.callsign);
        }
      });
      boardList.appendChild(row);
    });
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      renderBoard();
    });
  });

  function scheduleBoardRefresh() {
    clearTimeout(boardTimer);
    const delay = Math.min(BOARD_REFRESH_MS * Math.pow(2, consecutiveFailures), 120000);
    boardTimer = setTimeout(async () => {
      await refreshBoard();
      scheduleBoardRefresh();
    }, delay);
  }

  // ---------- Optional schedule (AeroDataBox) ----------
  function resetSchedulePanel() {
    if (AeroDataBox.hasKey()) {
      scheduleGate.hidden = true;
      scheduleContent.hidden = false;
      scheduleContent.innerHTML = '<p class="board-empty">Loading schedule…</p>';
    } else {
      scheduleGate.hidden = false;
      scheduleContent.hidden = true;
    }
  }

  async function loadSchedule(airport) {
    try {
      const { departures, arrivals } = await AeroDataBox.getSchedule(airport.icao);
      renderSchedule(departures, arrivals);
    } catch (err) {
      let msg = 'Could not load the schedule right now.';
      if (err.message === 'BAD_KEY') msg = 'That AeroDataBox key was rejected — check it in Schedule key settings.';
      if (err.message === 'RATE_LIMIT') msg = "You've hit your AeroDataBox free-tier limit for now — try again later.";
      if (err.message === 'TIMEOUT') msg = 'AeroDataBox took too long to respond — try again shortly.';
      scheduleContent.innerHTML = `<p class="board-empty">${msg}</p>`;
    }
  }

  function renderSchedule(departures, arrivals) {
    const rowsHtml = (rows, label) => {
      if (!rows.length) return `<p class="board-empty">No ${label} in this window.</p>`;
      return `<table class="schedule-table"><thead><tr><th>Flight</th><th>Airline</th><th>${label === 'departures' ? 'To' : 'From'}</th><th>Terminal/Gate</th><th>Time</th><th>Status</th></tr></thead><tbody>${rows
        .map(
          (r) => `<tr><td>${r.number}</td><td>${r.airline}</td><td>${r.otherAirport}</td><td>${r.terminal}/${r.gate}</td><td>${r.scheduledTime ? r.scheduledTime.replace('T', ' ').slice(0, 16) : '—'}</td><td>${r.status}</td></tr>`
        )
        .join('')}</tbody></table>`;
    };
    scheduleContent.innerHTML = `
      <div class="schedule-block"><h4>Departures</h4>${rowsHtml(departures, 'departures')}</div>
      <div class="schedule-block"><h4>Arrivals</h4>${rowsHtml(arrivals, 'arrivals')}</div>
    `;
  }

  // ---------- Key modal ----------
  function openKeyModal() {
    keyInput.value = AeroDataBox.getKey();
    keyModal.hidden = false;
    keyModal.style.display = 'flex';
  }
  function closeKeyModal() {
    keyModal.hidden = true;
    keyModal.style.display = 'none';
  }
  settingsBtn.addEventListener('click', openKeyModal);
  addKeyBtn.addEventListener('click', openKeyModal);
  keyCancelBtn.addEventListener('click', closeKeyModal);
  keyModal.addEventListener('click', (e) => {
    if (e.target === keyModal) closeKeyModal();
  });
  keySaveBtn.addEventListener('click', () => {
    AeroDataBox.setKey(keyInput.value);
    closeKeyModal();
    resetSchedulePanel();
    if (currentAirport && AeroDataBox.hasKey()) loadSchedule(currentAirport);
  });
  keyClearBtn.addEventListener('click', () => {
    AeroDataBox.setKey('');
    keyInput.value = '';
    closeKeyModal();
    resetSchedulePanel();
  });

  // Exposed so the Live Map view can open the full Airport Explorer
  // for an airport a person clicked on the map.
  window.VectrOpenAirport = async (airport) => {
    Views.show('airport');
    await selectAirport(airport);
  };

  // Exposed for permalinks (?airport=LHR) and favorite chips, which
  // only have a code string, not the full airport object.
  window.VectrOpenAirportByCode = async (code) => {
    await Airports.load();
    const match = Airports.search(code);
    if (match) {
      Views.show('airport');
      await selectAirport(match);
    }
  };
})();
