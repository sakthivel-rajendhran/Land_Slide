/**
 * SlopeGuard — Automated Verification Suite for Admin-to-Rescue Force Assignment Workflow
 *
 * Verifies:
 * 1. Citizen incident report submission
 * 2. Admin assigns report to Rescue Team Alpha
 * 3. Rescue Team Alpha immediately retrieves assignment in ASSIGNED / PENDING state
 * 4. Rescue Team Bravo CANNOT see Team Alpha's assignment (Strict Team Isolation)
 * 5. Rescue Team Bravo cannot accept or modify Team Alpha's assignment (403 Forbidden)
 * 6. Rescue Team Alpha cannot start journey before accepting (Strict Pre-Journey sequence)
 * 7. Rescue Team Alpha accepts assignment -> state becomes ACCEPTED
 * 8. Rescue Team Alpha starts journey -> state becomes EN_ROUTE & GPS tracking active
 * 9. Rescue Team Alpha transmits GPS breadcrumbs -> coordinates & trail recorded
 * 10. Rescue Team Alpha arrives on scene -> ON_SCENE
 * 11. Rescue Team Alpha submits field progress
 * 12. Rescue Team Alpha submits outcome report -> AWAITING_VERIFICATION (Incident remains open)
 * 13. Admin verifies and closes incident -> COMPLETED
 * 14. Reassignment scenario: Admin assigns report to Team Alpha, reassigns to Team Bravo:
 *     - Team Alpha's workload cleared of report
 *     - Team Bravo receives report
 * 15. Revocation scenario: Admin revokes assignment -> disappears from active team workload
 */

const assert = require('assert');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';

