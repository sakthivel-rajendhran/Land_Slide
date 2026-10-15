package com.slopeguard.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * Payload for submitting a response outcome report for administrator verification.
 */
public class RescueOutcomeReportRequest {

    @NotBlank(message = "Resolution summary is required.")
    private String resolutionSummary;

    private String actionsPerformed;
    private String residualHazards;
    private String recommendations;

    public RescueOutcomeReportRequest() {
    }

    public RescueOutcomeReportRequest(String resolutionSummary, String actionsPerformed, String residualHazards, String recommendations) {
        this.resolutionSummary = resolutionSummary;
        this.actionsPerformed = actionsPerformed;
        this.residualHazards = residualHazards;
        this.recommendations = recommendations;
    }

    public String getResolutionSummary() {
        return resolutionSummary;
    }

    public void setResolutionSummary(String resolutionSummary) {
        this.resolutionSummary = resolutionSummary;
    }

    public String getActionsPerformed() {
        return actionsPerformed;
    }

    public void setActionsPerformed(String actionsPerformed) {
        this.actionsPerformed = actionsPerformed;
    }

    public String getResidualHazards() {
        return residualHazards;
    }

    public void setResidualHazards(String residualHazards) {
        this.residualHazards = residualHazards;
    }

    public String getRecommendations() {
        return recommendations;
    }

    public void setRecommendations(String recommendations) {
        this.recommendations = recommendations;
    }
}
