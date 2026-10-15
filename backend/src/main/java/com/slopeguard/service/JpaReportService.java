package com.slopeguard.service;

import com.slopeguard.dto.AdminReportResponse;
import com.slopeguard.dto.ReportCreateRequest;
import com.slopeguard.dto.ReportPhotoResponse;
import com.slopeguard.dto.ReportResponse;
import com.slopeguard.dto.ReportStatusUpdateRequest;
import com.slopeguard.exception.InvalidStatusTransitionException;
import com.slopeguard.exception.ResourceNotFoundException;
import com.slopeguard.model.AuditEventType;
import com.slopeguard.model.AuditOutcome;
import com.slopeguard.model.IncidentCategory;
import com.slopeguard.model.IncidentReport;
import com.slopeguard.model.ReportPhotoMetadata;
import com.slopeguard.model.ReportStatus;
import com.slopeguard.model.ReportStatusAuditLog;
import com.slopeguard.repository.IncidentReportRepository;
import com.slopeguard.repository.ReportStatusAuditLogRepository;
import jakarta.annotation.PostConstruct;
import org.springframework.context.annotation.Primary;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import com.slopeguard.repository.UserRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Production MySQL-backed implementation of {@link ReportService}.
 * Manages citizen landslide incident reports, administrative verification queues, and audit trails.
 */
@Service
@Primary
public class JpaReportService implements ReportService {

    private final IncidentReportRepository reportRepository;
    private final ReportStatusAuditLogRepository statusAuditLogRepository;
    private final AuditService auditService;
    private final UserRepository userRepository;
    private final JdbcTemplate jdbcTemplate;

    public JpaReportService(IncidentReportRepository reportRepository,
                            ReportStatusAuditLogRepository statusAuditLogRepository,
                            AuditService auditService,
                            UserRepository userRepository,
                            JdbcTemplate jdbcTemplate) {
        this.reportRepository = reportRepository;
        this.statusAuditLogRepository = statusAuditLogRepository;
        this.auditService = auditService;
        this.userRepository = userRepository;
        this.jdbcTemplate = jdbcTemplate;
    }

    @PostConstruct
    @Transactional
    public void init() {
        if (reportRepository.count() == 0) {
            seedInitialDemoReports();
        }
    }

    private void seedInitialDemoReports() {
        ReportCreateRequest seed1 = new ReportCreateRequest(
                "Local Resident (Mawlai)",
                "Rockfall blocking half of the bypass road near Mawlai stream bridge following heavy morning showers.",
                25.6012,
                91.8791,
                "Mawlai Bypass Bridge, Shillong, Meghalaya",
                IncidentCategory.ROCKFALL,
                LocalDateTime.now().minusHours(5)
        );
        createReport(seed1);

        ReportCreateRequest seed2 = new ReportCreateRequest(
                "Highway Patrol Officer",
                "Fresh mudslide and minor road subsidence along NH-29 hillside curve. Slope tension cracks visible above cut slope.",
                25.6598,
                94.0954,
                "NH-29 Km Marker 42, Kohima, Nagaland",
                IncidentCategory.ROAD_SUBSIDENCE,
                LocalDateTime.now().minusHours(3)
        );
        createReport(seed2);
    }

    @Override
    @Transactional
    public ReportResponse createReport(ReportCreateRequest request) {
        return createReport(request, null, null);
    }

