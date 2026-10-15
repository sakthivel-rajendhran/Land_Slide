package com.slopeguard.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.slopeguard.model.IncidentCategory;
import com.slopeguard.model.ReportStatus;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Complete mission state DTO for rescue teams and operations center monitoring.
 */
public class RescueMissionResponse {

    private Long id;
    private IncidentCategory incidentCategory;
    private String categoryDisplayName;
    private String description;
    private String locationDescription;
    private Double latitude;
    private Double longitude;
    private LocalDateTime reportedTimestamp;
    private ReportStatus status;
    private String operationalStage;

    // Assignment metadata
    private String assignedTeam;
    private String assignedRescueForceId;
    private String assignedOfficerId;
    private String assignedPriority;
    private String instructions;
    private String assignedAt;

    // Decision state
    private String decisionStatus;
    private String decisionReason;

    // Journey and live tracking
    private String journeyStartedAt;
    private String arrivedAt;

    @JsonProperty("isTrackingActive")
    private boolean isTrackingActive;

    private String lastLocationUpdate;
    private Double currentLatitude;
    private Double currentLongitude;
    private Double currentAccuracy;

    @JsonProperty("isLocationStale")
    private boolean isLocationStale;
    private List<GpsPoint> journeyTrail = new ArrayList<>();

    // Photos & Evidence
    private List<ReportPhotoResponse> photos = new ArrayList<>();

    // Progress and Outcome
    private List<RescueProgressEntry> progressHistory = new ArrayList<>();
    private RescueOutcomeReportRequest outcomeReport;
    private String adminFollowUpNotes;

    public RescueMissionResponse() {
    }

    public static class GpsPoint {
        private Double latitude;
        private Double longitude;
        private Double accuracy;
        private String timestamp;

        public GpsPoint() {}
        public GpsPoint(Double latitude, Double longitude, Double accuracy, String timestamp) {
            this.latitude = latitude;
            this.longitude = longitude;
            this.accuracy = accuracy;
            this.timestamp = timestamp;
        }
        public Double getLatitude() { return latitude; }
        public void setLatitude(Double latitude) { this.latitude = latitude; }
        public Double getLongitude() { return longitude; }
        public void setLongitude(Double longitude) { this.longitude = longitude; }
        public Double getAccuracy() { return accuracy; }
        public void setAccuracy(Double accuracy) { this.accuracy = accuracy; }
        public String getTimestamp() { return timestamp; }
        public void setTimestamp(String timestamp) { this.timestamp = timestamp; }
    }

    public static class RescueProgressEntry {
        private String timestamp;
        private String actor;
        private String siteAssessment;
        private String roadPassability;
        private String observedHazards;
        private String actionsTaken;
        private String resourcesRequired;

        public RescueProgressEntry() {}
        public RescueProgressEntry(String timestamp, String actor, String siteAssessment, String roadPassability, String observedHazards, String actionsTaken, String resourcesRequired) {
            this.timestamp = timestamp;
            this.actor = actor;
            this.siteAssessment = siteAssessment;
            this.roadPassability = roadPassability;
            this.observedHazards = observedHazards;
            this.actionsTaken = actionsTaken;
            this.resourcesRequired = resourcesRequired;
        }
        public String getTimestamp() { return timestamp; }
        public void setTimestamp(String timestamp) { this.timestamp = timestamp; }
        public String getActor() { return actor; }
        public void setActor(String actor) { this.actor = actor; }
        public String getSiteAssessment() { return siteAssessment; }
        public void setSiteAssessment(String siteAssessment) { this.siteAssessment = siteAssessment; }
        public String getRoadPassability() { return roadPassability; }
        public void setRoadPassability(String roadPassability) { this.roadPassability = roadPassability; }
        public String getObservedHazards() { return observedHazards; }
        public void setObservedHazards(String observedHazards) { this.observedHazards = observedHazards; }
        public String getActionsTaken() { return actionsTaken; }
        public void setActionsTaken(String actionsTaken) { this.actionsTaken = actionsTaken; }
        public String getResourcesRequired() { return resourcesRequired; }
        public void setResourcesRequired(String resourcesRequired) { this.resourcesRequired = resourcesRequired; }
    }

    // Getters and Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public IncidentCategory getIncidentCategory() { return incidentCategory; }
    public void setIncidentCategory(IncidentCategory incidentCategory) { this.incidentCategory = incidentCategory; }

