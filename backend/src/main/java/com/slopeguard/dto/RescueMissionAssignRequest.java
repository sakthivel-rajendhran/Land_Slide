package com.slopeguard.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * Payload for assigning an incident report to a specific Rescue Force team.
 */
public class RescueMissionAssignRequest {

    @NotBlank(message = "Rescue Force team ID is required")
    private String teamId;

    private String teamName;
    private String priority;
    private String instructions;
    private String responseWindow;

    public RescueMissionAssignRequest() {
    }

    public RescueMissionAssignRequest(String teamId, String teamName, String priority, String instructions, String responseWindow) {
        this.teamId = teamId;
        this.teamName = teamName;
        this.priority = priority;
        this.instructions = instructions;
        this.responseWindow = responseWindow;
    }

    public String getTeamId() {
        return teamId;
    }

    public void setTeamId(String teamId) {
        this.teamId = teamId;
    }

    public String getTeamName() {
        return teamName;
    }

    public void setTeamName(String teamName) {
        this.teamName = teamName;
    }

    public String getPriority() {
        return priority;
    }

    public void setPriority(String priority) {
        this.priority = priority;
    }

    public String getInstructions() {
        return instructions;
    }

    public void setInstructions(String instructions) {
        this.instructions = instructions;
    }

    public String getResponseWindow() {
        return responseWindow;
    }

    public void setResponseWindow(String responseWindow) {
        this.responseWindow = responseWindow;
    }
}