    @Override
    @Transactional
    public ReportResponse createReport(ReportCreateRequest request, Long reporterUserId, String reporterFullName) {
        if (request.getObservationTimestamp() != null &&
                request.getObservationTimestamp().isAfter(LocalDateTime.now().plusMinutes(5))) {
            throw new IllegalArgumentException("Observation timestamp cannot be in the future.");
        }

        LocalDateTime timestamp = (request.getReportedTimestamp() != null)
                ? request.getReportedTimestamp()
                : LocalDateTime.now();

        String effectiveReporterName = (request.getReporterName() != null && !request.getReporterName().isBlank())
                ? request.getReporterName()
                : reporterFullName;

        if (reporterUserId != null) {
            ensureUserExists(reporterUserId, effectiveReporterName);
        }

        IncidentReport report = new IncidentReport(
                null,
                reporterUserId,
                effectiveReporterName,
                request.getDescription(),
                request.getLatitude(),
                request.getLongitude(),
                request.getLocationDescription(),
                request.getIncidentCategory(),
                timestamp
        );

        report.setObservationTimestamp(request.getObservationTimestamp());
        report.setEnvironmentalObservations(request.getEnvironmentalObservations());
        report.setStatus(ReportStatus.PENDING);
        report.setUpdatedAt(LocalDateTime.now());
        report.setStatusUpdatedAt(LocalDateTime.now());

        IncidentReport saved = reportRepository.save(report);

        // Record audit event
        auditService.recordEvent(
                AuditEventType.REPORT_SUBMITTED,
                reporterUserId,
                saved.getId(),
                AuditOutcome.SUCCESS,
                "Citizen landslide hazard report submitted for category: " + request.getIncidentCategory(),
                null,
                ReportStatus.PENDING
        );

        return mapToPublicResponse(saved);
    }

    @Override
    @Transactional(readOnly = true)
    public List<ReportResponse> getAllPublicReports() {
        List<IncidentReport> reports = reportRepository.findAllByOrderByReportedTimestampDesc();
        List<ReportResponse> responses = new ArrayList<>(reports.size());
        for (IncidentReport r : reports) {
            responses.add(mapToPublicResponse(r));
        }
        return Collections.unmodifiableList(responses);
    }

    @Override
    @Transactional(readOnly = true)
    public List<ReportResponse> getReportsForCitizen(Long citizenUserId) {
        if (citizenUserId == null) {
            return Collections.emptyList();
        }

        List<IncidentReport> reports = reportRepository.findByReporterUserIdOrderByReportedTimestampDesc(citizenUserId);
        List<ReportResponse> responses = new ArrayList<>(reports.size());
        for (IncidentReport r : reports) {
            responses.add(mapToPublicResponse(r));
        }
        return Collections.unmodifiableList(responses);
    }

    @Override
    @Transactional(readOnly = true)
    public ReportResponse getReportByIdSecured(Long id, Long requesterUserId, boolean isAdmin) {
        IncidentReport report = findReportOrThrow(id);

        if (!isAdmin && (requesterUserId == null || report.getReporterUserId() == null
                || !report.getReporterUserId().equals(requesterUserId))) {
            throw new AccessDeniedException("Access is denied: You do not own this incident report.");
        }

        return mapToPublicResponse(report);
    }

    @Override
    @Transactional(readOnly = true)
    public ReportResponse getPublicReportById(Long id) {
        IncidentReport report = findReportOrThrow(id);
        return mapToPublicResponse(report);
    }

    @Override
    @Transactional(readOnly = true)
    public IncidentReport getReportEntity(Long id) {
        return findReportOrThrow(id);
    }

    @Override
    @Transactional(readOnly = true)
    public List<AdminReportResponse> getAllAdminReports() {
        return getAdminReports(null, null, "newest", 0, 100);
    }

    @Override
    @Transactional(readOnly = true)
    public List<AdminReportResponse> getAdminReports(ReportStatus status, IncidentCategory category, String sort, int page, int size) {
        if (page < 0) {
            throw new IllegalArgumentException("Page index cannot be negative.");
        }
        if (size < 1 || size > 100) {
            throw new IllegalArgumentException("Page size must be between 1 and 100.");
        }

        Sort.Direction direction = ("oldest".equalsIgnoreCase(sort) || "asc".equalsIgnoreCase(sort))
                ? Sort.Direction.ASC
                : Sort.Direction.DESC;
        Pageable pageable = PageRequest.of(page, size, Sort.by(direction, "reportedTimestamp"));

        Page<IncidentReport> reportPage = reportRepository.findByFilters(status, category, pageable);

        List<AdminReportResponse> responses = new ArrayList<>();
        for (IncidentReport r : reportPage.getContent()) {
            responses.add(mapToAdminResponse(r));
        }
        return Collections.unmodifiableList(responses);
    }

