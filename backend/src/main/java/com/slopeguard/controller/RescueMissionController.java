package com.slopeguard.controller;

import com.slopeguard.dto.*;
import com.slopeguard.model.*;
import com.slopeguard.service.AuditService;
import com.slopeguard.service.PhotoService;
import com.slopeguard.service.ReportService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * Controller providing operational endpoints for authorized rescue teams and administrators:
 * - Mission assignment and team-level access control (isolation between teams)
 * - Administrative assignment and revocation
 * - Mission review & decision (Accept / Decline)
 * - Permission-gated GPS journey tracking
 * - Real-time location updates & breadcrumb journey trail
 * - Arrival recording & on-site progress updates
 * - Outcome submission for administrative verification
 * - Follow-up requests by administrators
 */
@RestController
@RequestMapping("/api/rescue/missions")
public class RescueMissionController {

    private final ReportService reportService;
    private final PhotoService photoService;
    private final AuditService auditService;

    // In-memory thread-safe mission tracking state storage
    private static final Map<Long, MissionState> missionStates = new ConcurrentHashMap<>();

    public RescueMissionController(ReportService reportService, PhotoService photoService, AuditService auditService) {
        this.reportService = reportService;
        this.photoService = photoService;
        this.auditService = auditService;
    }

    private static class MissionState {
        String operationalStage = "ASSIGNED";
        String assignedTeam = "Rescue Force Unit Alpha (NER)";
        String assignedOfficerId = "rescue_force_alpha";
        String assignedPriority = "HIGH";
        String instructions = "Verify on-site slope movement, inspect culvert drainage, evaluate road passability, and report back.";
        String assignedAt = LocalDateTime.now().format(DateTimeFormatter.ISO_DATE_TIME);
        String decisionStatus = "PENDING";
        String decisionReason;
        String journeyStartedAt;
        String arrivedAt;
        boolean isTrackingActive = false;
        Instant lastLocationTimestamp;
        Double currentLatitude;
        Double currentLongitude;
        Double currentAccuracy;
        final List<RescueMissionResponse.GpsPoint> journeyTrail = Collections.synchronizedList(new ArrayList<>());
        final List<RescueMissionResponse.RescueProgressEntry> progressHistory = Collections.synchronizedList(new ArrayList<>());
        RescueOutcomeReportRequest outcomeReport;
        String adminFollowUpNotes;
    }

    private MissionState getOrCreateMissionState(Long reportId) {
        return missionStates.computeIfAbsent(reportId, id -> new MissionState());
    }

