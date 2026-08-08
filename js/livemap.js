/**
 * livemap.js
 * ------------------------------------------------------------
 * The "one big map, everything on it" view. Shows every airport
 * in the offline dataset plus live aircraft currently within the
 * visible map bounds, both clickable, both opening a side panel
 * with live details.
 *
 * Deliberately viewport-driven rather than "fetch the whole
 * world": OpenSky's free anonymous tier is rate-limited (see
 * opensky.js / airportview.js), and rendering thousands of DOM
 * markers at low zoom would be slow anyway. So:
 *   - Airports (only ~260, cheap) always render for the current
 *     view.
 *   - Live aircraft only load once you're zoomed in enough that
 *     the bounding box is a reasonable size, and are refetched
 *     (debounced + throttled) as you pan/zoom, not on a fixed
 *     timer independent of what you're actually looking at.
 *   - Plane markers render through a Leaflet.markercluster group,
 *     so dense airspace collapses into count bubbles instead of
 *     hundreds of overlapping icons, and stays fast even with the
 *     marker cap raised.
 * ------------------------------------------------------------
 */
(() => {
  'use strict';

  const navBtn = document.getElementById('navLiveMap');
  const backBtn = document.getElementById('liveMapBackBtn');
  const statusEl = document.getElementById('liveMapStatus');
  const panel = document.getElementById('liveMapPanel');
  const panelContent = document.getElementById('liveMapPanelContent');
  const panelCloseBtn = document.getElementById('liveMapPanelClose');

  const MIN_ZOOM_FOR_TRAFFIC = 6;
  const MAX_PLANE_MARKERS = 800; // clustering handles density now, so this is just a sane upper safety cap
  const FETCH_DEBOUNCE_MS = 900;
  const MIN_FETCH_INTERVAL_MS = 8000;

  let map = null;
  let airportMarkers = [];
  let planeCluster = null;
  let moveDebounceTimer = null;
  let lastFetchTs = 0;
  let consecutiveFailures = 0;
  let initialized = false;

  // ---------- Navigation ----------
  navBtn.addEventListener('click', async () => {
    Views.show('livemap');
    await Airports.load();
    initMap();
    renderAirportMarkers();
    maybeLoadTraffic(true);
  });

  backBtn.addEventListener('click', () => {
    closePanel();
    Views.show('home');
  });

  // ---------- Map setup ----------
  function initMap() {
    if (initialized) {
      setTimeout(() => map.invalidateSize(), 60);
      return;
    }
    initialized = true;
    map = L.map('liveMap', { zoomControl: true, attributionControl: true }).setView([20, 20], 3);
    setTileLayer();

    planeCluster = L.markerClusterGroup({
      maxClusterRadius: 55,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        const size = count < 10 ? 32 : count < 50 ? 40 : 48;
        return L.divIcon({
          html: `<div class="vectr-cluster" style="width:${size}px;height:${size}px;">${count}</div>`,
          className: '',
          iconSize: L.point(size, size),
        });
      },
    });
    map.addLayer(planeCluster);

    map.on('moveend zoomend', () => {
      clearTimeout(moveDebounceTimer);
      moveDebounceTimer = setTimeout(() => {
        renderAirportMarkers();
        maybeLoadTraffic(false);
      }, FETCH_DEBOUNCE_MS);
    });

    setTimeout(() => map.invalidateSize(), 60);
  }

  function setTileLayer() {
    const tileUrl = document.body.getAttribute('data-theme') === 'dark'
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
    L.tileLayer(tileUrl, {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);
  }

  // ---------- Airport markers (cheap, always shown for current view) ----------
  function renderAirportMarkers() {
    airportMarkers.forEach((m) => map.removeLayer(m));
    airportMarkers = [];
    const bounds = map.getBounds();
    Airports.all().forEach((a) => {
      if (!bounds.contains([a.lat, a.lon])) return;
      const marker = L.circleMarker([a.lat, a.lon], {
        radius: 7, color: '#F5A623', fillColor: '#F5A623', fillOpacity: 1, weight: 2,
      })
        .bindTooltip(`${a.iata || a.icao} — ${a.name}`, { permanent: false })
        .addTo(map);
      marker.on('click', () => openAirportPanel(a));
      airportMarkers.push(marker);
    });
  }

  // ---------- Live traffic (viewport-driven, rate-limit-aware) ----------
  function maybeLoadTraffic(isInitial) {
    const zoom = map.getZoom();
    if (zoom < MIN_ZOOM_FOR_TRAFFIC) {
      clearPlaneMarkers();
      statusEl.textContent = `Zoom in to load live traffic (currently zoomed out too far — zoom ${zoom}/${MIN_ZOOM_FOR_TRAFFIC}).`;
      return;
    }
    const now = Date.now();
    if (!isInitial && now - lastFetchTs < MIN_FETCH_INTERVAL_MS) {
      statusEl.textContent = 'Keeping requests polite to the free live-data providers \u2014 traffic will refresh shortly.';
      return;
    }
    loadTraffic();
  }

  async function loadTraffic() {
    const b = map.getBounds();
    lastFetchTs = Date.now();
    statusEl.textContent = 'Loading live traffic in view\u2026';
    let states;
    try {
      states = await OpenSky.fetchStatesInBbox(b.getSouth(), b.getNorth(), b.getWest(), b.getEast());
      consecutiveFailures = 0;
    } catch (err) {
      console.error(err);
      consecutiveFailures += 1;
      statusEl.textContent = Views.describeDualFailure(err);
      return;
    }

    clearPlaneMarkers();
    const withPos = states.filter((f) => f.latitude != null && f.longitude != null);
    const shown = withPos.slice(0, MAX_PLANE_MARKERS);

    const markers = shown.map((f) => {
      const marker = L.marker([f.latitude, f.longitude], {
        icon: L.divIcon({
          className: '',
          html: `<div class="plane-icon livemap-plane" style="transform:rotate(${f.true_track || 0}deg);">✈</div>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
      }).bindTooltip(f.callsign || 'Unknown', { permanent: false });
      marker.on('click', () => openPlanePanel(f));
      return marker;
    });
    planeCluster.addLayers(markers);

    const capNote = withPos.length > MAX_PLANE_MARKERS
      ? ` (showing ${MAX_PLANE_MARKERS} of ${withPos.length} \u2014 zoom in further to narrow it down)`
      : '';
    statusEl.textContent = `${shown.length} aircraft in view${capNote} \u00b7 updated ${new Date().toLocaleTimeString()}`;
  }

  function clearPlaneMarkers() {
    if (planeCluster) planeCluster.clearLayers();
  }

  // ---------- Side panel ----------
  function openPanel(html) {
    panelContent.innerHTML = html;
    panel.hidden = false;
    panel.style.display = 'block';
  }

  function closePanel() {
    panel.hidden = true;
    panel.style.display = 'none';
  }

  panelCloseBtn.addEventListener('click', closePanel);

  function openAirportPanel(a) {
    openPanel(`
      <h3>${a.name}</h3>
      <p class="airport-meta">${a.iata || ''}${a.iata && a.icao ? ' / ' : ''}${a.icao || ''} \u00b7 ${a.city || ''}, ${a.country || ''}</p>
      <p class="airport-meta">${a.lat.toFixed(2)}\u00b0, ${a.lon.toFixed(2)}\u00b0 \u00b7 ${a.tz || ''}</p>
      <button class="search-btn livemap-panel-action" id="livemapOpenAirportBtn">Open full Airport Explorer</button>
    `);
    document.getElementById('livemapOpenAirportBtn').addEventListener('click', () => {
      closePanel();
      if (window.VectrOpenAirport) window.VectrOpenAirport(a);
    });
  }

  function openPlanePanel(f) {
    const altFt = f.baro_altitude != null ? Math.round(f.baro_altitude * 3.28084).toLocaleString() : '—';
    const spdKt = f.velocity != null ? Math.round(f.velocity * 1.94384) : '—';
    const heading = f.true_track != null ? `${Math.round(f.true_track)}\u00b0` : '—';
    openPanel(`
      <h3>${f.callsign || 'Unknown callsign'}</h3>
      <p class="airport-meta">${f.origin_country || ''} \u00b7 ICAO24 ${f.icao24}</p>
      <div class="telemetry-grid">
        <div class="tele-card"><span class="tele-label">Altitude</span><span class="tele-value">${altFt} ft</span></div>
        <div class="tele-card"><span class="tele-label">Speed</span><span class="tele-value">${spdKt} kt</span></div>
        <div class="tele-card"><span class="tele-label">Heading</span><span class="tele-value">${heading}</span></div>
      </div>
      <button class="search-btn livemap-panel-action" id="livemapTrackBtn" ${f.callsign ? '' : 'disabled'}>Track this flight</button>
    `);
    document.getElementById('livemapTrackBtn').addEventListener('click', () => {
      closePanel();
      Views.show('app');
      if (window.VectrTrackFlight && f.callsign) window.VectrTrackFlight(f.callsign);
    });
  }
})();
