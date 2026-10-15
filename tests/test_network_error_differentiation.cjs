/**
 * Verification for Error Distinction & Role Navigation
 */
const assert = require('assert');
const fs = require('fs');

console.log('Testing error distinction and role navigation in SlopeGuard...');

// 1. Verify api.js error handling logic
const apiContent = fs.readFileSync('e:/PROJECTS 2K26/landslide/frontend/js/core/api.js', 'utf8');

// Check that navigator.onLine check is distinguished from Failed to fetch
assert(apiContent.includes('!navigator.onLine'), 'api.js handles offline navigator state');
assert(apiContent.includes('CONNECTION_FAILED'), 'api.js distinguishes server connection failure from generic offline');
assert(apiContent.includes('Unable to connect to the SlopeGuard server'), 'api.js provides helpful server connection error message');
assert(apiContent.includes('isPublicAuthEndpoint'), 'api.js isolates public authentication endpoints');

// 2. Verify signup.html destination logic
const signupContent = fs.readFileSync('e:/PROJECTS 2K26/landslide/frontend/signup.html', 'utf8');
assert(signupContent.includes('getSafeDestination(user)'), 'signup.html passes user to getSafeDestination');
assert(signupContent.includes('role === "ADMIN" ? "admin/dashboard.html" : "dashboard.html"'), 'signup.html routes CITIZEN to dashboard.html and ADMIN to admin/dashboard.html');
assert(signupContent.includes('decoded.startsWith("admin/") && role !== "ADMIN"'), 'signup.html blocks non-admins from admin dashboard');
assert(signupContent.includes('window.location.replace(destination)'), 'signup.html replaces history stack on redirection');

// 3. Verify CorsConfig.java
const corsContent = fs.readFileSync('e:/PROJECTS 2K26/landslide/backend/src/main/java/com/slopeguard/config/CorsConfig.java', 'utf8');
assert(corsContent.includes('setAllowedOriginPatterns'), 'CorsConfig sets allowedOriginPatterns');
assert(corsContent.includes('setAllowedHeaders(List.of("*"))'), 'CorsConfig allows all headers');

// 4. Verify SecurityConfig.java
const secContent = fs.readFileSync('e:/PROJECTS 2K26/landslide/backend/src/main/java/com/slopeguard/config/SecurityConfig.java', 'utf8');
assert(secContent.includes('HttpMethod.OPTIONS, "/**"'), 'SecurityConfig permits preflight OPTIONS requests unconditionally');

console.log('All error distinction and role navigation checks PASSED successfully!');