    /**
     * Verifies if the authenticated caller has access to the specified mission state.
     * Admins have universal access; Rescue Force members only see missions assigned to their unit.
     */
    private boolean isMissionAssignedToUser(MissionState state, Authentication authentication) {
        if (authentication == null) return false;

        boolean isAdmin = authentication.getAuthorities().stream()
                .anyMatch(a -> "ROLE_ADMIN".equals(a.getAuthority()));
        if (isAdmin) return true;

        String assignedOfficerId = state.assignedOfficerId != null ? state.assignedOfficerId.trim().toLowerCase() : "";
        String assignedTeam = state.assignedTeam != null ? state.assignedTeam.trim().toLowerCase() : "";

        String userEmail = "";
        String userName = "";
        String userIdStr = "";

        if (authentication.getPrincipal() instanceof Jwt jwt) {
            Object emailClaim = jwt.getClaims().get("email");
            if (emailClaim != null) userEmail = emailClaim.toString().trim().toLowerCase();

            Object nameClaim = jwt.getClaims().get("name");
            if (nameClaim != null) userName = nameClaim.toString().trim().toLowerCase();

            Object subClaim = jwt.getClaims().get("sub");
            if (subClaim != null) userIdStr = subClaim.toString().trim();
            Object uidClaim = jwt.getClaims().get("userId");
            if (uidClaim != null) userIdStr = uidClaim.toString().trim();
        } else {
            userEmail = authentication.getName() != null ? authentication.getName().trim().toLowerCase() : "";
        }

        // Direct ID / Email Match
        if (!assignedOfficerId.isEmpty()) {
            if (assignedOfficerId.equals(userIdStr) || assignedOfficerId.equals(userEmail)) {
                return true;
            }
            // Team Alpha aliases (Lyngdoh / Khasi / rescue_force_alpha)
            if (userEmail.contains("officer@") || userEmail.contains("lyngdoh") || userName.contains("lyngdoh")) {
                if (assignedOfficerId.contains("alpha") || assignedOfficerId.contains("khasi") || assignedOfficerId.contains("lyngdoh") || assignedOfficerId.contains("officer@")) {
                    return true;
                }
            }
            // Team Bravo aliases (Barman / Dima / rescue_force_bravo)
            if (userEmail.contains("bravo") || userEmail.contains("barman") || userEmail.contains("dima") || userName.contains("barman")) {
                if (assignedOfficerId.contains("bravo") || assignedOfficerId.contains("dima") || assignedOfficerId.contains("barman")) {
                    return true;
                }
            }
            // Team Noney aliases (Kamei)
            if (userEmail.contains("noney") || userName.contains("kamei")) {
                if (assignedOfficerId.contains("noney") || assignedOfficerId.contains("kamei")) {
                    return true;
                }
            }
            // Team Garo / Tura aliases (Sangma / Shillong)
            if (userEmail.contains("shillong") || userName.contains("sangma")) {
                if (assignedOfficerId.contains("shillong") || assignedOfficerId.contains("sangma")) {
                    return true;
                }
            }
            if (!userName.isEmpty() && (assignedOfficerId.contains(userName) || userName.contains(assignedOfficerId))) {
                return true;
            }
        }

        // Team Name Match
        if (!assignedTeam.isEmpty()) {
            if (!userEmail.isEmpty() && assignedTeam.contains(userEmail)) return true;
            if (!userName.isEmpty() && (assignedTeam.contains(userName) || userName.contains(assignedTeam))) return true;
            if ((userEmail.contains("officer@") || userName.contains("lyngdoh")) && (assignedTeam.contains("alpha") || assignedTeam.contains("lyngdoh") || assignedTeam.contains("khasi"))) {
                return true;
            }
            if ((userEmail.contains("bravo") || userName.contains("barman")) && (assignedTeam.contains("bravo") || assignedTeam.contains("barman") || assignedTeam.contains("dima"))) {
                return true;
            }
        }

        return false;
    }

    /**
     * Enforces team-level access control. Throws AccessDeniedException (403) if unauthorized.
     */
    private void checkTeamAccessOrThrow(Long reportId, Authentication authentication) {
        if (authentication == null) {
            throw new AccessDeniedException("Unauthenticated access.");
        }
        boolean isAdmin = authentication.getAuthorities().stream()
                .anyMatch(a -> "ROLE_ADMIN".equals(a.getAuthority()));
        if (isAdmin) return;

        MissionState state = getOrCreateMissionState(reportId);
        if ("REVOKED".equals(state.operationalStage)) {
            throw new AccessDeniedException("Access denied: Mission #" + reportId + " assignment has been revoked by administration.");
        }
        if (!isMissionAssignedToUser(state, authentication)) {
            throw new AccessDeniedException("Forbidden: Mission #" + reportId + " is not assigned to your Rescue Force unit.");
        }
    }

    /**
     * Lists active or assigned missions for authorized rescue teams and administrators.
     * Enforces strict team isolation: non-admins only see missions targeted to their unit.
     */
    @GetMapping
    public ResponseEntity<List<RescueMissionResponse>> getAssignedMissions(Authentication authentication) {
        List<AdminReportResponse> allReports = reportService.getAllAdminReports();
        boolean isAdmin = authentication != null && authentication.getAuthorities().stream()
                .anyMatch(a -> "ROLE_ADMIN".equals(a.getAuthority()));

        List<RescueMissionResponse> missions = allReports.stream()
                .filter(report -> {
                    MissionState state = getOrCreateMissionState(report.getId());
                    if ("REVOKED".equals(state.operationalStage)) {
                        return isAdmin;
                    }
                    if (isAdmin) {
                        return true;
                    }
                    return isMissionAssignedToUser(state, authentication);
                })
                .map(this::toMissionResponse)
                .collect(Collectors.toList());

        return ResponseEntity.ok(missions);
    }

