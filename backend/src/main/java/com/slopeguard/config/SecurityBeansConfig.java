package com.slopeguard.config;

import com.slopeguard.service.JwtService;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;

/**
 * Common security beans definition: PasswordEncoder, JwtDecoder, and JwtAuthenticationConverter.
 */
@Configuration
public class SecurityBeansConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public JwtDecoder jwtDecoder(JwtService jwtService) {
        return jwtService.getJwtDecoder();
    }

    /**
     * Maps the custom 'role' claim in JWT tokens (e.g. CITIZEN, ADMIN) to Spring Security authorities (ROLE_CITIZEN, ROLE_ADMIN).
     */
    @Bean
    public JwtAuthenticationConverter jwtAuthenticationConverter() {
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();
        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            java.util.Set<org.springframework.security.core.GrantedAuthority> authorities = new java.util.HashSet<>();
            String role = jwt.getClaimAsString("role");
            if (role != null) {
                String roleUpper = role.toUpperCase();
                authorities.add(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_" + roleUpper));
                // Bidirectional compatibility mapping between RESCUE_FORCE and OFFICER
                if ("RESCUE_FORCE".equals(roleUpper)) {
                    authorities.add(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_OFFICER"));
                } else if ("OFFICER".equals(roleUpper)) {
                    authorities.add(new org.springframework.security.core.authority.SimpleGrantedAuthority("ROLE_RESCUE_FORCE"));
                }
            }
            return authorities;
        });
        return converter;
    }
}
