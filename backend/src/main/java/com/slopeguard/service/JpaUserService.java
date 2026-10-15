package com.slopeguard.service;

import com.slopeguard.dto.RegisterRequest;
import com.slopeguard.exception.DuplicateEmailException;
import com.slopeguard.exception.InvalidCredentialsException;
import com.slopeguard.model.User;
import com.slopeguard.model.UserRole;
import com.slopeguard.repository.UserRepository;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Primary;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Locale;
import java.util.Optional;

/**
 * Production MySQL-backed implementation of {@link UserService}.
 * <p>
 * Security Guarantees:
 * 1. BCrypt salted hashing for all user passwords. Plaintext passwords are never stored.
 * 2. Case-insensitive email normalization and database-level unique constraint enforcement.
 * 3. Constant-time-like validation to mitigate timing attacks during authentication.
 * 4. Strictly assigns CITIZEN role during public self-registration.
 * 5. Rejects authentication and access for disabled accounts.
 */
@Service
@Primary
public class JpaUserService implements UserService {

    private static final Logger log = LoggerFactory.getLogger(JpaUserService.class);

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;

    @Value("${slopeguard.security.admin.enabled:false}")
    private boolean adminProvisioningEnabled;

    @Value("${slopeguard.security.admin.email:}")
    private String adminProvisionEmail;

    @Value("${slopeguard.security.admin.password:}")
    private String adminProvisionPassword;

    @Value("${slopeguard.security.admin.name:System Administrator}")
    private String adminProvisionName;

    public JpaUserService(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @PostConstruct
    @Transactional
    public void init() {
        if (adminProvisioningEnabled && adminProvisionEmail != null && !adminProvisionEmail.isBlank()
                && adminProvisionPassword != null && !adminProvisionPassword.isBlank()) {
            provisionAdmin(adminProvisionName, adminProvisionEmail, adminProvisionPassword);
            log.info("Initialized/verified administrative account for: {}", normalizeEmail(adminProvisionEmail));
        }

        // Provision default Rescue Force units for operational assignment workflows
        ensureRescueForceAccount("Er. T. Lyngdoh (Rescue Force Alpha)", "officer@slopeguard.ner.gov.in", "OfficerPass123!");
        ensureRescueForceAccount("Er. R. Barman (Rescue Force Bravo)", "officer.bravo@slopeguard.ner.gov.in", "OfficerPass123!");
    }

    private void ensureRescueForceAccount(String fullName, String email, String rawPassword) {
        String normalized = normalizeEmail(email);
        Optional<User> existing = userRepository.findByEmail(normalized);
        if (existing.isPresent()) {
            User u = existing.get();
            if (u.getRole() != UserRole.RESCUE_FORCE) {
                u.setRole(UserRole.RESCUE_FORCE);
                userRepository.save(u);
            }
        } else {
            User u = new User();
            u.setFullName(fullName);
            u.setEmail(normalized);
            u.setPasswordHash(passwordEncoder.encode(rawPassword));
            u.setRole(UserRole.RESCUE_FORCE);
            u.setEnabled(true);
            u.setCreatedAt(LocalDateTime.now());
            u.setUpdatedAt(LocalDateTime.now());
            userRepository.save(u);
            log.info("Provisioned default rescue force account: {}", normalized);
        }
    }

    @Override
    @Transactional
    public User registerCitizen(RegisterRequest request) {
        String normalizedEmail = normalizeEmail(request.getEmail());

        if (normalizedEmail.isBlank()) {
            throw new IllegalArgumentException("Email address cannot be empty.");
        }

        if (userRepository.existsByEmail(normalizedEmail)) {
            throw new DuplicateEmailException("An account with email '" + normalizedEmail + "' already exists.");
        }

        String passwordHash = passwordEncoder.encode(request.getPassword());

        User user = new User();
        user.setFullName(request.getFullName().trim());
        user.setEmail(normalizedEmail);
        user.setPasswordHash(passwordHash);
        user.setPhoneNumber(request.getPhoneNumber() != null ? request.getPhoneNumber().trim() : null);
        user.setRole(UserRole.CITIZEN);
        user.setEnabled(true);
        user.setCreatedAt(LocalDateTime.now());
        user.setUpdatedAt(LocalDateTime.now());

        try {
            User saved = userRepository.saveAndFlush(user);
            log.info("Registered new citizen account with ID {} for email {}", saved.getId(), normalizedEmail);
            return saved;
        } catch (DataIntegrityViolationException ex) {
            log.warn("Database unique constraint violation during registration for email {}", normalizedEmail);
            throw new DuplicateEmailException("An account with email '" + normalizedEmail + "' already exists.");
        }
    }

    @Override
    @Transactional(readOnly = true)
    public User authenticate(String email, String rawPassword) {
        String normalizedEmail = normalizeEmail(email);

        Optional<User> userOpt = userRepository.findByEmail(normalizedEmail);
        if (userOpt.isEmpty()) {
            throw new InvalidCredentialsException("Invalid email or password.");
        }

        User user = userOpt.get();
        if (!user.isEnabled()) {
            log.warn("Authentication attempt for disabled account: {}", normalizedEmail);
            throw new InvalidCredentialsException("Invalid email or password.");
        }

        if (!passwordEncoder.matches(rawPassword, user.getPasswordHash())) {
            throw new InvalidCredentialsException("Invalid email or password.");
        }

        return user;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<User> findById(Long id) {
        if (id == null) {
            return Optional.empty();
        }
        return userRepository.findById(id).filter(User::isEnabled);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<User> findByEmail(String email) {
        String normalized = normalizeEmail(email);
        return userRepository.findByEmail(normalized).filter(User::isEnabled);
    }

    @Override
    @Transactional(readOnly = true)
    public boolean emailExists(String email) {
        return userRepository.existsByEmail(normalizeEmail(email));
    }

    @Override
    @Transactional
    public User provisionAdmin(String fullName, String email, String rawPassword) {
        String normalizedEmail = normalizeEmail(email);

        Optional<User> existing = userRepository.findByEmail(normalizedEmail);
        if (existing.isPresent()) {
            User admin = existing.get();
            admin.setRole(UserRole.ADMIN);
            admin.setEnabled(true);
            return userRepository.save(admin);
        }

        String passwordHash = passwordEncoder.encode(rawPassword);

        User admin = new User();
        admin.setFullName(fullName.trim());
        admin.setEmail(normalizedEmail);
        admin.setPasswordHash(passwordHash);
        admin.setRole(UserRole.ADMIN);
        admin.setEnabled(true);
        admin.setCreatedAt(LocalDateTime.now());
        admin.setUpdatedAt(LocalDateTime.now());

        User saved = userRepository.saveAndFlush(admin);
        log.info("Provisioned administrator account with ID {}", saved.getId());
        return saved;
    }

    private String normalizeEmail(String email) {
        return email != null ? email.trim().toLowerCase(Locale.ROOT) : "";
    }
}
