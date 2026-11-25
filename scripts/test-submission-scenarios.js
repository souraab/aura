const assert = require("node:assert");

// Initialize jiti to load TypeScript module with path aliases
const jiti = require("jiti")(process.cwd() + "/index.js", {
  alias: {
    "^@/(.*)$": process.cwd() + "/src/$1",
    "@": process.cwd() + "/src",
  },
});

process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "mock-key";

const {
  compareSubmissionsForAttempt,
  selectActiveSubmissionForAttempt,
} = jiti("./src/lib/admin-questions-db.ts");

console.log("=== RUNNING SUBMISSION ORDERING & SELECTION TEST SUITE ===");

// Helper to simulate step 11 evalStatus resolution
function simulateEvaluationStatusResolution(att, latestSub, ev) {
  let evalStatus = "NOT_SUBMITTED";
  let marksAwarded = null;
  let isCorrect = null;

  if (!latestSub || !latestSub.submitted_at) {
    evalStatus = att.status === "IN_PROGRESS" ? "IN_PROGRESS" : "NOT_SUBMITTED";
  } else if (!ev) {
    evalStatus = "PENDING";
  } else {
    const upperStatus = String(ev.evaluation_status || "").toUpperCase();
    if (upperStatus === "FINALIZED") {
      evalStatus = "FINALIZED";
      marksAwarded = typeof ev.final_marks === "number" ? ev.final_marks : 0;
      isCorrect = marksAwarded > 0;
    } else {
      evalStatus = "PENDING";
    }
  }

  return { evalStatus, marksAwarded, isCorrect };
}

// Scenario 1: One submitted record
{
  const subs = [
    {
      id: "sub-1",
      attempt_id: "att-1",
      submission_status: "SUBMITTED",
      submitted_at: "2026-11-19T10:00:00Z",
      created_at: "2026-11-19T09:59:00Z",
    },
  ];
  const selected = selectActiveSubmissionForAttempt(subs);
  assert.strictEqual(selected?.id, "sub-1", "Scenario 1: Must select the single submitted record");
  console.log("✓ Scenario 1 PASSED: One submitted record selected correctly.");
}

// Scenario 2: Older submitted + newer draft
{
  const subs = [
    {
      id: "sub-submitted",
      attempt_id: "att-2",
      submission_status: "SUBMITTED",
      submitted_at: "2026-11-19T10:00:00Z",
      created_at: "2026-11-19T09:58:00Z",
    },
    {
      id: "sub-newer-draft",
      attempt_id: "att-2",
      submission_status: "IN_PROGRESS",
      submitted_at: null,
      created_at: "2026-11-19T10:05:00Z",
    },
  ];
  const selected = selectActiveSubmissionForAttempt(subs);
  assert.strictEqual(
    selected?.id,
    "sub-submitted",
    "Scenario 2: Genuinely submitted record must take precedence over newer unsubmitted draft"
  );
  console.log("✓ Scenario 2 PASSED: Older submitted record prioritized over newer draft.");
}

// Scenario 3: Two submitted records
{
  const subs = [
    {
      id: "sub-older",
      attempt_id: "att-3",
      submission_status: "SUBMITTED",
      submitted_at: "2026-11-19T09:30:00Z",
      created_at: "2026-11-19T09:29:00Z",
    },
    {
      id: "sub-newer",
      attempt_id: "att-3",
      submission_status: "SUBMITTED",
      submitted_at: "2026-11-19T10:30:00Z",
      created_at: "2026-11-19T10:29:00Z",
    },
  ];
  const selected = selectActiveSubmissionForAttempt(subs);
  assert.strictEqual(selected?.id, "sub-newer", "Scenario 3: Must select the latest submitted record");
  console.log("✓ Scenario 3 PASSED: Latest submitted record selected among multiple submissions.");
}

