package com.slopeguard.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * Payload for on-site progress updates from a rescue team.
 */
public class RescueProgressUpdateRequest {

    @NotBlank(message = "Site assessment summary is required.")
    private String siteAssessment;

    private String roadPassability;
    private String observedHazards;
    private String actionsTaken;
    private String resourcesRequired;
    private Boolean furtherActionNeeded;

    public RescueProgressUpdateRequest() {
    }

    public String getSiteAssessment() {
        return siteAssessment;
    }

    public void setSiteAssessment(String siteAssessment) {
        this.siteAssessment = siteAssessment;
    }

    public String getRoadPassability() {
        return roadPassability;
    }

    public void setRoadPassability(String roadPassability) {
        this.roadPassability = roadPassability;
    }

    public String getObservedHazards() {
        return observedHazards;
    }

    public void setObservedHazards(String observedHazards) {
        this.observedHazards = observedHazards;
    }

    public String getActionsTaken() {
        return actionsTaken;
    }

    public void setActionsTaken(String actionsTaken) {
        this.actionsTaken = actionsTaken;
    }

    public String getResourcesRequired() {
        return resourcesRequired;
    }

    public void setResourcesRequired(String resourcesRequired) {
        this.resourcesRequired = resourcesRequired;
    }

    public Boolean getFurtherActionNeeded() {
        return furtherActionNeeded;
    }

    public void setFurtherActionNeeded(Boolean furtherActionNeeded) {
        this.furtherActionNeeded = furtherActionNeeded;
    }
}