    @Override
    @Transactional(readOnly = true)
    public int countAdminReports(ReportStatus status, IncidentCategory category) {
        return (int) reportRepository.countByFilters(status, category);
    }

    @Override
    @Transactional(readOnly = true)
    public AdminReportResponse getAdminReportById(Long id) {
        IncidentReport report = findReportOrThrow(id);
        return mapToAdminResponse(report);
    }

    @Override
    @Transactional(readOnly = true)
    public List<AdminReportResponse> getPendingAdminReports(String sort, int page, int size) {
        return getAdminReports(ReportStatus.PENDING, null, sort, page, size);
    }

    @Override
    @Transactional
    public AdminReportResponse reviewReport(Long id, String reviewNote, Long adminUserId, String adminEmail) {
        IncidentReport report = findReportOrThrow(id);

        ReportStatus previousStatus = report.getStatus();
        report.setReviewNotes(reviewNote);
        report.setUpdatedAt(LocalDateTime.now());

        if (previousStatus == ReportStatus.PENDING) {
            report.setStatus(ReportStatus.UNDER_REVIEW);
        }

        IncidentReport saved = reportRepository.save(report);

        auditService.recordEvent(
                AuditEventType.REPORT_REVIEWED,
                adminUserId,
                id,
                AuditOutcome.SUCCESS,
                "Administrator recorded review note: " + reviewNote,
                previousStatus,
                saved.getStatus()
        );

        return mapToAdminResponse(saved);
    }

    @Override
    @Transactional
    public AdminReportResponse updateReportStatus(Long id, ReportStatusUpdateRequest request) {
        return updateReportStatus(id, request, null, "admin");
    }

    @Override
    @Transactional(noRollbackFor = InvalidStatusTransitionException.class)
    public AdminReportResponse updateReportStatus(Long id, ReportStatusUpdateRequest request, Long adminUserId, String adminEmail) {
        IncidentReport report = findReportOrThrow(id);

        ReportStatus currentStatus = report.getStatus();
        ReportStatus newStatus = request.getStatus();

        if (newStatus == null) {
            throw new IllegalArgumentException("Target status cannot be null.");
        }

        if (newStatus == ReportStatus.PENDING) {
            auditService.recordEvent(
                    AuditEventType.REPORT_STATUS_CHANGED,
                    adminUserId,
                    id,
                    AuditOutcome.FAILURE,
                    "Attempted illegal status transition: cannot update or revert report to PENDING.",
                    currentStatus,
                    newStatus
            );
            throw new InvalidStatusTransitionException(String.format(
                    "Cannot update or revert report #%d to 'PENDING' status.", id
            ));
        }

        if (!isValidTransition(currentStatus, newStatus)) {
            auditService.recordEvent(
                    AuditEventType.REPORT_STATUS_CHANGED,
                    adminUserId,
                    id,
                    AuditOutcome.FAILURE,
                    String.format("Unsupported status transition on report #%d from %s to %s.", id, currentStatus, newStatus),
                    currentStatus,
                    newStatus
            );
            throw new InvalidStatusTransitionException(String.format(
                    "Unsupported status transition on report #%d: cannot transition from '%s' to '%s'.",
                    id, currentStatus, newStatus
            ));
        }

        if (currentStatus == newStatus) {
            if (request.getReviewNotes() != null) {
                report.setReviewNotes(request.getReviewNotes());
                report.setUpdatedAt(LocalDateTime.now());
                report = reportRepository.save(report);
            }
            return mapToAdminResponse(report);
        }

        report.setStatus(newStatus);
        report.setStatusUpdatedAt(LocalDateTime.now());
        report.setUpdatedAt(LocalDateTime.now());
        if (request.getReviewNotes() != null && !request.getReviewNotes().isBlank()) {
            report.setReviewNotes(request.getReviewNotes());
        }

        IncidentReport saved = reportRepository.save(report);

        // Record audit event
        auditService.recordEvent(
                AuditEventType.REPORT_STATUS_CHANGED,
                adminUserId,
                id,
                AuditOutcome.SUCCESS,
                "Report status changed to " + newStatus + (request.getReviewNotes() != null ? " (" + request.getReviewNotes() + ")" : ""),
                currentStatus,
                newStatus
        );

        // Record legacy status audit log entry
        ReportStatusAuditLog legacyLog = new ReportStatusAuditLog(
                null,
                id,
                currentStatus,
                newStatus,
                adminUserId,
                adminEmail,
                request.getReviewNotes()
        );
        statusAuditLogRepository.save(legacyLog);

        return mapToAdminResponse(saved);
    }