// Scenario 4: Two submitted records with identical timestamps (deterministic ID tie-break)
{
  const subA = {
    id: "sub-001",
    attempt_id: "att-4",
    submission_status: "SUBMITTED",
    submitted_at: "2026-11-19T10:00:00Z",
    created_at: "2026-11-19T09:59:00Z",
  };
  const subB = {
    id: "sub-002",
    attempt_id: "att-4",
    submission_status: "SUBMITTED",
    submitted_at: "2026-11-19T10:00:00Z",
    created_at: "2026-11-19T09:59:00Z",
  };

  const selectedOrder1 = selectActiveSubmissionForAttempt([subA, subB]);
  const selectedOrder2 = selectActiveSubmissionForAttempt([subB, subA]);
  assert.strictEqual(selectedOrder1?.id, "sub-002", "Scenario 4: Deterministic tie-break selects sub-002");
  assert.strictEqual(
    selectedOrder2?.id,
    "sub-002",
    "Scenario 4: Tie-break order must be stable regardless of array insertion order"
  );
  console.log("✓ Scenario 4 PASSED: Identical timestamps resolved with deterministic tie-break.");
}

// Scenario 5: Only draft records
{
  const subs = [
    {
      id: "draft-older",
      attempt_id: "att-5",
      submission_status: "IN_PROGRESS",
      submitted_at: null,
      created_at: "2026-11-19T09:00:00Z",
    },
    {
      id: "draft-newer",
      attempt_id: "att-5",
      submission_status: "IN_PROGRESS",
      submitted_at: null,
      created_at: "2026-11-19T09:15:00Z",
    },
  ];
  const selected = selectActiveSubmissionForAttempt(subs);
  assert.strictEqual(selected?.id, "draft-newer", "Scenario 5: Selects newest draft among drafts");
  assert.strictEqual(selected?.submitted_at, null, "Scenario 5: Active submission submitted_at remains null");

  const resolutionInProgress = simulateEvaluationStatusResolution({ status: "IN_PROGRESS" }, selected, null);
  assert.strictEqual(
    resolutionInProgress.evalStatus,
    "IN_PROGRESS",
    "Scenario 5: Draft attempt with IN_PROGRESS status resolves to IN_PROGRESS"
  );
  assert.strictEqual(resolutionInProgress.marksAwarded, null, "Scenario 5: Must not have awarded marks");

  const resolutionNotSubmitted = simulateEvaluationStatusResolution({ status: "STARTED" }, selected, null);
  assert.strictEqual(
    resolutionNotSubmitted.evalStatus,
    "NOT_SUBMITTED",
    "Scenario 5: Draft attempt without IN_PROGRESS status resolves to NOT_SUBMITTED"
  );
  assert.strictEqual(resolutionNotSubmitted.marksAwarded, null, "Scenario 5: Must not have awarded marks");
  console.log("✓ Scenario 5 PASSED: Only draft records correctly preserves in-progress/not-submitted state.");
}

// Scenario 6: No submission
{
  const subs = [];
  const selected = selectActiveSubmissionForAttempt(subs);
  assert.strictEqual(selected, null, "Scenario 6: Must return null when no submissions exist");

  const resolutionInProgress = simulateEvaluationStatusResolution({ status: "IN_PROGRESS" }, selected, null);
  assert.strictEqual(
    resolutionInProgress.evalStatus,
    "IN_PROGRESS",
    "Scenario 6: Empty submission with IN_PROGRESS attempt status resolves to IN_PROGRESS"
  );
  assert.strictEqual(resolutionInProgress.marksAwarded, null, "Scenario 6: Must not have awarded marks");

  const resolutionNotSubmitted = simulateEvaluationStatusResolution({ status: "ABANDONED" }, selected, null);
  assert.strictEqual(
    resolutionNotSubmitted.evalStatus,
    "NOT_SUBMITTED",
    "Scenario 6: Empty submission with other status resolves to NOT_SUBMITTED"
  );
  assert.strictEqual(resolutionNotSubmitted.marksAwarded, null, "Scenario 6: Must not have awarded marks");
  console.log("✓ Scenario 6 PASSED: No submission correctly preserves NOT_SUBMITTED / IN_PROGRESS handling.");
}

console.log("\nALL 6 SUBMISSION SELECTION SCENARIOS PASSED SUCCESSFULLY!");