    /**
     * Retrieves specific mission details.
     */
    @GetMapping("/{id}")
    public ResponseEntity<RescueMissionResponse> getMissionById(@PathVariable Long id, Authentication authentication) {
        checkTeamAccessOrThrow(id, authentication);
        AdminReportResponse report = reportService.getAdminReportById(id);
        return ResponseEntity.ok(toMissionResponse(report));
    }

    /**
     * Administrator assigns an incident report to a specific Rescue Force team.
     */
    @PreAuthorize("hasRole('ADMIN')")
    @PostMapping("/{id}/assign")
    public ResponseEntity<RescueMissionResponse> assignMission(
            @PathVariable Long id,
            @Valid @RequestBody RescueMissionAssignRequest request,
            Authentication authentication) {

        AdminReportResponse report = reportService.getAdminReportById(id);
        MissionState state = getOrCreateMissionState(id);
        Long adminId = extractUserId(authentication);
        String adminActor = extractActor(authentication);

        String teamId = request.getTeamId().trim();
        String teamName = (request.getTeamName() != null && !request.getTeamName().isBlank())
                ? request.getTeamName().trim()
                : teamId;
        String priority = (request.getPriority() != null && !request.getPriority().isBlank())
                ? request.getPriority().trim().toUpperCase()
                : "HIGH";
        String instructions = (request.getInstructions() != null && !request.getInstructions().isBlank())
                ? request.getInstructions().trim()
                : "Verify on-site slope movement, inspect culvert drainage, evaluate road passability, and report back.";

        state.assignedOfficerId = teamId;
        state.assignedTeam = teamName;
        state.assignedPriority = priority;
        state.instructions = instructions;
        state.assignedAt = LocalDateTime.now().format(DateTimeFormatter.ISO_DATE_TIME);
        state.operationalStage = "ASSIGNED";
        state.decisionStatus = "PENDING";
        state.decisionReason = null;
        state.journeyStartedAt = null;
        state.arrivedAt = null;
        state.isTrackingActive = false;

        // Transition incident status to UNDER_REVIEW if currently PENDING
        if (report.getStatus() == ReportStatus.PENDING) {
            reportService.updateReportStatus(id, new ReportStatusUpdateRequest(
                    ReportStatus.UNDER_REVIEW,
                    "Assigned to Rescue Force unit: " + teamName + " (Priority: " + priority + ")"
            ));
        }

        auditService.recordEvent(
                AuditEventType.REPORT_REVIEWED,
                adminId,
                id,
                AuditOutcome.SUCCESS,
                "Administrator (" + adminActor + ") assigned incident to " + teamName + " (" + teamId + ")",
                report.getStatus(),
                report.getStatus() == ReportStatus.PENDING ? ReportStatus.UNDER_REVIEW : report.getStatus()
        );

        AdminReportResponse updated = reportService.getAdminReportById(id);
        return ResponseEntity.ok(toMissionResponse(updated));
    }

    /**
     * Administrator revokes an existing mission assignment.
     */
    @PreAuthorize("hasRole('ADMIN')")
    @PostMapping("/{id}/revoke")
    public ResponseEntity<RescueMissionResponse> revokeAssignment(
            @PathVariable Long id,
            @RequestBody(required = false) Map<String, String> requestBody,
            Authentication authentication) {

        AdminReportResponse report = reportService.getAdminReportById(id);
        MissionState state = getOrCreateMissionState(id);
        Long adminId = extractUserId(authentication);
        String adminActor = extractActor(authentication);

        String previousTeam = state.assignedTeam;
        String reason = (requestBody != null && requestBody.containsKey("reason"))
                ? requestBody.get("reason")
                : "Administrator revoked assignment";

        state.operationalStage = "REVOKED";
        state.decisionStatus = "REVOKED";
        state.isTrackingActive = false;
        state.assignedOfficerId = "UNASSIGNED";
        state.assignedTeam = "Unassigned";

        auditService.recordEvent(
                AuditEventType.REPORT_REVIEWED,
                adminId,
                id,
                AuditOutcome.SUCCESS,
                "Administrator (" + adminActor + ") revoked assignment from " + previousTeam + ". Reason: " + reason,
                report.getStatus(),
                report.getStatus()
        );

        AdminReportResponse updated = reportService.getAdminReportById(id);
        return ResponseEntity.ok(toMissionResponse(updated));
    }

