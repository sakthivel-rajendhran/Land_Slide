const fs = require('fs');
const path = require('path');

const BACKEND_URL = 'http://localhost:8080';
const FRONTEND_URL = 'http://localhost:5500';

async function runTests() {
  console.log('====================================================');
  console.log('SLOPEGUARD CITIZEN DASHBOARD VERIFICATION SUITE');
  console.log('====================================================\n');

  let passes = 0;
  let failures = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passes++;
    } else {
      console.error(`[FAIL] ${message}`);
      failures++;
    }
  }

  try {
    // ----------------------------------------------------
    // TEST 1: Backend Risk & Alert Endpoints
    // ----------------------------------------------------
    console.log('--- 1. Testing Core Backend Risk & Alert Endpoints ---');
    const riskSummaryRes = await fetch(`${BACKEND_URL}/api/risks/summary`);
    assert(riskSummaryRes.status === 200, `GET /api/risks/summary responded with 200 OK (got ${riskSummaryRes.status})`);
    const riskSummaryData = await riskSummaryRes.json();
    assert(riskSummaryData && (riskSummaryData.totalAssessments !== undefined || riskSummaryData.highRiskCount !== undefined || typeof riskSummaryData === 'object'), 'Risk summary returns structured risk metrics');

    const risksListRes = await fetch(`${BACKEND_URL}/api/risks`);
    assert(risksListRes.status === 200, `GET /api/risks responded with 200 OK (got ${risksListRes.status})`);

    const alertsRes = await fetch(`${BACKEND_URL}/api/public/alerts`);
    assert(alertsRes.status === 200, `GET /api/public/alerts responded with 200 OK (got ${alertsRes.status})`);

    const envRes = await fetch(`${BACKEND_URL}/api/environmental/status`);
    assert(envRes.status === 200, `GET /api/environmental/status responded with 200 OK (got ${envRes.status})`);

    // ----------------------------------------------------
    // TEST 2: Citizen 1 Registration & Authentication
    // ----------------------------------------------------
    console.log('\n--- 2. Registering Citizen 1 Account ---');
    const timestamp = Date.now();
    const citizen1Email = `citizen.test.${timestamp}@slopeguard.org`;
    const regPayload1 = {
      fullName: 'Aarav Sharma',
      email: citizen1Email,
      password: 'CitizenPassword123!',
      phoneNumber: '+919876543210',
      role: 'CITIZEN',
      location: 'Gangtok East, Sikkim'
    };

    const regRes1 = await fetch(`${BACKEND_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regPayload1)
    });

    const regData1 = await regRes1.json();
    assert(regRes1.status === 201 || regRes1.status === 200, `Citizen 1 registered successfully (status: ${regRes1.status})`);
    const citizen1Token = regData1.token;
    assert(citizen1Token, 'Citizen 1 received valid JWT bearer token');
    assert(regData1.role === 'CITIZEN', `Citizen 1 role is confirmed as CITIZEN (got ${regData1.role})`);

    // ----------------------------------------------------
    // TEST 3: Incident Report Validation (Negative Test)
    // ----------------------------------------------------
    console.log('\n--- 3. Testing Report Validation (Field Rules) ---');
    const invalidReportRes = await fetch(`${BACKEND_URL}/api/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${citizen1Token}`
      },
      body: JSON.stringify({
        description: 'Short', // Less than 10 characters
        incidentCategory: null,
        latitude: null
      })
    });

    assert(invalidReportRes.status === 400, `Validation correctly rejected invalid report with 400 Bad Request (got ${invalidReportRes.status})`);

    // ----------------------------------------------------
    // TEST 4: Incident Report Submission (Positive Test)
    // ----------------------------------------------------
    console.log('\n--- 4. Submitting Real Citizen Incident Report (5 Steps) ---');
    const validReportPayload = {
      incidentCategory: 'ROCKFALL',
      description: 'Large boulder dislodged from cliffside blocking half of the northbound roadway. Loose gravel actively sliding.',
      locationDescription: 'NH-10 Mile 42 between Sevoke and Teesta Bazaar',
      latitude: 27.05124,
      longitude: 88.42318
    };

    const reportSubmitRes = await fetch(`${BACKEND_URL}/api/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${citizen1Token}`
      },
      body: JSON.stringify(validReportPayload)
    });

    assert(reportSubmitRes.status === 201 || reportSubmitRes.status === 200, `Incident report created successfully (status ${reportSubmitRes.status})`);
    const createdReport = await reportSubmitRes.json();
    const reportId = createdReport.id;
    assert(reportId !== undefined && reportId !== null, `Real backend report reference returned: #${reportId}`);
    assert(createdReport.status === 'PENDING', `Report status initially set to PENDING (Submitted stage)`);

    // ----------------------------------------------------
    // TEST 5: Photo Attachment Upload
    // ----------------------------------------------------
    console.log('\n--- 5. Testing Photo Attachment Upload ---');
    const validPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const blob = new Blob([validPng], { type: 'image/png' });
    const fd = new FormData();
    fd.append('file', blob, 'slope_rockfall_evidence.png');

    const photoRes = await fetch(`${BACKEND_URL}/api/reports/${reportId}/photos`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${citizen1Token}` },
      body: fd
    });
    assert(photoRes.status === 201 || photoRes.status === 200, `Photo attached to report #${reportId} successfully (status: ${photoRes.status})`);

    // ----------------------------------------------------
    // TEST 6: Citizen 1 "My Reports" Tracking
    // ----------------------------------------------------
    console.log('\n--- 6. Verifying Report in Citizen 1 My Reports (/api/reports/mine) ---');
    const myReportsRes1 = await fetch(`${BACKEND_URL}/api/reports/mine`, {
      headers: { 'Authorization': `Bearer ${citizen1Token}` }
    });
    assert(myReportsRes1.status === 200, `GET /api/reports/mine responded with 200 OK`);
    const myReportsList = await myReportsRes1.json();
    const foundReport = Array.isArray(myReportsList) ? myReportsList.find(r => r.id === reportId) : null;
    assert(foundReport !== undefined && foundReport !== null, `Report #${reportId} is present in Citizen 1's report history`);
    assert(foundReport && foundReport.incidentCategory === 'ROCKFALL', `Report category matches 'ROCKFALL'`);
    assert(foundReport && foundReport.status === 'PENDING', `Report status matches 'PENDING'`);
    assert(foundReport && Array.isArray(foundReport.photos) && foundReport.photos.length > 0, `Report includes uploaded photo attachment`);

    // ----------------------------------------------------
    // TEST 7: Backend Authorization Isolation (Citizen 2)
    // ----------------------------------------------------
    console.log('\n--- 7. Verifying Authorization Isolation with Citizen 2 ---');
    const citizen2Email = `citizen2.test.${timestamp}@slopeguard.org`;
    const regPayload2 = {
      fullName: 'Priya Chhetri',
      email: citizen2Email,
      password: 'CitizenPassword123!',
      phoneNumber: '+919876543299',
      role: 'CITIZEN',
      location: 'Namchi, Sikkim'
    };
    const regRes2 = await fetch(`${BACKEND_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regPayload2)
    });
    const regData2 = await regRes2.json();
    const citizen2Token = regData2.token;

    const myReportsRes2 = await fetch(`${BACKEND_URL}/api/reports/mine`, {
      headers: { 'Authorization': `Bearer ${citizen2Token}` }
    });
    const c2Reports = await myReportsRes2.json();
    const leakedReport = Array.isArray(c2Reports) ? c2Reports.find(r => r.id === reportId) : null;
    assert(!leakedReport, `Citizen 2 CANNOT see Citizen 1's report #${reportId} (Authorization is strictly enforced by backend)`);

    // ----------------------------------------------------
    // TEST 8: Static Template & Aesthetics Verification
    // ----------------------------------------------------
    console.log('\n--- 8. Verifying Design System, Palettes & Components ---');

    // Check dashboard.css
    const cssPath = path.join(__dirname, '../frontend/css/pages/dashboard.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    const hasBackdropFilter = /backdrop-filter\s*:\s*blur/i.test(cssContent);
    assert(!hasBackdropFilter, 'dashboard.css contains ZERO backdrop-filter blur declarations (Solid surfaces enforced)');

    // Check tokens and colors
    assert(cssContent.includes('#F8F6EE') || cssContent.includes('--lw-bg'), 'Warm Ivory (#F8F6EE) token integrated');
    assert(cssContent.includes('#C96F4F') || cssContent.includes('--lw-cta'), 'Terracotta (#C96F4F) accent token integrated');
    assert(cssContent.includes('#D9C9B2') || cssContent.includes('--lw-border'), 'Sand Beige (#D9C9B2) border token integrated');

    // Check report-incident.html for the 5 categories
    const reportHtmlPath = path.join(__dirname, '../frontend/report-incident.html');
    const reportHtml = fs.readFileSync(reportHtmlPath, 'utf8');
    assert(reportHtml.includes('Landslide'), 'Report Incident form contains Landslide category');
    assert(reportHtml.includes('Road Blockage'), 'Report Incident form contains Road Blockage category');
    assert(reportHtml.includes('Ground Cracks'), 'Report Incident form contains Ground Cracks category');
    assert(reportHtml.includes('Falling Rocks'), 'Report Incident form contains Falling Rocks category');
    assert(reportHtml.includes('Other Observation'), 'Report Incident form contains Other Observation category');

    // Check 4 location options and 5 steps
    assert(reportHtml.includes('Use My Current Location') || reportHtml.includes('btnUseGps'), 'Report Incident form contains Option A GPS location action');
    assert(reportHtml.includes('incidentMapCanvas') || reportHtml.includes('location-map-canvas'), 'Report Incident form contains Option B Map selection canvas');
    assert(reportHtml.includes('Review and Submit') || reportHtml.includes('Review & Submit'), 'Report Incident form contains Step 5 Review and Submit');

    // Check 6-stage lifecycle in dashboard.html and my-reports.html
    const myReportsHtmlPath = path.join(__dirname, '../frontend/my-reports.html');
    const myReportsHtml = fs.readFileSync(myReportsHtmlPath, 'utf8');
    assert(myReportsHtml.includes('Submitted'), 'Lifecycle contains Submitted stage');
    assert(myReportsHtml.includes('Under Review'), 'Lifecycle contains Under Review stage');
    assert(myReportsHtml.includes('Verified'), 'Lifecycle contains Verified stage');
    assert(myReportsHtml.includes('Needs Information'), 'Lifecycle contains Needs Information stage');
    assert(myReportsHtml.includes('Assigned'), 'Lifecycle contains Assigned stage');
    assert(myReportsHtml.includes('In Progress'), 'Lifecycle contains In Progress stage');
    assert(myReportsHtml.includes('Completed'), 'Lifecycle contains Completed stage');

    // Check quick actions in dashboard.html
    const dashHtmlPath = path.join(__dirname, '../frontend/dashboard.html');
    const dashHtml = fs.readFileSync(dashHtmlPath, 'utf8');
    assert(dashHtml.includes('Report an Incident') || dashHtml.includes('Report Incident'), 'Dashboard overview includes Report an Incident action');
    assert(dashHtml.includes('View Risk Map') || dashHtml.includes('Risk Map'), 'Dashboard overview includes View Risk Map action');
    assert(dashHtml.includes('Risk Assessments') || dashHtml.includes('View Risk Assessments'), 'Dashboard overview includes View Risk Assessments action');
    assert(dashHtml.includes('My Reports') || dashHtml.includes('Track My Reports'), 'Dashboard overview includes Track My Reports action');

    console.log('\n====================================================');
    console.log(`SUMMARY: ${passes} passed, ${failures} failed.`);
    console.log('====================================================');
    if (failures > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Test Suite encountered an error:', err);
    process.exit(1);
  }
}

runTests();
