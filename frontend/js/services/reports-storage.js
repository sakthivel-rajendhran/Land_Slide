/**
 * SlopeGuard — Shared Citizen Incident Report Storage Utility (reports-storage.js)
 * Persistent client-side storage using browser IndexedDB for structured report records and image Blobs.
 * 
 * - Single source of truth for citizen landslide & road blockage incident reports
 * - Native Blob storage for photographs (no large Base64 strings in localStorage)
 * - Object URL lifecycle management (create and revoke to avoid memory leaks)
 * - Cross-tab live synchronization via BroadcastChannel API and storage events
 * - Anti-duplicate submission protection
 * - Role-aware data access (citizen filters own reports, officer/admin views all)
 */

window.LW = window.LW || {};

window.LW.reportsStorage = (function() {
  const DB_NAME = "SlopeGuardReportsDB";
  const DB_VERSION = 1;
  const STORE_NAME = "reports";
  const BROADCAST_CHANNEL_NAME = "slopeguard_reports_sync";
  const SYNC_STORAGE_KEY = "sg_reports_sync_event";

  let dbInstance = null;
  let dbPromise = null;
  const activeObjectUrls = new Set();
  const syncListeners = new Set();
  const inFlightSubmissions = new Map();

  // Cross-tab broadcast channel
  let broadcastChannel = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      broadcastChannel.onmessage = (event) => {
        notifySyncListeners(event.data);
      };
    }
  } catch (e) {
    console.warn("[reportsStorage] BroadcastChannel not supported, falling back to storage events:", e);
  }

  // Cross-tab storage event listener
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("storage", (e) => {
      if (e.key === SYNC_STORAGE_KEY && e.newValue) {
        try {
          const data = JSON.parse(e.newValue);
          notifySyncListeners(data);
        } catch (err) {}
      }
    });

    // Cleanup object URLs on page unload
    window.addEventListener("beforeunload", () => {
      revokeAllPhotoUrls();
    });
  }

  function notifySyncListeners(payload) {
    syncListeners.forEach(fn => {
      try {
        fn(payload);
      } catch (err) {
        console.error("[reportsStorage] Sync listener error:", err);
      }
    });
  }

  function broadcastChange(type, reportId) {
    const payload = {
      type: type,
      reportId: reportId,
      timestamp: Date.now()
    };

    if (broadcastChannel) {
      try {
        broadcastChannel.postMessage(payload);
      } catch (e) {}
    }

    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(payload));
      }
    } catch (e) {}

    // Also notify local listeners in current window
    notifySyncListeners(payload);
  }

  /**
   * Register a synchronization listener for live cross-tab and cross-component updates
   */
  function onSync(fn) {
    if (typeof fn === "function") {
      syncListeners.add(fn);
      return () => syncListeners.delete(fn);
    }
    return () => {};
  }

  // In-memory fallback if IndexedDB is disabled or unavailable
  const memoryStore = new Map();

  /**
   * Initialize and open the IndexedDB database safely
   */
  function initDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const idb = (typeof window !== "undefined" && window.indexedDB) || (typeof indexedDB !== "undefined" ? indexedDB : null);

      if (!idb) {
        console.warn("[reportsStorage] IndexedDB not available, using in-memory store");
        resolve(null);
        return;
      }

      const request = idb.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("reporter_user_id", "reporter_user_id", { unique: false });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("reported_timestamp", "reported_timestamp", { unique: false });
          store.createIndex("incident_category", "incident_category", { unique: false });
        }
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        dbInstance.onversionchange = () => {
          dbInstance.close();
          dbInstance = null;
          dbPromise = null;
        };
        resolve(dbInstance);
      };

      request.onerror = (event) => {
        console.error("[reportsStorage] IndexedDB open error:", request.error || event);
        reject(request.error || new Error("Failed to open IndexedDB"));
      };

      request.onblocked = () => {
        console.warn("[reportsStorage] IndexedDB open blocked by other tabs");
      };
    });

    return dbPromise;
  }

  /**
   * Helper to execute IndexedDB transaction safely
   */
  async function withStore(mode, callback) {
    const db = await initDB();
    if (!db) {
      return callback(null, memoryStore);
    }

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);

        tx.onerror = (e) => reject(tx.error || e);
        tx.onabort = (e) => reject(tx.error || e);

        const result = callback(store, null);
        tx.oncomplete = () => resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Generate unique report ID
   */
  function generateReportId() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const randomHex = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `INC-NER-${timestamp}-${randomHex}`;
  }

  /**
   * Create browser Object URL for a Blob and register it for cleanup
   */
  function createPhotoUrl(blob) {
    if (!blob) return "";
    if (typeof blob === "string") return blob; // Already URL or dataURL
    if (typeof URL !== "undefined" && URL.createObjectURL) {
      try {
        const url = URL.createObjectURL(blob);
        activeObjectUrls.add(url);
        return url;
      } catch (e) {
        console.warn("[reportsStorage] Failed to create object URL for blob:", e);
      }
    }
    return "";
  }

  /**
   * Revoke a single Object URL
   */
  function revokePhotoUrl(url) {
    if (url && activeObjectUrls.has(url)) {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
      activeObjectUrls.delete(url);
    }
  }

  /**
   * Revoke all allocated Object URLs to prevent memory leaks
   */
  function revokeAllPhotoUrls() {
    activeObjectUrls.forEach(url => {
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
    });
    activeObjectUrls.clear();
  }

  /**
   * Attach temporary object URLs to report photos for browser display
   */
  function attachPhotoUrls(report) {
    if (!report) return report;
    const cloned = { ...report };
    if (Array.isArray(cloned.photos)) {
      cloned.photos = cloned.photos.map(p => {
        const photoCopy = { ...p };
        if (p.blob && (!p.url || p.url.startsWith("blob:"))) {
          photoCopy.url = createPhotoUrl(p.blob);
          photoCopy.previewUrl = photoCopy.url;
        }
        return photoCopy;
      });
    }
    return cloned;
  }

  /**
   * Save a new incident report to IndexedDB
   * Stores metadata and native image Blobs safely
   */
  async function saveReport(reportData, imageBlobs = [], userOverride = null) {
    // 1. Validation
    if (!reportData) {
      throw new Error("Report data cannot be empty.");
    }

    // Support passing user object as 2nd parameter if imageBlobs is omitted
    if (imageBlobs && !Array.isArray(imageBlobs) && typeof imageBlobs === "object" && !(typeof Blob !== "undefined" && imageBlobs instanceof Blob)) {
      userOverride = imageBlobs;
      imageBlobs = [];
    }

    const category = reportData.incidentCategory || reportData.incidentType || reportData.category;
    if (!category || !String(category).trim()) {
      throw new Error("Incident category is required. Please select a hazard type.");
    }

    const description = reportData.description || "";
    if (!description.trim() || description.trim().length < 10) {
      throw new Error("Incident description must be at least 10 characters.");
    }

    const lat = Number(reportData.latitude ?? reportData.location?.latitude ?? reportData.lat);
    const lng = Number(reportData.longitude ?? reportData.location?.longitude ?? reportData.lng);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error("Valid geographic coordinates (latitude and longitude) are required.");
    }

    // 2. Anti-duplicate submission check
    const submissionFingerprint = `${category}_${lat.toFixed(5)}_${lng.toFixed(5)}_${description.trim().substring(0, 30)}`;
    const nowTs = Date.now();
    const lastSub = inFlightSubmissions.get(submissionFingerprint);
    if (lastSub && (nowTs - lastSub) < 3000) {
      throw new Error("A duplicate submission is already being processed. Please wait a moment.");
    }
    inFlightSubmissions.set(submissionFingerprint, nowTs);

    try {
      // 3. User & Session Metadata
      let currentUser = null;
      try {
        currentUser = (window.LW.authService && window.LW.authService.getCurrentUser()) ||
                      (window.LW.auth && window.LW.auth.getUser()) || null;
      } catch (e) {}

      if (!currentUser && typeof localStorage !== "undefined") {
        try {
          const rawUser = sessionStorage.getItem("sg_user") || localStorage.getItem("sg_user");
          if (rawUser) currentUser = JSON.parse(rawUser);
        } catch (e) {}
      }

      const reporterUserId = userOverride?.id || userOverride?.userId || userOverride?.email ||
                             reportData.reporterUserId || reportData.userId || reportData.reporter_user_id ||
                             currentUser?.id || currentUser?.userId || currentUser?.email || "citizen_anonymous";
      const reporterName = userOverride?.name || userOverride?.fullName || userOverride?.email ||
                           reportData.reporterName || reportData.citizenName ||
                           currentUser?.name || currentUser?.fullName || currentUser?.email || "Citizen Observer";

      const reportId = reportData.id || generateReportId();
      const reportedAt = reportData.reportedTimestamp || reportData.submittedAt || new Date().toISOString();
      const observedAt = reportData.observationTimestamp || reportData.observedAt || reportedAt;

      // 4. Process photos into Blob objects
      const processedPhotos = [];
      const incomingPhotos = reportData.photos || imageBlobs || [];

      for (let i = 0; i < incomingPhotos.length; i++) {
        const item = incomingPhotos[i];
        let photoBlob = null;
        let filename = `evidence_${i + 1}.jpg`;
        let mimeType = "image/jpeg";
        let size = 0;

        if (item instanceof Blob) {
          photoBlob = item;
          filename = (item.name) || filename;
          mimeType = item.type || mimeType;
          size = item.size || 0;
        } else if (item.file instanceof Blob) {
          photoBlob = item.file;
          filename = item.originalName || item.filename || item.file.name || filename;
          mimeType = item.mimeType || item.file.type || mimeType;
          size = item.size || item.file.size || 0;
        } else if (item.blob instanceof Blob) {
          photoBlob = item.blob;
          filename = item.filename || filename;
          mimeType = item.mimeType || item.blob.type || mimeType;
          size = item.size || item.blob.size || 0;
        } else if (item.dataUrl && typeof item.dataUrl === "string") {
          // Convert DataURL to Blob if needed
          try {
            const arr = item.dataUrl.split(",");
            const mime = arr[0].match(/:(.*?);/)[1];
            const bstr = atob(arr[1]);
            let n = bstr.length;
            const u8arr = new Uint8Array(n);
            while (n--) u8arr[n] = bstr.charCodeAt(n);
            photoBlob = new Blob([u8arr], { type: mime });
            mimeType = mime;
            size = photoBlob.size;
            filename = item.filename || filename;
          } catch (e) {}
        }

        if (photoBlob) {
          processedPhotos.push({
            id: item.id || `PHOTO-${Date.now().toString(36).toUpperCase()}-${i}`,
            filename: filename,
            mimeType: mimeType,
            size: size,
            blob: photoBlob
          });
        }
      }

      // 5. Structure complete local record
      const fullRecord = {
        id: reportId,
        reporter_user_id: String(reporterUserId),
        userId: String(reporterUserId),
        reporter_name: reporterName,
        reporterName: reporterName,
        incident_category: category,
        incidentCategory: category,
        incident_type: reportData.incidentType || category,
        incidentType: reportData.incidentType || category,
        description: description.trim(),
        latitude: lat,
        longitude: lng,
        location: {
          latitude: lat,
          longitude: lng,
          accuracy: reportData.location?.accuracy || reportData.accuracy || 15,
          accuracyMeters: reportData.location?.accuracyMeters || 15,
          roadName: reportData.location?.roadName || reportData.roadName || "",
          placeName: reportData.location?.placeName || reportData.placeName || "Regional Slope",
          source: reportData.location?.source || reportData.source || "manual_entry"
        },
        location_description: reportData.locationDescription || reportData.location?.roadName || reportData.roadName || "Regional Slope Corridor",
        road_name: reportData.roadName || reportData.location?.roadName || "",
        road_passability: reportData.roadPassability || reportData.road_passability || "unknown",
        roadPassability: reportData.roadPassability || reportData.road_passability || "unknown",
        severity: reportData.severity || "MODERATE",
        reported_timestamp: reportedAt,
        submittedAt: reportedAt,
        observation_timestamp: observedAt,
        observedAt: observedAt,
        status: reportData.status || "Pending Verification",
        review_notes: reportData.reviewNotes || "",
        reviewReason: reportData.reviewReason || reportData.reviewNotes || "",
        verified_passability: reportData.verifiedPassability || reportData.roadPassability || "unknown",
        verifiedPassability: reportData.verifiedPassability || reportData.roadPassability || "unknown",
        verified_incident_type: reportData.verifiedIncidentType || category,
        verifiedIncidentType: reportData.verifiedIncidentType || category,
        officer_assignment: reportData.officerAssignment || null,
        photos: processedPhotos,
        audit_trail: [
          {
            action: "SUBMISSION",
            statusResult: reportData.status || "Pending Verification",
            actor: reporterName,
            timestamp: reportedAt,
            notes: "Citizen report recorded in device IndexedDB storage."
          }
        ]
      };

      // 6. Write to IndexedDB
      const db = await initDB();
      if (!db) {
        memoryStore.set(reportId, fullRecord);
      } else {
        await new Promise((resolve, reject) => {
          try {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const req = store.put(fullRecord);

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error("Failed to write report to IndexedDB"));
            tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
          } catch (err) {
            reject(err);
          }
        });
      }

      // 7. Cross-tab synchronization
      broadcastChange("REPORT_SAVED", reportId);

      return attachPhotoUrls(fullRecord);
    } catch (err) {
      console.error("[reportsStorage] saveReport failed:", err);
      // Clean up in-flight submission lock on error
      inFlightSubmissions.delete(submissionFingerprint);
      throw err;
    }
  }

  /**
   * Retrieve all reports from IndexedDB, sorted newest first
   */
  async function getAllReports() {
    const db = await initDB();
    let records = [];

    if (!db) {
      records = Array.from(memoryStore.values());
    } else {
      records = await new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_NAME, "readonly");
          const store = tx.objectStore(STORE_NAME);
          const req = store.getAll();

          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error || new Error("Failed to read reports"));
        } catch (err) {
          reject(err);
        }
      });
    }

    // Sort descending by reported timestamp
    records.sort((a, b) => {
      const timeA = new Date(a.reported_timestamp || a.submittedAt || 0).getTime();
      const timeB = new Date(b.reported_timestamp || b.submittedAt || 0).getTime();
      return timeB - timeA;
    });

    return records.map(attachPhotoUrls);
  }

  /**
   * Retrieve individual report by ID
   */
  async function getReportById(id) {
    if (!id) return null;
    const db = await initDB();
    let record = null;

    if (!db) {
      record = memoryStore.get(String(id)) || null;
    } else {
      record = await new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_NAME, "readonly");
          const store = tx.objectStore(STORE_NAME);
          const req = store.get(String(id));

          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error || new Error("Failed to get report by ID"));
        } catch (err) {
          reject(err);
        }
      });
    }

    return record ? attachPhotoUrls(record) : null;
  }

  /**
   * Retrieve reports for a specific user ID
   */
  async function getReportsByUserId(userId) {
    if (!userId) return [];
    const all = await getAllReports();
    const strUserId = String(userId).toLowerCase();

    return all.filter(r => {
      const rUid = String(r.reporter_user_id || r.userId || "").toLowerCase();
      const rEmail = String(r.reporter_email || "").toLowerCase();
      return rUid === strUserId || rEmail === strUserId;
    });
  }

  /**
   * Update report status and adjudication notes
   */
  async function updateReportStatus(id, newStatus, options = {}) {
    if (!id) throw new Error("Report ID is required for status update.");

    const db = await initDB();
    let existing = await getReportById(id);
    if (!existing) {
      throw new Error(`Report '${id}' not found in local storage.`);
    }

    const updated = {
      ...existing,
      status: newStatus,
      reviewNotes: options.reviewReason || options.reviewNotes || options.notes || existing.reviewNotes || "",
      reviewReason: options.reviewReason || options.reviewNotes || options.notes || existing.reviewReason || "",
      verifiedPassability: options.verifiedPassability || existing.verifiedPassability || existing.roadPassability,
      verifiedIncidentType: options.verifiedIncidentType || existing.verifiedIncidentType || existing.incidentType,
      updated_at: new Date().toISOString()
    };

    const auditTrail = existing.audit_trail || existing.auditTrail || [];
    auditTrail.push({
      action: options.action || "STATUS_UPDATE",
      statusResult: newStatus,
      actor: options.actor || "Geotechnical Officer",
      timestamp: new Date().toISOString(),
      notes: options.reviewReason || options.reviewNotes || options.notes || `Status changed to ${newStatus}`
    });
    updated.audit_trail = auditTrail;
    updated.auditTrail = auditTrail;

    if (!db) {
      memoryStore.set(String(id), updated);
    } else {
      await new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(updated);

          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error || new Error("Failed to update report status"));
        } catch (err) {
          reject(err);
        }
      });
    }

    broadcastChange("REPORT_UPDATED", id);
    return attachPhotoUrls(updated);
  }

  /**
   * Delete report where workflow allows
   */
  async function deleteReport(id) {
    if (!id) return false;
    const db = await initDB();

    if (!db) {
      memoryStore.delete(String(id));
    } else {
      await new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);
          const req = store.delete(String(id));

          req.onsuccess = () => resolve(true);
          req.onerror = () => reject(req.error || new Error("Failed to delete report"));
        } catch (err) {
          reject(err);
        }
      });
    }

    broadcastChange("REPORT_DELETED", id);
    return true;
  }

  /**
  /**
   * Verified Rescue Force Registry (formerly Field Officer)
   */
  const VERIFIED_RESCUE_FORCE = [
    {
      id: "officer_khasi",
      name: "Er. T. Lyngdoh",
      designation: "NER Rescue Force Unit (SDRF)",
      district: "East Khasi Hills (NH-40 / Shillong Bypass Corridor)",
      phone: "+91-94361-22819",
      available: true
    },
    {
      id: "officer_dima",
      name: "Er. R. Barman",
      designation: "NER Rescue Force Unit (SDRF)",
      district: "Dima Hasao (Haflong / Lumding-Badarpur Hill Section)",
      phone: "+91-94350-81902",
      available: true
    },
    {
      id: "officer_noney",
      name: "Er. K. Kamei",
      designation: "NER Rescue Force Unit (SDRF)",
      district: "Noney Railway Corridor (NH-37 / Imphal Road)",
      phone: "+91-98620-41093",
      available: true
    },
    {
      id: "officer_shillong",
      name: "Er. S. Sangma",
      designation: "NER Rescue Force Unit (SDRF)",
      district: "West Garo Hills & Tura Range",
      phone: "+91-94363-71820",
      available: true
    }
  ];
  const VERIFIED_OFFICERS = VERIFIED_RESCUE_FORCE; // Backward-compatibility alias

  /**
   * Verified Emergency Rescue Contacts (North Eastern Region)
   */
  const VERIFIED_RESCUE_CONTACTS = [
    {
      agency: "NDRF 1st Battalion Control Room (Patgaon, Guwahati)",
      phone: "03612840284",
      displayPhone: "0361-2840284",
      altPhone: "1078",
      type: "Federal Disaster Response Force",
      coverage: "Assam, Meghalaya, Tripura, Mizoram"
    },
    {
      agency: "State Disaster Management Authority (SDMA SEOC)",
      phone: "1070",
      displayPhone: "1070 (Toll Free)",
      altPhone: "0361-2237219",
      type: "State Emergency Operations Center",
      coverage: "Statewide Headquarters"
    },
    {
      agency: "District Emergency Operation Center (DDMA)",
      phone: "1077",
      displayPhone: "1077 (District Cell)",
      altPhone: "",
      type: "District Disaster Cell",
      coverage: "Local District Administration"
    },
    {
      agency: "National Emergency Response (Police, Fire & Ambulance)",
      phone: "112",
      displayPhone: "112 (Universal Emergency)",
      altPhone: "100",
      type: "Immediate Police / EMS Dispatch",
      coverage: "All India Universal Emergency"
    }
  ];

  function getVerifiedRescueForce() {
    return [...VERIFIED_RESCUE_FORCE];
  }

  function getVerifiedOfficers() {
    return [...VERIFIED_RESCUE_FORCE];
  }

  function getVerifiedRescueContacts() {
    return [...VERIFIED_RESCUE_CONTACTS];
  }

  /**
   * Assign an incident report to a Rescue Force unit
   */
  async function assignRescueForce(reportId, rescueData, instructions, priority = "HIGH", requestedTime = "2 hours", adminUser = null) {
    if (!reportId) throw new Error("Report ID is required for Rescue Force assignment.");
    if (typeof rescueData === "string") {
      rescueData = VERIFIED_RESCUE_FORCE.find(o => o.id === rescueData || o.name.includes(rescueData)) || { id: rescueData, name: rescueData };
    }
    if (!rescueData || !rescueData.id) throw new Error("Valid Rescue Force selection is required.");

    const db = await initDB();
    const existing = await getReportById(reportId);
    if (!existing) throw new Error(`Report '${reportId}' not found.`);

    const assignmentRecord = {
      id: rescueData.id,
      name: rescueData.name || rescueData.id,
      designation: rescueData.designation || "Rescue Force Unit (SDRF)",
      district: rescueData.district || "",
      assignedAt: new Date().toISOString(),
      assignedBy: adminUser?.name || adminUser?.fullName || "Operations Center Admin",
      instructions: instructions || "Perform on-site slope verification and report road passability.",
      priority: priority,
      requestedTime: requestedTime,
      taskStatus: "PENDING", // PENDING -> ACKNOWLEDGED -> IN_PROGRESS -> COMPLETED
      acknowledgedAt: null,
      inspectionCompleted: false,
      inspectionTimestamp: null,
      officerNotes: "",
      resolutionNotes: "",
      completedAt: null
    };

    const updated = {
      ...existing,
      status: "Assigned",
      assigned_rescue_force: assignmentRecord,
      assignedRescueForce: assignmentRecord,
      assigned_officer: assignmentRecord,
      officer_assignment: assignmentRecord,
      assignedOfficer: assignmentRecord,
      updated_at: new Date().toISOString()
    };

    const auditTrail = existing.audit_trail || existing.auditTrail || [];
    auditTrail.push({
      action: "RESCUE_FORCE_ASSIGNED",
      statusResult: "Assigned",
      actor: adminUser?.name || "Operations Center Admin",
      timestamp: new Date().toISOString(),
      notes: `Assigned to ${assignmentRecord.name} (${assignmentRecord.district}). Priority: ${priority}. Response Window: ${requestedTime}. Instructions: ${assignmentRecord.instructions}`
    });
    updated.audit_trail = auditTrail;
    updated.auditTrail = auditTrail;

    if (!db) {
      memoryStore.set(String(reportId), updated);
    } else {
      await new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(updated);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error || new Error("Failed to save assignment."));
        } catch (err) {
          reject(err);
        }
      });
    }

    if (window.LW && window.LW.api && window.LW.api.post) {
      try {
        await window.LW.api.post(`/api/rescue/missions/${reportId}/assign`, {
          teamId: rescueData.id || rescueData.name,
          teamName: rescueData.name || rescueData.id,
          priority: priority,
          instructions: instructions || "Perform on-site slope verification and report road passability.",
          responseWindow: requestedTime
        });
      } catch (backendErr) {
        console.warn("[reportsStorage] Backend assign notice:", backendErr);
      }
    }

    broadcastChange("MISSION_ASSIGNED", reportId);
    broadcastChange("REPORT_UPDATED", reportId);
    return attachPhotoUrls(updated);
  }

  /**
   * Revoke an incident assignment from a Rescue Force unit
   */
  async function revokeRescueForce(reportId, reason = "Administrator revoked assignment", adminUser = null) {
    if (!reportId) throw new Error("Report ID is required to revoke assignment.");

    if (window.LW && window.LW.api && window.LW.api.post) {
      try {
        await window.LW.api.post(`/api/rescue/missions/${reportId}/revoke`, { reason: reason });
      } catch (backendErr) {
        console.warn("[reportsStorage] Backend revoke notice:", backendErr);
      }
    }

    const db = await initDB();
    const existing = await getReportById(reportId);
    if (existing) {
      existing.assigned_rescue_force = null;
      existing.assignedRescueForce = null;
      existing.assigned_officer = null;
      existing.officer_assignment = null;
      existing.assignedOfficer = null;
      existing.operationalStage = "REVOKED";
      existing.status = "Under Review";

      const auditTrail = existing.audit_trail || existing.auditTrail || [];
      auditTrail.push({
        action: "RESCUE_FORCE_REVOKED",
        statusResult: "Under Review",
        actor: adminUser?.name || "Operations Center Admin",
        timestamp: new Date().toISOString(),
        notes: `Assignment revoked by administrator: ${reason}`
      });
      existing.audit_trail = auditTrail;
      existing.auditTrail = auditTrail;

      if (!db) {
        memoryStore.set(String(reportId), existing);
      } else {
        await new Promise((resolve, reject) => {
          try {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const req = store.put(existing);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error("Failed to revoke assignment."));
          } catch (err) {
            reject(err);
          }
        });
      }
    }

    broadcastChange("MISSION_REVOKED", reportId);
    broadcastChange("REPORT_UPDATED", reportId);
    return existing;
  }

  // Backward-compatibility alias
  const assignOfficer = assignRescueForce;

  /**
   * Field officer acknowledges task assignment
   */
  async function officerAcknowledge(reportId, officerUser = null) {
    if (!reportId) throw new Error("Report ID is required.");
    const db = await initDB();
    const existing = await getReportById(reportId);
    if (!existing) throw new Error(`Report '${reportId}' not found.`);

    if (!existing.assigned_officer) {
      throw new Error(`Report '${reportId}' has no assigned officer.`);
    }

    const officerName = officerUser?.name || existing.assigned_officer.name || "Field Officer";
    const assignment = {
      ...existing.assigned_officer,
      taskStatus: "ACKNOWLEDGED",
      acknowledgedAt: new Date().toISOString()
    };

    const updated = {
      ...existing,
      status: "Responding",
      assigned_officer: assignment,
      officer_assignment: assignment,
      assignedOfficer: assignment,
      updated_at: new Date().toISOString()
    };

    const auditTrail = existing.audit_trail || existing.auditTrail || [];
    auditTrail.push({
      action: "ASSIGNMENT_ACKNOWLEDGED",
      statusResult: "Responding",
      actor: officerName,
      timestamp: new Date().toISOString(),
      notes: "Field Officer acknowledged task assignment and initiated inspection protocol."
    });
    updated.audit_trail = auditTrail;
    updated.auditTrail = auditTrail;

    if (!db) {
      memoryStore.set(String(reportId), updated);
    } else {
      await new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(updated);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error || new Error("Failed to record officer acknowledgment."));
        } catch (err) {
          reject(err);
        }
      });
    }

    broadcastChange("REPORT_UPDATED", reportId);
    return attachPhotoUrls(updated);
  }

  /**
   * Field officer updates response observations, on-site inspection, or marks resolved
   */
  async function officerUpdateResponse(reportId, payload = {}, officerUser = null) {
    if (!reportId) throw new Error("Report ID is required.");
    const db = await initDB();
    const existing = await getReportById(reportId);
    if (!existing) throw new Error(`Report '${reportId}' not found.`);

    const officerName = officerUser?.name || existing.assigned_officer?.name || "Field Officer";
    const currentAssignment = existing.assigned_officer || {
      id: officerUser?.id || "field_officer",
      name: officerName,
      taskStatus: "IN_PROGRESS"
    };

    const isCompleting = payload.taskStatus === "COMPLETED" || Boolean(payload.resolutionNotes && payload.resolutionNotes.trim());
    const isInspected = Boolean(payload.inspectionCompleted);

    const updatedAssignment = {
      ...currentAssignment,
      taskStatus: isCompleting ? "COMPLETED" : (payload.taskStatus || "IN_PROGRESS"),
      inspectionCompleted: isInspected ? true : currentAssignment.inspectionCompleted,
      inspectionTimestamp: isInspected ? (currentAssignment.inspectionTimestamp || new Date().toISOString()) : currentAssignment.inspectionTimestamp,
      officerNotes: payload.officerNotes !== undefined ? payload.officerNotes : currentAssignment.officerNotes,
      resolutionNotes: payload.resolutionNotes !== undefined ? payload.resolutionNotes : currentAssignment.resolutionNotes,
      completedAt: isCompleting ? (currentAssignment.completedAt || new Date().toISOString()) : currentAssignment.completedAt
    };

    const updated = {
      ...existing,
      status: isCompleting ? "Resolved" : (existing.status === "Assigned" ? "Responding" : existing.status),
      assigned_officer: updatedAssignment,
      officer_assignment: updatedAssignment,
      assignedOfficer: updatedAssignment,
      updated_at: new Date().toISOString()
    };

    if (payload.verifiedPassability) {
      updated.verifiedPassability = payload.verifiedPassability;
      updated.roadPassability = payload.verifiedPassability;
      updated.road_passability = payload.verifiedPassability;
    }

    const auditTrail = existing.audit_trail || existing.auditTrail || [];
    let noteText = `Field Update by ${officerName}: Status = ${updatedAssignment.taskStatus}.`;
    if (isInspected) noteText += " [On-Site Physical Inspection Verified]";
    if (payload.officerNotes) noteText += ` Notes: ${payload.officerNotes}`;
    if (payload.resolutionNotes) noteText += ` Resolution: ${payload.resolutionNotes}`;

    auditTrail.push({
      action: isCompleting ? "TASK_RESOLVED" : (isInspected ? "FIELD_INSPECTED" : "FIELD_OBSERVATION"),
      statusResult: updated.status,
      actor: officerName,
      timestamp: new Date().toISOString(),
      notes: noteText
    });
    updated.audit_trail = auditTrail;
    updated.auditTrail = auditTrail;

    if (!db) {
      memoryStore.set(String(reportId), updated);
    } else {
      await new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(updated);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error || new Error("Failed to save field officer update."));
        } catch (err) {
          reject(err);
        }
      });
    }

    broadcastChange("REPORT_UPDATED", reportId);
    return attachPhotoUrls(updated);
  }

  /**
   * Escalate incident to verified emergency rescue teams (Task 5)
   * Clearly records initiating agency, contact numbers, and human-operator confirmation status.
   */
  async function escalateToRescueTeam(reportId, escalationData = {}, adminUser = null) {
    if (!reportId) throw new Error("Report ID is required for rescue escalation.");
    const db = await initDB();
    const existing = await getReportById(reportId);
    if (!existing) throw new Error(`Report '${reportId}' not found.`);

    if (!escalationData.agency || !escalationData.contactNumber) {
      throw new Error("Target emergency agency and verified contact number are required.");
    }

    const initiatorName = adminUser?.name || adminUser?.fullName || "Operations Center Admin";
    const escalationRecord = {
      escalatedAt: new Date().toISOString(),
      escalatedBy: initiatorName,
      agency: escalationData.agency,
      contactNumber: escalationData.contactNumber,
      contactMethod: escalationData.contactMethod || "PHONE_CALL_INITIATED",
      reason: escalationData.reason || "Severe active slope failure threatening transit or human safety.",
      outcomeStatus: escalationData.outcomeStatus || "INITIATED",
      // Outcome statuses: 'INITIATED' | 'CONFIRMED_EN_ROUTE' | 'RECORDED_LOCALLY' | 'ACKNOWLEDGED_BY_TEAM'
      dispatchNotes: escalationData.dispatchNotes || "",
      isRealActionRecorded: Boolean(escalationData.isRealActionRecorded),
      closedAt: null,
      closureNotes: ""
    };

    const updated = {
      ...existing,
      status: "Escalated",
      severity: "CRITICAL",
      escalation: escalationRecord,
      escalation_record: escalationRecord,
      updated_at: new Date().toISOString()
    };

    const auditTrail = existing.audit_trail || existing.auditTrail || [];
    auditTrail.push({
      action: "RESCUE_ESCALATION",
      statusResult: "Escalated",
      actor: initiatorName,
      timestamp: new Date().toISOString(),
      notes: `Escalated to ${escalationRecord.agency} (${escalationRecord.contactNumber}). Outcome: ${escalationRecord.outcomeStatus}. Human Confirmed: ${escalationRecord.isRealActionRecorded ? 'YES' : 'NO'}. Reason: ${escalationRecord.reason}`
    });
    updated.audit_trail = auditTrail;
    updated.auditTrail = auditTrail;

    if (!db) {
      memoryStore.set(String(reportId), updated);
    } else {
      await new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(updated);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error || new Error("Failed to record rescue escalation."));
        } catch (err) {
          reject(err);
        }
      });
    }

    broadcastChange("REPORT_UPDATED", reportId);
    return attachPhotoUrls(updated);
  }

  /**
   * Close or stand down an active rescue escalation
   */
  async function closeEscalation(reportId, closureNotes = "", adminUser = null) {
    if (!reportId) throw new Error("Report ID is required.");
    const db = await initDB();
    const existing = await getReportById(reportId);
    if (!existing) throw new Error(`Report '${reportId}' not found.`);

    const closerName = adminUser?.name || "Operations Center Admin";
    const currentEsc = existing.escalation || {};

    const updatedEsc = {
      ...currentEsc,
      closedAt: new Date().toISOString(),
      closureNotes: closureNotes || "Emergency rescue escalation concluded and stood down."
    };

    const updated = {
      ...existing,
      status: "Resolved",
      escalation: updatedEsc,
      escalation_record: updatedEsc,
      updated_at: new Date().toISOString()
    };

    const auditTrail = existing.audit_trail || existing.auditTrail || [];
    auditTrail.push({
      action: "ESCALATION_CLOSED",
      statusResult: "Resolved",
      actor: closerName,
      timestamp: new Date().toISOString(),
      notes: `Rescue escalation closed. Notes: ${updatedEsc.closureNotes}`
    });
    updated.audit_trail = auditTrail;
    updated.auditTrail = auditTrail;

    if (!db) {
      memoryStore.set(String(reportId), updated);
    } else {
      await new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(STORE_NAME, "readwrite");
          const store = tx.objectStore(STORE_NAME);
          const req = store.put(updated);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error || new Error("Failed to close rescue escalation."));
        } catch (err) {
          reject(err);
        }
      });
    }

    broadcastChange("REPORT_UPDATED", reportId);
    return attachPhotoUrls(updated);
  }

  /**
   * Retrieve reports assigned to a specific officer
   */
  async function getReportsAssignedToOfficer(officerId) {
    if (!officerId) return [];
    const all = await getAllReports();
    const target = String(officerId).toLowerCase().trim();

    return all.filter(r => {
      const assigned = r.assigned_officer || r.officer_assignment || r.assignedOfficer;
      if (!assigned) return false;
      const aId = String(assigned.id || "").toLowerCase();
      const aName = String(assigned.name || "").toLowerCase();
      return aId === target || aName.includes(target);
    });
  }

  /**
   * Unified search across reports with role-based field filtering (Task 2)
   */
  function searchReports(records = [], query = "", role = "citizen") {
    if (!Array.isArray(records)) return [];
    const q = String(query || "").trim().toLowerCase();
    if (!q) return [...records];

    const isStaff = role === "admin" || role === "officer";

    return records.filter(r => {
      if (!r) return false;

      // Report ID
      const id = String(r.id || "").toLowerCase();
      if (id.includes(q)) return true;

      // Category / Title
      const cat = String(r.incident_category || r.incidentCategory || r.incidentType || r.incident_type || "").toLowerCase();
      if (cat.includes(q)) return true;

      // Description / Keywords
      const desc = String(r.description || r.summary || "").toLowerCase();
      if (desc.includes(q)) return true;

      // Location Name / Landmark / Corridor / District / Road
      const place = `${r.location?.placeName || ""} ${r.location?.roadName || ""} ${r.location?.landmark || ""} ${r.location?.district || ""} ${r.location_description || ""} ${r.roadName || ""} ${r.road_name || ""}`.toLowerCase();
      if (place.includes(q)) return true;

      // Severity
      const sev = String(r.severity || "").toLowerCase();
      if (sev.includes(q)) return true;

      // Status
      const st = String(r.status || "").toLowerCase();
      if (st.includes(q)) return true;

      // Passability
      const pass = String(r.roadPassability || r.road_passability || r.verifiedPassability || "").toLowerCase();
      if (pass.includes(q)) return true;

      // Assigned Officer
      const officer = r.assigned_officer || r.officer_assignment;
      if (officer) {
        const offName = String(officer.name || "").toLowerCase();
        const offDist = String(officer.district || "").toLowerCase();
        if (offName.includes(q) || offDist.includes(q)) return true;
      }

      // Reporter Name / Citizen Reference (ONLY for staff to prevent privacy leaks - Task 2.12)
      if (isStaff) {
        const repName = String(r.reporter_name || r.reporterName || r.citizenName || "").toLowerCase();
        const repId = String(r.reporter_user_id || r.userId || r.citizenId || "").toLowerCase();
        if (repName.includes(q) || repId.includes(q)) return true;
      }

      return false;
    });
  }

  /**
   * Retrieve photo Blob for a report
   */
  async function getPhotoBlob(reportId, photoId) {
    const report = await getReportById(reportId);
    if (!report || !report.photos) return null;
    const photo = report.photos.find(p => p.id === photoId);
    return photo ? (photo.blob || null) : null;
  }

  /**
   * Register a synchronization listener for live cross-tab updates
   */
  function onSync(callback) {
    if (typeof callback === "function") {
      syncListeners.add(callback);
    }
    return () => syncListeners.delete(callback);
  }

  /**
   * Rescue Mission Storage & Workflow Integrations
   */
  async function getReportsAssignedToOfficer(officerId) {
    const all = await getAllReports();
    const strId = String(officerId || "").toLowerCase();
    return all.filter(r => {
      const off = r.assigned_officer || r.officer_assignment;
      if (!off) return false;
      const oId = String(off.id || "").toLowerCase();
      const oName = String(off.name || "").toLowerCase();
      return oId.includes(strId) || oName.includes(strId);
    });
  }

  function isMissionAssignedToCurrentUser(mission) {
    let currentUser = null;
    try {
      const raw = (typeof sessionStorage !== "undefined" && sessionStorage.getItem("sg_user")) ||
                  (typeof localStorage !== "undefined" && localStorage.getItem("sg_user"));
      currentUser = raw ? JSON.parse(raw) : null;
    } catch (e) {}

    if (!currentUser) return true;
    const role = (currentUser.role || "").toUpperCase();
    if (role === "ADMIN") return true;

    const uid = String(currentUser.id || currentUser.userId || "").toLowerCase();
    const uEmail = String(currentUser.email || currentUser.username || "").toLowerCase();
    const uName = String(currentUser.name || currentUser.fullName || "").toLowerCase();

    const assignedId = String(mission.assignedOfficerId || mission.assigned_officer?.id || "").toLowerCase();
    const assignedTeam = String(mission.assignedTeam || mission.assigned_officer?.name || "").toLowerCase();

    if (assignedId) {
      if (assignedId === uid || assignedId === uEmail) return true;
      if ((uEmail.includes("officer@") || uEmail.includes("lyngdoh") || uName.includes("lyngdoh")) &&
          (assignedId.includes("alpha") || assignedId.includes("khasi") || assignedId.includes("lyngdoh") || assignedId.includes("officer@"))) {
        return true;
      }
      if ((uEmail.includes("bravo") || uEmail.includes("barman") || uEmail.includes("dima") || uName.includes("barman")) &&
          (assignedId.includes("bravo") || assignedId.includes("dima") || assignedId.includes("barman"))) {
        return true;
      }
      if ((uEmail.includes("noney") || uName.includes("kamei")) && (assignedId.includes("noney") || assignedId.includes("kamei"))) {
        return true;
      }
      if ((uEmail.includes("shillong") || uName.includes("sangma")) && (assignedId.includes("shillong") || assignedId.includes("sangma"))) {
        return true;
      }
    }

    if (assignedTeam) {
      if (uEmail && assignedTeam.includes(uEmail)) return true;
      if (uName && assignedTeam.includes(uName)) return true;
      if ((uEmail.includes("officer@") || uName.includes("lyngdoh")) && (assignedTeam.includes("alpha") || assignedTeam.includes("lyngdoh") || assignedTeam.includes("khasi"))) return true;
      if ((uEmail.includes("bravo") || uName.includes("barman")) && (assignedTeam.includes("bravo") || assignedTeam.includes("barman") || assignedTeam.includes("dima"))) return true;
    }

    return false;
  }

  async function getRescueMissions() {
    let serverMissions = [];
    if (window.LW && window.LW.api) {
      try {
        const res = await window.LW.api.get("/api/rescue/missions");
        if (Array.isArray(res)) serverMissions = res;
      } catch (err) {
        console.warn("[reportsStorage] Server missions fetch notice:", err);
      }
    }

    const localReports = await getAllReports();
    const missionMap = new Map();

    serverMissions.forEach(m => {
      missionMap.set(String(m.id), m);
    });

    localReports.forEach(r => {
      const id = String(r.id);
      const existing = missionMap.get(id);
      const assigned = r.assigned_officer || r.officer_assignment;
      if (existing) {
        if (r.photos && r.photos.length > 0 && (!existing.photos || existing.photos.length === 0)) {
          existing.photos = r.photos;
        }
        if (r.assigned_officer && !existing.assignedTeam) {
          existing.assignedTeam = r.assigned_officer.name;
          existing.instructions = r.assigned_officer.instructions;
          existing.assignedPriority = r.assigned_officer.priority;
        }
      } else if (assigned || r.status === "Assigned" || r.status === "Responding" || r.status === "Escalated") {
        missionMap.set(id, {
          id: r.id,
          rawId: r.id,
          incidentCategory: r.incidentCategory || r.incident_category || "OTHER",
          categoryDisplayName: r.incidentCategory || r.incident_type || "Incident",
          description: r.description,
          locationDescription: r.location?.roadName || r.locationDescription || "Regional Slope",
          latitude: r.latitude ?? r.location?.latitude,
          longitude: r.longitude ?? r.location?.longitude,
          reportedTimestamp: r.reported_timestamp || r.submittedAt,
          status: r.status,
          operationalStage: r.operationalStage || (r.status === "Responding" ? "IN_PROGRESS" : "ASSIGNED"),
          assignedTeam: assigned?.name || "Rescue Team Alpha (SDRF)",
          assignedOfficerId: assigned?.id || "officer_alpha",
          assignedPriority: assigned?.priority || "HIGH",
          instructions: assigned?.instructions || "Verify on-site slope movement, inspect road passability, and report back.",
          assignedAt: assigned?.assignedAt || r.reported_timestamp,
          decisionStatus: assigned?.taskStatus === "DECLINED" ? "DECLINED" : (assigned?.taskStatus === "ACKNOWLEDGED" ? "ACCEPTED" : "PENDING"),
          decisionReason: r.decisionReason || null,
          journeyStartedAt: r.journeyStartedAt || null,
          arrivedAt: r.arrivedAt || null,
          isTrackingActive: Boolean(r.isTrackingActive),
          currentLatitude: r.currentLatitude || null,
          currentLongitude: r.currentLongitude || null,
          currentAccuracy: r.currentAccuracy || null,
          journeyTrail: r.journeyTrail || [],
          photos: r.photos || [],
          progressHistory: r.progressHistory || [],
          outcomeReport: r.outcomeReport || null,
          adminFollowUpNotes: r.adminFollowUpNotes || null
        });
      }
    });

    const list = Array.from(missionMap.values())
      .filter(m => (m.operationalStage || "").toUpperCase() !== "REVOKED")
      .filter(m => isMissionAssignedToCurrentUser(m));

    return list;
  }

  async function getMissionById(missionId) {
    if (!missionId) return null;
    if (window.LW.api) {
      try {
        const res = await window.LW.api.get(`/api/rescue/missions/${missionId}`);
        if (res && res.id) return res;
      } catch (e) {}
    }
    const missions = await getRescueMissions();
    return missions.find(m => String(m.id) === String(missionId)) || null;
  }

  async function acceptMission(reportId, teamUser = null) {
    if (!reportId) throw new Error("Mission ID is required.");
    let backendUpdated = null;
    if (window.LW.api) {
      try {
        backendUpdated = await window.LW.api.post(`/api/rescue/missions/${reportId}/decision`, {
          decision: "ACCEPT"
        });
      } catch (e) {
        console.warn("[reportsStorage] Server accept decision fallback:", e);
      }
    }

    const existing = await getReportById(reportId);
    if (existing) {
      const assigned = existing.assigned_officer || { name: teamUser?.name || "Rescue Team Alpha (SDRF)" };
      assigned.taskStatus = "ACCEPTED";
      assigned.acknowledgedAt = new Date().toISOString();

      const updated = {
        ...existing,
        status: "Responding",
        operationalStage: "ACCEPTED",
        assigned_officer: assigned,
        officer_assignment: assigned,
        updated_at: new Date().toISOString()
      };

      const auditTrail = existing.audit_trail || existing.auditTrail || [];
      auditTrail.push({
        action: "MISSION_ACCEPTED",
        statusResult: "Responding",
        actor: teamUser?.name || "Rescue Team Alpha",
        timestamp: new Date().toISOString(),
        notes: "Rescue Team accepted mission assignment."
      });
      updated.audit_trail = auditTrail;
      await saveReport(updated);
      broadcastChange("MISSION_UPDATED", reportId);
      return backendUpdated || updated;
    }

    broadcastChange("MISSION_UPDATED", reportId);
    return backendUpdated;
  }

  async function declineMission(reportId, reason, teamUser = null) {
    if (!reportId) throw new Error("Mission ID is required.");
    if (!reason || !reason.trim()) {
      throw new Error("A mandatory reason must be provided when declining an assignment.");
    }

    let backendUpdated = null;
    if (window.LW.api) {
      try {
        backendUpdated = await window.LW.api.post(`/api/rescue/missions/${reportId}/decision`, {
          decision: "DECLINE",
          reason: reason.trim()
        });
      } catch (e) {
        console.warn("[reportsStorage] Server decline decision fallback:", e);
      }
    }

    const existing = await getReportById(reportId);
    if (existing) {
      const assigned = existing.assigned_officer || {};
      assigned.taskStatus = "DECLINED";
      assigned.declineReason = reason.trim();

      const updated = {
        ...existing,
        status: "Pending Verification",
        operationalStage: "ASSIGNED",
        assigned_officer: assigned,
        officer_assignment: assigned,
        decisionReason: reason.trim(),
        updated_at: new Date().toISOString()
      };

      const auditTrail = existing.audit_trail || existing.auditTrail || [];
      auditTrail.push({
        action: "MISSION_DECLINED",
        statusResult: "Pending Verification",
        actor: teamUser?.name || "Rescue Team Alpha",
        timestamp: new Date().toISOString(),
        notes: `Rescue Team declined mission: ${reason.trim()}`
      });
      updated.audit_trail = auditTrail;
      await saveReport(updated);
      broadcastChange("MISSION_UPDATED", reportId);
      return backendUpdated || updated;
    }

    broadcastChange("MISSION_UPDATED", reportId);
    return backendUpdated;
  }

  async function startJourney(reportId, teamUser = null) {
    if (!reportId) throw new Error("Mission ID is required.");
    let backendUpdated = null;
    if (window.LW.api) {
      try {
        backendUpdated = await window.LW.api.post(`/api/rescue/missions/${reportId}/start-journey`);
      } catch (e) {
        console.warn("[reportsStorage] Server start journey fallback:", e);
      }
    }

    const existing = await getReportById(reportId);
    if (existing) {
      const updated = {
        ...existing,
        status: "Responding",
        operationalStage: "EN_ROUTE",
        isTrackingActive: true,
        journeyStartedAt: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const auditTrail = existing.audit_trail || existing.auditTrail || [];
      auditTrail.push({
        action: "JOURNEY_STARTED",
        statusResult: "En Route",
        actor: teamUser?.name || "Rescue Team Alpha",
        timestamp: new Date().toISOString(),
        notes: "Rescue Team started journey and activated GPS tracking protocol."
      });
      updated.audit_trail = auditTrail;
      await saveReport(updated);
      broadcastChange("MISSION_UPDATED", reportId);
      return backendUpdated || updated;
    }

    broadcastChange("MISSION_UPDATED", reportId);
    return backendUpdated;
  }

  async function recordLocationUpdate(reportId, locationData, teamUser = null) {
    if (!reportId || !locationData) return null;
    let backendRes = null;
    if (window.LW.api) {
      try {
        backendRes = await window.LW.api.post(`/api/rescue/missions/${reportId}/location`, {
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          accuracy: locationData.accuracy || 10,
          speed: locationData.speed || 0,
          heading: locationData.heading || 0,
          timestamp: locationData.timestamp || new Date().toISOString()
        });
      } catch (e) {
        console.warn("[reportsStorage] Server location update fallback:", e);
      }
    }

    const existing = await getReportById(reportId);
    if (existing) {
      const trail = existing.journeyTrail || [];
      trail.push({
        latitude: locationData.latitude,
        longitude: locationData.longitude,
        accuracy: locationData.accuracy || 10,
        timestamp: locationData.timestamp || new Date().toISOString()
      });

      const updated = {
        ...existing,
        currentLatitude: locationData.latitude,
        currentLongitude: locationData.longitude,
        currentAccuracy: locationData.accuracy || 10,
        lastLocationUpdate: new Date().toISOString(),
        isTrackingActive: true,
        journeyTrail: trail
      };
      await saveReport(updated);
      broadcastChange("LOCATION_UPDATED", reportId);
      return backendRes || updated;
    }

    broadcastChange("LOCATION_UPDATED", reportId);
    return backendRes;
  }

  async function getMissionLocation(reportId) {
    if (!reportId) return null;
    if (window.LW.api) {
      try {
        const res = await window.LW.api.get(`/api/rescue/missions/${reportId}/location`);
        if (res) return res;
      } catch (e) {}
    }
    const report = await getReportById(reportId);
    if (!report) return null;
    return {
      missionId: report.id,
      incidentLocation: {
        latitude: report.latitude ?? report.location?.latitude,
        longitude: report.longitude ?? report.location?.longitude,
        locationDescription: report.location?.roadName || report.location_description || ""
      },
      isTrackingActive: Boolean(report.isTrackingActive),
      operationalStage: report.operationalStage || "ASSIGNED",
      currentLatitude: report.currentLatitude || null,
      currentLongitude: report.currentLongitude || null,
      currentAccuracy: report.currentAccuracy || null,
      lastLocationTimestamp: report.lastLocationUpdate || null,
      freshnessSeconds: report.lastLocationUpdate ? Math.floor((Date.now() - new Date(report.lastLocationUpdate).getTime()) / 1000) : -1,
      isLocationStale: report.lastLocationUpdate ? ((Date.now() - new Date(report.lastLocationUpdate).getTime()) > 60000) : true,
      journeyTrail: report.journeyTrail || []
    };
  }

  async function markArrival(reportId, teamUser = null) {
    if (!reportId) throw new Error("Mission ID is required.");
    let backendRes = null;
    if (window.LW.api) {
      try {
        backendRes = await window.LW.api.post(`/api/rescue/missions/${reportId}/arrive`);
      } catch (e) {
        console.warn("[reportsStorage] Server arrival fallback:", e);
      }
    }

    const existing = await getReportById(reportId);
    if (existing) {
      const updated = {
        ...existing,
        operationalStage: "ON_SCENE",
        status: "Responding",
        arrivedAt: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const auditTrail = existing.audit_trail || existing.auditTrail || [];
      auditTrail.push({
        action: "ARRIVAL_ON_SCENE",
        statusResult: "On Scene",
        actor: teamUser?.name || "Rescue Team Alpha",
        timestamp: new Date().toISOString(),
        notes: "Rescue Team arrived at incident site and began initial reconnaissance."
      });
      updated.audit_trail = auditTrail;
      await saveReport(updated);
      broadcastChange("MISSION_UPDATED", reportId);
      return backendRes || updated;
    }

    broadcastChange("MISSION_UPDATED", reportId);
    return backendRes;
  }

  async function submitProgressUpdate(reportId, progressData, teamUser = null) {
    if (!reportId) throw new Error("Mission ID is required.");
    if (!progressData || !progressData.siteAssessment) {
      throw new Error("Site assessment is required.");
    }

    let backendRes = null;
    if (window.LW.api) {
      try {
        backendRes = await window.LW.api.post(`/api/rescue/missions/${reportId}/progress`, progressData);
      } catch (e) {
        console.warn("[reportsStorage] Server progress update fallback:", e);
      }
    }

    const existing = await getReportById(reportId);
    if (existing) {
      const history = existing.progressHistory || [];
      history.push({
        timestamp: new Date().toISOString(),
        actor: teamUser?.name || "Rescue Team Alpha",
        siteAssessment: progressData.siteAssessment,
        roadPassability: progressData.roadPassability || existing.roadPassability,
        observedHazards: progressData.observedHazards || "",
        actionsTaken: progressData.actionsTaken || "",
        resourcesRequired: progressData.resourcesRequired || ""
      });

      const updated = {
        ...existing,
        operationalStage: "IN_PROGRESS",
        status: "Responding",
        roadPassability: progressData.roadPassability || existing.roadPassability,
        road_passability: progressData.roadPassability || existing.roadPassability,
        progressHistory: history,
        updated_at: new Date().toISOString()
      };
      const auditTrail = existing.audit_trail || existing.auditTrail || [];
      auditTrail.push({
        action: "PROGRESS_RECORDED",
        statusResult: "In Progress",
        actor: teamUser?.name || "Rescue Team Alpha",
        timestamp: new Date().toISOString(),
        notes: `Progress update recorded: ${progressData.siteAssessment}`
      });
      updated.audit_trail = auditTrail;
      await saveReport(updated);
      broadcastChange("MISSION_UPDATED", reportId);
      return backendRes || updated;
    }

    broadcastChange("MISSION_UPDATED", reportId);
    return backendRes;
  }

  async function submitOutcomeForVerification(reportId, outcomeData, teamUser = null) {
    if (!reportId) throw new Error("Mission ID is required.");
    if (!outcomeData || !outcomeData.resolutionSummary) {
      throw new Error("Resolution summary is required.");
    }

    let backendRes = null;
    if (window.LW.api) {
      try {
        backendRes = await window.LW.api.post(`/api/rescue/missions/${reportId}/outcome`, outcomeData);
      } catch (e) {
        console.warn("[reportsStorage] Server outcome submission fallback:", e);
      }
    }

    const existing = await getReportById(reportId);
    if (existing) {
      const updated = {
        ...existing,
        operationalStage: "AWAITING_VERIFICATION",
        status: "Under Review",
        outcomeReport: outcomeData,
        isTrackingActive: false,
        reviewNotes: `Rescue Outcome: ${outcomeData.resolutionSummary}`,
        updated_at: new Date().toISOString()
      };
      const auditTrail = existing.audit_trail || existing.auditTrail || [];
      auditTrail.push({
        action: "OUTCOME_SUBMITTED",
        statusResult: "Awaiting Verification",
        actor: teamUser?.name || "Rescue Team Alpha",
        timestamp: new Date().toISOString(),
        notes: `Outcome submitted for administrator verification: ${outcomeData.resolutionSummary}`
      });
      updated.audit_trail = auditTrail;
      await saveReport(updated);
      broadcastChange("MISSION_UPDATED", reportId);
      return backendRes || updated;
    }

    broadcastChange("MISSION_UPDATED", reportId);
    return backendRes;
  }

  async function requestFollowup(reportId, instructions, adminUser = null) {
    if (!reportId) throw new Error("Mission ID is required.");
    if (!instructions || !instructions.trim()) {
      throw new Error("Follow-up instructions are required.");
    }

    let backendRes = null;
    if (window.LW.api) {
      try {
        backendRes = await window.LW.api.post(`/api/rescue/missions/${reportId}/follow-up`, {
          instructions: instructions.trim()
        });
      } catch (e) {
        console.warn("[reportsStorage] Server follow-up fallback:", e);
      }
    }

    const existing = await getReportById(reportId);
    if (existing) {
      const updated = {
        ...existing,
        operationalStage: "FOLLOW_UP_REQUIRED",
        status: "Responding",
        adminFollowUpNotes: instructions.trim(),
        reviewNotes: `Follow-up Required: ${instructions.trim()}`,
        updated_at: new Date().toISOString()
      };
      const auditTrail = existing.audit_trail || existing.auditTrail || [];
      auditTrail.push({
        action: "FOLLOWUP_REQUESTED",
        statusResult: "Follow-up Required",
        actor: adminUser?.name || "Operations Center Admin",
        timestamp: new Date().toISOString(),
        notes: `Administrator requested further action: ${instructions.trim()}`
      });
      updated.audit_trail = auditTrail;
      await saveReport(updated);
      broadcastChange("MISSION_UPDATED", reportId);
      return backendRes || updated;
    }

    broadcastChange("MISSION_UPDATED", reportId);
    return backendRes;
  }

  return {
    init: initDB,
    saveReport,
    getAllReports,
    getReportById,
    getReportsByUserId,
    getReportsAssignedToOfficer,
    getReportsAssignedToRescueForce: getReportsAssignedToOfficer,
    getRescueMissions,
    getMissionById,
    acceptMission,
    declineMission,
    startJourney,
    recordLocationUpdate,
    getMissionLocation,
    markArrival,
    submitProgressUpdate,
    submitOutcomeForVerification,
    requestFollowup,
    updateReportStatus,
    assignOfficer,
    assignRescueForce: assignOfficer,
    revokeRescueForce,
    officerAcknowledge,
    officerUpdateResponse,
    escalateToRescueTeam,
    closeEscalation,
    searchReports,
    getVerifiedOfficers,
    getVerifiedRescueForce: getVerifiedOfficers,
    getVerifiedRescueContacts,
    deleteReport,
    getPhotoBlob,
    createPhotoUrl,
    revokePhotoUrl,
    revokeAllPhotoUrls,
    attachPhotoUrls,
    onSync
  };
})();

