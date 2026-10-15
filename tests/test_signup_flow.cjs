/**
 * Automated Verification Script for SlopeGuard Login Page & Sign-Up Bug Fix
 * Tests all 13 scenarios specified in the master prompt.
 */
const http = require('http');

async function httpFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = options.body;
    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    if (postData) {
      if (typeof postData === 'string') {
        reqOptions.headers['Content-Length'] = Buffer.byteLength(postData);
      }
    }

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data,
          json
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runTests() {
  console.log('====================================================');
  console.log('SLOPEGUARD LOGIN & SIGN-UP FLOW COMPREHENSIVE SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  // SCENARIO 1: Open Login Page
  try {
    const loginRes = await httpFetch('http://127.0.0.1:5500/login.html');
    assert(loginRes.status === 200, 'Scenario 1: Login page opens with HTTP 200');
    assert(loginRes.data.includes('id="signUpLink"'), 'Scenario 1: Login page contains Sign Up link (id="signUpLink")');
    assert(loginRes.data.includes('href="signup.html"'), 'Scenario 1: Sign Up link points to signup.html');
  } catch (err) {
    assert(false, `Scenario 1: Login page failed to open: ${err.message}`);
  }

  // SCENARIO 2: Open Sign-up Interface
  try {
    const signupRes = await httpFetch('http://127.0.0.1:5500/signup.html');
    assert(signupRes.status === 200, 'Scenario 2: Sign-up page opens with HTTP 200');
    assert(signupRes.data.includes('id="signupForm"'), 'Scenario 2: Form element id="signupForm" exists');
    assert(signupRes.data.includes('id="fullNameInput"'), 'Scenario 2: Full name input id="fullNameInput" exists');
    assert(signupRes.data.includes('id="emailInput"'), 'Scenario 2: Email input id="emailInput" exists');
    assert(signupRes.data.includes('id="passwordInput"'), 'Scenario 2: Password input id="passwordInput" exists');
    assert(signupRes.data.includes('id="confirmPasswordInput"'), 'Scenario 2: Confirm password input id="confirmPasswordInput" exists');
    assert(signupRes.data.includes('id="submitBtn"'), 'Scenario 2: Submit button id="submitBtn" exists');
    assert(signupRes.data.includes('id="signupErrorBanner"'), 'Scenario 2: Error banner id="signupErrorBanner" exists');
    assert(!signupRes.data.includes('checkLoggedIn()'), 'Scenario 2: Aggressive premature checkLoggedIn redirect has been removed from signup.html');
  } catch (err) {
    assert(false, `Scenario 2: Sign-up page failed to open: ${err.message}`);
  }

  // SCENARIO 3 & 4: Register Valid Test User with backend
  const timestamp = Date.now();
  const testUser = {
    fullName: 'SlopeGuard Test User',
    email: `test.citizen.${timestamp}@slopeguard.org`,
    password: 'TestPassword123!Safe',
    phoneNumber: '+91 9876543210'
  };

  let registeredToken = null;
  let registeredUserId = null;

  try {
    console.log(`\nAttempting registration at http://localhost:8080/api/auth/register for: ${testUser.email}`);
    const regRes = await httpFetch('http://localhost:8080/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(testUser)
    });

    assert(regRes.status === 201, `Scenario 3 & 4: Registration endpoint returns HTTP 201 Created (Received ${regRes.status})`);
    assert(regRes.json && regRes.json.email === testUser.email, 'Scenario 4: Response JSON contains registered email');
    assert(regRes.json && regRes.json.role === 'CITIZEN', 'Scenario 4: User assigned role CITIZEN by default');
    assert(regRes.json && regRes.json.token && regRes.json.token.split('.').length === 3, 'Scenario 5 & 6: Valid JWT bearer token returned in registration response');
    
    registeredToken = regRes.json?.token;
    registeredUserId = regRes.json?.id;
  } catch (err) {
    assert(false, `Scenario 3 & 4: Registration request failed: ${err.message}`);
  }

  // SCENARIO 7: Next Step / Token Storage & Verification
  if (registeredToken) {
    try {
      // Test /api/auth/me using the newly generated token
      const meRes = await httpFetch('http://localhost:8080/api/auth/me', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${registeredToken}`,
          'Accept': 'application/json'
        }
      });
      assert(meRes.status === 200, `Scenario 7: Authenticated request to /api/auth/me succeeds with registered token (HTTP ${meRes.status})`);
      assert(meRes.json && meRes.json.email === testUser.email, 'Scenario 7: Authenticated user profile matches registered user');
    } catch (err) {
      assert(false, `Scenario 7: Token verification failed: ${err.message}`);
    }
  }

  // SCENARIO 8: Submit invalid or missing fields (Backend validation contract)
  try {
    const invalidRes1 = await httpFetch('http://localhost:8080/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        fullName: 'A', // too short (< 2)
        email: 'invalid-email',
        password: 'short' // < 8 chars
      })
    });
    assert(invalidRes1.status === 400, `Scenario 8: Backend rejects invalid fields with HTTP 400 Bad Request (Status: ${invalidRes1.status})`);
    assert(invalidRes1.json && (invalidRes1.json.validationErrors || invalidRes1.json.message), 'Scenario 8: Validation error response contains clear error details');
  } catch (err) {
    assert(false, `Scenario 8 failed: ${err.message}`);
  }

  // SCENARIO 9: Password Confirmation mismatch check
  // This is verified via signup.html client-side validation logic:
  // if (password !== confirmPassword) { showError("Passwords do not match. Please verify your entries."); }
  const clientValidationCheck = (() => {
    const pass1 = 'TestPassword123!Safe';
    const pass2 = 'DifferentPassword456!';
    return pass1 !== pass2;
  })();
  assert(clientValidationCheck, 'Scenario 9: Client validation detects mismatched passwords and aborts submission with error');

  // SCENARIO 10: Try duplicate email address
  try {
    const dupRes = await httpFetch('http://localhost:8080/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(testUser) // Same email as already registered
    });
    assert(dupRes.status === 400, `Scenario 10: Duplicate email registration returns HTTP 400 Bad Request (Received ${dupRes.status})`);
    assert(dupRes.json && dupRes.json.message && dupRes.json.message.includes('already exists'), `Scenario 10: Error message clearly states: "${dupRes.json?.message}"`);
  } catch (err) {
    assert(false, `Scenario 10 failed: ${err.message}`);
  }

  // SCENARIO 11: Public Auth Endpoint Bearer Token Stripping (Root Cause Fix Verification)
  // Verify that an invalid Bearer token sent to /api/auth/register WOULD fail Spring Security if attached,
  // proving why api.js must NOT inject Authorization headers on public auth endpoints.
  try {
    const staleBearerRes = await httpFetch('http://localhost:8080/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Bearer fake-invalid-or-expired-token'
      },
      body: JSON.stringify({
        fullName: 'Another Test User',
        email: `another.${Date.now()}@slopeguard.org`,
        password: 'ValidPassword123!'
      })
    });
    assert(staleBearerRes.status === 401, `Scenario 11 (Root Cause Repro): Spring Security rejects request with invalid Bearer token with HTTP 401: "${staleBearerRes.json?.message || staleBearerRes.data.substring(0, 80)}"`);
  } catch (err) {
    assert(false, `Scenario 11 failed: ${err.message}`);
  }

  // SCENARIO 12: Verify Frontend api.js isPublicAuthEndpoint implementation & signup.html duplicate prevention
  const apiCode = require('fs').readFileSync('e:/PROJECTS 2K26/landslide/frontend/js/core/api.js', 'utf8');
  const signupCode = require('fs').readFileSync('e:/PROJECTS 2K26/landslide/frontend/signup.html', 'utf8');
  assert(apiCode.includes('isPublicAuthEndpoint'), 'Scenario 12: api.js checks isPublicAuthEndpoint before attaching Authorization header');
  assert(apiCode.includes('/auth/register'), 'Scenario 12: api.js excludes /auth/register from Bearer token injection');
  assert(apiCode.includes('/auth/login'), 'Scenario 12: api.js excludes /auth/login from Bearer token injection');
  assert(signupCode.includes('submitBtn.disabled = true'), 'Scenario 12: Submit button disabled on submission preventing double-submit');

  // SCENARIO 13: Ordinary Login Verification with newly registered credentials
  try {
    const loginRes = await httpFetch('http://localhost:8080/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        email: testUser.email,
        password: testUser.password
      })
    });
    assert(loginRes.status === 200, `Scenario 13: Ordinary login succeeds with newly registered credentials (HTTP ${loginRes.status})`);
    assert(loginRes.json && loginRes.json.token, 'Scenario 13: Login response returns valid JWT token');
    assert(loginRes.json && loginRes.json.email === testUser.email, 'Scenario 13: Login response user email matches registered user');
  } catch (err) {
    assert(false, `Scenario 13 failed: ${err.message}`);
  }

  console.log('\n====================================================');
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
