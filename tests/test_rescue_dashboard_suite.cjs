const fs = require('fs');
const path = require('path');

const BACKEND_URL = 'http://localhost:8080';
const FRONTEND_URL = 'http://localhost:5500';

async function runTests() {
  console.log('====================================================');
  console.log('SLOPEGUARD RESCUE TEAM DASHBOARD VERIFICATION SUITE');
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
    // TEST 1: Frontend Files & Asset Integrity
    // ----------------------------------------------------
    console.log('--- 1. Testing Frontend Artifacts & Architecture ---');

    const htmlPath = path.join(__dirname, '..', 'frontend', 'rescue-dashboard.html');
    assert(fs.existsSync(htmlPath), 'rescue-dashboard.html exists in frontend directory');
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    assert(htmlContent.includes('id="activeMissionBanner"'), 'Hero Active Mission Pinned Banner present');
    assert(htmlContent.includes('id="kpiNew"'), 'New Assignments KPI card present');
    assert(htmlContent.includes('id="kpiActive"'), 'Active Operations KPI card present');
    assert(htmlContent.includes('id="kpiTransit"'), 'In Transit KPI card present');
    assert(htmlContent.includes('id="kpiScene"'), 'On Scene KPI card present');
    assert(htmlContent.includes('id="kpiReview"'), 'Awaiting Verification KPI card present');
    assert(htmlContent.includes('id="kpiFollowup"'), 'Follow-Up Required KPI card present');
    assert(htmlContent.includes('id="rescueMap"'), 'Leaflet tactical map container present');
    assert(htmlContent.includes('id="declineModal"'), 'Decline assignment modal present');
    assert(htmlContent.includes('id="progressModal"'), 'Field progress report modal present');
    assert(htmlContent.includes('id="outcomeModal"'), 'Submit response outcome modal present');
    assert(htmlContent.includes('id="contactsModal"'), 'Emergency helplines modal present');

    const cssPath = path.join(__dirname, '..', 'frontend', 'css', 'pages', 'rescue-dashboard.css');
    assert(fs.existsSync(cssPath), 'rescue-dashboard.css stylesheet exists');
    const cssContent = fs.readFileSync(cssPath, 'utf8');
    assert(cssContent.includes('#2E3A2F'), 'Theme uses Deep Forest Green #2E3A2F');
    assert(cssContent.includes('#6B7F5B'), 'Theme uses Sage Green #6B7F5B');
    assert(cssContent.includes('#D9C9B2'), 'Theme uses Sand Beige #D9C9B2');
    assert(cssContent.includes('#C96F4F'), 'Theme uses Terracotta #C96F4F');
    assert(!cssContent.includes('backdrop-filter: blur'), 'Theme strictly enforces ZERO glassmorphism / ZERO backdrop blur');

    const jsPath = path.join(__dirname, '..', 'frontend', 'js', 'pages', 'rescue-dashboard.js');
    assert(fs.existsSync(jsPath), 'rescue-dashboard.js controller exists');
    const jsContent = fs.readFileSync(jsPath, 'utf8');
    assert(jsContent.includes('watchPosition'), 'Implements real browser Geolocation API watchPosition tracking');
    assert(jsContent.includes('calculateDistanceKm'), 'Implements Haversine straight-line distance calculation');

    // Check login routing
    const loginHtml = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'login.html'), 'utf8');
    assert(loginHtml.includes('rescue-dashboard.html'), 'login.html routes OFFICER directly to rescue-dashboard.html');
    assert(loginHtml.includes('Rescue Force'), 'Demo button correctly renamed to Rescue Force');

    // ----------------------------------------------------
    // TEST 2: Authentication & Role Verification
    // ----------------------------------------------------
    console.log('\n--- 2. Testing Officer & Admin Authentication ---');

    const officerLoginRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'officer@slopeguard.ner.gov.in', password: 'OfficerPass123!' })
    });
    assert(officerLoginRes.status === 200, `Officer login succeeded with 200 OK (status: ${officerLoginRes.status})`);
    const officerAuth = await officerLoginRes.json();
    assert(officerAuth.token && (officerAuth.role === 'RESCUE_FORCE' || officerAuth.role === 'OFFICER'), `Authenticated as RESCUE_FORCE role (token received: ${Boolean(officerAuth.token)})`);
    const officerToken = officerAuth.token;

    const adminLoginRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@slopeguard.org', password: 'AdminPass123!Safe' })
    });
    assert(adminLoginRes.status === 200, `Admin login succeeded with 200 OK (status: ${adminLoginRes.status})`);
    const adminAuth = await adminLoginRes.json();
    const adminToken = adminAuth.token;

    // ----------------------------------------------------
    // TEST 3: Fetching Assigned Rescue Missions
    // ----------------------------------------------------
    console.log('\n--- 3. Testing Missions Retrieval ---');

    const missionsRes = await fetch(`${BACKEND_URL}/api/rescue/missions`, {
      headers: { 'Authorization': `Bearer ${officerToken}` }
    });
    assert(missionsRes.status === 200, `GET /api/rescue/missions returned 200 OK (status: ${missionsRes.status})`);
    const missions = await missionsRes.json();
    assert(Array.isArray(missions), `Retrieved array of rescue missions (count: ${missions.length})`);

    let targetMission = missions.find(m => m.status !== 'VERIFIED' && m.operationalStage !== 'COMPLETED');
    if (!targetMission) {
      console.log('No active unverified mission found, creating test report first...');
      const createReportRes = await fetch(`${BACKEND_URL}/api/reports`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          incidentCategory: 'MUD_SLIDE',
          description: 'Automated test landslide on NH-40 corridor for rescue tracking verification',
          locationDescription: 'NH-40 Kilometer 24, Mawiong',
          latitude: 25.5921,
          longitude: 91.8955,
          severity: 'HIGH',
          roadPassability: 'PARTIALLY_BLOCKED'
        })
      });
      const created = await createReportRes.json();
      await fetch(`${BACKEND_URL}/api/rescue/missions/${created.id}/assign`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${adminToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          teamId: 'officer_khasi',
          teamName: 'Rescue Force Unit Alpha',
          priority: 'HIGH',
          instructions: 'Automated test assignment'
        })
      });
      targetMission = { id: created.id, latitude: 25.5921, longitude: 91.8955 };
    }

    const testMissionId = targetMission.id;
    console.log(`Using Mission ID #${testMissionId} for operational lifecycle testing`);

    // ----------------------------------------------------
    // TEST 4: Decline Validation (Mandatory Reason Requirement)
    // ----------------------------------------------------
    console.log('\n--- 4. Testing Mission Decision & Validation ---');

    // Attempt decline with empty reason (must fail with 400 Bad Request)
    const invalidDeclineRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${testMissionId}/decision`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${officerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ decision: 'DECLINE', reason: '' })
    });
    assert(invalidDeclineRes.status === 400, `Declining without reason rejected with 400 Bad Request (got ${invalidDeclineRes.status})`);

    // Accept mission
    const acceptRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${testMissionId}/decision`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${officerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ decision: 'ACCEPT' })
    });
    assert(acceptRes.status === 200, `Accepting mission succeeded with 200 OK (status: ${acceptRes.status})`);
    const acceptedMission = await acceptRes.json();
    assert(acceptedMission.decisionStatus === 'ACCEPTED' || acceptedMission.operationalStage === 'ACCEPTED' || acceptedMission.status === 'RESPONDING',
      'Mission status transitioned to ACCEPTED / RESPONDING');

    // ----------------------------------------------------
    // TEST 5: Journey Start & Live GPS Telemetry
    // ----------------------------------------------------
    console.log('\n--- 5. Testing Journey Start & Live GPS Telemetry ---');

    const startJourneyRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${testMissionId}/start-journey`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${officerToken}` }
    });
    assert(startJourneyRes.status === 200, `POST /api/rescue/missions/${testMissionId}/start-journey returned 200 OK`);
    const journeyData = await startJourneyRes.json();
    assert(journeyData.isTrackingActive === true || journeyData.trackingActive === true, 'Mission state has isTrackingActive: true');
    assert(journeyData.operationalStage === 'EN_ROUTE', 'Mission operationalStage transitioned to EN_ROUTE');

    // Send first GPS breadcrumb
    const locUpdate1 = await fetch(`${BACKEND_URL}/api/rescue/missions/${testMissionId}/location`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${officerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        latitude: 25.5780,
        longitude: 91.8810,
        accuracy: 8.5,
        speed: 42.0,
        heading: 35.0,
        timestamp: new Date().toISOString()
      })
    });
    assert(locUpdate1.status === 200, 'Recorded GPS location ping 1 (accuracy ±8.5m)');

    // Send second GPS breadcrumb
    const locUpdate2 = await fetch(`${BACKEND_URL}/api/rescue/missions/${testMissionId}/location`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${officerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        latitude: 25.5840,
        longitude: 91.8870,
        accuracy: 6.2,
        speed: 38.5,
        heading: 40.0,
        timestamp: new Date().toISOString()
      })
    });
    assert(locUpdate2.status === 200, 'Recorded GPS location ping 2 (accuracy ±6.2m)');

    // Query live mission location
    const liveLocRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${testMissionId}/location`, {
      headers: { 'Authorization': `Bearer ${officerToken}` }
    });
    assert(liveLocRes.status === 200, 'GET live location endpoint returned 200 OK');
    const liveLoc = await liveLocRes.json();
    assert(liveLoc.currentLatitude === 25.5840 && liveLoc.currentLongitude === 91.8870, 'Current location reflects latest GPS ping');
    assert(liveLoc.isLocationStale === false, 'Fresh GPS location has isLocationStale: false');
    assert(Array.isArray(liveLoc.journeyTrail) && liveLoc.journeyTrail.length >= 2, `Journey trail accumulated breadcrumb points (points: ${liveLoc.journeyTrail.length})`);

    // ----------------------------------------------------
    // TEST 6: Arrival on Scene
    // ----------------------------------------------------
    console.log('\n--- 6. Testing Arrival on Scene ---');

    const arriveRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${testMissionId}/arrive`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${officerToken}` }
    });
    assert(arriveRes.status === 200, `POST /arrive returned 200 OK`);
    const arriveData = await arriveRes.json();
    assert(arriveData.operationalStage === 'ON_SCENE', 'Operational stage transitioned to ON_SCENE');

    // ----------------------------------------------------
    // TEST 7: Field Progress Updates
    // ----------------------------------------------------
    console.log('\n--- 7. Testing Field Progress Reporting ---');

    const progressRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${testMissionId}/progress`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${officerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        siteAssessment: 'Moderate translational debris flow covering 60% of westbound carriageway. Saturated red clay.',
        roadPassability: 'PARTIALLY_BLOCKED',
        observedHazards: 'Downed electrical lines, Active mudflow',
        actionsTaken: 'Perimeter cordoned, traffic diverted to single-lane pilot convoy.',
        resourcesRequired: '1x JCB Hydraulic Excavator, Police Traffic Unit'
      })
    });
    assert(progressRes.status === 200, `POST /progress returned 200 OK`);
    const progressData = await progressRes.json();
    assert(Array.isArray(progressData.progressHistory) && progressData.progressHistory.length > 0, 'Progress update successfully appended to mission dossier');

    // ----------------------------------------------------
    // TEST 8: Submit Outcome for Administrator Verification
    // ----------------------------------------------------
    console.log('\n--- 8. Testing Outcome Submission & Verification Guard ---');

    const outcomeRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${testMissionId}/outcome`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${officerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        resolutionSummary: 'Debris cleared from primary lane. Geotechnical stabilization retaining wall inspected.',
        casualtiesReported: 0,
        evacuationsConducted: 4,
        infrastructureStatus: 'Single-lane operational with cautionary signage. Retaining wall requires structural grouting.',
        recommendedFollowUp: 'DDMA structural inspection required within 24 hours.'
      })
    });
    assert(outcomeRes.status === 200, `POST /outcome returned 200 OK`);
    const outcomeData = await outcomeRes.json();
    assert(outcomeData.operationalStage === 'AWAITING_VERIFICATION' || outcomeData.status === 'UNDER_REVIEW',
      'Incident transitioned to AWAITING_VERIFICATION / UNDER_REVIEW');
    assert(outcomeData.status !== 'RESOLVED' && outcomeData.status !== 'COMPLETED',
      'Rescue team outcome submission does NOT unilaterally mark incident as RESOLVED/COMPLETED (Preserves Admin Adjudication Boundary)');

    // ----------------------------------------------------
    // TEST 9: Admin Follow-Up Request & Reactivation
    // ----------------------------------------------------
    console.log('\n--- 9. Testing Admin Follow-Up Instruction Flow ---');

    const followUpRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${testMissionId}/follow-up`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        instructions: 'Please inspect the upper slope drainage culvert 50m upslope before leaving the sector.'
      })
    });
    assert(followUpRes.status === 200, `Admin POST /follow-up returned 200 OK`);
    const followUpData = await followUpRes.json();
    assert(followUpData.operationalStage === 'FOLLOW_UP_REQUIRED', 'Mission operationalStage transitioned to FOLLOW_UP_REQUIRED');
    assert(followUpData.adminFollowUpNotes && followUpData.adminFollowUpNotes.includes('drainage culvert'),
      'Admin follow-up instructions persisted in mission record');

    // ----------------------------------------------------
    // SUMMARY
    // ----------------------------------------------------
    console.log('\n====================================================');
    console.log(`TEST SUITE RESULTS: ${passes} PASSED, ${failures} FAILED`);
    console.log('====================================================');

    if (failures > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('\n[FATAL TEST ERROR]:', err);
    process.exit(1);
  }
}

runTests();
