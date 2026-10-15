package com.slopeguard.controller;

import com.slopeguard.dto.MonitoredAreaRequest;
import com.slopeguard.dto.MonitoredAreaResponse;
import com.slopeguard.service.AreaService;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Controller providing administrative monitored sector registry management.
 * Owned by Module 1 (Ragul).
 */
@RestController
@RequestMapping("/api/admin/areas")
public class AreaController {

    private final AreaService areaService;

    public AreaController(AreaService areaService) {
        this.areaService = areaService;
    }

    /**
     * Lists monitored areas with search and status filtering.
     * Accessible by ADMIN and OFFICER roles.
     */
    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'RESCUE_FORCE', 'OFFICER')")
    public ResponseEntity<Page<MonitoredAreaResponse>> listAreas(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok(areaService.listAreas(search, status, page, size));
    }

    /**
     * Registers a new monitored sector. Restricted to administrators.
     */
    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<MonitoredAreaResponse> createArea(@Valid @RequestBody MonitoredAreaRequest request) {
        MonitoredAreaResponse created = areaService.createArea(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    /**
     * Retrieves sector details by ID. Accessible by ADMIN, RESCUE_FORCE, and OFFICER.
     */
    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN', 'RESCUE_FORCE', 'OFFICER')")
    public ResponseEntity<MonitoredAreaResponse> getArea(@PathVariable Long id) {
        return ResponseEntity.ok(areaService.getArea(id));
    }

    /**
     * Updates monitored sector details. Restricted to administrators.
     */
    @PutMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<MonitoredAreaResponse> updateArea(@PathVariable Long id,
                                                            @Valid @RequestBody MonitoredAreaRequest request) {
        return ResponseEntity.ok(areaService.updateArea(id, request));
    }

    /**
     * Toggles sector monitoring status (ACTIVE / INACTIVE). Restricted to administrators.
     */
    @RequestMapping(value = "/{id}/status", method = {RequestMethod.PUT, RequestMethod.PATCH})
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<MonitoredAreaResponse> updateAreaStatus(
            @PathVariable Long id,
            @RequestParam(name = "active", required = false) Boolean activeParam,
            @RequestBody(required = false) Map<String, Object> body) {
        String status = "ACTIVE";
        if (activeParam != null) {
            status = activeParam ? "ACTIVE" : "INACTIVE";
        } else if (body != null) {
            if (body.containsKey("status") && body.get("status") != null) {
                status = body.get("status").toString();
            } else if (body.containsKey("active") && body.get("active") != null) {
                boolean active = Boolean.parseBoolean(body.get("active").toString());
                status = active ? "ACTIVE" : "INACTIVE";
            }
        }
        return ResponseEntity.ok(areaService.updateAreaStatus(id, status));
    }
}