    public String getCategoryDisplayName() { return categoryDisplayName; }
    public void setCategoryDisplayName(String categoryDisplayName) { this.categoryDisplayName = categoryDisplayName; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public String getLocationDescription() { return locationDescription; }
    public void setLocationDescription(String locationDescription) { this.locationDescription = locationDescription; }

    public Double getLatitude() { return latitude; }
    public void setLatitude(Double latitude) { this.latitude = latitude; }

    public Double getLongitude() { return longitude; }
    public void setLongitude(Double longitude) { this.longitude = longitude; }

    public LocalDateTime getReportedTimestamp() { return reportedTimestamp; }
    public void setReportedTimestamp(LocalDateTime reportedTimestamp) { this.reportedTimestamp = reportedTimestamp; }

    public ReportStatus getStatus() { return status; }
    public void setStatus(ReportStatus status) { this.status = status; }

    public String getOperationalStage() { return operationalStage; }
    public void setOperationalStage(String operationalStage) { this.operationalStage = operationalStage; }

    public String getAssignedTeam() { return assignedTeam; }
    public void setAssignedTeam(String assignedTeam) { this.assignedTeam = assignedTeam; }

    public String getAssignedRescueForceId() { return assignedRescueForceId != null ? assignedRescueForceId : assignedOfficerId; }
    public void setAssignedRescueForceId(String assignedRescueForceId) {
        this.assignedRescueForceId = assignedRescueForceId;
        this.assignedOfficerId = assignedRescueForceId;
    }

    public String getAssignedOfficerId() { return assignedOfficerId != null ? assignedOfficerId : assignedRescueForceId; }
    public void setAssignedOfficerId(String assignedOfficerId) {
        this.assignedOfficerId = assignedOfficerId;
        this.assignedRescueForceId = assignedOfficerId;
    }

    public String getAssignedPriority() { return assignedPriority; }
    public void setAssignedPriority(String assignedPriority) { this.assignedPriority = assignedPriority; }

    public String getInstructions() { return instructions; }
    public void setInstructions(String instructions) { this.instructions = instructions; }

    public String getAssignedAt() { return assignedAt; }
    public void setAssignedAt(String assignedAt) { this.assignedAt = assignedAt; }

    public String getDecisionStatus() { return decisionStatus; }
    public void setDecisionStatus(String decisionStatus) { this.decisionStatus = decisionStatus; }

    public String getDecisionReason() { return decisionReason; }
    public void setDecisionReason(String decisionReason) { this.decisionReason = decisionReason; }

    public String getJourneyStartedAt() { return journeyStartedAt; }
    public void setJourneyStartedAt(String journeyStartedAt) { this.journeyStartedAt = journeyStartedAt; }

    public String getArrivedAt() { return arrivedAt; }
    public void setArrivedAt(String arrivedAt) { this.arrivedAt = arrivedAt; }

    @JsonProperty("isTrackingActive")
    public boolean isTrackingActive() { return isTrackingActive; }
    public void setTrackingActive(boolean trackingActive) { isTrackingActive = trackingActive; }

    public String getLastLocationUpdate() { return lastLocationUpdate; }
    public void setLastLocationUpdate(String lastLocationUpdate) { this.lastLocationUpdate = lastLocationUpdate; }

    public Double getCurrentLatitude() { return currentLatitude; }
    public void setCurrentLatitude(Double currentLatitude) { this.currentLatitude = currentLatitude; }

    public Double getCurrentLongitude() { return currentLongitude; }
    public void setCurrentLongitude(Double currentLongitude) { this.currentLongitude = currentLongitude; }

    public Double getCurrentAccuracy() { return currentAccuracy; }
    public void setCurrentAccuracy(Double currentAccuracy) { this.currentAccuracy = currentAccuracy; }

    @JsonProperty("isLocationStale")
    public boolean isLocationStale() { return isLocationStale; }
    public void setLocationStale(boolean locationStale) { isLocationStale = locationStale; }

    public List<GpsPoint> getJourneyTrail() { return journeyTrail; }
    public void setJourneyTrail(List<GpsPoint> journeyTrail) { this.journeyTrail = journeyTrail; }

    public List<ReportPhotoResponse> getPhotos() { return photos; }
    public void setPhotos(List<ReportPhotoResponse> photos) { this.photos = photos; }

    public List<RescueProgressEntry> getProgressHistory() { return progressHistory; }
    public void setProgressHistory(List<RescueProgressEntry> progressHistory) { this.progressHistory = progressHistory; }

    public RescueOutcomeReportRequest getOutcomeReport() { return outcomeReport; }
    public void setOutcomeReport(RescueOutcomeReportRequest outcomeReport) { this.outcomeReport = outcomeReport; }

    public String getAdminFollowUpNotes() { return adminFollowUpNotes; }
    public void setAdminFollowUpNotes(String adminFollowUpNotes) { this.adminFollowUpNotes = adminFollowUpNotes; }
}