async function run() {
  console.log('================================================================');
  console.log('   SLOPEGUARD ASSIGNMENT & TEAM ISOLATION VERIFICATION SUITE   ');
  console.log('================================================================');

  let passedTests = 0;
  function testPassed(msg) {
    passedTests++;
    console.log(`  [PASS ${passedTests}] ${msg}`);
  }

  // --------------------------------------------------------------------------
  // 1. Authenticate Users (Admin, Rescue Team Alpha, Rescue Team Bravo)
  // --------------------------------------------------------------------------
  console.log('\n--- 1. Authenticating Roles ---');

  // Admin
  const adminRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@slopeguard.org', password: 'AdminPass123!Safe' })
  });
  assert.strictEqual(adminRes.status, 200, `Admin login failed: ${adminRes.status}`);
  const adminAuth = await adminRes.json();
  const adminToken = adminAuth.token;
  testPassed('Administrator authenticated successfully');

  // Team Alpha (Lyngdoh)
  const alphaRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'officer@slopeguard.ner.gov.in', password: 'OfficerPass123!' })
  });
  assert.strictEqual(alphaRes.status, 200, `Team Alpha login failed: ${alphaRes.status}`);
  const alphaAuth = await alphaRes.json();
  const alphaToken = alphaAuth.token;
  testPassed('Rescue Team Alpha (Lyngdoh) authenticated successfully');

  // Team Bravo (Barman)
  const bravoRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'officer.bravo@slopeguard.ner.gov.in', password: 'OfficerPass123!' })
  });
  assert.strictEqual(bravoRes.status, 200, `Team Bravo login failed: ${bravoRes.status}`);
  const bravoAuth = await bravoRes.json();
  const bravoToken = bravoAuth.token;
  testPassed('Rescue Team Bravo (Barman) authenticated successfully');

  // --------------------------------------------------------------------------
  // 2. Citizen Submits Incident Report
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Citizen Submits Incident Report ---');

  const reportPayload = {
    description: 'Active debris slide and tension cracks blocking single-lane on NH-40 corridor km 44 near Mawphlang.',
    latitude: 25.4623,
    longitude: 91.7589,
    locationDescription: 'NH-40 km 44, Mawphlang Pass, East Khasi Hills',
    incidentCategory: 'MUD_SLIDE'
  };

  const createReportRes = await fetch(`${BACKEND_URL}/api/reports`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(reportPayload)
  });
  assert.strictEqual(createReportRes.status, 201, `Create report failed: ${createReportRes.status}`);
  const createdReport = await createReportRes.json();
  const reportId = createdReport.id;
  assert.ok(reportId, 'Report ID generated');
  testPassed(`Citizen incident report #${reportId} created with status ${createdReport.status}`);

  // --------------------------------------------------------------------------
  // 3. Admin Assigns Report to Rescue Team Alpha
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Admin Assigns Incident to Team Alpha ---');

  const assignPayload = {
    teamId: 'officer_khasi',
    teamName: 'Rescue Force Unit Alpha (Er. T. Lyngdoh)',
    priority: 'CRITICAL',
    instructions: 'Deploy immediately with heavy earthmover. Clear blocked single-lane and evaluate tension cracks.',
    responseWindow: '1 hour'
  };

  const assignRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${reportId}/assign`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(assignPayload)
  });
  assert.strictEqual(assignRes.status, 200, `Admin assign failed: ${assignRes.status}`);
  const assignedMission = await assignRes.json();
  assert.strictEqual(assignedMission.operationalStage, 'ASSIGNED');
  assert.strictEqual(assignedMission.decisionStatus, 'PENDING');
  assert.strictEqual(assignedMission.assignedOfficerId, 'officer_khasi');
  testPassed(`Admin assigned incident #${reportId} to Team Alpha with CRITICAL priority`);

  // --------------------------------------------------------------------------
  // 4. Team Alpha Retrieves Missions (Immediate Delivery)
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Team Alpha Retrieves Assigned Workload ---');

  const alphaMissionsRes = await fetch(`${BACKEND_URL}/api/rescue/missions`, {
    headers: { 'Authorization': `Bearer ${alphaToken}` }
  });
  assert.strictEqual(alphaMissionsRes.status, 200);
  const alphaMissions = await alphaMissionsRes.json();
  const alphaTarget = alphaMissions.find(m => String(m.id) === String(reportId));
  assert.ok(alphaTarget, `Mission #${reportId} must appear in Team Alpha's dashboard workload`);
  assert.strictEqual(alphaTarget.decisionStatus, 'PENDING');
  assert.strictEqual(alphaTarget.operationalStage, 'ASSIGNED');
  assert.strictEqual(alphaTarget.assignedPriority, 'CRITICAL');
  testPassed(`Team Alpha sees mission #${reportId} in pending assignments queue`);

  // --------------------------------------------------------------------------
  // 5. Team Bravo Retrieves Missions (Team Isolation Check)
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Team Isolation: Team Bravo CANNOT see Team Alpha Assignment ---');

  const bravoMissionsRes = await fetch(`${BACKEND_URL}/api/rescue/missions`, {
    headers: { 'Authorization': `Bearer ${bravoToken}` }
  });
  assert.strictEqual(bravoMissionsRes.status, 200);
  const bravoMissions = await bravoMissionsRes.json();
  const bravoTarget = bravoMissions.find(m => String(m.id) === String(reportId));
  assert.strictEqual(bravoTarget, undefined, `Team Bravo MUST NOT see mission #${reportId} assigned to Team Alpha`);
  testPassed(`Team Bravo's mission list does not contain Team Alpha's private assignment #${reportId}`);

  // --------------------------------------------------------------------------
  // 6. Team Bravo Attempts to Access / Accept Team Alpha Mission (403 Forbidden)
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Access Control: Team Bravo Blocked with 403 Forbidden ---');

  const bravoGetRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${reportId}`, {
    headers: { 'Authorization': `Bearer ${bravoToken}` }
  });
  assert.strictEqual(bravoGetRes.status, 403, `Expected 403 Forbidden when Team Bravo queries mission #${reportId}, got: ${bravoGetRes.status}`);
  testPassed(`GET /api/rescue/missions/${reportId} by Team Bravo returned 403 Forbidden`);

  const bravoAcceptRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${reportId}/decision`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${bravoToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ decision: 'ACCEPT' })
  });
  assert.strictEqual(bravoAcceptRes.status, 403, `Expected 403 Forbidden when Team Bravo attempts to accept Team Alpha's mission, got: ${bravoAcceptRes.status}`);
  testPassed(`POST /api/rescue/missions/${reportId}/decision by Team Bravo returned 403 Forbidden`);

  // --------------------------------------------------------------------------
  // 7. Strict Pre-Journey Sequence: Cannot Start Journey Before Accepting
  // --------------------------------------------------------------------------
  console.log('\n--- 7. Pre-Journey Sequence Enforcement ---');

  const prematureJourneyRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${reportId}/start-journey`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${alphaToken}` }
  });
  assert.ok(prematureJourneyRes.status === 400 || prematureJourneyRes.status === 409 || prematureJourneyRes.status === 500,
    `Expected error when starting journey before accepting, got: ${prematureJourneyRes.status}`);
  testPassed('Premature start-journey rejected because mission is not yet accepted');

  // --------------------------------------------------------------------------
  // 8. Team Alpha Accepts Assignment
  // --------------------------------------------------------------------------
  console.log('\n--- 8. Team Alpha Accepts Assignment ---');

  const acceptRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${reportId}/decision`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${alphaToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ decision: 'ACCEPT' })
  });
  assert.strictEqual(acceptRes.status, 200, `Accept failed: ${acceptRes.status}`);
  const acceptedMission = await acceptRes.json();
  assert.strictEqual(acceptedMission.decisionStatus, 'ACCEPTED');
  assert.strictEqual(acceptedMission.operationalStage, 'ACCEPTED');
  testPassed(`Team Alpha accepted mission #${reportId}. Operational stage is now ACCEPTED`);

  // --------------------------------------------------------------------------
  // 9. Team Alpha Starts Journey (GPS Activated)
  // --------------------------------------------------------------------------
  console.log('\n--- 9. Team Alpha Starts Journey & Activates GPS ---');

  const startJourneyRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${reportId}/start-journey`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${alphaToken}` }
  });
  assert.strictEqual(startJourneyRes.status, 200, `Start journey failed: ${startJourneyRes.status}`);
  const journeyMission = await startJourneyRes.json();
  assert.strictEqual(journeyMission.operationalStage, 'EN_ROUTE');
  assert.strictEqual(journeyMission.isTrackingActive, true);
  assert.ok(journeyMission.journeyStartedAt, 'journeyStartedAt timestamp recorded');
  testPassed(`Team Alpha started journey. Stage is EN_ROUTE and tracking is active`);

  // --------------------------------------------------------------------------
  // 10. Live GPS Coordinates Updates Transmitted
  // --------------------------------------------------------------------------
  console.log('\n--- 10. Transmitting GPS Location Telemetry ---');

  const loc1Res = await fetch(`${BACKEND_URL}/api/rescue/missions/${reportId}/location`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${alphaToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      latitude: 25.5600,
      longitude: 91.8700,
      accuracy: 8.5,
      timestamp: new Date().toISOString()
    })
  });
  assert.strictEqual(loc1Res.status, 200);

  const loc2Res = await fetch(`${BACKEND_URL}/api/rescue/missions/${reportId}/location`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${alphaToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      latitude: 25.5100,
      longitude: 91.8100,
      accuracy: 6.2,
      timestamp: new Date().toISOString()
    })
  });
  assert.strictEqual(loc2Res.status, 200);

  // Admin verifies live location telemetry
  const adminLocRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${reportId}/location`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.strictEqual(adminLocRes.status, 200);
  const locData = await adminLocRes.json();
  assert.strictEqual(locData.isTrackingActive, true);
  assert.strictEqual(locData.currentLatitude, 25.5100);
  assert.strictEqual(locData.currentLongitude, 91.8100);
  assert.strictEqual(locData.isLocationStale, false);
  assert.ok(Array.isArray(locData.journeyTrail) && locData.journeyTrail.length >= 2, 'Journey trail contains recorded breadcrumbs');
  testPassed(`Live GPS telemetry streamed and verified by Admin: (${locData.currentLatitude}, ${locData.currentLongitude})`);

  // --------------------------------------------------------------------------
  // 11. Team Alpha Records Arrival on Scene
  // --------------------------------------------------------------------------
  console.log('\n--- 11. Team Alpha Records Arrival On Scene ---');

  const arriveRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${reportId}/arrive`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${alphaToken}` }
  });
  assert.strictEqual(arriveRes.status, 200);
  const arriveData = await arriveRes.json();
  assert.strictEqual(arriveData.operationalStage, 'ON_SCENE');
  assert.ok(arriveData.arrivedAt, 'arrivedAt timestamp recorded');
  testPassed(`Team Alpha arrived on scene. Operational stage: ON_SCENE`);

  // --------------------------------------------------------------------------
  // 12. Team Alpha Submits Field Progress
  // --------------------------------------------------------------------------
  console.log('\n--- 12. Team Alpha Submits On-Site Progress Assessment ---');

  const progressRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${reportId}/progress`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${alphaToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      siteAssessment: 'Debris volume estimated at 350 cu.m. Tension cracks expanding 2cm/hr on upper crest.',
      roadPassability: 'PARTIALLY_BLOCKED',
      observedHazards: 'Active secondary mudflow, unstable upper boulders',
      actionsTaken: 'Cordoned perimeter 100m, deployed spotters, redirected small vehicles via bypass',
      resourcesRequired: '1x Excavator, 1x Water pump, 20x Sandbags'
    })
  });
  assert.strictEqual(progressRes.status, 200);
  const progressData = await progressRes.json();
  assert.strictEqual(progressData.operationalStage, 'IN_PROGRESS');
  assert.ok(progressData.progressHistory.length >= 1);
  testPassed(`Field progress assessment recorded in mission dossier`);

  // --------------------------------------------------------------------------
  // 13. Team Alpha Submits Response Outcome for Admin Verification
  // --------------------------------------------------------------------------
  console.log('\n--- 13. Team Alpha Submits Response Outcome ---');

  const outcomeRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${reportId}/outcome`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${alphaToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      resolutionSummary: 'Slope debris cleared from carriage-way. Upper tension cracks stabilized with geotextile covers. Road reopened to single-lane piloted traffic.',
      casualtiesReported: 0,
      evacuationsConducted: 4,
      infrastructureDamage: 'Minor culvert rim damage, highway embankment intact.',
      followUpRecommended: 'PWD structural retaining wall reinforcement required before monsoon peak.',
      evidenceNotes: 'All field logs cross-verified with Meghalaya SDRF station.'
    })
  });
  assert.strictEqual(outcomeRes.status, 200);
  const outcomeData = await outcomeRes.json();
  assert.strictEqual(outcomeData.operationalStage, 'AWAITING_VERIFICATION');
  assert.strictEqual(outcomeData.status, 'UNDER_REVIEW');
  assert.strictEqual(outcomeData.isTrackingActive, false);
  testPassed(`Outcome report submitted. Stage is AWAITING_VERIFICATION, incident remains UNDER_REVIEW (closure reserved for Admin)`);

  // --------------------------------------------------------------------------
  // 14. Admin Verifies Outcome & Completes Incident
  // --------------------------------------------------------------------------
  console.log('\n--- 14. Administrator Adjudicates & Closes Incident ---');

  const verifyRes = await fetch(`${BACKEND_URL}/api/admin/reports/${reportId}/status`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      status: 'VERIFIED',
      reviewNotes: 'Verified on-site outcome report submitted by Rescue Force Alpha. Road cleared, safety buffer established.'
    })
  });
  assert.strictEqual(verifyRes.status, 200);
  const verifiedData = await verifyRes.json();
  assert.strictEqual(verifiedData.status, 'VERIFIED');

  // Verify mission operationalStage reflects COMPLETED
  const finalMissionRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${reportId}`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const finalMission = await finalMissionRes.json();
  assert.strictEqual(finalMission.operationalStage, 'COMPLETED');
  testPassed(`Administrator verified incident #${reportId}. Mission operational stage marked COMPLETED`);

  // --------------------------------------------------------------------------
  // 15. Reassignment Scenario: Admin Reassigns from Team Alpha to Team Bravo
  // --------------------------------------------------------------------------
  console.log('\n--- 15. Testing Reassignment: Team Alpha -> Team Bravo ---');

  // Create report 2
  const rep2Res = await fetch(`${BACKEND_URL}/api/reports`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      description: 'Massive rockfall hazard reported near Haflong railway cutting.',
      latitude: 25.1782,
      longitude: 93.0234,
      locationDescription: 'Haflong - Lumding Railway Section, Dima Hasao',
      incidentCategory: 'ROCKFALL'
    })
  });
  const rep2 = await rep2Res.json();
  const rep2Id = rep2.id;

  // Step A: Assign to Team Alpha
  await fetch(`${BACKEND_URL}/api/rescue/missions/${rep2Id}/assign`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      teamId: 'officer_khasi',
      teamName: 'Rescue Force Unit Alpha',
      priority: 'HIGH',
      instructions: 'Initial reconnaissance'
    })
  });

  // Verify Team Alpha sees it, Team Bravo does not
  let aMissions = await (await fetch(`${BACKEND_URL}/api/rescue/missions`, { headers: { 'Authorization': `Bearer ${alphaToken}` } })).json();
  let bMissions = await (await fetch(`${BACKEND_URL}/api/rescue/missions`, { headers: { 'Authorization': `Bearer ${bravoToken}` } })).json();
  assert.ok(aMissions.some(m => String(m.id) === String(rep2Id)), 'Team Alpha must see report 2 initially');
  assert.ok(!bMissions.some(m => String(m.id) === String(rep2Id)), 'Team Bravo must NOT see report 2 initially');
  testPassed(`Initial assignment of report #${rep2Id} correctly visible only to Team Alpha`);

  // Step B: Admin Reassigns to Team Bravo
  const reassignRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${rep2Id}/assign`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      teamId: 'officer_dima',
      teamName: 'Rescue Force Unit Bravo (Er. R. Barman)',
      priority: 'CRITICAL',
      instructions: 'Immediate track inspection at Haflong cutting'
    })
  });
  assert.strictEqual(reassignRes.status, 200);

  // Step C: Verify Team Alpha NO LONGER sees it, and Team Bravo NOW sees it!
  aMissions = await (await fetch(`${BACKEND_URL}/api/rescue/missions`, { headers: { 'Authorization': `Bearer ${alphaToken}` } })).json();
  bMissions = await (await fetch(`${BACKEND_URL}/api/rescue/missions`, { headers: { 'Authorization': `Bearer ${bravoToken}` } })).json();
  assert.ok(!aMissions.some(m => String(m.id) === String(rep2Id)), `Team Alpha MUST NOT see reassigned report #${rep2Id}`);
  assert.ok(bMissions.some(m => String(m.id) === String(rep2Id)), `Team Bravo MUST see reassigned report #${rep2Id}`);
  testPassed(`Reassignment successful: report #${rep2Id} removed from Team Alpha and transferred to Team Bravo`);

  // --------------------------------------------------------------------------
  // 16. Revocation Scenario: Admin Revokes Assignment
  // --------------------------------------------------------------------------
  console.log('\n--- 16. Testing Revocation Scenario ---');

  const revokeRes = await fetch(`${BACKEND_URL}/api/rescue/missions/${rep2Id}/revoke`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ reason: 'Hazard resolved by local rail maintenance crew' })
  });
  assert.strictEqual(revokeRes.status, 200);

  // Verify neither team sees report 2 in active missions
  aMissions = await (await fetch(`${BACKEND_URL}/api/rescue/missions`, { headers: { 'Authorization': `Bearer ${alphaToken}` } })).json();
  bMissions = await (await fetch(`${BACKEND_URL}/api/rescue/missions`, { headers: { 'Authorization': `Bearer ${bravoToken}` } })).json();
  assert.ok(!aMissions.some(m => String(m.id) === String(rep2Id)), 'Team Alpha must not see revoked mission');
  assert.ok(!bMissions.some(m => String(m.id) === String(rep2Id)), 'Team Bravo must not see revoked mission');
  testPassed(`Revocation verified: report #${rep2Id} removed from active workloads for all units`);

  console.log('\n================================================================');
  console.log(`   ALL ${passedTests} ASSIGNMENT & ISOLATION WORKFLOW TESTS PASSED!`);
  console.log('================================================================\n');
}

run().catch(err => {
  console.error('\n❌ Test Failure:', err);
  process.exit(1);
});
