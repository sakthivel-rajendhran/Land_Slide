/**
 * SlopeGuard — Rescue Team Dashboard Page Controller (rescue-dashboard.js)
 * End-to-end integration with RescueMissionController & reports-storage.js
 */

(function () {
  'use strict';

  // State Management
  let currentUser = null;
  let allMissions = [];
  let selectedMission = null;
  let activeFilter = 'all';
  let searchQuery = '';
  let leafletMap = null;
  let incidentMarker = null;
  let teamMarker = null;
  let journeyPolyline = null;
  let accuracyCircle = null;
  let geoWatchId = null;
  let lastGpsPingTime = null;
  let currentTeamCoords = null; // { latitude, longitude, accuracy }
  let uploadedPhotos = []; // [{ name, dataUrl }]

  // Guard: Verify authentication and role
  function initAuthGuard() {
    try {
      const raw = sessionStorage.getItem('sg_user') || localStorage.getItem('sg_user');
      currentUser = raw ? JSON.parse(raw) : null;
    } catch (e) {
      currentUser = null;
    }

    if (!currentUser) {
      window.location.replace('login.html?next=rescue-dashboard.html');
      return false;
    }

    const role = (currentUser.role || '').toUpperCase();
    if (role !== 'OFFICER' && role !== 'RESCUE_FORCE' && role !== 'ADMIN') {
      window.location.replace('dashboard.html');
      return false;
    }

    // Populate user profile info in topbar
    const nameEl = document.getElementById('officerName');
    const avatarEl = document.getElementById('officerAvatar');
    const officerName = currentUser.name || currentUser.fullName || 'Rescue Force Unit';
    if (nameEl) nameEl.textContent = officerName;
    if (avatarEl) avatarEl.textContent = officerName.charAt(0).toUpperCase();

    return true;
  }

  // Haversine Distance Formula in Kilometers
  function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
    const R = 6371; // Earth's radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Escape HTML helper
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Initialize Leaflet Tactical Map
  function initMap() {
    const mapEl = document.getElementById('rescueMap');
    if (!mapEl || typeof L === 'undefined') return;

    if (leafletMap) {
      leafletMap.remove();
      leafletMap = null;
    }

    // Default center: North Eastern Region (Shillong / Guwahati corridor)
    const defaultCenter = [25.5788, 91.8933];
    leafletMap = L.map('rescueMap', {
      zoomControl: true,
      attributionControl: true
    }).setView(defaultCenter, 11);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors | SlopeGuard NER'
    }).addTo(leafletMap);
  }

  // Render Markers and Journey Trail on Tactical Map
  function updateMapForMission(mission) {
    if (!leafletMap || !mission) return;

    const lat = mission.latitude;
    const lng = mission.longitude;

    // 1. Incident Marker
    if (lat != null && lng != null) {
      if (!incidentMarker) {
        const incidentIcon = L.divIcon({
          className: 'custom-incident-marker',
          html: `<div style="background:#DC2626; color:#FFF; width:28px; height:28px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:800; border:2px solid #FFF; box-shadow:0 2px 6px rgba(0,0,0,0.3); font-size:14px;">⚠️</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });
        incidentMarker = L.marker([lat, lng], { icon: incidentIcon }).addTo(leafletMap);
      } else {
        incidentMarker.setLatLng([lat, lng]);
      }

      incidentMarker.bindPopup(`
        <div style="font-family:'Manrope',sans-serif; padding:4px;">
          <strong style="color:#2E3A2F;">${escapeHtml(mission.categoryDisplayName || 'Incident')}</strong>
          <div style="font-size:12px; color:#4A5D48; margin-top:2px;">${escapeHtml(mission.locationDescription || '')}</div>
          <div style="font-size:11px; color:#C96F4F; font-weight:700; margin-top:4px;">Stage: ${escapeHtml(mission.operationalStage || 'ASSIGNED')}</div>
        </div>
      `);
    }

    // 2. Team Location Marker
    const teamLat = currentTeamCoords?.latitude ?? mission.currentLatitude;
    const teamLng = currentTeamCoords?.longitude ?? mission.currentLongitude;
    const teamAcc = currentTeamCoords?.accuracy ?? mission.currentAccuracy ?? 15;

    if (teamLat != null && teamLng != null) {
      if (!teamMarker) {
        const teamIcon = L.divIcon({
          className: 'custom-team-marker',
          html: `<div style="background:#16A34A; color:#FFF; width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:800; border:2px solid #FFF; box-shadow:0 2px 8px rgba(0,0,0,0.4); font-size:15px;">🚑</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        });
        teamMarker = L.marker([teamLat, teamLng], { icon: teamIcon }).addTo(leafletMap);
      } else {
        teamMarker.setLatLng([teamLat, teamLng]);
      }

      if (!accuracyCircle) {
        accuracyCircle = L.circle([teamLat, teamLng], {
          radius: teamAcc,
          color: '#16A34A',
          fillColor: '#86EFAC',
          fillOpacity: 0.18,
          weight: 1
        }).addTo(leafletMap);
      } else {
        accuracyCircle.setLatLng([teamLat, teamLng]);
        accuracyCircle.setRadius(teamAcc);
      }

      teamMarker.bindPopup(`
        <div style="font-family:'Manrope',sans-serif; padding:4px;">
          <strong style="color:#16A34A;">Rescue Team Live Location</strong>
          <div style="font-size:11px; color:#4A5D48;">Accuracy: ±${Math.round(teamAcc)}m</div>
        </div>
      `);
    }

    // 3. Journey Trail Polyline
    const trailPoints = (mission.journeyTrail || [])
      .filter(p => p.latitude != null && p.longitude != null)
      .map(p => [p.latitude, p.longitude]);

    if (teamLat != null && teamLng != null) {
      trailPoints.push([teamLat, teamLng]);
    }

    if (trailPoints.length > 0) {
      if (!journeyPolyline) {
        journeyPolyline = L.polyline(trailPoints, {
          color: '#2E3A2F',
          weight: 4,
          opacity: 0.85,
          dashArray: '4, 8'
        }).addTo(leafletMap);
      } else {
        journeyPolyline.setLatLngs(trailPoints);
      }
    }

    // Center and Fit bounds
    const boundsPoints = [];
    if (lat != null && lng != null) boundsPoints.push([lat, lng]);
    if (teamLat != null && teamLng != null) boundsPoints.push([teamLat, teamLng]);

    if (boundsPoints.length >= 2) {
      leafletMap.fitBounds(boundsPoints, { padding: [50, 50], maxZoom: 15 });
    } else if (boundsPoints.length === 1) {
      leafletMap.setView(boundsPoints[0], 13);
    }
  }

  let knownMissionIds = new Set();
  let isFirstLoad = true;

  // Load Missions from Backend / Storage
  async function loadMissions(silent = false) {
    try {
      if (window.LW?.reportsStorage?.getRescueMissions) {
        const fetched = await window.LW.reportsStorage.getRescueMissions();

        // Detect new incoming assignments and alert team (Requirement 1.5, 1.6)
        if (!isFirstLoad) {
          const newAssignments = fetched.filter(m => 
            !knownMissionIds.has(String(m.id)) && 
            ((m.decisionStatus || '').toUpperCase() === 'PENDING' || (m.operationalStage || '').toUpperCase() === 'ASSIGNED')
          );
          if (newAssignments.length > 0) {
            const firstNew = newAssignments[0];
            const msg = `🚨 New Mission Assigned: #${firstNew.id} (${firstNew.categoryDisplayName || firstNew.incidentCategory}) - ${firstNew.locationDescription || 'Regional Sector'}`;
            if (window.LW?.ui?.toast) window.LW.ui.toast(msg, 'warning');

            // Automatically switch selected mission to the new assignment if none currently in transit
            if (!selectedMission || selectedMission.operationalStage !== 'EN_ROUTE') {
              selectedMission = firstNew;
            }
          }
        }

        allMissions = fetched;
        knownMissionIds = new Set(allMissions.map(m => String(m.id)));
        isFirstLoad = false;
      } else {
        allMissions = [];
      }
    } catch (e) {
      console.error('[rescue-dashboard] Error loading missions:', e);
      allMissions = [];
    }

    renderKPIs();
    determineActiveMission();
    renderMissionsList();
  }

  // Compute and Render Key Metrics Cards
  function renderKPIs() {
    let countNew = 0;
    let countActive = 0;
    let countTransit = 0;
    let countScene = 0;
    let countReview = 0;
    let countFollowup = 0;

    allMissions.forEach(m => {
      const stage = (m.operationalStage || '').toUpperCase();
      const status = (m.status || '').toLowerCase();
      const decision = (m.decisionStatus || '').toUpperCase();

      // Follow-up required
      if (stage === 'FOLLOW_UP_REQUIRED' || Boolean(m.adminFollowUpNotes)) {
        countFollowup++;
      }
      // Awaiting Verification / Under Review
      else if (stage === 'AWAITING_VERIFICATION' || status === 'under review') {
        countReview++;
      }
      // On Scene
      else if (stage === 'ON_SCENE') {
        countScene++;
        countActive++;
      }
      // In Transit
      else if (stage === 'EN_ROUTE') {
        countTransit++;
        countActive++;
      }
      // Accepted but not yet started
      else if (stage === 'ACCEPTED' || status === 'responding') {
        countActive++;
      }
      // New / Assigned
      else if (decision === 'PENDING' || stage === 'ASSIGNED' || status === 'assigned') {
        countNew++;
      }
    });

    setKpiCount('kpiCountNew', countNew);
    setKpiCount('kpiCountActive', countActive);
    setKpiCount('kpiCountTransit', countTransit);
    setKpiCount('kpiCountScene', countScene);
    setKpiCount('kpiCountReview', countReview);
    setKpiCount('kpiCountFollowup', countFollowup);
  }

  function setKpiCount(id, count) {
    const el = document.getElementById(id);
    if (el) el.textContent = count;
  }

  // Pick the most urgent mission for the pinned Active Mission Hero Banner
  function determineActiveMission() {
    if (selectedMission) {
      // Refresh current selection
      const refreshed = allMissions.find(m => String(m.id) === String(selectedMission.id));
      if (refreshed) selectedMission = refreshed;
    }

    if (!selectedMission) {
      // 1. Follow-up required first
      selectedMission = allMissions.find(
        m => m.operationalStage === 'FOLLOW_UP_REQUIRED' || Boolean(m.adminFollowUpNotes)
      );
      // 2. On scene next
      if (!selectedMission) {
        selectedMission = allMissions.find(m => m.operationalStage === 'ON_SCENE');
      }
      // 3. En route next
      if (!selectedMission) {
        selectedMission = allMissions.find(m => m.operationalStage === 'EN_ROUTE');
      }
      // 4. Accepted next
      if (!selectedMission) {
        selectedMission = allMissions.find(m => m.operationalStage === 'ACCEPTED');
      }
      // 5. Assigned next
      if (!selectedMission) {
        selectedMission = allMissions.find(
          m => (m.decisionStatus || 'PENDING') === 'PENDING' && (m.status || '').toLowerCase() === 'assigned'
        );
      }
      // 6. Any other mission
      if (!selectedMission && allMissions.length > 0) {
        selectedMission = allMissions[0];
      }
    }

    renderActiveMissionBanner();
    if (selectedMission) {
      updateMapForMission(selectedMission);
    }
  }

  // Render the Active Mission Hero Banner
  function renderActiveMissionBanner() {
    const banner = document.getElementById('activeMissionBanner');
    if (!banner) return;

    if (!selectedMission) {
      banner.style.display = 'none';
      return;
    }

    banner.style.display = 'block';

    const stage = (selectedMission.operationalStage || 'ASSIGNED').toUpperCase();
    banner.className = `active-mission-banner ${stage.toLowerCase().replace(/_/g, '-')}`;

    // Title & Category
    const titleEl = document.getElementById('bannerMissionTitle');
    if (titleEl) {
      titleEl.textContent = `${selectedMission.categoryDisplayName || 'Incident Report'} #${selectedMission.id}`;
    }

    // Stage Badge
    const badgeEl = document.getElementById('bannerStageBadge');
    if (badgeEl) {
      const stageLabels = {
        ASSIGNED: 'New Assignment',
        ACCEPTED: 'Accepted &bull; Ready',
        EN_ROUTE: 'In Transit &bull; GPS Active',
        ON_SCENE: 'On Scene &bull; In Action',
        AWAITING_VERIFICATION: 'Awaiting Admin Review',
        FOLLOW_UP_REQUIRED: 'Follow-Up Required'
      };
      badgeEl.className = `mission-stage-badge ${stage.toLowerCase()}`;
      badgeEl.innerHTML = stageLabels[stage] || stage;
    }

    // Location & Coordinates
    const locEl = document.getElementById('bannerLocation');
    if (locEl) {
      locEl.textContent = selectedMission.locationDescription || 'Regional Sector';
    }

    const coordsEl = document.getElementById('bannerCoords');
    if (coordsEl) {
      if (selectedMission.latitude != null && selectedMission.longitude != null) {
        coordsEl.textContent = `${Number(selectedMission.latitude).toFixed(4)}, ${Number(selectedMission.longitude).toFixed(4)}`;
      } else {
        coordsEl.textContent = 'No GPS';
      }
    }

    // Straight-line Distance
    const distEl = document.getElementById('bannerDistance');
    if (distEl) {
      const teamLat = currentTeamCoords?.latitude ?? selectedMission.currentLatitude;
      const teamLng = currentTeamCoords?.longitude ?? selectedMission.currentLongitude;
      const dist = calculateDistanceKm(teamLat, teamLng, selectedMission.latitude, selectedMission.longitude);
      if (dist != null) {
        distEl.textContent = dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`;
      } else {
        distEl.textContent = '--';
      }
    }

    // Response Priority
    const prioEl = document.getElementById('bannerPriority');
    if (prioEl) {
      prioEl.textContent = selectedMission.assignedPriority || 'HIGH';
    }

    // Follow-up Alert Box
    const followUpBox = document.getElementById('bannerFollowUpBox');
    const followUpText = document.getElementById('bannerFollowUpText');
    if (followUpBox && followUpText) {
      if (stage === 'FOLLOW_UP_REQUIRED' || selectedMission.adminFollowUpNotes) {
        followUpBox.style.display = 'flex';
        followUpText.textContent = selectedMission.adminFollowUpNotes || 'Administrator requested further verification and on-site evaluation.';
      } else {
        followUpBox.style.display = 'none';
      }
    }

    // GPS Telemetry Pill
    const gpsPill = document.getElementById('bannerGpsPill');
    if (gpsPill) {
      const isTracking = Boolean(selectedMission.isTrackingActive || geoWatchId);
      const acc = currentTeamCoords?.accuracy ?? selectedMission.currentAccuracy ?? 12;
      const isStale = selectedMission.isLocationStale || (lastGpsPingTime && Date.now() - lastGpsPingTime > 60000);

      if (isTracking) {
        gpsPill.className = isStale ? 'telemetry-pill stale' : 'telemetry-pill';
        gpsPill.innerHTML = isStale
          ? `⚠️ GPS Telemetry Stale (>60s)`
          : `<span class="pulse-dot"></span> GPS Active (±${Math.round(acc)}m)`;
      } else {
        gpsPill.className = 'telemetry-pill';
        gpsPill.innerHTML = `GPS Standby`;
      }
    }

    // Description, Instructions, Photos, and Assigned At (Requirement 1.4)
    const descEl = document.getElementById('bannerDescription');
    if (descEl) {
      descEl.textContent = selectedMission.description || 'No written description provided by citizen.';
    }

    const instrEl = document.getElementById('bannerInstructions');
    if (instrEl) {
      if (selectedMission.instructions) {
        instrEl.style.display = 'block';
        instrEl.innerHTML = `<strong>Operational Objectives:</strong> ${escapeHtml(selectedMission.instructions)}`;
      } else {
        instrEl.style.display = 'none';
      }
    }

    const assignedAtEl = document.getElementById('bannerAssignedAt');
    if (assignedAtEl) {
      const dt = selectedMission.assignedAt || selectedMission.reportedTimestamp;
      assignedAtEl.textContent = dt ? `Assigned: ${new Date(dt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • ${new Date(dt).toLocaleDateString()}` : 'Assigned: Just now';
    }

    const photosContainer = document.getElementById('bannerPhotosContainer');
    if (photosContainer) {
      const photos = selectedMission.photos || [];
      if (photos.length > 0) {
        photosContainer.innerHTML = photos.map(p => {
          const url = p.photoUrl || p.fileUrl || (p.id ? `/api/reports/${selectedMission.id}/photos/${p.id}` : '');
          return url ? `
            <div style="position: relative; width: 64px; height: 64px; border-radius: 4px; overflow: hidden; border: 1px solid var(--rescue-forest); cursor: pointer;" onclick="window.open('${escapeHtml(url)}', '_blank')">
              <img src="${escapeHtml(url)}" alt="Incident Photo" style="width: 100%; height: 100%; object-fit: cover;" />
            </div>
          ` : '';
        }).join('');
      } else {
        photosContainer.innerHTML = `<span style="font-size: 0.75rem; color: var(--rescue-text-muted);">No citizen photos attached.</span>`;
      }
    }

    // Action Buttons based on Stage
    renderBannerActionButtons(stage);
  }

  function renderBannerActionButtons(stage) {
    const btnContainer = document.getElementById('bannerActionButtons');
    if (!btnContainer) return;

    btnContainer.innerHTML = '';

    if (stage === 'ASSIGNED') {
      const btnAccept = document.createElement('button');
      btnAccept.className = 'btn-primary';
      btnAccept.innerHTML = `<span>Accept Mission</span>`;
      btnAccept.onclick = () => handleAcceptMission(selectedMission.id);

      const btnDecline = document.createElement('button');
      btnDecline.className = 'btn-danger-outline';
      btnDecline.innerHTML = `<span>Decline...</span>`;
      btnDecline.onclick = () => openDeclineModal(selectedMission);

      btnContainer.appendChild(btnAccept);
      btnContainer.appendChild(btnDecline);
    } else if (stage === 'ACCEPTED') {
      const btnStart = document.createElement('button');
      btnStart.className = 'btn-primary';
      btnStart.innerHTML = `<span>Start Journey & Activate GPS</span>`;
      btnStart.onclick = () => handleStartJourney(selectedMission.id);

      btnContainer.appendChild(btnStart);
    } else if (stage === 'EN_ROUTE') {
      const btnArrive = document.createElement('button');
      btnArrive.className = 'btn-forest';
      btnArrive.innerHTML = `<span>Arrived on Scene</span>`;
      btnArrive.onclick = () => handleMarkArrival(selectedMission.id);

      const btnPing = document.createElement('button');
      btnPing.className = 'btn-outline';
      btnPing.innerHTML = `<span>Update GPS Ping</span>`;
      btnPing.onclick = () => pingCurrentGps(selectedMission.id);

      btnContainer.appendChild(btnArrive);
      btnContainer.appendChild(btnPing);
    } else if (stage === 'ON_SCENE' || stage === 'FOLLOW_UP_REQUIRED') {
      const btnProgress = document.createElement('button');
      btnProgress.className = 'btn-outline';
      btnProgress.innerHTML = `<span>Log Field Progress</span>`;
      btnProgress.onclick = () => openProgressModal(selectedMission);

      const btnOutcome = document.createElement('button');
      btnOutcome.className = 'btn-primary';
      btnOutcome.innerHTML = `<span>Submit Final Outcome</span>`;
      btnOutcome.onclick = () => openOutcomeModal(selectedMission);

      btnContainer.appendChild(btnProgress);
      btnContainer.appendChild(btnOutcome);
    } else if (stage === 'AWAITING_VERIFICATION') {
      const btnView = document.createElement('button');
      btnView.className = 'btn-outline';
      btnView.innerHTML = `<span>View Submitted Outcome</span>`;
      btnView.onclick = () => openDetailsModal(selectedMission);

      const notice = document.createElement('span');
      notice.style.fontSize = '0.75rem';
      notice.style.color = 'var(--rescue-text-muted)';
      notice.textContent = 'Transmitted to SDMA for verification & formal completion.';

      btnContainer.appendChild(btnView);
      btnContainer.appendChild(notice);
    }
  }

  // Render Missions List Cards
  function renderMissionsList() {
    const listEl = document.getElementById('missionsList');
    if (!listEl) return;

    let filtered = [...allMissions];

    // Filter by Active Tab
    if (activeFilter === 'new') {
      filtered = filtered.filter(
        m => (m.decisionStatus || 'PENDING') === 'PENDING' && (m.status || '').toLowerCase() === 'assigned'
      );
    } else if (activeFilter === 'transit') {
      filtered = filtered.filter(m => (m.operationalStage || '').toUpperCase() === 'EN_ROUTE');
    } else if (activeFilter === 'scene') {
      filtered = filtered.filter(m => (m.operationalStage || '').toUpperCase() === 'ON_SCENE');
    } else if (activeFilter === 'review') {
      filtered = filtered.filter(
        m => (m.operationalStage || '').toUpperCase() === 'AWAITING_VERIFICATION' || (m.status || '').toLowerCase() === 'under review'
      );
    } else if (activeFilter === 'followup') {
      filtered = filtered.filter(
        m => (m.operationalStage || '').toUpperCase() === 'FOLLOW_UP_REQUIRED' || Boolean(m.adminFollowUpNotes)
      );
    }

    // Filter by Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(m => {
        const cat = (m.categoryDisplayName || m.incidentCategory || '').toLowerCase();
        const loc = (m.locationDescription || '').toLowerCase();
        const desc = (m.description || '').toLowerCase();
        const id = String(m.id || '');
        return cat.includes(q) || loc.includes(q) || desc.includes(q) || id.includes(q);
      });
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div class="rescue-empty-state">
          <div class="rescue-empty-icon">📋</div>
          <div class="rescue-empty-title">No Missions Found</div>
          <div>No missions matching current criteria.</div>
        </div>
      `;
      return;
    }

    listEl.innerHTML = filtered
      .map(m => {
        const isSelected = selectedMission && String(selectedMission.id) === String(m.id);
        const stage = (m.operationalStage || 'ASSIGNED').toUpperCase();
        const severity = (m.assignedPriority || 'HIGH').toLowerCase();
        const dateStr = m.assignedAt || m.reportedTimestamp ? new Date(m.assignedAt || m.reportedTimestamp).toLocaleDateString() : '--';

        const teamLat = currentTeamCoords?.latitude ?? m.currentLatitude;
        const teamLng = currentTeamCoords?.longitude ?? m.currentLongitude;
        const dist = calculateDistanceKm(teamLat, teamLng, m.latitude, m.longitude);
        const distText = dist != null ? (dist < 1 ? `${Math.round(dist * 1000)} m` : `${dist.toFixed(1)} km`) : '--';

        return `
          <div class="mission-card ${isSelected ? 'selected' : ''}" data-mission-id="${escapeHtml(m.id)}">
            <div class="mission-card-top">
              <span class="mission-card-category">${escapeHtml(m.categoryDisplayName || 'Incident')} #${escapeHtml(m.id)}</span>
              <div class="mission-card-meta">
                <span class="severity-pill ${severity}">${escapeHtml(severity)}</span>
                <span class="mission-stage-badge ${stage.toLowerCase()}">${escapeHtml(stage.replace(/_/g, ' '))}</span>
              </div>
            </div>
            <div class="mission-card-desc">${escapeHtml(m.description || m.instructions || 'No details provided.')}</div>
            <div class="mission-card-footer">
              <span class="mission-card-distance">📍 ${escapeHtml(m.locationDescription || 'Slope Sector')} (${distText})</span>
              <div class="mission-card-actions">
                <button type="button" class="btn-outline btn-sm" data-action="details" data-mission-id="${escapeHtml(m.id)}">Details</button>
              </div>
            </div>
          </div>
        `;
      })
      .join('');

    // Wire Card Click Listeners
    listEl.querySelectorAll('.mission-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="details"]')) return;
        const mId = card.dataset.missionId;
        const mission = allMissions.find(m => String(m.id) === String(mId));
        if (mission) {
          selectedMission = mission;
          renderActiveMissionBanner();
          renderMissionsList();
          updateMapForMission(mission);
        }
      });
    });

    listEl.querySelectorAll('[data-action="details"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mId = btn.dataset.missionId;
        const mission = allMissions.find(m => String(m.id) === String(mId));
        if (mission) openDetailsModal(mission);
      });
    });
  }

  // Handle Accept Mission
  async function handleAcceptMission(missionId) {
    if (!missionId) return;
    try {
      if (window.LW?.ui?.toast) window.LW.ui.toast('Accepting mission assignment...', 'info');
      await window.LW.reportsStorage.acceptMission(missionId, currentUser);
      if (window.LW?.ui?.toast) window.LW.ui.toast('Mission accepted. Prepare for departure.', 'success');
      await loadMissions();
    } catch (e) {
      if (window.LW?.ui?.toast) window.LW.ui.toast(e.message || 'Failed to accept mission', 'error');
    }
  }

  // Show/Hide GPS Permission & Telemetry Alert Box
  function showGpsAlert(type, title, message, showRetry, missionId = null) {
    const alertBox = document.getElementById('bannerGpsAlertBox');
    const titleEl = document.getElementById('bannerGpsAlertTitle');
    const msgEl = document.getElementById('bannerGpsAlertMsg');
    const iconEl = document.getElementById('bannerGpsAlertIcon');
    const retryBtn = document.getElementById('btnRetryGps');
    if (!alertBox || !titleEl || !msgEl) return;

    alertBox.style.display = 'block';
    if (type === 'error') {
      alertBox.style.backgroundColor = '#FEF2F2';
      alertBox.style.border = '1px solid #FCA5A5';
      alertBox.style.color = '#991B1B';
      if (iconEl) iconEl.textContent = '⚠️';
    } else if (type === 'success') {
      alertBox.style.backgroundColor = '#F0FDF4';
      alertBox.style.border = '1px solid #86EFAC';
      alertBox.style.color = '#166534';
      if (iconEl) iconEl.textContent = '📍';
    } else {
      alertBox.style.backgroundColor = '#FAF8F2';
      alertBox.style.border = '1px solid #D9C9B2';
      alertBox.style.color = '#2E3A2F';
      if (iconEl) iconEl.textContent = 'ℹ️';
    }

    titleEl.textContent = title;
    msgEl.textContent = message;

    if (retryBtn) {
      if (showRetry && missionId) {
        retryBtn.style.display = 'inline-block';
        retryBtn.onclick = () => {
          retryBtn.style.display = 'none';
          startGeolocationTracking(missionId);
        };
      } else {
        retryBtn.style.display = 'none';
      }
    }
  }

  // Handle Start Journey & Activate Geolocation
  async function handleStartJourney(missionId) {
    if (!missionId) return;

    // Show explicit explanation of why device location permission is requested
    showGpsAlert(
      'info',
      'Location Tracking Protocol',
      'SlopeGuard requires device GPS access to stream live mission telemetry to the SDMA Operations Center during active transit.',
      false
    );

    try {
      if (window.LW?.ui?.toast) window.LW.ui.toast('Activating GPS tracking and journey protocol...', 'info');
      await window.LW.reportsStorage.startJourney(missionId, currentUser);

      // Start Browser Geolocation Tracking
      startGeolocationTracking(missionId);

      if (window.LW?.ui?.toast) window.LW.ui.toast('Journey started. Transmitting GPS tracking telemetry.', 'success');
      await loadMissions();
    } catch (e) {
      if (window.LW?.ui?.toast) window.LW.ui.toast(e.message || 'Failed to start journey', 'error');
    }
  }

  // Start Real Browser Geolocation API Watch (No fabricated/invented coordinates)
  function startGeolocationTracking(missionId) {
    if (geoWatchId) {
      navigator.geolocation.clearWatch(geoWatchId);
      geoWatchId = null;
    }

    if (!('geolocation' in navigator)) {
      showGpsAlert(
        'error',
        'Geolocation Unsupported',
        'The Geolocation API is not supported by your current browser or device environment.',
        false
      );
      return;
    }

    geoWatchId = navigator.geolocation.watchPosition(
      position => {
        const { latitude, longitude, accuracy, speed, heading } = position.coords;
        currentTeamCoords = { latitude, longitude, accuracy: accuracy || 10 };
        lastGpsPingTime = Date.now();

        showGpsAlert(
          'success',
          'GPS Live Telemetry Active',
          `Broadcasting live position (${latitude.toFixed(4)}, ${longitude.toFixed(4)}) with ±${Math.round(accuracy || 10)}m accuracy.`,
          false
        );

        // Transmit real verified coordinates to backend
        window.LW.reportsStorage.recordLocationUpdate(missionId, {
          latitude,
          longitude,
          accuracy: accuracy || 10,
          speed: speed || 0,
          heading: heading || 0,
          timestamp: new Date().toISOString()
        });

        // Update UI & Map
        if (selectedMission && String(selectedMission.id) === String(missionId)) {
          selectedMission.currentLatitude = latitude;
          selectedMission.currentLongitude = longitude;
          selectedMission.currentAccuracy = accuracy;
          selectedMission.isLocationStale = false;
          updateMapForMission(selectedMission);
          renderActiveMissionBanner();
        }
      },
      error => {
        console.warn('[rescue-dashboard] Geolocation error:', error.message);
        let errorMsg = 'Unable to acquire GPS coordinates from device.';
        if (error.code === 1) { // PERMISSION_DENIED
          errorMsg = 'Location permission was denied. Please allow location permissions in your browser address bar settings to transmit live coordinates.';
        } else if (error.code === 2) { // POSITION_UNAVAILABLE
          errorMsg = 'GPS location is currently unavailable or device signal is weak.';
        } else if (error.code === 3) { // TIMEOUT
          errorMsg = 'GPS location request timed out waiting for device satellite lock.';
        }

        showGpsAlert('error', 'GPS Tracking Interrupted', errorMsg, true, missionId);
        if (window.LW?.ui?.toast) window.LW.ui.toast(errorMsg, 'error');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000
      }
    );
  }

  // Manual GPS Ping Trigger
  async function pingCurrentGps(missionId) {
    if (!missionId) return;
    if (window.LW?.ui?.toast) window.LW.ui.toast('Acquiring current GPS telemetry ping...', 'info');

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async pos => {
          const { latitude, longitude, accuracy } = pos.coords;
          currentTeamCoords = { latitude, longitude, accuracy };
          lastGpsPingTime = Date.now();
          await window.LW.reportsStorage.recordLocationUpdate(missionId, {
            latitude,
            longitude,
            accuracy: accuracy || 10,
            timestamp: new Date().toISOString()
          });
          if (window.LW?.ui?.toast) window.LW.ui.toast(`GPS telemetry recorded: ±${Math.round(accuracy)}m`, 'success');
          await loadMissions();
        },
        err => {
          const msg = err.code === 1 ? 'Location permission was denied by browser.' : (err.message || 'GPS signal unavailable');
          showGpsAlert('error', 'GPS Ping Failed', msg, true, missionId);
          if (window.LW?.ui?.toast) window.LW.ui.toast(`GPS update failed: ${msg}`, 'error');
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    } else {
      showGpsAlert('error', 'GPS Unavailable', 'Geolocation API is not supported in this browser.', false);
    }
  }

  // Handle Arrival on Scene
  async function handleMarkArrival(missionId) {
    if (!missionId) return;
    try {
      if (window.LW?.ui?.toast) window.LW.ui.toast('Marking arrival on scene...', 'info');
      await window.LW.reportsStorage.markArrival(missionId, currentUser);
      if (window.LW?.ui?.toast) window.LW.ui.toast('Status updated: ON SCENE. Conduct field assessment.', 'success');
      await loadMissions();
    } catch (e) {
      if (window.LW?.ui?.toast) window.LW.ui.toast(e.message || 'Failed to mark arrival', 'error');
    }
  }

  // ==========================================================================
  // Modal Handlers
  // ==========================================================================

  // Decline Modal
  function openDeclineModal(mission) {
    const modal = document.getElementById('declineModal');
    const form = document.getElementById('declineForm');
    const textarea = document.getElementById('declineReason');
    if (!modal || !form || !textarea) return;

    textarea.value = '';
    form.onsubmit = async (e) => {
      e.preventDefault();
      const reason = textarea.value.trim();
      if (!reason) {
        if (window.LW?.ui?.toast) window.LW.ui.toast('A mandatory decline reason must be provided.', 'error');
        return;
      }

      try {
        await window.LW.reportsStorage.declineMission(mission.id, reason, currentUser);
        closeModal('declineModal');
        if (window.LW?.ui?.toast) window.LW.ui.toast('Mission assignment declined.', 'info');
        await loadMissions();
      } catch (err) {
        if (window.LW?.ui?.toast) window.LW.ui.toast(err.message || 'Failed to decline mission', 'error');
      }
    };

    modal.classList.add('active');
  }

  // Progress Update Modal
  function openProgressModal(mission) {
    const modal = document.getElementById('progressModal');
    const form = document.getElementById('progressForm');
    if (!modal || !form) return;

    uploadedPhotos = [];
    renderPhotoPreviews();

    form.reset();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const assessment = document.getElementById('progressAssessment').value.trim();
      const passability = document.getElementById('progressPassability').value;
      const actions = document.getElementById('progressActions').value.trim();
      const resources = document.getElementById('progressResources').value.trim();

      // Collect checked hazards
      const hazardCheckboxes = form.querySelectorAll('input[name="hazards"]:checked');
      const hazards = Array.from(hazardCheckboxes).map(cb => cb.value).join(', ');

      if (!assessment) {
        if (window.LW?.ui?.toast) window.LW.ui.toast('Site assessment findings are required.', 'error');
        return;
      }

      try {
        await window.LW.reportsStorage.submitProgressUpdate(mission.id, {
          siteAssessment: assessment,
          roadPassability: passability,
          observedHazards: hazards,
          actionsTaken: actions,
          resourcesRequired: resources
        }, currentUser);

        closeModal('progressModal');
        if (window.LW?.ui?.toast) window.LW.ui.toast('Field progress update transmitted to Operations Center.', 'success');
        await loadMissions();
      } catch (err) {
        if (window.LW?.ui?.toast) window.LW.ui.toast(err.message || 'Failed to record progress', 'error');
      }
    };

    modal.classList.add('active');
  }

  // Submit Final Outcome Modal (Transfers to Admin for Verification)
  function openOutcomeModal(mission) {
    const modal = document.getElementById('outcomeModal');
    const form = document.getElementById('outcomeForm');
    if (!modal || !form) return;

    form.reset();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const summary = document.getElementById('outcomeSummary').value.trim();
      const casualties = parseInt(document.getElementById('outcomeCasualties').value, 10) || 0;
      const evacuations = parseInt(document.getElementById('outcomeEvacuations').value, 10) || 0;
      const infrastructure = document.getElementById('outcomeInfrastructure').value.trim();
      const followUp = document.getElementById('outcomeFollowUp').value.trim();

      if (!summary) {
        if (window.LW?.ui?.toast) window.LW.ui.toast('Resolution summary is required.', 'error');
        return;
      }

      try {
        await window.LW.reportsStorage.submitOutcomeForVerification(mission.id, {
          resolutionSummary: summary,
          casualtiesReported: casualties,
          evacuationsConducted: evacuations,
          infrastructureStatus: infrastructure,
          recommendedFollowUp: followUp
        }, currentUser);

        // Stop geolocation watch once mission outcome is submitted
        if (geoWatchId) {
          navigator.geolocation.clearWatch(geoWatchId);
          geoWatchId = null;
        }

        closeModal('outcomeModal');
        if (window.LW?.ui?.toast) {
          window.LW.ui.toast('Outcome submitted. Transferred to SDMA for administrative verification.', 'success');
        }
        await loadMissions();
      } catch (err) {
        if (window.LW?.ui?.toast) window.LW.ui.toast(err.message || 'Failed to submit outcome', 'error');
      }
    };

    modal.classList.add('active');
  }

  // Mission Details Modal
  function openDetailsModal(mission) {
    const modal = document.getElementById('detailsModal');
    const body = document.getElementById('detailsModalBody');
    if (!modal || !body) return;

    const stage = (mission.operationalStage || 'ASSIGNED').toUpperCase();
    const dateStr = mission.reportedTimestamp ? new Date(mission.reportedTimestamp).toLocaleString() : '--';

    let photosHtml = '<p style="color:var(--rescue-text-muted); font-size:0.8125rem;">No citizen photos attached.</p>';
    if (Array.isArray(mission.photos) && mission.photos.length > 0) {
      photosHtml = `
        <div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:8px;">
          ${mission.photos
            .map(p => {
              const url = p.url || p.previewUrl || '';
              return `<img src="${escapeHtml(url)}" style="width:90px; height:90px; object-fit:cover; border-radius:4px; border:1px solid #D9C9B2; cursor:pointer;" onclick="window.open('${escapeHtml(url)}','_blank')" />`;
            })
            .join('')}
        </div>
      `;
    }

    let progressHtml = '<p style="color:var(--rescue-text-muted); font-size:0.8125rem;">No progress updates logged yet.</p>';
    if (Array.isArray(mission.progressHistory) && mission.progressHistory.length > 0) {
      progressHtml = mission.progressHistory
        .map(h => `
          <div style="padding:8px 12px; background:#FAF8F2; border:1px solid #D9C9B2; border-radius:4px; margin-bottom:8px; font-size:0.8125rem;">
            <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
              <strong style="color:#2E3A2F;">${escapeHtml(h.actor || 'Team')}</strong>
              <span style="color:#6E806B; font-size:0.75rem;">${new Date(h.timestamp).toLocaleTimeString()}</span>
            </div>
            <div>${escapeHtml(h.siteAssessment)}</div>
            ${h.roadPassability ? `<div style="font-size:0.75rem; color:#C96F4F; margin-top:4px;">Road: ${escapeHtml(h.roadPassability)}</div>` : ''}
          </div>
        `)
        .join('');
    }

    body.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #D9C9B2; padding-bottom:12px;">
        <div>
          <h3 style="margin:0; color:#2E3A2F; font-size:1.1rem;">${escapeHtml(mission.categoryDisplayName || 'Incident')} #${escapeHtml(mission.id)}</h3>
          <div style="font-size:0.75rem; color:#6E806B; margin-top:2px;">Reported: ${escapeHtml(dateStr)}</div>
        </div>
        <span class="mission-stage-badge ${stage.toLowerCase()}">${escapeHtml(stage.replace(/_/g, ' '))}</span>
      </div>

      <div style="margin-top:12px;">
        <div class="form-label">Location & Coordinates</div>
        <div style="font-size:0.875rem; color:#2E3A2F; font-weight:600;">${escapeHtml(mission.locationDescription || 'Regional Sector')}</div>
        <div style="font-family:'JetBrains Mono',monospace; font-size:0.75rem; color:#4A5D48; margin-top:2px;">
          ${mission.latitude != null && mission.longitude != null ? `${Number(mission.latitude).toFixed(4)}, ${Number(mission.longitude).toFixed(4)}` : 'Coordinates unavailable'}
        </div>
      </div>

      <div style="margin-top:12px;">
        <div class="form-label">Citizen Description</div>
        <div style="font-size:0.875rem; color:#4A5D48; line-height:1.5;">${escapeHtml(mission.description || 'No written description provided.')}</div>
      </div>

      <div style="margin-top:12px;">
        <div class="form-label">Attached Field Photos</div>
        ${photosHtml}
      </div>

      <div style="margin-top:12px;">
        <div class="form-label">Operations Center Instructions</div>
        <div style="padding:10px 14px; background:#FAF8F2; border-left:3px solid #6B7F5B; border-radius:4px; font-size:0.8125rem; color:#2E3A2F;">
          ${escapeHtml(mission.instructions || 'Inspect site stability and report road passability.')}
        </div>
      </div>

      <div style="margin-top:12px;">
        <div class="form-label">Field Progress Updates</div>
        ${progressHtml}
      </div>
    `;

    modal.classList.add('active');
  }

  // Emergency Contacts Modal
  function openContactsModal() {
    const modal = document.getElementById('contactsModal');
    if (modal) modal.classList.add('active');
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
  }

  // Photo Upload & Preview
  function renderPhotoPreviews() {
    const container = document.getElementById('photoPreviews');
    if (!container) return;

    container.innerHTML = uploadedPhotos
      .map(
        (p, idx) => `
        <div class="photo-thumbnail-card">
          <img src="${p.dataUrl}" alt="Evidence" />
          <button type="button" class="photo-remove-btn" onclick="window.removeRescuePhoto(${idx})">&times;</button>
        </div>
      `
      )
      .join('');
  }

  window.removeRescuePhoto = function (index) {
    uploadedPhotos.splice(index, 1);
    renderPhotoPreviews();
  };

  function setupPhotoUpload() {
    const fileInput = document.getElementById('photoFileInput');
    const dropZone = document.getElementById('photoDropZone');
    if (!fileInput || !dropZone) return;

    dropZone.onclick = () => fileInput.click();

    fileInput.onchange = e => {
      const files = Array.from(e.target.files || []);
      files.forEach(file => {
        if (!file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = evt => {
          uploadedPhotos.push({
            name: file.name,
            dataUrl: evt.target.result
          });
          renderPhotoPreviews();
        };
        reader.readAsDataURL(file);
      });
    };
  }

  // Wire UI Controls
  function initControls() {
    // Search input
    const searchInput = document.getElementById('missionSearch');
    if (searchInput) {
      searchInput.addEventListener('input', e => {
        searchQuery = e.target.value;
        renderMissionsList();
      });
    }

    // Filter pills
    document.querySelectorAll('.rescue-filter-pills .filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.rescue-filter-pills .filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        activeFilter = pill.dataset.filter || 'all';
        renderMissionsList();
      });
    });

    // KPI Cards click to filter
    const kpiMap = {
      kpiNew: 'new',
      kpiTransit: 'transit',
      kpiScene: 'scene',
      kpiReview: 'review',
      kpiFollowup: 'followup'
    };
    Object.keys(kpiMap).forEach(kpiId => {
      const card = document.getElementById(kpiId);
      if (card) {
        card.addEventListener('click', () => {
          activeFilter = kpiMap[kpiId];
          document.querySelectorAll('.rescue-filter-pills .filter-pill').forEach(p => {
            if (p.dataset.filter === activeFilter) p.classList.add('active');
            else p.classList.remove('active');
          });
          renderMissionsList();
        });
      }
    });

    // Preset decline chips
    document.querySelectorAll('.preset-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const textarea = document.getElementById('declineReason');
        if (textarea) {
          textarea.value = chip.textContent.trim();
          textarea.focus();
        }
      });
    });

    // Emergency quick-call button
    const sosBtn = document.getElementById('btnEmergencyHelp');
    if (sosBtn) {
      sosBtn.addEventListener('click', openContactsModal);
    }

    // Modal close buttons
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.getAttribute('data-close-modal');
        closeModal(modalId);
      });
    });

    // Sign out button
    const logoutBtn = document.getElementById('btnSignOut');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        sessionStorage.removeItem('sg_user');
        sessionStorage.removeItem('sg_token');
        localStorage.removeItem('sg_user');
        localStorage.removeItem('sg_token');
        window.location.replace('login.html');
      });
    }

    // Recenter map buttons
    const btnCenterIncident = document.getElementById('btnCenterIncident');
    if (btnCenterIncident) {
      btnCenterIncident.addEventListener('click', () => {
        if (leafletMap && selectedMission && selectedMission.latitude != null) {
          leafletMap.setView([selectedMission.latitude, selectedMission.longitude], 14);
        }
      });
    }

    const btnCenterTeam = document.getElementById('btnCenterTeam');
    if (btnCenterTeam) {
      btnCenterTeam.addEventListener('click', () => {
        const lat = currentTeamCoords?.latitude ?? selectedMission?.currentLatitude;
        const lng = currentTeamCoords?.longitude ?? selectedMission?.currentLongitude;
        if (leafletMap && lat != null && lng != null) {
          leafletMap.setView([lat, lng], 14);
        }
      });
    }

    // Duty Toggle Switch
    const dutyBtn = document.getElementById('btnDutyToggle');
    if (dutyBtn) {
      dutyBtn.addEventListener('click', () => {
        const isOnDuty = dutyBtn.getAttribute('data-duty') === 'on';
        if (isOnDuty) {
          dutyBtn.setAttribute('data-duty', 'off');
          dutyBtn.innerHTML = `<span>Off Duty</span>`;
          dutyBtn.style.background = '#6E806B';
          if (window.LW?.ui?.toast) window.LW.ui.toast('Status set to Off Duty.', 'info');
        } else {
          dutyBtn.setAttribute('data-duty', 'on');
          dutyBtn.innerHTML = `<span>On Duty</span>`;
          dutyBtn.style.background = 'var(--rescue-forest)';
          if (window.LW?.ui?.toast) window.LW.ui.toast('Status set to On Duty & Ready.', 'success');
        }
      });
    }

    setupPhotoUpload();
  }

  // Periodic Telemetry Stale Checker (every 10 seconds)
  setInterval(() => {
    if (selectedMission) {
      const isStale = selectedMission.isLocationStale || (lastGpsPingTime && Date.now() - lastGpsPingTime > 60000);
      const gpsPill = document.getElementById('bannerGpsPill');
      if (gpsPill && (selectedMission.isTrackingActive || geoWatchId)) {
        if (isStale) {
          gpsPill.className = 'telemetry-pill stale';
          gpsPill.innerHTML = `⚠️ GPS Telemetry Stale (>60s)`;
        }
      }
    }
  }, 10000);

  // Initialize on DOM Ready
  document.addEventListener('DOMContentLoaded', async () => {
    if (!initAuthGuard()) return;
    initMap();
    initControls();
    await loadMissions();

    // Listen to storage sync events
    if (window.LW?.reportsStorage?.onSync) {
      window.LW.reportsStorage.onSync(() => {
        loadMissions(false);
      });
    }

    // Live continuous 3-second mission polling for immediate assignment delivery (Requirement 1.6)
    setInterval(() => {
      loadMissions(true);
    }, 3000);
  });
})();