    /**
     * Accept or decline an assigned mission.
     */
    @PostMapping("/{id}/decision")
    public ResponseEntity<RescueMissionResponse> recordMissionDecision(
            @PathVariable Long id,
            @Valid @RequestBody RescueMissionDecisionRequest request,
            Authentication authentication) {

        checkTeamAccessOrThrow(id, authentication);

        AdminReportResponse report = reportService.getAdminReportById(id);
        MissionState state = getOrCreateMissionState(id);
        Long userId = extractUserId(authentication);
        String actor = extractActor(authentication);

        boolean isAccept = "ACCEPT".equalsIgnoreCase(request.getDecision());
        if (!isAccept && (request.getReason() == null || request.getReason().trim().isEmpty())) {
            throw new IllegalArgumentException("A mandatory reason must be provided when declining an assignment.");
        }

        if (isAccept) {
            state.decisionStatus = "ACCEPTED";
            state.operationalStage = "ACCEPTED";
            state.decisionReason = null;

            // Transition incident to UNDER_REVIEW
            if (report.getStatus() == ReportStatus.PENDING) {
                reportService.updateReportStatus(id, new ReportStatusUpdateRequest(ReportStatus.UNDER_REVIEW, "Assignment accepted by " + actor));
            }

            auditService.recordEvent(
                    AuditEventType.REPORT_STATUS_CHANGED,
                    userId,
                    id,
                    AuditOutcome.SUCCESS,
                    "Rescue team accepted mission assignment",
                    ReportStatus.PENDING,
                    ReportStatus.UNDER_REVIEW
            );
        } else {
            state.decisionStatus = "DECLINED";
            state.operationalStage = "ASSIGNED";
            state.decisionReason = request.getReason().trim();

            auditService.recordEvent(
                    AuditEventType.REPORT_REVIEWED,
                    userId,
                    id,
                    AuditOutcome.SUCCESS,
                    "Rescue team declined mission assignment: " + state.decisionReason,
                    report.getStatus(),
                    report.getStatus()
            );
        }

        AdminReportResponse updated = reportService.getAdminReportById(id);
        return ResponseEntity.ok(toMissionResponse(updated));
    }

    /**
     * Starts journey and activates GPS tracking session.
     * Enforces strict state sequence: mission must be ACCEPTED first.
     */
    @PostMapping("/{id}/start-journey")
    public ResponseEntity<RescueMissionResponse> startJourney(
            @PathVariable Long id,
            Authentication authentication) {

        checkTeamAccessOrThrow(id, authentication);

        AdminReportResponse report = reportService.getAdminReportById(id);
        MissionState state = getOrCreateMissionState(id);
        Long userId = extractUserId(authentication);
        String actor = extractActor(authentication);

        if (!"ACCEPTED".equalsIgnoreCase(state.decisionStatus) && !"ACCEPTED".equalsIgnoreCase(state.operationalStage)) {
            throw new IllegalStateException("Cannot start journey before the mission assignment has been accepted.");
        }

        state.operationalStage = "EN_ROUTE";
        state.isTrackingActive = true;
        state.journeyStartedAt = LocalDateTime.now().format(DateTimeFormatter.ISO_DATE_TIME);

        auditService.recordEvent(
                AuditEventType.REPORT_REVIEWED,
                userId,
                id,
                AuditOutcome.SUCCESS,
                "Rescue team initiated journey and activated GPS tracking protocol",
                report.getStatus(),
                report.getStatus()
        );

        return ResponseEntity.ok(toMissionResponse(report));
    }

