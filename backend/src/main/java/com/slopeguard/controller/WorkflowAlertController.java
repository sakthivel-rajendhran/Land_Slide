package com.slopeguard.controller;

import com.slopeguard.dto.AlertDeliveryResponse;
import com.slopeguard.dto.AlertTransitionRequest;
import com.slopeguard.dto.WorkflowAlertRequest;
import com.slopeguard.dto.WorkflowAlertResponse;
import com.slopeguard.service.WorkflowAlertService;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Controller providing operational alert workflow management:
 * Draft, Submit, Approve, Publish, Reject, Resolve, and Withdraw.
 * Owned by Module 1 (Ragul).
 */
@RestController
@RequestMapping("/api/admin/alerts")
public class WorkflowAlertController {

    private final WorkflowAlertService alertService;

    public WorkflowAlertController(WorkflowAlertService alertService) {
        this.alertService = alertService;
    }

    private Long extractUserId(Jwt jwt) {
        if (jwt == null) return 1L;
        try {
            return Long.valueOf(jwt.getSubject());
        } catch (NumberFormatException e) {
            return 1L;
        }
    }

    /**
     * Lists early-warning alert advisories in the administrative workflow.
     */
    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'RESCUE_FORCE', 'OFFICER')")
    public ResponseEntity<Page<WorkflowAlertResponse>> listAlerts(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String severity,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok(alertService.listAlerts(status, severity, page, size));
    }

    /**
     * Creates a new alert draft. Drafts are never visible publicly.
     */
    @PostMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'RESCUE_FORCE', 'OFFICER')")
    public ResponseEntity<WorkflowAlertResponse> createDraft(@AuthenticationPrincipal Jwt jwt,
                                                             @Valid @RequestBody WorkflowAlertRequest request) {
        Long userId = extractUserId(jwt);
        WorkflowAlertResponse response = alertService.createDraftAlert(request, userId);
        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    /**
     * Retrieves alert details by ID.
     */
    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN', 'RESCUE_FORCE', 'OFFICER')")
    public ResponseEntity<WorkflowAlertResponse> getAlert(@PathVariable String id) {
        return ResponseEntity.ok(alertService.getAlert(id));
    }

    /**
     * Updates an alert in DRAFT status.
     */
    @PutMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN', 'RESCUE_FORCE', 'OFFICER')")
    public ResponseEntity<WorkflowAlertResponse> updateDraft(@PathVariable String id,
                                                             @AuthenticationPrincipal Jwt jwt,
                                                             @Valid @RequestBody WorkflowAlertRequest request) {
        Long userId = extractUserId(jwt);
        return ResponseEntity.ok(alertService.updateDraftAlert(id, request, userId));
    }

    /**
     * Submits a draft alert for supervisor review (DRAFT -> PENDING_REVIEW).
     */
    @PostMapping("/{id}/submit")
    @PreAuthorize("hasAnyRole('ADMIN', 'RESCUE_FORCE', 'OFFICER')")
    public ResponseEntity<WorkflowAlertResponse> submitAlert(@PathVariable String id,
                                                             @AuthenticationPrincipal Jwt jwt) {
        Long userId = extractUserId(jwt);
        return ResponseEntity.ok(alertService.submitAlert(id, userId));
    }

    /**
     * Approves an alert for publication (PENDING_REVIEW -> APPROVED).
     * Rule: The user who created the draft cannot approve it (self-approval prohibited with 403 Forbidden).
     */
    @PostMapping("/{id}/approve")
    @PreAuthorize("hasAnyRole('ADMIN', 'RESCUE_FORCE', 'OFFICER')")
    public ResponseEntity<WorkflowAlertResponse> approveAlert(@PathVariable String id,
                                                              @AuthenticationPrincipal Jwt jwt) {
        Long userId = extractUserId(jwt);
        return ResponseEntity.ok(alertService.approveAlert(id, userId));
    }

    /**
     * Activates public hazard alert broadcast (APPROVED -> PUBLISHED).
     */
    @PostMapping("/{id}/publish")
    @PreAuthorize("hasAnyRole('ADMIN', 'RESCUE_FORCE', 'OFFICER')")
    public ResponseEntity<WorkflowAlertResponse> publishAlert(@PathVariable String id,
                                                              @AuthenticationPrincipal Jwt jwt) {
        Long userId = extractUserId(jwt);
        return ResponseEntity.ok(alertService.publishAlert(id, userId));
    }

    /**
     * Rejects an alert under review back to DRAFT with justification (PENDING_REVIEW -> DRAFT).
     */
    @PostMapping("/{id}/reject")
    @PreAuthorize("hasAnyRole('ADMIN', 'RESCUE_FORCE', 'OFFICER')")
    public ResponseEntity<WorkflowAlertResponse> rejectAlert(@PathVariable String id,
                                                             @AuthenticationPrincipal Jwt jwt,
                                                             @RequestBody AlertTransitionRequest request) {
        Long userId = extractUserId(jwt);
        String reason = request != null ? request.getReason() : null;
        return ResponseEntity.ok(alertService.rejectAlert(id, reason, userId));
    }

    /**
     * Resolves an active public advisory once hazard threat subsides (PUBLISHED -> RESOLVED).
     */
    @PostMapping("/{id}/resolve")
    @PreAuthorize("hasAnyRole('ADMIN', 'RESCUE_FORCE', 'OFFICER')")
    public ResponseEntity<WorkflowAlertResponse> resolveAlert(@PathVariable String id,
                                                              @AuthenticationPrincipal Jwt jwt,
                                                              @RequestBody AlertTransitionRequest request) {
        Long userId = extractUserId(jwt);
        String reason = request != null ? request.getReason() : null;
        return ResponseEntity.ok(alertService.resolveAlert(id, reason, userId));
    }

    /**
     * Withdraws an erroneous or superseded public advisory (PUBLISHED -> WITHDRAWN).
     */
    @PostMapping("/{id}/withdraw")
    @PreAuthorize("hasAnyRole('ADMIN', 'RESCUE_FORCE', 'OFFICER')")
    public ResponseEntity<WorkflowAlertResponse> withdrawAlert(@PathVariable String id,
                                                               @AuthenticationPrincipal Jwt jwt,
                                                               @RequestBody AlertTransitionRequest request) {
        Long userId = extractUserId(jwt);
        String reason = request != null ? request.getReason() : null;
        return ResponseEntity.ok(alertService.withdrawAlert(id, reason, userId));
    }

    /**
     * Lists multi-channel delivery dispatch rows for an alert.
     */
    @GetMapping("/{id}/delivery")
    @PreAuthorize("hasAnyRole('ADMIN', 'RESCUE_FORCE', 'OFFICER')")
    public ResponseEntity<List<AlertDeliveryResponse>> getDeliveries(@PathVariable String id) {
        return ResponseEntity.ok(alertService.getDeliveries(id));
    }
}
