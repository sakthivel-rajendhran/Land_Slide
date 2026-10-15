/**
 * SlopeGuard — Risk Map Page Controller (pages/map.js)
 * Manages map lifecycle, data filtering, accessible list view, geolocation, and URL deep-links.
 */

document.addEventListener("DOMContentLoaded", async () => {
  const mapCanvas = document.getElementById("riskMapCanvas");
  const toolbarSlot = document.getElementById("mapToolbarSlot");
  const tableViewContainer = document.getElementById("mapTableViewContainer");
  const statusBarEl = document.getElementById("mapStatusBar");
  const statusIndicator = document.getElementById("mapStatusIndicator");
  const statusText = document.getElementById("mapStatusText");

  let allRegions = [];
  let currentFiltered = [];
  let allIncidents = [];
  let riskMapInstance = null;

  // 1. Fetch Regions & Incidents
  try {
    const [regionsRes, incidentsRes] = await Promise.all([
      window.LW.regionsService.getAll().catch(() => []),
      (window.LW.incidentsService?.getAllIncidents() || window.LW.regionsService?.getIncidents() || []).catch(() => [])
    ]);
    allRegions = regionsRes || [];
    allIncidents = incidentsRes || [];
    currentFiltered = [...allRegions];
  } catch (err) {
    console.error("[pages/map.js] Failed to fetch regions/incidents", err);
    window.LW.ui?.toast("Failed to load monitored slope zones", "error");
  }

  // 2. Mount Risk Map with 5 GIS layers
  riskMapInstance = window.LW.RiskMap?.mount(mapCanvas, {
    mode: "full",
    regions: allRegions,
    incidents: allIncidents,
    onSelect(region) {
      window.LW.regionPanel?.open(region);
    },
    onSelectIncident(incident) {
      console.info("[pages/map.js] Selected incident:", incident.id);
    }
  });

  // 3. Mount Filter Toolbar
  if (toolbarSlot && window.LW.filterBar) {
    window.LW.filterBar.mount(toolbarSlot, {
      onFilterChange(filters) {
        applyFilters(filters);
      },
      onLocationRequest() {
        handleGeolocation();
      },
      onToggleView(isListView) {
        toggleViewMode(isListView);
      }
    });
  }

  // 4. Filter Logic
  function applyFilters({ query, risk, dataStatus }) {
    const q = (query || "").toLowerCase();
    currentFiltered = allRegions.filter(region => {
      if (q) {
        const matchesName = region.name.toLowerCase().includes(q);
        const matchesDistrict = region.district.toLowerCase().includes(q);
        const matchesState = (region.state || "").toLowerCase().includes(q);
        if (!matchesName && !matchesDistrict && !matchesState) return false;
      }
      if (risk && risk !== "all" && (region.risk_level || "none") !== risk) {
        return false;
      }
      if (dataStatus && dataStatus !== "all" && region.data_status !== dataStatus) {
        return false;
      }
      return true;
    });

    if (riskMapInstance) {
      riskMapInstance.setFilters({ query: q, risk, dataStatus });
    }

    renderTableView(currentFiltered);
  }

  // 5. Accessible Table List View
  function renderTableView(regions) {
    if (!tableViewContainer) return;
    const format = window.LW.format || {};

    if (regions.length === 0) {
      tableViewContainer.innerHTML = `
        <div class="lw-card" style="text-align: center; padding: 40px;">
          <p class="lw-state__title">No matching slope sectors</p>
          <p class="lw-state__desc">${window.LW.content?.noSearchResults || "Try another search term or clear filters."}</p>
        </div>
      `;
      return;
    }

    tableViewContainer.innerHTML = `
      <div class="lw-table-container">
        <table class="lw-table" aria-label="Monitored Landslide Regions Table">
          <thead>
            <tr>
              <th scope="col">Sector & District</th>
              <th scope="col">Assessed Risk</th>
              <th scope="col">Telemetry Status</th>
              <th scope="col">Rainfall (24h)</th>
              <th scope="col">Slope Angle</th>
              <th scope="col">Last Assessed</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            ${regions.map(r => `
              <tr data-id="${r.id}" tabindex="0">
                <td>
                  <strong style="color: var(--lw-text);">${r.name}</strong><br/>
                  <span style="font-size: 0.75rem; color: var(--lw-text-muted);">${r.district}, ${r.state || 'Western Ghats'}</span>
                </td>
                <td>
                  <span class="lw-risk lw-risk--${r.risk_level || 'none'}">
                    <span class="lw-risk__shape"></span>
                    ${(r.risk_level || 'not assessed').toUpperCase()}
                  </span>
                </td>
                <td>
                  <span class="lw-chip lw-chip--${r.data_status || 'current'}">
                    ${(r.data_status || 'current').toUpperCase()}
                  </span>
                </td>
                <td style="font-family: var(--lw-font-mono);">${format.rainfall(r.accumulated_rainfall_24h)}</td>
                <td style="font-family: var(--lw-font-mono);">${format.slope(r.slope_gradient)}</td>
                <td>${format.relativeTime(r.assessed_at)}</td>
                <td>
                  <button type="button" class="lw-btn lw-btn--sm lw-btn--outline" data-action="details" data-id="${r.id}">
                    View Details
                  </button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    tableViewContainer.querySelectorAll('[data-action="details"]').forEach(btn => {
      btn.onclick = () => {
        const id = parseInt(btn.dataset.id, 10);
        const region = allRegions.find(r => r.id === id);
        if (region) window.LW.regionPanel?.open(region);
      };
    });
  }

  function toggleViewMode(isListView) {
    if (isListView) {
      mapCanvas.style.display = "none";
      tableViewContainer.classList.add("active");
      renderTableView(currentFiltered);
    } else {
      mapCanvas.style.display = "block";
      tableViewContainer.classList.remove("active");
      if (riskMapInstance) {
        riskMapInstance.getMapInstance()?.invalidateSize();
      }
    }
  }

  // 6. Geolocation ("Use My Location")
  async function handleGeolocation() {
    if (!navigator.geolocation) {
      window.LW.ui?.toast("Geolocation is not supported by your browser.", "error");
      return;
    }

    window.LW.ui?.toast("Querying GPS coordinates...", "info");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        try {
          const nearby = await window.LW.regionsService.getNearby(latitude, longitude);
          if (nearby && nearby.length > 0) {
            const nearest = nearby[0];
            window.LW.ui?.toast(`Nearest monitored sector: ${nearest.name} (${nearest.distance_km} km away)`, "success");
            if (riskMapInstance) {
              riskMapInstance.focus(nearest.id);
            }
          } else {
            window.LW.ui?.toast(window.LW.content?.locationNoRegion || "No monitored regions near this location.", "info");
          }
        } catch (e) {
          window.LW.ui?.toast("Failed to compute proximity to slope zones.", "error");
        }
      },
      (err) => {
        console.warn("[pages/map.js] Geolocation denied or unavailable", err);
        window.LW.ui?.toast(window.LW.content?.locationDenied || "Location access denied. Please search manually.", "info");
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }

  // 7. Handle URL Deep Links (?region=<id> or ?incident=<id> or ?lat=..&lng=..&z=..)
  const urlParams = new URLSearchParams(window.location.search);
  const targetRegionId = urlParams.get("region");
  const targetIncidentId = urlParams.get("incident");
  const targetLat = parseFloat(urlParams.get("lat"));
  const targetLng = parseFloat(urlParams.get("lng"));
  const targetZoom = parseInt(urlParams.get("z"), 10);

  if (targetIncidentId && riskMapInstance) {
    setTimeout(() => {
      riskMapInstance.focusIncident(targetIncidentId);
    }, 400);
  } else if (targetRegionId && riskMapInstance) {
    const id = parseInt(targetRegionId, 10);
    setTimeout(() => {
      riskMapInstance.focus(id);
    }, 400);
  } else if (!isNaN(targetLat) && !isNaN(targetLng) && riskMapInstance) {
    riskMapInstance.getMapInstance()?.setView([targetLat, targetLng], targetZoom || 12);
  }

  // 8. Live Status Bar Updates
  function updateStatusBar(detail = {}) {
    if (!statusBarEl) return;
    const isOnline = navigator.onLine && detail.state !== "offline";
    if (isOnline) {
      statusIndicator.className = "map-status-indicator";
      statusText.textContent = `Online • Synced ${detail.lastSyncAt ? window.LW.format?.relativeTime(detail.lastSyncAt) : 'just now'}`;
    } else {
      statusIndicator.className = "map-status-indicator offline";
      statusText.textContent = `Offline • Cached data`;
    }
  }

  document.addEventListener("lw:connectivity", (e) => updateStatusBar(e.detail));
  updateStatusBar();
});
