package com.slopeguard.controller;

import com.slopeguard.dto.AuthResponse;
import com.slopeguard.dto.ForgotPasswordRequest;
import com.slopeguard.dto.LoginRequest;
import com.slopeguard.dto.RegisterRequest;
import com.slopeguard.dto.RegisterResponse;
import com.slopeguard.dto.ResetPasswordRequest;
import com.slopeguard.dto.UserProfileResponse;
import com.slopeguard.exception.ResourceNotFoundException;
import com.slopeguard.model.User;
import com.slopeguard.service.JwtService;
import com.slopeguard.service.PasswordResetService;
import com.slopeguard.service.UserService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Controller providing citizen registration, authentication login, profile retrieval, logout, and password recovery.
 * Owned by Module 1 (Ragul).
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final UserService userService;
    private final JwtService jwtService;
    private final PasswordResetService passwordResetService;

    public AuthController(UserService userService, JwtService jwtService, PasswordResetService passwordResetService) {
        this.userService = userService;
        this.jwtService = jwtService;
        this.passwordResetService = passwordResetService;
    }

    /**
     * Self-service citizen account registration.
     * Enforces CITIZEN role assignment.
     */
    @PostMapping("/register")
    public ResponseEntity<RegisterResponse> register(@Valid @RequestBody RegisterRequest request) {
        User user = userService.registerCitizen(request);
        String token = jwtService.generateToken(user);

        RegisterResponse response = new RegisterResponse(
                user.getId(),
                user.getFullName(),
                user.getEmail(),
                user.getRole(),
                "Citizen account registered successfully. You may now log in.",
                token,
                "Bearer"
        );

        return ResponseEntity.status(HttpStatus.CREATED).body(response);
    }

    /**
     * Authenticates email and password, issuing a signed JWT access token.
     */
    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
        User user = userService.authenticate(request.getEmail(), request.getPassword());
        String token = jwtService.generateToken(user);

        AuthResponse response = new AuthResponse(
                token,
                "Bearer",
                jwtService.getExpirationSeconds(),
                user.getId(),
                user.getEmail(),
                user.getFullName(),
                user.getRole()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Retrieves the profile and role of the currently authenticated user.
     */
    @GetMapping("/me")
    public ResponseEntity<UserProfileResponse> getCurrentUser(@AuthenticationPrincipal Jwt jwt) {
        Long userId = Long.valueOf(jwt.getSubject());
        User user = userService.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("Authenticated user account was not found."));

        UserProfileResponse response = new UserProfileResponse(
                user.getId(),
                user.getFullName(),
                user.getEmail(),
                user.getRole(),
                user.getPhoneNumber(),
                user.getCreatedAt()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Client logout guidance.
     * In a stateless architecture without token blacklisting, the client is instructed to delete
     * the bearer token from its client storage.
     */
    @PostMapping("/logout")
    public ResponseEntity<Map<String, Object>> logout() {
        return ResponseEntity.ok(Map.of(
                "message", "Logout acknowledged. Stateless access tokens must be discarded by the client.",
                "stateless", true,
                "tokenRevoked", false
        ));
    }

    /**
     * Initiates password recovery.
     * Always returns standard message without revealing whether the email exists.
     */
    @PostMapping("/forgot-password")
    public ResponseEntity<Map<String, Object>> forgotPassword(@Valid @RequestBody ForgotPasswordRequest request) {
        return ResponseEntity.ok(passwordResetService.requestReset(request.getEmail()));
    }

    /**
     * Resets account password using a validated single-use token.
     */
    @PostMapping("/reset-password")
    public ResponseEntity<Map<String, Object>> resetPassword(@Valid @RequestBody ResetPasswordRequest request) {
        return ResponseEntity.ok(passwordResetService.resetPassword(request.getToken(), request.getNewPassword()));
    }
}
