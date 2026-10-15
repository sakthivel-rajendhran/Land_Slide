package com.slopeguard.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * Payload for accepting or declining an assigned rescue mission.
 */
public class RescueMissionDecisionRequest {

    @NotBlank(message = "Decision must be either ACCEPT or DECLINE.")
    @Pattern(regexp = "^(?i)(ACCEPT|DECLINE)$", message = "Decision must be ACCEPT or DECLINE.")
    private String decision;

    private String reason;

    public RescueMissionDecisionRequest() {
    }

    public RescueMissionDecisionRequest(String decision, String reason) {
        this.decision = decision;
        this.reason = reason;
    }

    public String getDecision() {
        return decision;
    }

    public void setDecision(String decision) {
        this.decision = decision;
    }

    public String getReason() {
        return reason;
    }

    public void setReason(String reason) {
        this.reason = reason;
    }
}