    /**
     * Receives GPS coordinates update from rescue team in transit.
     */
    @PostMapping("/{id}/location")
    public ResponseEntity<RescueMissionResponse> updateLocation(
            @PathVariable Long id,
            @Valid @RequestBody RescueLocationUpdateRequest request,
            Authentication authentication) {

        checkTeamAccessOrThrow(id, authentication);

        AdminReportResponse report = reportService.getAdminReportById(id);
        MissionState state = getOrCreateMissionState(id);

        if (!state.isTrackingActive || !"EN_ROUTE".equals(state.operationalStage)) {
            throw new IllegalStateException("GPS tracking is not currently active for mission #" + id + ". Please start journey first.");
        }

        String ts = (request.getTimestamp() != null && !request.getTimestamp().isEmpty())
                ? request.getTimestamp()
                : LocalDateTime.now().format(DateTimeFormatter.ISO_DATE_TIME);

        state.currentLatitude = request.getLatitude();
        state.currentLongitude = request.getLongitude();
        state.currentAccuracy = request.getAccuracy() != null ? request.getAccuracy() : 10.0;
        state.lastLocationTimestamp = Instant.now();

        // Append to recorded breadcrumb journey trail
        state.journeyTrail.add(new RescueMissionResponse.GpsPoint(
                request.getLatitude(),
                request.getLongitude(),
                state.currentAccuracy,
                ts
        ));

        return ResponseEntity.ok(toMissionResponse(report));
    }

