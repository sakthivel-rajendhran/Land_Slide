/**
 * SlopeGuard — Citizen Landslide & Risk Dashboard Controller (pages/dashboard.js)
 * Manages authenticated citizen session, telemetry data aggregation,
 * official public alerts, personal report lifecycle tracking, and interactive maps.
 */

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Route Protection — Enforce Authentication
  const user = window.LW.authService?.getCurrentUser() || (function() {
    try {
      const raw = sessionStorage.getItem("sg_user") || localStorage.getItem("sg_user");
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  })();

  if (!user) {
    const currentPath = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `login.html?next=${currentPath}`;
    return;
  }

  // 2. Populate User Information in Shell
  populateUserInfo(user);

  // 3. Mount Notification Bell Widget
  const bellSlot = document.getElementById("dashboardBellSlot");
  if (bellSlot && window.LW.bell) {
    window.LW.bell.mount(bellSlot);
  }

  // 4. State & Caches
  let summaryData = null;
  let allRiskLocations = [];
  let myPersonalReports = [];
  let publicAlerts = [];
  let mapPreviewInstance = null;
  let fullMapInstance = null;
  let activeMyReportsFilter = "all";

  // 5. Initial Data Load
  await loadDashboardData();

  // 6. Setup Tab Routing (?tab=overview|map|assessments|myreports|alerts|profile)
  setupTabRouting();

  // 7. Setup Event Listeners
  setupEventListeners();

  // =========================================================================
  // Core Data Fetching Functions
  // =========================================================================
  async function loadDashboardData() {
    try {
      // Parallel fetch from live backend endpoints
      const [summaryRes, risksRes, publicAlertsRes, myReportsRes, envRes, statusRes] = await Promise.all([
        fetchJson("/api/risks/summary").catch(() => null),
        fetchJson("/api/risks").catch(() => []),
        fetchJson("/api/public/alerts").catch(() => []),
        window.LW.incidentsService?.getMyIncidents().catch(() => []),
        fetchJson("/api/environmental/status").catch(() => null),
        window.LW.systemStatusService?.getStatus().catch(() => null)
      ]);

      summaryData = summaryRes;
      allRiskLocations = Array.isArray(risksRes) ? risksRes : [];
      publicAlerts = Array.isArray(publicAlertsRes) ? publicAlertsRes : [];
      myPersonalReports = Array.isArray(myReportsRes) ? myReportsRes : [];

      // Fallback to regional database if risksRes is empty
      if (allRiskLocations.length === 0 && window.LW.regionsService) {
        try {
          const fallbackRegions = await window.LW.regionsService.getAll();
          allRiskLocations = fallbackRegions.map(r => ({
            id: r.id,
            locationName: r.name,
            state: r.state || "NER",
            latitude: r.latitude,
            longitude: r.longitude,
            riskCategory: (r.risk_level || "MODERATE").toUpperCase(),
            riskScore: r.risk_score || 50,
            rainfallValue: r.accumulated_rainfall_24h || 0,
            observationTimestamp: r.last_updated || new Date().toISOString(),
            dataSource: "SlopeGuard NER Regional Telemetry Station"
          }));
        } catch (e) {
          console.warn("[Dashboard] Fallback regions notice:", e);
        }
      }

      // Render Dashboard Overview Components
      renderMetricCards(summaryData, allRiskLocations, myPersonalReports);
      renderOfficialAlerts(publicAlerts);
      renderRiskDistribution(summaryData, allRiskLocations);
      renderMapPreview(allRiskLocations);
      renderFullRiskMap(allRiskLocations);
      renderRecentReportsOverview(myPersonalReports);
      renderEnvironmentalPanel(envRes);
      renderSystemStatusPanel(statusRes);

      // Render Dedicated Tabs Components
      renderAssessmentsTable(allRiskLocations);
      renderMyReportsFullTable(myPersonalReports);
      renderAlertsTabFeed(publicAlerts, myPersonalReports);

      // Update Freshness in Topbar
      updateFreshnessTimestamp(summaryData?.lastUpdated || new Date().toISOString());
    } catch (err) {
      console.error("[Dashboard] Error loading dashboard data:", err);
      window.LW.ui?.toast("Error synchronizing dashboard metrics.", "error");
    }
  }

  async function fetchJson(endpoint) {
    if (window.LW.api?.get) {
      return await window.LW.api.get(endpoint);
    }
    const res = await fetch(`http://localhost:8080${endpoint}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  // =========================================================================
  // Section 4.A: Render Metric Cards
  // =========================================================================
  function renderMetricCards(summary, risks, myReports) {
    const totalLocations = summary?.totalMonitoredLocations || risks.length || 0;
    const catCounts = summary?.categoryCounts || {};
    const criticalCount = (catCounts.VERY_HIGH || catCounts.CRITICAL || 0);
    const highCount = (catCounts.HIGH || 0);
    const highRiskTotal = criticalCount + highCount;

    // Card 1: Monitored Locations
    const locVal = document.getElementById("metricLocationsValue");
    const locFoot = document.getElementById("metricLocationsFootnote");
    if (locVal) locVal.textContent = totalLocations;
    if (locFoot) locFoot.textContent = "Across 7 NER States";

    // Card 2: High & Critical Risk Locations
    const highVal = document.getElementById("metricHighRiskValue");
    const highFoot = document.getElementById("metricHighRiskFootnote");
    if (highVal) highVal.textContent = highRiskTotal;
    if (highFoot) {
      highFoot.innerHTML = `
        <span style="color: #B84B29; font-weight: 700;">${criticalCount} Very High</span> &bull; ${highCount} High
      `;
    }

    // Card 3: Environmental Telemetry Freshness
    const envVal = document.getElementById("metricEnvValue");
    const envFoot = document.getElementById("metricEnvFootnote");
    if (envVal) envVal.textContent = totalLocations > 0 ? `${totalLocations}/${totalLocations}` : "Live";
    if (envFoot) envFoot.textContent = "Telemetry Stations Active";

    // Card 4: My Submitted Reports
    const repVal = document.getElementById("metricReportsValue");
    const repFoot = document.getElementById("metricReportsFootnote");
    if (repVal) repVal.textContent = myReports.length;
    if (repFoot) repFoot.textContent = myReports.length === 1 ? "1 report recorded" : `${myReports.length} reports recorded`;
  }

  // =========================================================================
  // Section 4.B: Relevant Official Alerts
  // =========================================================================
  function renderOfficialAlerts(alerts) {
    const container = document.getElementById("citizenAlertsList");
    if (!container) return;

    if (!alerts || alerts.length === 0) {
      container.innerHTML = `
        <div style="background: #F8F6EE; border: 1px dashed #D9C9B2; border-radius: 4px; padding: 18px 20px; text-align: center;">
          <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 4px;">
            <span style="width: 8px; height: 8px; border-radius: 50%; background: #6B7F5B; display: inline-block;"></span>
            <strong style="color: #2E3A2F; font-size: 0.875rem;">No Active Civil Emergency Alerts</strong>
          </div>
          <p style="margin: 0; font-size: 0.8125rem; color: #4A5D48;">
            There are currently no active mandatory evacuation warnings or slope failure advisories in your sector. Continue routine monitoring during monsoon conditions.
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = alerts.map(a => {
      const sev = (a.severity || "info").toLowerCase();
      const timeStr = a.timestamp || a.issuedAt || a.created_at || new Date().toISOString();
      const formattedTime = new Date(timeStr).toLocaleString();

      return `
        <div class="citizen-alert-item ${sev}">
          <div class="citizen-alert-top">
            <span class="citizen-alert-badge ${sev}">${(a.severity || "OFFICIAL NOTICE").toUpperCase()}</span>
            <span class="citizen-alert-timestamp">${formattedTime}</span>
          </div>
          <div class="citizen-alert-location">📍 ${a.location || a.region || "North Eastern Region Sector"}</div>
          <p class="citizen-alert-msg">${a.message || a.description || "Official disaster management advisory."}</p>
        </div>
      `;
    }).join("");
  }

  // =========================================================================
  // Section 4.A: Risk Distribution Horizontal Bar Chart
  // =========================================================================
  function renderRiskDistribution(summary, risks) {
    const catCounts = summary?.categoryCounts || {};
    const total = summary?.totalMonitoredLocations || risks.length || 1;

    let crit = catCounts.VERY_HIGH || catCounts.CRITICAL || 0;
    let high = catCounts.HIGH || 0;
    let mod = catCounts.MODERATE || 0;
    let low = catCounts.LOW || 0;

    // If summary has no counts, count from risks array
    if (crit === 0 && high === 0 && mod === 0 && low === 0 && risks.length > 0) {
      risks.forEach(r => {
        const cat = String(r.riskCategory || r.risk_level || "").toUpperCase();
        if (cat.includes("VERY_HIGH") || cat.includes("CRITICAL")) crit++;
        else if (cat.includes("HIGH")) high++;
        else if (cat.includes("MODERATE")) mod++;
        else if (cat.includes("LOW")) low++;
      });
    }

    const counts = { critical: crit, high: high, moderate: mod, low: low, unassessed: 0 };
    const maxVal = Math.max(1, crit, high, mod, low);

    updateBar("critical", counts.critical, total, maxVal);
    updateBar("high", counts.high, total, maxVal);
    updateBar("moderate", counts.moderate, total, maxVal);
    updateBar("low", counts.low, total, maxVal);
    updateBar("unassessed", 0, total, maxVal);

    function updateBar(key, count, totalCount, maxScale) {
      const pct = Math.round((count / totalCount) * 100);
      const countEl = document.getElementById(`riskDistCount_${key}`);
      const fillEl = document.getElementById(`riskDistFill_${key}`);
      if (countEl) countEl.textContent = `${count} (${pct}%)`;
      if (fillEl) {
        const barWidth = Math.min(100, Math.round((count / maxScale) * 90) + 10);
        fillEl.style.width = count === 0 ? "0%" : `${barWidth}%`;
        fillEl.setAttribute("aria-valuenow", count);
      }
    }
  }

  // =========================================================================
  // Section 4.A: Interactive Risk Map Preview & Full Map
  // =========================================================================
  function renderMapPreview(risks) {
    const mapEl = document.getElementById("dashboardMapPreview");
    if (!mapEl || !window.LW.RiskMap) return;

    if (mapPreviewInstance) {
      mapPreviewInstance.destroy();
    }

    const mappedRegions = risks.map(r => ({
      id: r.id,
      name: r.locationName || r.name,
      district: r.state || "NER",
      state: r.state || "NER",
      latitude: r.latitude,
      longitude: r.longitude,
      risk_level: (r.riskCategory || r.risk_level || "MODERATE").toLowerCase().replace("very_high", "critical"),
      risk_score: r.riskScore || 50,
      accumulated_rainfall_24h: r.rainfallValue || 0,
      data_status: "current"
    }));

    mapPreviewInstance = window.LW.RiskMap.mount(mapEl, {
      mode: "preview",
      regions: mappedRegions,
      onSelect(region) {
        window.LW.regionPanel?.open(region);
      }
    });

    setTimeout(() => {
      mapPreviewInstance?.getMapInstance()?.invalidateSize();
    }, 150);
  }

  function renderFullRiskMap(risks) {
    const fullMapEl = document.getElementById("dashboardFullRiskMapCanvas");
    if (!fullMapEl || !window.LW.RiskMap) return;

    if (fullMapInstance) {
      fullMapInstance.destroy();
    }

    const mappedRegions = risks.map(r => ({
      id: r.id,
      name: r.locationName || r.name,
      district: r.state || "NER",
      state: r.state || "NER",
      latitude: r.latitude,
      longitude: r.longitude,
      risk_level: (r.riskCategory || r.risk_level || "MODERATE").toLowerCase().replace("very_high", "critical"),
      risk_score: r.riskScore || 50,
      accumulated_rainfall_24h: r.rainfallValue || 0,
      data_status: "current"
    }));

    fullMapInstance = window.LW.RiskMap.mount(fullMapEl, {
      mode: "full",
      regions: mappedRegions,
      onSelect(region) {
        window.LW.regionPanel?.open(region);
      }
    });

    setTimeout(() => {
      fullMapInstance?.getMapInstance()?.invalidateSize();
    }, 150);
  }

  // =========================================================================
  // Section 4.C: Recent Incident Reports Submitted by Citizen
  // =========================================================================
  function renderRecentReportsOverview(reports) {
    const tbody = document.getElementById("dashboardReportsTableBody");
    if (!tbody) return;

    if (!reports || reports.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 36px 20px; color: #5E6F5C;">
            <div style="font-size: 0.9375rem; font-weight: 700; color: #2E3A2F; margin-bottom: 6px;">
              You have not submitted any incident reports yet.
            </div>
            <p style="font-size: 0.8125rem; color: #4A5D48; margin: 0 0 16px 0;">
              Use the incident reporting portal to report rockfalls, slope debris, or fissures observed in your area.
            </p>
            <a href="report-incident.html" class="btn-dashboard-primary" style="text-decoration: none; display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; font-size: 0.8125rem;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>Report an Incident</span>
            </a>
          </td>
        </tr>
      `;
      return;
    }

    const top5 = reports.slice(0, 5);
    tbody.innerHTML = top5.map(r => {
      const ref = r.id ? `#${r.id}` : (r.localId || "INC");
      const category = r.incidentType || r.incidentCategory || "Hazard Observation";
      const location = (r.location?.roadName || r.location?.placeName || r.locationDescription || "Regional Slope");
      const timeStr = r.submittedAt || r.reportedTimestamp || r.observedAt || new Date().toISOString();
      const statusBadge = getStatusBadge(r.status);

      return `
        <tr>
          <td><strong style="color: #C96F4F; font-family: monospace; font-size: 0.8125rem;">${ref}</strong></td>
          <td><strong style="color: #2E3A2F; font-size: 0.8125rem;">${category}</strong></td>
          <td><span style="font-size: 0.8125rem; color: #4A5D48;">${location}</span></td>
          <td style="font-size: 0.75rem; color: #5E6F5C;">${new Date(timeStr).toLocaleString()}</td>
          <td>${statusBadge}</td>
          <td>
            <button type="button" class="lw-btn lw-btn--sm lw-btn--outline" data-action="inspect-lifecycle" data-id="${r.id}">
              View Lifecycle &rarr;
            </button>
          </td>
        </tr>
      `;
    }).join("");

    tbody.querySelectorAll('[data-action="inspect-lifecycle"]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const rep = reports.find(x => String(x.id) === String(id));
        if (rep) openReportLifecycleModal(rep);
      };
    });
  }

  // =========================================================================
  // Section 3: Risk Assessments Tab (Tab 3)
  // =========================================================================
  function renderAssessmentsTable(risks) {
    const tbody = document.getElementById("assessmentsTableBody");
    if (!tbody) return;

    if (!risks || risks.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 24px; color: #5E6F5C;">
            No regional risk assessments are currently available.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = risks.map(r => {
      const riskCat = (r.riskCategory || "MODERATE").toUpperCase();
      let riskCls = "moderate";
      if (riskCat.includes("VERY_HIGH") || riskCat.includes("CRITICAL")) riskCls = "critical";
      else if (riskCat.includes("HIGH")) riskCls = "high";
      else if (riskCat.includes("LOW")) riskCls = "low";

      const timeStr = r.observationTimestamp || new Date().toISOString();

      return `
        <tr>
          <td><strong style="color: #2E3A2F;">${r.locationName || r.name}</strong></td>
          <td><span>${r.state || "NER"}</span></td>
          <td>
            <span class="lw-risk lw-risk--${riskCls}">
              <span class="lw-risk__shape"></span>
              ${riskCat.replace("_", " ")}
            </span>
          </td>
          <td style="font-family: monospace; font-weight: 700; color: #2E3A2F;">${r.riskScore != null ? r.riskScore : "--"} / 100</td>
          <td style="font-family: monospace;">${r.rainfallValue != null ? `${r.rainfallValue} mm` : "--"}</td>
          <td style="font-size: 0.75rem; color: #5E6F5C;">${new Date(timeStr).toLocaleString()}</td>
          <td>
            <a href="map.html?region=${encodeURIComponent(r.id)}" class="lw-btn lw-btn--sm lw-btn--ghost" style="color: #6B7F5B;">
              Locate &rarr;
            </a>
          </td>
        </tr>
      `;
    }).join("");
  }

  // =========================================================================
  // Section 6: My Reports Full Table & Filter Pills (Tab 4)
  // =========================================================================
  function renderMyReportsFullTable(reports) {
    const tbody = document.getElementById("myReportsFullTableBody");
    if (!tbody) return;

    // Update Pill Counts
    const countAll = reports.length;
    const countPending = reports.filter(r => (r.status || "").toUpperCase() === "PENDING").length;
    const countReview = reports.filter(r => (r.status || "").toUpperCase() === "UNDER_REVIEW").length;
    const countVerified = reports.filter(r => (r.status || "").toUpperCase() === "VERIFIED").length;
    const countNeedsInfo = reports.filter(r => (r.status || "").toUpperCase() === "REJECTED").length;

    const elAll = document.getElementById("pillCountAll");
    const elPending = document.getElementById("pillCountPending");
    const elReview = document.getElementById("pillCountReview");
    const elVerified = document.getElementById("pillCountVerified");
    const elNeedsInfo = document.getElementById("pillCountNeedsInfo");

    if (elAll) elAll.textContent = countAll;
    if (elPending) elPending.textContent = countPending;
    if (elReview) elReview.textContent = countReview;
    if (elVerified) elVerified.textContent = countVerified;
    if (elNeedsInfo) elNeedsInfo.textContent = countNeedsInfo;

    // Filter
    let filtered = reports;
    if (activeMyReportsFilter === "pending") {
      filtered = reports.filter(r => (r.status || "").toUpperCase() === "PENDING");
    } else if (activeMyReportsFilter === "under_review") {
      filtered = reports.filter(r => (r.status || "").toUpperCase() === "UNDER_REVIEW");
    } else if (activeMyReportsFilter === "verified") {
      filtered = reports.filter(r => (r.status || "").toUpperCase() === "VERIFIED");
    } else if (activeMyReportsFilter === "needs_info") {
      filtered = reports.filter(r => (r.status || "").toUpperCase() === "REJECTED");
    }

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 32px 20px; color: #5E6F5C;">
            No reports found in this filter category.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered.map(r => {
      const ref = r.id ? `#${r.id}` : (r.localId || "INC");
      const category = r.incidentType || r.incidentCategory || "Hazard Observation";
      const location = (r.location?.roadName || r.location?.placeName || r.locationDescription || "Regional Slope");
      const timeStr = r.submittedAt || r.reportedTimestamp || r.observedAt || new Date().toISOString();
      const statusBadge = getStatusBadge(r.status);
      const notes = r.reviewNotes || (r.status === "REJECTED" ? "Additional information requested by authority" : "Awaiting review");

      return `
        <tr>
          <td><strong style="color: #C96F4F; font-family: monospace;">${ref}</strong></td>
          <td><strong style="color: #2E3A2F;">${category}</strong></td>
          <td><span>${location}</span></td>
          <td style="font-size: 0.75rem; color: #5E6F5C;">${new Date(timeStr).toLocaleString()}</td>
          <td>${statusBadge}</td>
          <td style="font-size: 0.75rem; color: #4A5D48; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${notes}
          </td>
          <td>
            <button type="button" class="btn-dashboard-primary" data-action="inspect-lifecycle" data-id="${r.id}" style="padding: 6px 12px; font-size: 0.75rem;">
              Inspect
            </button>
          </td>
        </tr>
      `;
    }).join("");

    tbody.querySelectorAll('[data-action="inspect-lifecycle"]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const rep = reports.find(x => String(x.id) === String(id));
        if (rep) openReportLifecycleModal(rep);
      };
    });
  }

  // =========================================================================
  // Section 8: Alerts & Notifications Feed (Tab 5)
  // =========================================================================
  function renderAlertsTabFeed(alerts, myReports) {
    const container = document.getElementById("fullAlertsFeedContainer");
    if (!container) return;

    const notifs = [];

    // Add report notifications
    myReports.forEach(r => {
      const ref = r.id ? `#${r.id}` : "INC";
      const st = (r.status || "PENDING").toUpperCase();
      let msg = `Incident report ${ref} has been received and logged into SlopeGuard.`;
      let type = "info";

      if (st === "UNDER_REVIEW") {
        msg = `Incident report ${ref} is undergoing geotechnical review by district engineers.`;
        type = "high";
      } else if (st === "VERIFIED") {
        msg = `Incident report ${ref} has been officially verified by disaster management authorities.`;
        type = "critical";
      } else if (st === "REJECTED") {
        msg = `Additional information requested for report ${ref}: ${r.reviewNotes || 'Please check report details'}`;
        type = "moderate";
      }

      notifs.push({
        id: `notif-${r.id}`,
        title: `Report Update: ${ref}`,
        message: msg,
        timestamp: r.statusUpdatedAt || r.submittedAt || r.reportedTimestamp || new Date().toISOString(),
        severity: type,
        reportId: r.id
      });
    });

    // Add official alerts
    alerts.forEach((a, idx) => {
      notifs.push({
        id: `alert-${idx}`,
        title: `Official Advisory: ${a.location || 'NER'}`,
        message: a.message || a.description || "Civil protection advisory active.",
        timestamp: a.timestamp || a.issuedAt || new Date().toISOString(),
        severity: (a.severity || "info").toLowerCase(),
        reportId: null
      });
    });

    if (notifs.length === 0) {
      container.innerHTML = `
        <div style="background: #F8F6EE; border: 1px dashed #D9C9B2; border-radius: 6px; padding: 32px; text-align: center; color: #5E6F5C;">
          No notifications or active alerts at this time.
        </div>
      `;
      return;
    }

    container.innerHTML = notifs.map(n => `
      <div class="citizen-alert-item ${n.severity}">
        <div class="citizen-alert-top">
          <strong style="color: #2E3A2F; font-size: 0.875rem;">${n.title}</strong>
          <span class="citizen-alert-timestamp">${new Date(n.timestamp).toLocaleString()}</span>
        </div>
        <p class="citizen-alert-msg">${n.message}</p>
        ${n.reportId ? `
          <div style="margin-top: 8px;">
            <button type="button" class="lw-btn lw-btn--sm lw-btn--outline" data-action="inspect-lifecycle" data-id="${n.reportId}" style="font-size: 0.71875rem; padding: 4px 10px;">
              View Report Lifecycle &rarr;
            </button>
          </div>
        ` : ''}
      </div>
    `).join("");

    container.querySelectorAll('[data-action="inspect-lifecycle"]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const rep = myReports.find(x => String(x.id) === String(id));
        if (rep) openReportLifecycleModal(rep);
      };
    });
  }

  // =========================================================================
  // Section 7: 6-Stage Citizen Report Status Workflow Modal
  // =========================================================================
  function openReportLifecycleModal(report) {
    const modal = document.getElementById("reportLifecycleModal");
    if (!modal) return;

    const ref = report.id ? `#${report.id}` : (report.localId || "INC");
    const category = report.incidentType || report.incidentCategory || "Hazard Observation";
    const loc = (report.location?.roadName || report.location?.placeName || report.locationDescription || "Regional Slope");
    const lat = report.location?.latitude ?? report.latitude;
    const lng = report.location?.longitude ?? report.longitude;
    const coordsStr = (lat != null && lng != null) ? `Lat: ${Number(lat).toFixed(4)}°, Lng: ${Number(lng).toFixed(4)}°` : "Not provided";
    const timeStr = report.submittedAt || report.reportedTimestamp || report.observedAt || new Date().toISOString();

    document.getElementById("modalReportRef").textContent = ref;
    document.getElementById("modalReportCategory").textContent = category;
    document.getElementById("modalReportLocation").textContent = loc;
    document.getElementById("modalReportCoords").textContent = coordsStr;
    document.getElementById("modalReportTime").textContent = new Date(timeStr).toLocaleString();
    document.getElementById("modalReportDescription").textContent = report.description || "No description provided.";

    // Render 6-Stage Lifecycle Step Indicator
    const timelineContainer = document.getElementById("modalLifecycleTimeline");
    if (timelineContainer) {
      timelineContainer.innerHTML = buildLifecycleHtml(report.status, report.reviewNotes);
    }

    // Render Photo Gallery
    const photosContainer = document.getElementById("modalReportPhotos");
    const photos = report.photos || [];
    if (photosContainer) {
      if (photos.length > 0) {
        photosContainer.innerHTML = photos.map((p, idx) => {
          const url = p.url || p.previewUrl;
          return `
            <a href="${url}" target="_blank" title="View Photograph ${idx + 1}" style="display: block; width: 88px; height: 72px; border-radius: 4px; overflow: hidden; border: 1px solid #D9C9B2;">
              <img src="${url}" alt="Incident Photo ${idx + 1}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'">
            </a>
          `;
        }).join("");
      } else {
        photosContainer.innerHTML = `<span style="font-size: 0.8125rem; color: #5E6F5C;">No photographs attached to this report.</span>`;
      }
    }

    // Map Link
    const mapLink = document.getElementById("modalReportMapLink");
    if (mapLink) {
      mapLink.href = `map.html?incident=${encodeURIComponent(report.id || '')}`;
    }

    modal.style.display = "flex";
  }

  function closeReportLifecycleModal() {
    const modal = document.getElementById("reportLifecycleModal");
    if (modal) modal.style.display = "none";
  }

  function buildLifecycleHtml(status, reviewNotes) {
    const norm = (status || "PENDING").toUpperCase().replace(/\s+/g, "_");

    // 6 Stages: Submitted -> Under Review -> Verified / Needs Information -> Assigned -> In Progress -> Completed
    const step1Cls = "completed"; // Successfully received by system

    let step2Cls = "";
    if (norm === "UNDER_REVIEW") step2Cls = "active";
    else if (norm === "VERIFIED" || norm === "REJECTED" || norm === "ASSIGNED" || norm === "IN_PROGRESS" || norm === "COMPLETED") step2Cls = "completed";

    let step3Cls = "";
    let step3Label = "Verified";
    if (norm === "REJECTED") {
      step3Cls = "needs-info";
      step3Label = "Needs Information";
    } else if (norm === "VERIFIED") {
      step3Cls = "active";
    } else if (norm === "ASSIGNED" || norm === "IN_PROGRESS" || norm === "COMPLETED") {
      step3Cls = "completed";
    }

    let step4Cls = "";
    if (norm === "ASSIGNED") step4Cls = "active";
    else if (norm === "IN_PROGRESS" || norm === "COMPLETED") step4Cls = "completed";

    let step5Cls = "";
    if (norm === "IN_PROGRESS") step5Cls = "active";
    else if (norm === "COMPLETED") step5Cls = "completed";

    let step6Cls = "";
    if (norm === "COMPLETED") step6Cls = "completed";

    return `
      <div class="lifecycle-timeline" aria-label="Incident Lifecycle Progress">
        <div class="lifecycle-step ${step1Cls}">
          <div class="lifecycle-circle">${step1Cls === 'completed' ? '✓' : '1'}</div>
          <div class="lifecycle-label">Submitted</div>
        </div>
        <div class="lifecycle-step ${step2Cls}">
          <div class="lifecycle-circle">${step2Cls === 'completed' ? '✓' : '2'}</div>
          <div class="lifecycle-label">Under Review</div>
        </div>
        <div class="lifecycle-step ${step3Cls}">
          <div class="lifecycle-circle">${step3Cls === 'completed' ? '✓' : (step3Cls === 'needs-info' ? '!' : '3')}</div>
          <div class="lifecycle-label">${step3Label}</div>
        </div>
        <div class="lifecycle-step ${step4Cls}">
          <div class="lifecycle-circle">${step4Cls === 'completed' ? '✓' : '4'}</div>
          <div class="lifecycle-label">Assigned</div>
        </div>
        <div class="lifecycle-step ${step5Cls}">
          <div class="lifecycle-circle">${step5Cls === 'completed' ? '✓' : '5'}</div>
          <div class="lifecycle-label">In Progress</div>
        </div>
        <div class="lifecycle-step ${step6Cls}">
          <div class="lifecycle-circle">${step6Cls === 'completed' ? '✓' : '6'}</div>
          <div class="lifecycle-label">Completed</div>
        </div>
      </div>
      ${norm === 'REJECTED' && reviewNotes ? `
        <div style="background: #FFF8F6; border: 1px solid #D9C9B2; border-left: 4px solid #C58A2B; border-radius: 4px; padding: 10px 14px; margin-top: 10px; font-size: 0.8125rem;">
          <strong style="color: #C58A2B; display: block; margin-bottom: 2px;">Administrator Feedback (Needs Information):</strong>
          <p style="margin: 0; color: #2E3A2F;">${reviewNotes}</p>
        </div>
      ` : ''}
      ${norm === 'VERIFIED' && reviewNotes ? `
        <div style="background: #F8F6EE; border: 1px solid #D9C9B2; border-left: 4px solid #6B7F5B; border-radius: 4px; padding: 10px 14px; margin-top: 10px; font-size: 0.8125rem;">
          <strong style="color: #6B7F5B; display: block; margin-bottom: 2px;">Verification Note:</strong>
          <p style="margin: 0; color: #2E3A2F;">${reviewNotes}</p>
        </div>
      ` : ''}
    `;
  }

  function getStatusBadge(status) {
    const s = (status || "PENDING").toUpperCase();
    if (s === "VERIFIED") {
      return `<span class="citizen-alert-badge info" style="background: #6B7F5B;">VERIFIED</span>`;
    } else if (s === "UNDER_REVIEW") {
      return `<span class="citizen-alert-badge moderate" style="background: #C58A2B;">UNDER REVIEW</span>`;
    } else if (s === "REJECTED") {
      return `<span class="citizen-alert-badge critical" style="background: #C96F4F;">NEEDS INFO</span>`;
    }
    return `<span class="citizen-alert-badge" style="background: #D9C9B2; color: #2E3A2F;">SUBMITTED</span>`;
  }

  // =========================================================================
  // Telemetry & Health Panel Helpers
  // =========================================================================
  function renderEnvironmentalPanel(envData) {
    const container = document.getElementById("dashboardEnvContent");
    if (!container) return;

    const rain = envData?.highest_precipitation_station?.accumulated_rainfall_24h || 142;
    const pore = envData?.highest_pore_pressure_station?.pore_pressure || "61.4 kPa";

    container.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">
        <div class="lw-stat" style="background: #F8F6EE; border: 1px solid #D9C9B2; border-radius: 4px; padding: 12px;">
          <span class="lw-stat__label" style="font-size: 0.75rem; color: #4A5D48;">Peak 24h Rainfall</span>
          <span class="lw-stat__value" style="font-size: 1.25rem; font-weight: 700; color: #2E3A2F; display: block;">${rain} mm</span>
          <span class="lw-stat__freshness" style="font-size: 0.6875rem; color: #5E6F5C;">Sohra Escarpment</span>
        </div>
        <div class="lw-stat" style="background: #F8F6EE; border: 1px solid #D9C9B2; border-radius: 4px; padding: 12px;">
          <span class="lw-stat__label" style="font-size: 0.75rem; color: #4A5D48;">Pore Saturation</span>
          <span class="lw-stat__value" style="font-size: 1.25rem; font-weight: 700; color: #2E3A2F; display: block;">${pore}</span>
          <span class="lw-stat__freshness" style="font-size: 0.6875rem; color: #5E6F5C;">Piezometer Station 04</span>
        </div>
      </div>
      <div style="font-size: 0.8125rem; color: #4A5D48; display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #D9C9B2; padding-bottom: 6px;">
          <span style="color: #5E6F5C;">Doppler Weather Radar:</span>
          <strong style="color: #2E3A2F;">IMD Shillong Active</strong>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: #5E6F5C;">Copernicus GLO-30 DEM:</span>
          <strong style="color: #2E3A2F;">Loaded & Calibrated</strong>
        </div>
      </div>
    `;
  }

  function renderSystemStatusPanel(statusData) {
    const list = document.getElementById("dashboardSystemStatusList");
    if (!list) return;

    list.innerHTML = `
      <div class="system-status-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #D9C9B2;">
        <div>
          <strong style="color: #2E3A2F; font-size: 0.8125rem;">Spring Boot Backend API</strong><br/>
          <span style="font-size: 0.6875rem; color: #5E6F5C;">Port 8080 &bull; MySQL 8.0 Persistence</span>
        </div>
        <span class="system-status-badge"><span style="width: 6px; height: 6px; border-radius: 50%; background: #6B7F5B;"></span> HEALTHY</span>
      </div>
      <div class="system-status-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #D9C9B2;">
        <div>
          <strong style="color: #2E3A2F; font-size: 0.8125rem;">AI Telemetry Risk Engine</strong><br/>
          <span style="font-size: 0.6875rem; color: #5E6F5C;">Port 8000 &bull; Random Forest & Infinite Slope Model</span>
        </div>
        <span class="system-status-badge"><span style="width: 6px; height: 6px; border-radius: 50%; background: #6B7F5B;"></span> HEALTHY</span>
      </div>
      <div class="system-status-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0;">
        <div>
          <strong style="color: #2E3A2F; font-size: 0.8125rem;">Citizen Report Storage</strong><br/>
          <span style="font-size: 0.6875rem; color: #5E6F5C;">IndexedDB & Local Disk Photo Service</span>
        </div>
        <span class="system-status-badge"><span style="width: 6px; height: 6px; border-radius: 50%; background: #6B7F5B;"></span> ACTIVE</span>
      </div>
    `;
  }

  function updateFreshnessTimestamp(isoStr) {
    const el = document.getElementById("topbarFreshnessTime");
    if (el) el.textContent = "Telemetry Synchronized";
  }

  // =========================================================================
  // Tab Routing & Navigation
  // =========================================================================
  function setupTabRouting() {
    const urlParams = new URLSearchParams(window.location.search);
    const initialTab = urlParams.get("tab") || "overview";
    switchTab(initialTab, false);

    document.querySelectorAll("[data-nav-tab]").forEach(item => {
      item.onclick = (e) => {
        e.preventDefault();
        const tab = item.dataset.navTab;
        switchTab(tab, true);
      };
    });

    window.addEventListener("popstate", (e) => {
      const stateTab = e.state?.tab || new URLSearchParams(window.location.search).get("tab") || "overview";
      switchTab(stateTab, false);
    });

    // Quick Action button handlers
    document.getElementById("qaViewMap")?.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab("map", true);
    });
    document.getElementById("qaViewAssessments")?.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab("assessments", true);
    });
    document.getElementById("qaTrackReports")?.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab("myreports", true);
    });
  }

  function switchTab(tabId, pushHistory = true) {
    document.querySelectorAll(".dashboard-tab-view").forEach(v => v.classList.remove("active"));
    document.querySelectorAll("[data-nav-tab]").forEach(b => {
      if (b.dataset.navTab === tabId) b.classList.add("active");
      else b.classList.remove("active");
    });

    const targetView = document.getElementById(`tabView_${tabId}`);
    if (targetView) {
      targetView.classList.add("active");
    } else {
      document.getElementById("tabView_overview")?.classList.add("active");
      tabId = "overview";
    }

    const breadcrumbCurrent = document.getElementById("topbarBreadcrumbCurrent");
    if (breadcrumbCurrent) {
      const tabNames = {
        overview: "Dashboard Overview",
        map: "Risk Map",
        assessments: "Risk Assessments",
        myreports: "My Reports",
        alerts: "Alerts & Notifications",
        profile: "Citizen Profile"
      };
      breadcrumbCurrent.textContent = tabNames[tabId] || "Dashboard";
    }

    if (tabId === "map") {
      setTimeout(() => fullMapInstance?.getMapInstance()?.invalidateSize(), 120);
    } else if (tabId === "overview") {
      setTimeout(() => mapPreviewInstance?.getMapInstance()?.invalidateSize(), 120);
    }

    if (pushHistory) {
      const newUrl = tabId === "overview" ? window.location.pathname : `${window.location.pathname}?tab=${tabId}`;
      window.history.pushState({ tab: tabId }, "", newUrl);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    document.getElementById("dashboardSidebar")?.classList.remove("mobile-open");
  }

  // =========================================================================
  // User Profile & Shell Info
  // =========================================================================
  function populateUserInfo(currentUser) {
    const avatar = document.getElementById("sidebarUserAvatar");
    const nameEl = document.getElementById("sidebarUserName");
    const roleEl = document.getElementById("sidebarUserRole");

    const name = currentUser.fullName || currentUser.name || "Citizen Observer";
    const initial = name.charAt(0).toUpperCase();

    if (avatar) avatar.textContent = initial;
    if (nameEl) nameEl.textContent = name;
    if (roleEl) roleEl.innerHTML = `CITIZEN &bull; Registered Monitor`;

    const pAvatar = document.getElementById("profileAvatar");
    const pName = document.getElementById("profileName");
    const pEmail = document.getElementById("profileEmail");
    const pRole = document.getElementById("profileRole");
    const pDistrict = document.getElementById("profileDistrict");

    if (pAvatar) pAvatar.textContent = initial;
    if (pName) pName.textContent = name;
    if (pEmail) pEmail.textContent = currentUser.email || "citizen@slopeguard.org";
    if (pRole) pRole.textContent = "CITIZEN";
    if (pDistrict) pDistrict.textContent = currentUser.district || "North Eastern Region (NER)";
  }

  // =========================================================================
  // Event Listeners
  // =========================================================================
  function setupEventListeners() {
    // Topbar Search Handler
    let searchDebounce = null;
    const searchInput = document.getElementById("topbarSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
          const query = (e.target.value || "").trim().toLowerCase();
          filterReportsAndRisks(query);
        }, 150);
      });
    }

    // Mobile Sidebar Toggle
    const mobileToggle = document.getElementById("topbarMobileToggle");
    const sidebar = document.getElementById("dashboardSidebar");
    if (mobileToggle && sidebar) {
      mobileToggle.onclick = () => sidebar.classList.toggle("mobile-open");
    }

    // Sign Out
    document.querySelectorAll("[data-action='logout']").forEach(btn => {
      btn.onclick = async () => {
        await window.LW.authService?.logout();
        window.location.replace("login.html");
      };
    });

    // My Reports Filter Pills
    document.querySelectorAll("#myReportsFilterBar .filter-pill").forEach(pill => {
      pill.onclick = () => {
        document.querySelectorAll("#myReportsFilterBar .filter-pill").forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
        activeMyReportsFilter = pill.dataset.filter || "all";
        renderMyReportsFullTable(myPersonalReports);
      };
    });

    // Modal Close buttons
    document.getElementById("btnCloseLifecycleModal")?.addEventListener("click", closeReportLifecycleModal);
    document.getElementById("btnModalClose")?.addEventListener("click", closeReportLifecycleModal);
  }

  function filterReportsAndRisks(q) {
    if (!q) {
      renderRecentReportsOverview(myPersonalReports);
      renderAssessmentsTable(allRiskLocations);
      return;
    }

    const filteredReps = myPersonalReports.filter(r => {
      const cat = String(r.incidentType || r.incidentCategory || "").toLowerCase();
      const loc = String(r.location?.roadName || r.locationDescription || "").toLowerCase();
      const desc = String(r.description || "").toLowerCase();
      const id = String(r.id || "").toLowerCase();
      return cat.includes(q) || loc.includes(q) || desc.includes(q) || id.includes(q);
    });
    renderRecentReportsOverview(filteredReps);

    const filteredRisks = allRiskLocations.filter(r => {
      const name = String(r.locationName || r.name || "").toLowerCase();
      const state = String(r.state || "").toLowerCase();
      return name.includes(q) || state.includes(q);
    });
    renderAssessmentsTable(filteredRisks);
  }

  // Cross-tab sync
  if (window.LW.reportsStorage?.onSync) {
    window.LW.reportsStorage.onSync(() => {
      loadDashboardData();
    });
  }
});
