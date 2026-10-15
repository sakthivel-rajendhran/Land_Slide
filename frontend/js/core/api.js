/**
 * SlopeGuard — Unified API Client (api.js)
 * Wraps fetch(), injects CSRF headers, enforces 15s timeout, normalizes envelopes,
 * and provides offline mock fallback when backend is unreachable.
 */

window.LW = window.LW || {};

window.LW.api = (function() {
  const TIMEOUT_MS = 15000;

  function getCsrfToken() {
    if (typeof document === "undefined" || !document.cookie) return "";
    const match = document.cookie.match(/XSRF-TOKEN=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  async function request(path, options = {}) {
    const config = window.LW.config || { apiBase: "/api", useMock: true };
    const apiBase = (config.apiBase || "/api").replace(/\/+$/, "");
    let url = path;
    if (!path.startsWith("http://") && !path.startsWith("https://")) {
      const cleanPath = path.startsWith('/') ? path : `/${path}`;
      // Prevent any duplicate /api/api/ prefixes
      const normalizedPath = cleanPath.replace(/^\/api\/api\//, '/api/');

      if (normalizedPath.startsWith(apiBase)) {
        url = normalizedPath;
      } else if (apiBase.endsWith("/api") && normalizedPath.startsWith("/api/")) {
        url = `${apiBase}${normalizedPath.substring(4)}`;
      } else if (apiBase.endsWith("/api") && normalizedPath === "/api") {
        url = apiBase;
      } else {
        url = `${apiBase}${normalizedPath}`;
      }
    }

    const headers = {
      "Accept": "application/json",
      ...options.headers
    };

    // Only default Content-Type to JSON if body is not FormData
    const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
    if (!isFormData && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    // Determine if this is a public authentication endpoint
    const urlLower = url.toLowerCase();
    const isPublicAuthEndpoint = urlLower.includes("/auth/login") ||
                                 urlLower.includes("/auth/register") ||
                                 urlLower.includes("/auth/forgot-password") ||
                                 urlLower.includes("/auth/verify-reset-token") ||
                                 urlLower.includes("/auth/reset-password") ||
                                 urlLower.includes("/auth/google");

    // Inject Bearer token if available and NOT on a public unauthenticated route
    let token = null;
    if (!isPublicAuthEndpoint) {
      try {
        const storedRaw = (typeof sessionStorage !== "undefined" && sessionStorage.getItem("sg_user")) ||
                          (typeof localStorage !== "undefined" && localStorage.getItem("sg_user"));
        if (storedRaw) {
          const parsed = JSON.parse(storedRaw);
          token = parsed.token || parsed.jwt;
        }
        if (!token && typeof localStorage !== "undefined") {
          token = localStorage.getItem("sg_token");
        }
      } catch (e) {}

      if (token && !headers["Authorization"]) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    const csrf = getCsrfToken();
    if (csrf) {
      headers["X-XSRF-TOKEN"] = csrf;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        credentials: "include",
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const json = await response.json().catch(() => null);

      if (!response.ok) {
        let msg = json?.message;
        if (json?.validationErrors && Array.isArray(json.validationErrors) && json.validationErrors.length > 0) {
          msg = json.validationErrors.join("; ");
        }
        if (!msg) {
          if (response.status === 400) msg = "Invalid request details. Please check your form input.";
          else if (response.status === 401) msg = "Authentication failed or token invalid.";
          else if (response.status === 403) msg = "Access denied: You do not have permission for this resource.";
          else if (response.status === 404) msg = "The requested service endpoint was not found.";
          else if (response.status === 409) msg = "Conflict: An account or record with these details already exists.";
          else if (response.status >= 500) msg = `Server error (HTTP ${response.status}). Please try again later.`;
          else msg = `Request failed with status ${response.status}`;
        }
        throw {
          code: json?.code || (response.status === 401 ? "UNAUTHENTICATED" : (response.status === 403 ? "FORBIDDEN" : "API_ERROR")),
          message: msg,
          status: response.status,
          fieldErrors: json?.fieldErrors || json?.validationErrors || []
        };
      }

      // Seamless compatibility for direct DTOs / arrays vs envelope { success, data }
      if (json && typeof json === "object" && !("data" in json)) {
        try {
          Object.defineProperty(json, "data", {
            value: json,
            writable: true,
            configurable: true,
            enumerable: false
          });
        } catch (e) {
          json.data = json;
        }
      }

      return json;
    } catch (err) {
      clearTimeout(timeoutId);

      // If backend responded with an HTTP error status (400, 401, 403, 404, 409, 500, etc.), propagate directly
      if (err && err.status) {
        throw err;
      }

      // If mock mode is explicitly enabled and mock adapter exists, attempt fallback
      if (config.useMock && window.LW.mockAdapter) {
        const mockResult = window.LW.mockAdapter(url, options);
        if (mockResult) {
          return mockResult;
        }
      }

      // 1. Request timed out
      if (err.name === "AbortError") {
        throw { code: "TIMEOUT", message: "Request timed out after 15 seconds. Please verify server responsiveness.", status: 408 };
      }

      // 2. Client is genuinely offline (no network interface/internet)
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        throw { code: "OFFLINE", message: "Network connection is unavailable. Please check your internet connection.", status: 0, offline: true };
      }

      // 3. Backend is unreachable or network connection failed
      if (err.message?.includes("Failed to fetch") || err.message?.includes("NetworkError") || err.name === "TypeError") {
        throw {
          code: "CONNECTION_FAILED",
          message: `Unable to connect to the SlopeGuard server at ${url}. Please ensure the backend service is running and accessible.`,
          status: 0,
          offline: false
        };
      }

      throw err;
    }
  }

  return {
    get(path, params = {}) {
      const query = new URLSearchParams(params).toString();
      const url = query ? `${path}?${query}` : path;
      return request(url, { method: "GET" });
    },
    post(path, body = {}) {
      const isForm = typeof FormData !== "undefined" && body instanceof FormData;
      return request(path, {
        method: "POST",
        body: isForm ? body : JSON.stringify(body)
      });
    },
    patch(path, body = {}) {
      const isForm = typeof FormData !== "undefined" && body instanceof FormData;
      return request(path, {
        method: "PATCH",
        body: isForm ? body : JSON.stringify(body)
      });
    },
    put(path, body = {}) {
      const isForm = typeof FormData !== "undefined" && body instanceof FormData;
      return request(path, {
        method: "PUT",
        body: isForm ? body : JSON.stringify(body)
      });
    },
    delete(path) {
      return request(path, { method: "DELETE" });
    }
  };
})();
