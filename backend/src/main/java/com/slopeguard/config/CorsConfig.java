package com.slopeguard.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.util.Arrays;
import java.util.List;

/**
 * CORS Configuration for SlopeGuard Frontend Integration.
 * <p>
 * Binds to {@code slopeguard.cors.allowed-origins} in application.properties.
 * Specific origins are configured to avoid unsafe wildcard (*) origins while allowing
 * browser-based Single Page Applications or local static servers to communicate with {@code /api/**}.
 */
@Configuration
public class CorsConfig implements WebMvcConfigurer {

    private static final Logger log = LoggerFactory.getLogger(CorsConfig.class);

    private final String[] allowedOrigins;

    public CorsConfig(@Value("${slopeguard.cors.allowed-origins:http://localhost:5500,http://127.0.0.1:5500,http://localhost:3000,http://localhost:8080}") String[] allowedOrigins) {
        this.allowedOrigins = allowedOrigins;
        log.info("Configured SlopeGuard CORS allowed origins: {}", Arrays.toString(allowedOrigins));
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns("http://localhost:*", "http://127.0.0.1:*", "https://localhost:*", "https://127.0.0.1:*")
                .allowedMethods("GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .exposedHeaders("Location", "Authorization")
                .allowCredentials(true)
                .maxAge(3600);
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        List<String> originPatterns = new java.util.ArrayList<>(Arrays.asList(allowedOrigins));
        if (!originPatterns.contains("http://localhost:*")) originPatterns.add("http://localhost:*");
        if (!originPatterns.contains("http://127.0.0.1:*")) originPatterns.add("http://127.0.0.1:*");
        if (!originPatterns.contains("https://localhost:*")) originPatterns.add("https://localhost:*");
        if (!originPatterns.contains("https://127.0.0.1:*")) originPatterns.add("https://127.0.0.1:*");
        config.setAllowedOriginPatterns(originPatterns);
        config.setAllowedMethods(List.of("GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setExposedHeaders(List.of("Location", "Authorization"));
        config.setAllowCredentials(true);
        config.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        return source;
    }
}