    /**
     * Retrieves live location, freshness, accuracy, and journey trail for Admin and Rescue Team.
     */
    @GetMapping("/{id}/location")
    public ResponseEntity<Map<String, Object>> getLocation(@PathVariable Long id, Authentication authentication) {
        checkTeamAccessOrThrow(id, authentication);

        AdminReportResponse report = reportService.getAdminReportById(id);
        MissionState state = getOrCreateMissionState(id);

        boolean isStale = true;
        long freshnessSeconds = -1;
        if (state.lastLocationTimestamp != null) {
            freshnessSeconds = Duration.between(state.lastLocationTimestamp, Instant.now()).getSeconds();
            isStale = freshnessSeconds > 60; // Flag as stale if no update for > 60 seconds
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("missionId", id);
        body.put("incidentLocation", Map.of(
                "latitude", report.getLatitude(),
                "longitude", report.getLongitude(),
                "locationDescription", report.getLocationDescription() != null ? report.getLocationDescription() : ""
        ));
        body.put("isTrackingActive", state.isTrackingActive);
        body.put("operationalStage", state.operationalStage);
        body.put("currentLatitude", state.currentLatitude);
        body.put("currentLongitude", state.currentLongitude);
        body.put("currentAccuracy", state.currentAccuracy);
        body.put("lastLocationTimestamp", state.lastLocationTimestamp != null ? state.lastLocationTimestamp.toString() : null);
        body.put("freshnessSeconds", freshnessSeconds);
        body.put("isLocationStale", isStale);
        body.put("journeyTrail", new ArrayList<>(state.journeyTrail));

        return ResponseEntity.ok(body);
    }

    /**
     * Marks arrival on scene.
     */
    @PostMapping("/{id}/arrive")
    public ResponseEntity<RescueMissionResponse> markArrival(
            @PathVariable Long id,
            Authentication authentication) {

        checkTeamAccessOrThrow(id, authentication);

        AdminReportResponse report = reportService.getAdminReportById(id);
        MissionState state = getOrCreateMissionState(id);
        Long userId = extractUserId(authentication);
        String actor = extractActor(authentication);

        state.operationalStage = "ON_SCENE";
        state.arrivedAt = LocalDateTime.now().format(DateTimeFormatter.ISO_DATE_TIME);

        auditService.recordEvent(
                AuditEventType.REPORT_REVIEWED,
                userId,
                id,
                AuditOutcome.SUCCESS,
                "Rescue team recorded arrival on scene at incident location",
                report.getStatus(),
                report.getStatus()
        );

        return ResponseEntity.ok(toMissionResponse(report));
    }

    /**
     * Submits on-site progress assessment update.
     */
    @PostMapping("/{id}/progress")
    public ResponseEntity<RescueMissionResponse> recordProgress(
            @PathVariable Long id,
            @Valid @RequestBody RescueProgressUpdateRequest request,
            Authentication authentication) {

        checkTeamAccessOrThrow(id, authentication);

        AdminReportResponse report = reportService.getAdminReportById(id);
        MissionState state = getOrCreateMissionState(id);
        Long userId = extractUserId(authentication);
        String actor = extractActor(authentication);

        state.operationalStage = "IN_PROGRESS";
        RescueMissionResponse.RescueProgressEntry entry = new RescueMissionResponse.RescueProgressEntry(
                LocalDateTime.now().format(DateTimeFormatter.ISO_DATE_TIME),
                actor,
                request.getSiteAssessment(),
                request.getRoadPassability(),
                request.getObservedHazards(),
                request.getActionsTaken(),
                request.getResourcesRequired()
        );
        state.progressHistory.add(entry);

        auditService.recordEvent(
                AuditEventType.REPORT_REVIEWED,
                userId,
                id,
                AuditOutcome.SUCCESS,
                "Rescue team submitted field progress update: " + request.getSiteAssessment(),
                report.getStatus(),
                report.getStatus()
        );

        return ResponseEntity.ok(toMissionResponse(report));
    }

    /**
     * Submits response outcome report for administrator verification.
     * Note: Incident remains in UNDER_REVIEW; final closure is reserved for administrators.
     */
    @PostMapping("/{id}/outcome")
    public ResponseEntity<RescueMissionResponse> submitOutcome(
            @PathVariable Long id,
            @Valid @RequestBody RescueOutcomeReportRequest request,
            Authentication authentication) {

        checkTeamAccessOrThrow(id, authentication);

        AdminReportResponse report = reportService.getAdminReportById(id);
        MissionState state = getOrCreateMissionState(id);
        Long userId = extractUserId(authentication);
        String actor = extractActor(authentication);

        state.operationalStage = "AWAITING_VERIFICATION";
        state.isTrackingActive = false;
        state.outcomeReport = request;

        // Update report review notes with the outcome summary and keep status UNDER_REVIEW
        reportService.reviewReport(id, "Rescue Team Outcome Submitted by " + actor + ": " + request.getResolutionSummary(), userId, actor);

        auditService.recordEvent(
                AuditEventType.REPORT_REVIEWED,
                userId,
                id,
                AuditOutcome.SUCCESS,
                "Rescue team submitted response outcome for administrator verification",
                report.getStatus(),
                ReportStatus.UNDER_REVIEW
        );

        AdminReportResponse updated = reportService.getAdminReportById(id);
        return ResponseEntity.ok(toMissionResponse(updated));
    }

    /**
     * Administrator requests further action/follow-up from the rescue team.
     */
    @PreAuthorize("hasRole('ADMIN')")
    @PostMapping("/{id}/follow-up")
    public ResponseEntity<RescueMissionResponse> requestFollowUp(
            @PathVariable Long id,
            @Valid @RequestBody RescueFollowUpRequest request,
            Authentication authentication) {

        AdminReportResponse report = reportService.getAdminReportById(id);
        MissionState state = getOrCreateMissionState(id);
        Long userId = extractUserId(authentication);
        String actor = extractActor(authentication);

        state.operationalStage = "FOLLOW_UP_REQUIRED";
        state.adminFollowUpNotes = request.getInstructions().trim();

        // Update report review notes with follow up request
        reportService.reviewReport(id, "Administrator Follow-up Required: " + state.adminFollowUpNotes, userId, actor);

        auditService.recordEvent(
                AuditEventType.REPORT_REVIEWED,
                userId,
                id,
                AuditOutcome.SUCCESS,
                "Administrator requested further response action from rescue team: " + state.adminFollowUpNotes,
                report.getStatus(),
                report.getStatus()
        );

        AdminReportResponse updated = reportService.getAdminReportById(id);
        return ResponseEntity.ok(toMissionResponse(updated));
    }

    private RescueMissionResponse toMissionResponse(AdminReportResponse report) {
        MissionState state = getOrCreateMissionState(report.getId());
        RescueMissionResponse res = new RescueMissionResponse();

        res.setId(report.getId());
        res.setIncidentCategory(report.getIncidentCategory());
        res.setCategoryDisplayName(mapCategory(report.getIncidentCategory()));
        res.setDescription(report.getDescription());
        res.setLocationDescription(report.getLocationDescription());
        res.setLatitude(report.getLatitude());
        res.setLongitude(report.getLongitude());
        res.setReportedTimestamp(report.getReportedTimestamp());
        res.setStatus(report.getStatus());

        // Map status if officially verified or rejected
        if (report.getStatus() == ReportStatus.VERIFIED) {
            res.setOperationalStage("COMPLETED");
        } else if (report.getStatus() == ReportStatus.REJECTED) {
            res.setOperationalStage("REJECTED");
        } else {
            res.setOperationalStage(state.operationalStage);
        }

        res.setAssignedTeam(state.assignedTeam);
        res.setAssignedOfficerId(state.assignedOfficerId);
        res.setAssignedPriority(state.assignedPriority);
        res.setInstructions(state.instructions);
        res.setAssignedAt(state.assignedAt);

        res.setDecisionStatus(state.decisionStatus);
        res.setDecisionReason(state.decisionReason);
        res.setJourneyStartedAt(state.journeyStartedAt);
        res.setArrivedAt(state.arrivedAt);
        res.setTrackingActive(state.isTrackingActive);

        res.setCurrentLatitude(state.currentLatitude);
        res.setCurrentLongitude(state.currentLongitude);
        res.setCurrentAccuracy(state.currentAccuracy);
        if (state.lastLocationTimestamp != null) {
            res.setLastLocationUpdate(state.lastLocationTimestamp.toString());
            res.setLocationStale(Duration.between(state.lastLocationTimestamp, Instant.now()).getSeconds() > 60);
        } else {
            res.setLocationStale(true);
        }

        res.setJourneyTrail(new ArrayList<>(state.journeyTrail));
        res.setProgressHistory(new ArrayList<>(state.progressHistory));
        res.setOutcomeReport(state.outcomeReport);
        res.setAdminFollowUpNotes(state.adminFollowUpNotes);

        try {
            List<ReportPhotoResponse> photos = photoService.getPhotosForReport(report.getId(), null, true);
            res.setPhotos(photos != null ? photos : Collections.emptyList());
        } catch (Exception e) {
            res.setPhotos(Collections.emptyList());
        }

        return res;
    }

    private String mapCategory(IncidentCategory category) {
        if (category == null) return "Observation";
        switch (category) {
            case MUD_SLIDE: return "Landslide";
            case ROAD_SUBSIDENCE: return "Road Blockage";
            case SLOPE_CRACK: return "Ground Cracks";
            case ROCKFALL: return "Falling Rocks";
            case DEBRIS_FLOW: return "Debris Flow";
            case EROSION: return "Slope Erosion";
            case OTHER:
            default: return "Other Observation";
        }
    }

    private Long extractUserId(Authentication authentication) {
        if (authentication == null) return null;
        Object principal = authentication.getPrincipal();
        if (principal instanceof Jwt jwt) {
            Object sub = jwt.getClaims().get("sub");
            if (sub != null) {
                try {
                    return Long.parseLong(sub.toString());
                } catch (NumberFormatException ignored) {}
            }
            Object uid = jwt.getClaims().get("userId");
            if (uid != null) {
                try {
                    return Long.parseLong(uid.toString());
                } catch (NumberFormatException ignored) {}
            }
        }
        return 1L;
    }

    private String extractActor(Authentication authentication) {
        if (authentication == null) return "Rescue Force Personnel";
        if (authentication.getPrincipal() instanceof Jwt jwt) {
            Object nameClaim = jwt.getClaims().get("name");
            if (nameClaim != null) return nameClaim.toString();
        }
        return authentication.getName() != null ? authentication.getName() : "Rescue Force Personnel";
    }
}
