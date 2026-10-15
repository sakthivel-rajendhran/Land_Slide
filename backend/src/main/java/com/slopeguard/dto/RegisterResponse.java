package com.slopeguard.dto;

import com.slopeguard.model.UserRole;

/**
 * Registration confirmation DTO returning assigned account metadata.
 */
public class RegisterResponse {

    private Long id;
    private String fullName;
    private String email;
    private UserRole role;
    private String message;
    private String token;
    private String tokenType;

    public RegisterResponse() {
    }

    public RegisterResponse(Long id, String fullName, String email, UserRole role, String message) {
        this.id = id;
        this.fullName = fullName;
        this.email = email;
        this.role = role;
        this.message = message;
    }

    public RegisterResponse(Long id, String fullName, String email, UserRole role, String message, String token, String tokenType) {
        this.id = id;
        this.fullName = fullName;
        this.email = email;
        this.role = role;
        this.message = message;
        this.token = token;
        this.tokenType = tokenType;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getFullName() {
        return fullName;
    }

    public void setFullName(String fullName) {
        this.fullName = fullName;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public UserRole getRole() {
        return role;
    }

    public void setRole(UserRole role) {
        this.role = role;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public String getToken() {
        return token;
    }

    public void setToken(String token) {
        this.token = token;
    }

    public String getTokenType() {
        return tokenType;
    }

    public void setTokenType(String tokenType) {
        this.tokenType = tokenType;
    }
}