    private boolean isValidTransition(ReportStatus from, ReportStatus to) {
        if (from == to) {
            return true;
        }
        if (to == ReportStatus.PENDING) {
            return false;
        }
        switch (from) {
            case PENDING:
                return to == ReportStatus.UNDER_REVIEW || to == ReportStatus.VERIFIED || to == ReportStatus.REJECTED;
            case UNDER_REVIEW:
                return to == ReportStatus.VERIFIED || to == ReportStatus.REJECTED;
            case VERIFIED:
            case REJECTED:
                return false;
            default:
                return false;
        }
    }

    @Override
    @Transactional(readOnly = true)
    public List<ReportStatusAuditLog> getAuditLogsForReport(Long reportId) {
        return statusAuditLogRepository.findByReportIdOrderByChangedAtAsc(reportId);
    }

    private IncidentReport findReportOrThrow(Long id) {
        return reportRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Incident report with ID " + id + " was not found."));
    }

    private ReportResponse mapToPublicResponse(IncidentReport report) {
        List<ReportPhotoResponse> photoResponses = new ArrayList<>();
        if (report.getPhotos() != null) {
            for (ReportPhotoMetadata p : report.getPhotos()) {
                photoResponses.add(LocalDiskPhotoService.mapToResponse(p));
            }
        }

        ReportResponse response = new ReportResponse(
                report.getId(),
                report.getIncidentCategory(),
                report.getDescription(),
                report.getLocationDescription(),
                report.getLatitude(),
                report.getLongitude(),
                report.getStatus(),
                report.getReportedTimestamp(),
                report.getObservationTimestamp(),
                report.getEnvironmentalObservations(),
                photoResponses
        );
        response.setReviewNotes(report.getReviewNotes());
        response.setStatusUpdatedAt(report.getStatusUpdatedAt());
        return response;
    }

    private AdminReportResponse mapToAdminResponse(IncidentReport report) {
        List<ReportPhotoResponse> photoResponses = new ArrayList<>();
        if (report.getPhotos() != null) {
            for (ReportPhotoMetadata p : report.getPhotos()) {
                photoResponses.add(LocalDiskPhotoService.mapToResponse(p));
            }
        }

        return new AdminReportResponse(
                report.getId(),
                report.getReporterUserId(),
                report.getReporterName(),
                report.getIncidentCategory(),
                report.getDescription(),
                report.getLocationDescription(),
                report.getLatitude(),
                report.getLongitude(),
                report.getStatus(),
                report.getReportedTimestamp(),
                report.getObservationTimestamp(),
                report.getEnvironmentalObservations(),
                report.getUpdatedAt(),
                report.getReviewNotes(),
                photoResponses
        );
    }

    private void ensureUserExists(Long userId, String name) {
        if (!userRepository.existsById(userId)) {
            try {
                jdbcTemplate.update(
                        "INSERT INTO users (id, full_name, email, password_hash, role, enabled, created_at, updated_at) " +
                                "VALUES (?, ?, ?, ?, 'CITIZEN', true, NOW(), NOW())",
                        userId,
                        (name != null && !name.isBlank()) ? name : "Citizen " + userId,
                        "citizen_" + userId + "@slopeguard.local",
                        "$2a$10$placeholderHashForUnprovisionedUserReference"
                );
            } catch (Exception ignored) {
                // Ignore if created concurrently or already exists
            }
        }
    }
}
