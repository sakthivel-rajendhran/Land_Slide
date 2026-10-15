/**
 * SlopeGuard — Core Configuration (config.js)
 * Single place for runtime config, API endpoints, tile providers and app state
 */

window.LW = window.LW || {};

window.LW.config = {
  appVersion: "1.0.0",
  // Target live backend on port 8080 dynamically matching current host
  apiBase: (function() {
    if (typeof window === "undefined" || !window.location) return "http://localhost:8080/api";
    if (window.location.port === "8080") return "/api";
    const host = window.location.hostname || "localhost";
    return `http://${host}:8080/api`;
  })(),
  useMock: false, // Live persistence against Spring Boot & MySQL

  tileProvider: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
  },

  // Limits in minutes for data freshness calculations
  freshnessThresholds: {
    delayedAfterMinutes: 180, // 3 hours
    unavailableAfterMinutes: 720 // 12 hours
  },

  defaultCenter: [25.7500, 92.8000], // North Eastern Region (NER Corridor)
  defaultZoom: 7,
  nerCenter: [25.7500, 92.8000],
  westernGhatsCenter: [11.4102, 76.6950]
};
