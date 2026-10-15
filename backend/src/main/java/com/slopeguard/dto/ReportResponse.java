package com.slopeguard.dto;

import com.slopeguard.model.IncidentCategory;
import com.slopeguard.model.ReportStatus;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Public response DTO for citizen landslide reports.
 * <p>
 * Privacy Rule: Does NOT expose personal reporter names or identifying contact information
 * in public responses to protect citizen privacy.
 */
public class ReportResponse {

    private Long id;
    private IncidentCategory incidentCategory;
    private String description;
    private String locationDescription;
    private Double latitude;
    private Double longitude;
    private ReportStatus status;
    private LocalDateTime reportedTimestamp;
    private LocalDateTime observationTimestamp;
    private String environmentalObservations;
    private String reviewNotes;
    private LocalDateTime statusUpdatedAt;
    private List<ReportPhotoResponse> photos = new ArrayList<>();

    public ReportResponse() {
    }

    public ReportResponse(Long id, IncidentCategory incidentCategory, String description,
                          String locationDescription, Double latitude, Double longitude,
                          ReportStatus status, LocalDateTime reportedTimestamp) {
        this(id, incidentCategory, description, locationDescription, latitude, longitude,
                status, reportedTimestamp, null, null, new ArrayList<>());
    }

    public ReportResponse(Long id, IncidentCategory incidentCategory, String description,
                          String locationDescription, Double latitude, Double longitude,
                          ReportStatus status, LocalDateTime reportedTimestamp,
                          LocalDateTime observationTimestamp, String environmentalObservations,
                          List<ReportPhotoResponse> photos) {
        this.id = id;
        this.incidentCategory = incidentCategory;
        this.description = description;
        this.locationDescription = locationDescription;
        this.latitude = latitude;
        this.longitude = longitude;
        this.status = status;
        this.reportedTimestamp = reportedTimestamp;
        this.observationTimestamp = observationTimestamp;
        this.environmentalObservations = environmentalObservations;
        this.photos = photos != null ? photos : new ArrayList<>();
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public IncidentCategory getIncidentCategory() {
        return incidentCategory;
    }

    public void setIncidentCategory(IncidentCategory incidentCategory) {
        this.incidentCategory = incidentCategory;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public String getLocationDescription() {
        return locationDescription;
    }

    public void setLocationDescription(String locationDescription) {
        this.locationDescription = locationDescription;
    }

    public Double getLatitude() {
        return latitude;
    }

    public void setLatitude(Double latitude) {
        this.latitude = latitude;
    }

    public Double getLongitude() {
        return longitude;
    }

    public void setLongitude(Double longitude) {
        this.longitude = longitude;
    }

    public ReportStatus getStatus() {
        return status;
    }

    public void setStatus(ReportStatus status) {
        this.status = status;
    }

    public LocalDateTime getReportedTimestamp() {
        return reportedTimestamp;
    }

    public void setReportedTimestamp(LocalDateTime reportedTimestamp) {
        this.reportedTimestamp = reportedTimestamp;
    }

    public LocalDateTime getObservationTimestamp() {
        return observationTimestamp;
    }

    public void setObservationTimestamp(LocalDateTime observationTimestamp) {
        this.observationTimestamp = observationTimestamp;
    }

    public String getEnvironmentalObservations() {
        return environmentalObservations;
    }

    public void setEnvironmentalObservations(String environmentalObservations) {
        this.environmentalObservations = environmentalObservations;
    }

    public List<ReportPhotoResponse> getPhotos() {
        return photos;
    }

    public void setPhotos(List<ReportPhotoResponse> photos) {
        this.photos = photos != null ? photos : new ArrayList<>();
    }

    public String getReviewNotes() {
        return reviewNotes;
    }

    public void setReviewNotes(String reviewNotes) {
        this.reviewNotes = reviewNotes;
    }

    public LocalDateTime getStatusUpdatedAt() {
        return statusUpdatedAt;
    }

    public void setStatusUpdatedAt(LocalDateTime statusUpdatedAt) {
        this.statusUpdatedAt = statusUpdatedAt;
    }
}
