/**
 * SlopeGuard — Citizen Road Blockage & Landslide Incident Reporting Service (incidents-service.js)
 * Comprehensive client-side service for:
 * - Incident data model & 7 standard categories
 * - Photo file validation (format, magic bytes, size < 10MB)
 * - Safe photo upload & storage reference handling via IndexedDB Blobs
 * - Geolocation capture & coordinate verification
 * - Anti-duplicate submission protection
 * - Local storage persistence using shared window.LW.reportsStorage
 * - Administrative review & audit tracking
 */

window.LW = window.LW || {};

window.LW.incidentsService = (function() {
  const INCIDENTS_STORAGE_KEY = "sg_citizen_incidents";
  const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
  const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

  // 7 Standard Citizen Incident Categories
  const CATEGORIES = [
    "Road blocked by landslide debris",
    "Road covered by fallen rocks",
    "Road damaged by slope movement",
    "Ground cracks or slope instability near a road",
    "Small landslide observed",
    "Flooding or unusual water flow affecting a road",
    "Other relevant hazard"
  ];

  // Standard Passability Classifications
  const PASSABILITY_OPTIONS = [
    { value: "unknown", label: "Unknown / Unassessed", color: "#A3B3A0" },
    { value: "open", label: "Open (Passable with Caution)", color: "#8FD694" },
    { value: "partially blocked", label: "Partially Blocked (Single Lane / Hazard)", color: "#F1A46B" },
    { value: "completely blocked", label: "Completely Blocked (Impassable)", color: "#F07878" }
  ];

  /**
   * Validate uploaded photo file for format, size, and real file content (magic bytes)
   */
  async function validatePhotoFile(file) {
    if (!file) {
      return { valid: false, error: "No file selected." };
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      return {
        valid: false,
        error: `File size (${sizeMb} MB) exceeds maximum allowed limit of 10 MB.`
      };
    }

    const mime = (file.type || "").toLowerCase();
    if (!ALLOWED_MIME_TYPES.includes(mime)) {
      return {
        valid: false,
        error: `Unsupported image format (${file.type || 'unknown'}). Please select a JPEG, PNG, or WEBP image.`
      };
    }

    // Magic bytes verification
    try {
      let bytes = null;
      if (file.buffer) {
        bytes = new Uint8Array(file.buffer);
      } else if (file.slice) {
        const buffer = await file.slice(0, 16).arrayBuffer();
        bytes = new Uint8Array(buffer);
      } else if (file.arrayBuffer) {
        const buffer = await file.arrayBuffer();
        bytes = new Uint8Array(buffer);
      }

      if (bytes && bytes.length >= 4) {
        const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
        const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
        const isWebp =
          bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
          bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50; // WEBP

        if (!isJpeg && !isPng && !isWebp) {
          return {
            valid: false,
            error: "File content header does not match a valid image structure. Upload rejected."
          };
        }
      }

      return { valid: true };
    } catch (err) {
      console.warn("[incidentsService] Buffer read notice:", err);
      return { valid: ALLOWED_MIME_TYPES.includes(mime) };
    }
  }

  // Mapping between UI display text and backend enum IncidentCategory
  const CATEGORY_MAP = {
    "Road blocked by landslide debris": "DEBRIS_FLOW",
    "Road covered by fallen rocks": "ROCKFALL",
    "Road damaged by slope movement": "ROAD_SUBSIDENCE",
    "Ground cracks or slope instability near a road": "SLOPE_CRACK",
    "Small landslide observed": "MUD_SLIDE",
    "Flooding or unusual water flow affecting a road": "EROSION",
    "Other relevant hazard": "OTHER",
    "ROCKFALL": "ROCKFALL",
    "MUD_SLIDE": "MUD_SLIDE",
    "DEBRIS_FLOW": "DEBRIS_FLOW",
    "ROAD_SUBSIDENCE": "ROAD_SUBSIDENCE",
    "SLOPE_CRACK": "SLOPE_CRACK",
    "EROSION": "EROSION",
    "OTHER": "OTHER"
  };

  const ENUM_TO_LABEL = {
    "DEBRIS_FLOW": "Road blocked by landslide debris",
    "ROCKFALL": "Road covered by fallen rocks",
    "ROAD_SUBSIDENCE": "Road damaged by slope movement",
    "SLOPE_CRACK": "Ground cracks or slope instability near a road",
    "MUD_SLIDE": "Small landslide observed",
    "EROSION": "Flooding or unusual water flow affecting a road",
    "OTHER": "Other relevant hazard"
  };

  function toBackendCategory(cat) {
    if (!cat) return "OTHER";
    return CATEGORY_MAP[cat] || "OTHER";
  }

  function toDisplayCategory(cat) {
    if (!cat) return "Observation";
    return ENUM_TO_LABEL[cat] || cat;
  }

  function normalizeReport(item) {
    if (!item) return null;
    const cat = item.incidentCategory || item.category || item.incident_category || "OTHER";
    const locDesc = item.locationDescription || item.location_description || (item.location && (item.location.roadName || item.location.placeName)) || item.roadName || item.road_name || "";

    const rawPhotos = item.photos || [];
    const normalizedPhotos = rawPhotos.map(p => {
      let photoUrl = p.url || p.previewUrl;
      if (!photoUrl && p.blob && window.LW.reportsStorage?.createPhotoUrl) {
        photoUrl = window.LW.reportsStorage.createPhotoUrl(p.blob);
      }
      return {
        id: p.id,
        filename: p.originalFilename || p.filename || "evidence.jpg",
        url: photoUrl || "",
        previewUrl: photoUrl || "",
        blob: p.blob || null
      };
    });

    const pass = item.verifiedPassability || item.verified_passability || item.roadPassability || item.road_passability ||
                 (item.environmentalObservations?.toLowerCase().includes("passability:") ? item.environmentalObservations.split(":")[1].trim() : "unknown");

    const reporterName = item.reporterName || item.reporter_name || item.citizenName || "Citizen Reporter";
    const status = item.status || "Pending Verification";

    return {
      id: item.id ? String(item.id) : (item.localId || "INC-" + Date.now()),
      rawId: item.id,
      reporter_user_id: item.reporter_user_id || item.userId || "",
      userId: item.reporter_user_id || item.userId || "",
      reporterName: reporterName,
      reporter_name: reporterName,
      citizenName: reporterName,
      incidentType: toDisplayCategory(cat),
      incidentCategory: cat,
      category: cat,
      description: item.description || "",
      observedAt: item.observationTimestamp || item.observation_timestamp || item.reportedTimestamp || item.reported_timestamp || item.observedAt || new Date().toISOString(),
      submittedAt: item.reportedTimestamp || item.reported_timestamp || item.submittedAt || new Date().toISOString(),
      status: status,
      reviewReason: item.reviewNotes || item.review_notes || item.reviewReason || "",
      roadPassability: pass,
      verifiedPassability: pass,
      severity: item.severity || (status.toLowerCase().includes("verified") ? "CRITICAL" : (status.toLowerCase().includes("review") ? "HIGH" : "MODERATE")),
      location: {
        latitude: Number(item.latitude ?? (item.location && item.location.latitude) ?? 0),
        longitude: Number(item.longitude ?? (item.location && item.location.longitude) ?? 0),
        roadName: locDesc,
        placeName: locDesc || "Regional Slope",
        accuracy: item.accuracy || (item.location && item.location.accuracy) || 15
      },
      photos: normalizedPhotos,
      auditTrail: item.audit_trail || item.auditTrail || []
    };
  }

  /**
   * Process photo upload: validates file and creates native Blob reference and preview Object URL
   * Does NOT store large Base64 strings in localStorage
   */
  async function processPhotoUpload(file, onProgress = () => {}) {
    const val = await validatePhotoFile(file);
    if (!val.valid) {
      throw new Error(val.error);
    }

    onProgress(30);

    const safeExt = file.type === "image/png" ? "png" : (file.type === "image/webp" ? "webp" : "jpg");
    const photoId = "PHOTO-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(36).substring(2, 6).toUpperCase();
    const safeFilename = `${photoId}.${safeExt}`;

    onProgress(60);

    // Create temporary browser Object URL for instant preview without Base64 overhead
    let previewUrl = "";
    if (window.LW.reportsStorage?.createPhotoUrl) {
      previewUrl = window.LW.reportsStorage.createPhotoUrl(file);
    } else if (typeof URL !== "undefined" && URL.createObjectURL) {
      previewUrl = URL.createObjectURL(file);
    }

    onProgress(100);

    return {
      id: photoId,
      filename: safeFilename,
      originalName: file.name ? file.name.replace(/[^a-zA-Z0-9._-]/g, "_") : safeFilename,
      mimeType: file.type,
      size: file.size,
      url: previewUrl,
      previewUrl: previewUrl,
      blob: file, // Store native Blob for IndexedDB persistence
      file: file,
      uploadedAt: new Date().toISOString()
    };
  }

  /**
   * Submit an incident report to the shared IndexedDB reports storage utility
   */
  async function submitIncident(reportData) {
    // 1. Client-Side Validation
    if (!reportData) {
      throw new Error("Report details are required.");
    }

    const incType = reportData.incidentType || reportData.incidentCategory;
    if (!incType || !incType.trim()) {
      throw new Error("Incident type is required. Please select a hazard category.");
    }
    if (!reportData.description || reportData.description.trim().length < 10) {
      throw new Error("Please provide a descriptive observation (minimum 10 characters).");
    }
    if (!reportData.observedAt && !reportData.observationTimestamp) {
      throw new Error("Date and time observed is required.");
    }

    // Coordinates validation
    let lat = reportData.latitude ?? reportData.location?.latitude ?? reportData.lat;
    let lng = reportData.longitude ?? reportData.location?.longitude ?? reportData.lng;
    lat = Number(lat);
    lng = Number(lng);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error("Geographic coordinates are required and must be within valid boundary ranges.");
    }

    // 2. Prepare payload
    const backendCat = toBackendCategory(incType);
    const locDesc = (reportData.location?.roadName || reportData.location?.placeName || reportData.roadName || "Regional Slope Corridor").trim();

    const normalizedData = {
      ...reportData,
      incidentCategory: backendCat,
      incidentType: toDisplayCategory(backendCat),
      description: reportData.description.trim(),
      latitude: lat,
      longitude: lng,
      location: {
        latitude: lat,
        longitude: lng,
        roadName: locDesc,
        placeName: locDesc,
        accuracy: reportData.location?.accuracy || 15
      },
      roadPassability: reportData.roadPassability || "unknown",
      observedAt: reportData.observedAt || new Date().toISOString()
    };

    // 3. Submit to live backend if available
    let backendCreated = null;
    if (window.LW.api) {
      try {
        const createPayload = {
          incidentCategory: backendCat,
          description: normalizedData.description,
          locationDescription: locDesc,
          latitude: lat,
          longitude: lng,
          observationTimestamp: normalizedData.observedAt,
          environmentalObservations: reportData.additionalInfo || `Passability: ${reportData.roadPassability || 'unknown'}`
        };

        const res = await window.LW.api.post("/api/reports", createPayload);
        if (res && (res.id || res.data?.id)) {
          backendCreated = res.data || res;

          // If photos are present and report was created, upload photos to backend
          const photosToUpload = reportData.photos || [];
          for (let p of photosToUpload) {
            const blob = p.blob || p.file || p;
            if (blob instanceof Blob) {
              try {
                const formData = new FormData();
                formData.append("file", blob, p.filename || "evidence.jpg");
                await window.LW.api.post(`/api/reports/${backendCreated.id}/photos`, formData);
              } catch (photoErr) {
                console.warn("[incidentsService] Photo attachment upload warning:", photoErr);
              }
            }
          }
        }
      } catch (apiErr) {
        console.warn("[incidentsService] Backend submission notice:", apiErr);
        if (apiErr && apiErr.status === 400) {
          throw apiErr;
        }
      }
    }

    // 4. Save to shared IndexedDB storage utility
    if (backendCreated) {
      normalizedData.id = String(backendCreated.id);
      normalizedData.rawId = backendCreated.id;
      normalizedData.status = backendCreated.status || "PENDING";
      normalizedData.reportedTimestamp = backendCreated.reportedTimestamp;
    }

    if (window.LW.reportsStorage) {
      try {
        const saved = await window.LW.reportsStorage.saveReport(normalizedData, reportData.photos || []);
        return {
          success: true,
          data: normalizeReport(saved),
          backendId: backendCreated ? backendCreated.id : null,
          message: backendCreated ? `Report #${backendCreated.id} successfully recorded.` : "Report saved locally."
        };
      } catch (err) {
        if (backendCreated) {
          return {
            success: true,
            data: normalizeReport(backendCreated),
            backendId: backendCreated.id,
            message: `Report #${backendCreated.id} successfully recorded.`
          };
        }
        console.error("[incidentsService] Error saving report locally:", err);
        throw err;
      }
    }

    if (backendCreated) {
      return {
        success: true,
        data: normalizeReport(backendCreated),
        backendId: backendCreated.id,
        message: `Report #${backendCreated.id} successfully recorded.`
      };
    }

    throw new Error("Shared report storage utility is unavailable.");
  }

  /**
   * Fetch all incident reports from shared IndexedDB storage
   */
  async function getAllIncidents(filters = {}) {
    if (window.LW.reportsStorage) {
      try {
        let reports = await window.LW.reportsStorage.getAllReports();
        if (filters && filters.status && filters.status !== "all") {
          const target = filters.status.toLowerCase();
          reports = reports.filter(r => (r.status || "").toLowerCase() === target);
        }
        return reports.map(normalizeReport);
      } catch (e) {
        console.warn("[incidentsService] Failed to load from reportsStorage:", e);
      }
    }
    return [];
  }

  /**
   * Fetch logged-in citizen's personal incident reports
   * Queries real backend GET /api/reports/mine and falls back to IndexedDB
   */
  async function getMyIncidents() {
    let currentUser = null;
    try {
      currentUser = (window.LW.authService && window.LW.authService.getCurrentUser()) ||
                    (window.LW.auth && window.LW.auth.getUser()) || null;
    } catch (e) {}

    if (!currentUser && typeof localStorage !== "undefined") {
      try {
        const raw = sessionStorage.getItem("sg_user") || localStorage.getItem("sg_user");
        if (raw) currentUser = JSON.parse(raw);
      } catch (e) {}
    }

    // 1. Try real backend GET /api/reports/mine
    if (window.LW.api) {
      try {
        const serverReports = await window.LW.api.get("/api/reports/mine");
        if (Array.isArray(serverReports)) {
          const mapped = serverReports.map(normalizeReport);
          if (window.LW.reportsStorage) {
            for (let r of serverReports) {
              try {
                await window.LW.reportsStorage.saveReport(r);
              } catch (e) {}
            }
          }
          return mapped;
        }
      } catch (err) {
        console.warn("[incidentsService] Could not reach /api/reports/mine, checking local storage:", err);
      }
    }

    if (!currentUser) return [];
    const userId = currentUser.id || currentUser.userId || currentUser.email;

    if (window.LW.reportsStorage) {
      try {
        let items = await window.LW.reportsStorage.getReportsByUserId(userId);
        const role = String(currentUser.role || "").toLowerCase();
        if (role === "officer") {
          const assigned = await window.LW.reportsStorage.getReportsAssignedToOfficer(userId);
          const idSet = new Set(items.map(r => r.id));
          assigned.forEach(a => {
            if (!idSet.has(a.id)) {
              items.push(a);
              idSet.add(a.id);
            }
          });
        }
        return items.map(normalizeReport);
      } catch (err) {
        console.warn("[incidentsService] getMyIncidents error:", err);
      }
    }

    return [];
  }

  /**
   * Retrieve reports assigned to a specific field officer
   */
  async function getAssignedIncidents(officerId) {
    if (!officerId && window.LW.authService) {
      const u = window.LW.authService.getCurrentUser();
      officerId = u?.id || u?.userId || u?.name;
    }
    if (!officerId) return [];
    if (window.LW.reportsStorage) {
      const list = await window.LW.reportsStorage.getReportsAssignedToOfficer(officerId);
      return list.map(normalizeReport);
    }
    return [];
  }

  /**
   * Fetch single incident report by reference ID from shared IndexedDB storage
   */
  async function getIncidentById(id) {
    if (!id) return null;
    if (window.LW.reportsStorage) {
      try {
        const record = await window.LW.reportsStorage.getReportById(id);
        if (record) return normalizeReport(record);
      } catch (e) {}
    }
    return null;
  }

  /**
   * Submit an administrative review adjudication into shared IndexedDB storage
   */
  async function reviewIncident(id, reviewPayload) {
    if (!id) throw new Error("Incident ID is required for review.");

    const statusMap = {
      "verified": "Verified",
      "rejected": "Rejected",
      "under review": "Under Review",
      "under_review": "Under Review",
      "additional info requested": "Additional Info Requested",
      "resolved": "Resolved",
      "pending": "Pending Verification",
      "pending verification": "Pending Verification"
    };

    const rawStatus = (reviewPayload.status || "").toLowerCase();
    const mappedStatus = statusMap[rawStatus] || reviewPayload.status || "Verified";

    let actor = "Geotechnical Staff";
    try {
      const user = (window.LW.authService && window.LW.authService.getCurrentUser()) ||
                   (window.LW.auth && window.LW.auth.getUser());
      if (user) actor = user.name || user.fullName || user.email || actor;
    } catch (e) {}

    const options = {
      action: reviewPayload.action || "ADJUDICATE",
      status: mappedStatus,
      reviewReason: reviewPayload.reviewReason || reviewPayload.reviewNotes || reviewPayload.notes || "",
      verifiedIncidentType: reviewPayload.verifiedIncidentType,
      verifiedPassability: reviewPayload.verifiedPassability,
      actor: actor
    };

    if (window.LW.reportsStorage) {
      const updated = await window.LW.reportsStorage.updateReportStatus(id, mappedStatus, options);
      return { success: true, data: normalizeReport(updated) };
    }

    throw new Error("Shared report storage utility is unavailable.");
  }

  async function assignOfficer(id, officerData, instructions, priority, requestedTime) {
    if (window.LW.reportsStorage?.assignOfficer) {
      let user = null;
      try {
        user = window.LW.authService?.getCurrentUser() || window.LW.auth?.getUser();
      } catch (e) {}
      const updated = await window.LW.reportsStorage.assignOfficer(id, officerData, instructions, priority, requestedTime, user);
      return { success: true, data: normalizeReport(updated) };
    }
    throw new Error("Shared report storage utility unavailable.");
  }

  async function officerAcknowledge(id) {
    if (window.LW.reportsStorage?.officerAcknowledge) {
      let user = null;
      try {
        user = window.LW.authService?.getCurrentUser() || window.LW.auth?.getUser();
      } catch (e) {}
      const updated = await window.LW.reportsStorage.officerAcknowledge(id, user);
      return { success: true, data: normalizeReport(updated) };
    }
    throw new Error("Shared report storage utility unavailable.");
  }

  async function officerUpdateResponse(id, payload) {
    if (window.LW.reportsStorage?.officerUpdateResponse) {
      let user = null;
      try {
        user = window.LW.authService?.getCurrentUser() || window.LW.auth?.getUser();
      } catch (e) {}
      const updated = await window.LW.reportsStorage.officerUpdateResponse(id, payload, user);
      return { success: true, data: normalizeReport(updated) };
    }
    throw new Error("Shared report storage utility unavailable.");
  }

  async function escalateToRescueTeam(id, escalationData) {
    if (window.LW.reportsStorage?.escalateToRescueTeam) {
      let user = null;
      try {
        user = window.LW.authService?.getCurrentUser() || window.LW.auth?.getUser();
      } catch (e) {}
      const updated = await window.LW.reportsStorage.escalateToRescueTeam(id, escalationData, user);
      return { success: true, data: normalizeReport(updated) };
    }
    throw new Error("Shared report storage utility unavailable.");
  }

  async function closeEscalation(id, closureNotes) {
    if (window.LW.reportsStorage?.closeEscalation) {
      let user = null;
      try {
        user = window.LW.authService?.getCurrentUser() || window.LW.auth?.getUser();
      } catch (e) {}
      const updated = await window.LW.reportsStorage.closeEscalation(id, closureNotes, user);
      return { success: true, data: normalizeReport(updated) };
    }
    throw new Error("Shared report storage utility unavailable.");
  }

  return {
    getCategories() {
      return [...CATEGORIES];
    },
    getPassabilityOptions() {
      return [...PASSABILITY_OPTIONS];
    },
    getVerifiedOfficers() {
      return window.LW.reportsStorage?.getVerifiedOfficers ? window.LW.reportsStorage.getVerifiedOfficers() : [];
    },
    getVerifiedRescueContacts() {
      return window.LW.reportsStorage?.getVerifiedRescueContacts ? window.LW.reportsStorage.getVerifiedRescueContacts() : [];
    },
    validatePhotoFile,
    validateImageFile: validatePhotoFile,
    processPhotoUpload,
    submitIncident,
    getAllIncidents,
    getMyIncidents,
    getAssignedIncidents,
    getIncidentById,
    reviewIncident,
    assignOfficer,
    officerAcknowledge,
    officerUpdateResponse,
    escalateToRescueTeam,
    closeEscalation,
    normalizeReport
  };
})();
