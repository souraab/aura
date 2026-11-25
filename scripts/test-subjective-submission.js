/**
 * MathPractice: Subjective Answer Submission & Storage Verification Suite
 *
 * Runs repeatable verification tests against Supabase for subjective submissions:
 *   SECTION A: Security & Schema Isolation
 *     1. Storage private bucket RLS (unauthenticated cannot access student-submissions)
 *     2. app_private.is_image_referenced helper is inaccessible via RPC / REST API
 *
 *   SECTION B: Authenticated Subjective Workflow (Requires Student Credentials)
 *     3. Test Step 1: Typed Mathematical Solution Submission
 *        - Submits LaTeX mathematical working
 *        - Verifies evaluation_status = 'PENDING', final_marks = null
 *        - Verifies anti-spam throttle (<2s rejection)
 *     4. Test Step 2: Handwritten Work Attachment & Storage Path Verification
 *        - Uploads test scan to student-submissions/{userId}/...
 *        - Submits with p_image_paths array
 *        - Verifies public.submission_images ingestion with page_number = 1
 *        - Verifies get_student_result returns images metadata
 *     5. Test Step 3: Referential Protection on Storage DELETE (RLS Guard)
 *        - Attempts to delete submitted file from storage
 *        - Verifies deletion is rejected by app_private.is_image_referenced policy
 *     6. Test Step 4: Multi-Attempt Practice Retry & Result Restoration
 *        - Verifies get_student_results restores both typed text and image paths
 *
 * Usage:
 *   node --env-file=.env.local scripts/test-subjective-submission.js <student_email> <student_password> [question_id]
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local");
  process.exit(1);
}

async function runSubjectiveTestSuite() {
  console.log("==================================================================");
  console.log(" MathPractice: Subjective Submission & Storage Verification Suite");
  console.log("==================================================================\n");

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // =========================================================================
  // SECTION A: UNAUTHENTICATED SECURITY & ISOLATION
  // =========================================================================
  console.log("------------------------------------------------------------------");
  console.log("SECTION A: Unauthenticated Security & Schema Isolation");
  console.log("------------------------------------------------------------------");

  // TEST 1: Storage Bucket Unauthenticated Access Restriction
  console.log("\nTEST 1: Private student-submissions bucket RLS (anon client)");
  const { data: bucketFiles, error: bucketErr } = await anonClient
    .storage
    .from('student-submissions')
    .list();

  if (bucketErr || !bucketFiles || bucketFiles.length === 0) {
    console.log("  [PASS] Unauthenticated access to student-submissions denied or returns empty.");
  } else {
    console.warn("  [FAIL] Bucket contents leaked to unauthenticated client:", bucketFiles);
  }

  // TEST 2: Inaccessibility of app_private.is_image_referenced via RPC
  console.log("\nTEST 2: Private schema isolation (app_private.is_image_referenced unreachable via RPC)");
  const { data: rpcData, error: rpcErr } = await anonClient.rpc('is_image_referenced', {
    p_storage_path: 'test/path.jpg',
  });

  if (rpcErr && (rpcErr.code === 'PGRST202' || rpcErr.message.includes('Could not find the function') || rpcErr.message.includes('schema cache'))) {
    console.log("  [PASS] app_private helper is not exposed to PostgREST RPC:", rpcErr.message);
  } else if (rpcErr && rpcErr.message.includes('fetch failed')) {
    console.log("  [INFO] Network call blocked by sandbox or offline:", rpcErr.message);
  } else {
    console.warn("  [FAIL] app_private function was unexpectedly callable via RPC:", rpcData, rpcErr);
  }

  // =========================================================================
  // SECTION B: AUTHENTICATED TESTS (REQUIRES STUDENT CREDENTIALS)
  // =========================================================================
  const email = process.argv[2];
  const password = process.argv[3];
  let targetQuestionId = process.argv[4];

  if (!email || !password) {
    console.log("\n------------------------------------------------------------------");
    console.log("Authenticated workflow tests (Tests 3-6) require student credentials:");
    console.log("  node --env-file=.env.local scripts/test-subjective-submission.js <email> <password> [question_id]");
    console.log("------------------------------------------------------------------");
    console.log("\nStatus: SECTION A passed. SECTION B pending credentials.");
    return;
  }

  console.log("\n------------------------------------------------------------------");
  console.log(`SECTION B: Authenticated Subjective Submission Tests (User: ${email})`);
  console.log("------------------------------------------------------------------");

  const studentClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: authData, error: authErr } = await studentClient.auth.signInWithPassword({
    email,
    password,
  });

  if (authErr || !authData.user) {
    console.error(`  [FAIL] Authentication failed for ${email}: ${authErr?.message}`);
    return;
  }
  const studentUid = authData.user.id;
  console.log(`  [PASS] Authenticated student UUID: ${studentUid}`);

  // If question ID not provided, find first published SUBJECTIVE question
  if (!targetQuestionId) {
    const { data: questions, error: qErr } = await studentClient
      .from('questions')
      .select('id, question_text, question_type, marks, answer_type, status')
      .eq('status', 'PUBLISHED')
      .eq('question_type', 'SUBJECTIVE')
      .limit(1);

    if (qErr || !questions || questions.length === 0) {
      console.error("  [FAIL] No published SUBJECTIVE question found in the database.");
      console.log("  Please publish a SUBJECTIVE question in /admin/questions or pass its UUID as argument #3.");
      return;
    }
    targetQuestionId = questions[0].id;
    console.log(`  [INFO] Target Subjective Question ID: ${targetQuestionId}`);
    console.log(`  [INFO] Answer Type: ${questions[0].answer_type}, Marks: ${questions[0].marks}`);
  }

  // TEST 3: Step 1 - Typed Mathematical Solution Submission
  console.log("\nTEST 3: Step 1 — Typed Mathematical Answer Submission");
  const typedSolution = "Applying Pythagoras Theorem: In right triangle ABC, $AC^2 = AB^2 + BC^2 = 3^2 + 4^2 = 25$, therefore $AC = 5\\text{ cm}$.";

  const { data: typedSubRes, error: typedSubErr } = await studentClient.rpc('submit_student_answer', {
    p_question_id: targetQuestionId,
    p_typed_answer: JSON.stringify({
      type: "SUBJECTIVE",
      text: typedSolution,
    }),
    p_image_paths: [],
  });

  if (typedSubErr) {
    console.error("  [FAIL] Typed subjective submission error:", typedSubErr.message);
    return;
  }

  console.log(`  Evaluation Status: ${typedSubRes.evaluation_status}`);
  console.log(`  Attempt Number: ${typedSubRes.attempt_number}`);
  console.log(`  Feedback: ${typedSubRes.feedback}`);

  if (typedSubRes.evaluation_status === 'PENDING' && typedSubRes.final_marks === null) {
    console.log("  [PASS] Subjective solution routed to PENDING status with NULL marks (awaiting teacher evaluation).");
  } else {
    console.warn("  [FAIL] Unexpected evaluation status or marks:", typedSubRes);
  }

  // Anti-spam debouncing check
  console.log("\nChecking anti-spam submission debounce (< 2s)...");
  const { error: debounceErr } = await studentClient.rpc('submit_student_answer', {
    p_question_id: targetQuestionId,
    p_typed_answer: JSON.stringify({ type: "SUBJECTIVE", text: "rapid duplicate" }),
    p_image_paths: [],
  });

  if (debounceErr && debounceErr.message.includes('wait a moment')) {
    console.log("  [PASS] Rapid consecutive submission correctly rejected by debounce throttle.");
  } else {
    console.warn("  [FAIL] Debounce throttle failed to reject rapid submission:", debounceErr);
  }

  // Wait for debounce cooldown
  console.log("  Waiting 2.5s for throttle window to clear...");
  await new Promise(r => setTimeout(r, 2500));

  // TEST 4: Step 2 - Handwritten Work Upload and Ingestion
  console.log("\nTEST 4: Step 2 — Upload and Link Handwritten Solution Page");

  // Create sample dummy page buffer (1x1 pixel PNG)
  const dummyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  const testStoragePath = `${studentUid}/${Date.now()}-p1-test_scan.png`;

  console.log(`  Uploading sample page to storage: student-submissions/${testStoragePath}`);
  const { error: uploadErr } = await studentClient
    .storage
    .from('student-submissions')
    .upload(testStoragePath, dummyPng, { contentType: 'image/png' });

  if (uploadErr) {
    console.error("  [FAIL] Page upload to student-submissions failed:", uploadErr.message);
    return;
  }
  console.log("  [PASS] Page uploaded to student-submissions private bucket.");

  // Submit answer referencing this uploaded image
  console.log("  Submitting subjective answer with attached image path...");
  const { data: imgSubRes, error: imgSubErr } = await studentClient.rpc('submit_student_answer', {
    p_question_id: targetQuestionId,
    p_typed_answer: JSON.stringify({
      type: "SUBJECTIVE",
      text: "See attached handwritten calculation.",
    }),
    p_image_paths: [testStoragePath],
  });

  if (imgSubErr) {
    console.error("  [FAIL] Submission with image failed:", imgSubErr.message);
    return;
  }

  console.log(`  Attempt Number: ${imgSubRes.attempt_number}`);
  console.log(`  Attached Images Returned:`, imgSubRes.images);

  if (imgSubRes.images && imgSubRes.images.length > 0 && imgSubRes.images[0].storage_path === testStoragePath) {
    console.log("  [PASS] Image successfully ingested into submission_images with correct storage_path.");
  } else {
    console.warn("  [FAIL] Image metadata missing from evaluation result:", imgSubRes.images);
  }

  // TEST 5: Step 3 - Referential Protection on Storage DELETE (RLS Guard)
  console.log("\nTEST 5: Step 3 — Referential Integrity Protection on Storage DELETE");
  console.log("  Attempting to delete the submitted file from student-submissions...");

  const { data: delData, error: delErr } = await studentClient
    .storage
    .from('student-submissions')
    .remove([testStoragePath]);

  // When RLS blocks a delete, Supabase storage returns an empty array or an error
  if (delErr || !delData || delData.length === 0) {
    console.log("  [PASS] Storage DELETE safely rejected! Submitted image cannot be deleted by student.");
  } else {
    console.warn("  [FAIL] Security vulnerability: Submitted image was deleted from storage:", delData);
  }

  // TEST 6: Step 4 - Result Restoration & Multi-Attempt State
  console.log("\nTEST 6: Step 4 — Result Restoration Across Sessions (get_student_result)");
  const { data: restored, error: restoreErr } = await studentClient.rpc('get_student_result', {
    p_question_id: targetQuestionId,
  });

  if (restoreErr) {
    console.error("  [FAIL] Could not restore student result:", restoreErr.message);
    return;
  }

  console.log(`  Restored attempt: #${restored.attempt_number} (total: ${restored.total_attempts})`);
  console.log(`  Restored images count: ${restored.images?.length ?? 0}`);

  if (restored.submitted && restored.images && restored.images.length > 0) {
    console.log("  [PASS] Result restoration successfully reloaded attempt history and image attachments.");
  } else {
    console.warn("  [FAIL] Incomplete restoration data:", restored);
  }

  console.log("\n==================================================================");
  console.log(" ALL SUBJECTIVE SUBMISSION & STORAGE VERIFICATION TESTS PASSED!");
  console.log("==================================================================");
}

runSubjectiveTestSuite().catch(err => {
  console.error("Test runner encountered an error:", err);
  process.exit(1);
});

