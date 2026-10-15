package com.slopeguard.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfigurationSource;

/**
 * Spring Security configuration establishing a stateless, role-based JWT security filter chain.
 * <p>
 * Architectural Justification for CSRF Configuration:
 * CSRF protection is explicitly disabled because the SlopeGuard REST API uses stateless
 * bearer-token authentication (transferred exclusively via the standard HTTP 'Authorization: Bearer <token>'
 * header) rather than browser-managed cookie session state. Since browsers do not automatically
 * dispatch Authorization headers across origins, cross-site request forgery attacks are fundamentally mitigated.
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    private final JwtDecoder jwtDecoder;
    private final JwtAuthenticationConverter jwtAuthenticationConverter;
    private final RestAuthenticationEntryPoint authenticationEntryPoint;
    private final RestAccessDeniedHandler accessDeniedHandler;
    private final CorsConfigurationSource corsConfigurationSource;

    public SecurityConfig(
            JwtDecoder jwtDecoder,
            JwtAuthenticationConverter jwtAuthenticationConverter,
            RestAuthenticationEntryPoint authenticationEntryPoint,
            RestAccessDeniedHandler accessDeniedHandler,
            CorsConfigurationSource corsConfigurationSource) {
        this.jwtDecoder = jwtDecoder;
        this.jwtAuthenticationConverter = jwtAuthenticationConverter;
        this.authenticationEntryPoint = authenticationEntryPoint;
        this.accessDeniedHandler = accessDeniedHandler;
        this.corsConfigurationSource = corsConfigurationSource;
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                // Stateless REST APIs do not use browser session cookies; CSRF is therefore disabled
                .csrf(AbstractHttpConfigurer::disable)
                .cors(cors -> cors.configurationSource(corsConfigurationSource))
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // Public CORS preflight requests (permitted unconditionally)
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()

                        // Public system health, discovery, and documentation endpoints
                        .requestMatchers(HttpMethod.GET, "/api", "/api/health").permitAll()
                        .requestMatchers("/actuator/**").permitAll()

                        // Public authentication endpoints (Ragul Module 1)
                        .requestMatchers(HttpMethod.POST, "/api/auth/register", "/api/auth/login", "/api/auth/logout", "/api/auth/forgot-password", "/api/auth/reset-password").permitAll()

                        // Public publicapi endpoints (Ragul Module 1)
                        .requestMatchers(HttpMethod.GET, "/api/public/**").permitAll()

                        // Public risk inspection and prediction endpoints
                        .requestMatchers(HttpMethod.GET, "/api/risks/**").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/risks/predict/**", "/api/risks/predict").permitAll()

                        // Public environmental risk assessments (Phase 7)
                        .requestMatchers(HttpMethod.POST, "/api/risk-assessments/**", "/api/risk-assessments").permitAll()

                        // Public alert inspection and administrative adjudication (Phase 7)
                        .requestMatchers(HttpMethod.GET, "/api/alerts/**").permitAll()
                        .requestMatchers(HttpMethod.PATCH, "/api/alerts/**").hasRole("ADMIN")

                        // Public environmental rainfall and status monitoring endpoints
                        .requestMatchers(HttpMethod.GET, "/api/environmental/**").permitAll()

                        // Public incident report summary listing (privacy-safe, hides citizen identity)
                        .requestMatchers(HttpMethod.GET, "/api/reports").permitAll()

                        // Authenticated citizen profile endpoint (Ragul Module 1)
                        .requestMatchers(HttpMethod.GET, "/api/auth/me").authenticated()
                        .requestMatchers(HttpMethod.GET, "/api/users/me").authenticated()
                        .requestMatchers(HttpMethod.PUT, "/api/users/me", "/api/users/me/password").authenticated()

                        // Incident report submission and citizen-owned report access
                        .requestMatchers(HttpMethod.GET, "/api/reports/mine").authenticated()
                        .requestMatchers(HttpMethod.GET, "/api/reports/{id}").authenticated()
                        .requestMatchers("/api/reports/{id}/photos/**").authenticated()
                        .requestMatchers(HttpMethod.POST, "/api/reports").authenticated()

                        // Module 1 Alert Workflow and Area Management RBAC
                        .requestMatchers("/api/admin/alerts/**").hasAnyRole("ADMIN", "RESCUE_FORCE", "OFFICER")
                        .requestMatchers(HttpMethod.GET, "/api/admin/areas/**").hasAnyRole("ADMIN", "RESCUE_FORCE", "OFFICER")
                        .requestMatchers("/api/rescue/**").hasAnyRole("ADMIN", "RESCUE_FORCE", "OFFICER")
                        .requestMatchers("/api/admin/areas/**").hasRole("ADMIN")
                        .requestMatchers("/api/admin/users/**").hasRole("ADMIN")

                        // Administrative oversight and status review requires ADMIN role
                        .requestMatchers("/api/admin/**").hasRole("ADMIN")

                        // All other endpoints require authentication by default
                        .anyRequest().authenticated()
                )
                // Configure OAuth2 Resource Server for JWT Bearer tokens
                .oauth2ResourceServer(oauth2 -> oauth2
                        .jwt(jwt -> jwt
                                .decoder(jwtDecoder)
                                .jwtAuthenticationConverter(jwtAuthenticationConverter)
                        )
                        .authenticationEntryPoint(authenticationEntryPoint)
                        .accessDeniedHandler(accessDeniedHandler)
                )
                // Centralize JSON authentication & authorization error responses
                .exceptionHandling(exceptions -> exceptions
                        .authenticationEntryPoint(authenticationEntryPoint)
                        .accessDeniedHandler(accessDeniedHandler)
                );

        return http.build();
    }
}
