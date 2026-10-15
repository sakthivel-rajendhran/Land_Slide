package com.slopeguard.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * Payload for an administrator requesting further action from the rescue team.
 */
public class RescueFollowUpRequest {

    @NotBlank(message = "Instructions for further action are required.")
    private String instructions;

    public RescueFollowUpRequest() {
    }

    public RescueFollowUpRequest(String instructions) {
        this.instructions = instructions;
    }

    public String getInstructions() {
        return instructions;
    }

    public void setInstructions(String instructions) {
        this.instructions = instructions;
    }
}
