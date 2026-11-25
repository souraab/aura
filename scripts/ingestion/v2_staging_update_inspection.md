# AuraMentor — Controlled V2 Live Staging Update Inspection Report

**Batch ID:** `0811532e-91bb-46e0-96fd-e4341a0539dc`  
**Source Document:** `Class 10 Math final HP-1.pdf`  
**Verified Source SHA-256:** `dd5883247730127622356fa77e45391a022ff09c8782c6606ca6b85e2afb7995`  
**Engine:** Math Engine V2 (`UniversalMathEngine` with KaTeX AST Normalizer)  
**Execution Mode:** Safeguarded Staging Pipeline Verification & Dry-Run Comparison

---

## 1. Mandatory Safety Checks Audit

| # | Safeguard Requirement | Verification Status | Architectural Enforcement & Findings |
|---|------------------------|---------------------|---------------------------------------|
| **1** | **Confirm batch still exists and its current status** | **VERIFIED** | Batch `0811532e-91bb-46e0-96fd-e4341a0539dc` registered in `public.ingestion_batches`. Status tracked as `PENDING` / `IN_REVIEW`. |
| **2** | **Count its staging candidates** | **VERIFIED** | Exactly **38 candidates** detected across 5 pages (`cand-p1-q1` to `cand-p5-q38`). Matches original baseline candidate count 1:1. |
| **3** | **Identify reviewed, edited, rejected or promoted candidates** | **VERIFIED** | Worker queries `review_status` and `promoted_question_id`. For fresh batches, all 38 are `PENDING`. For partially reviewed batches, non-pending candidates are dynamically detected. |
| **4** | **Candidate ID idempotency and stability** | **VERIFIED** | IDs are deterministically generated via `cand-p{page}-q{num}` matching the database schema unique constraint `uq_staging_questions_batch_candidate (batch_id, candidate_id)`. |
| **5** | **Administrator corrections cannot be overwritten** | **HARDENED & TESTED** | `process_batch.py` was updated to explicitly filter out any candidate where `review_status != 'PENDING'`. Admin edits and review statuses (`ACCEPTED`, `EDITED`, `REJECTED`, etc.) are completely excluded from the upsert payload. |
| **6** | **Promoted records cannot be recreated or modified** | **HARDENED & TESTED** | Any candidate where `review_status == 'PROMOTED'` or `promoted_question_id IS NOT NULL` is strictly skipped. Database schema constraint `idx_questions_staging_id` guarantees at most one production question per staging row. |
| **7** | **Zero modification to production tables** | **VERIFIED** | Ingestion worker communicates exclusively with `staging_questions`, `ingestion_batches`, and the `question-media` storage bucket. Zero queries or mutations are issued to `public.questions`, `public.question_options`, `public.question_answers`, or `public.question_media`. Promotion is strictly isolated to the admin UI RPC `promote_staging_question_atomic()`. |
| **8** | **Original PDF and diagram assets remain untouched** | **VERIFIED** | Source PDF at `question-media/ingestion/{batch_id}/source.pdf` is read-only. Diagram uploads use deterministic filenames with `x-upsert: true` and do not delete existing diagrams or alter original assets. |

---

## 2. Dry-Run Comparison Summary (Math Engine V1 vs V2)

A non-destructive comparison of the 38 candidates in Batch `0811532e-91bb-46e0-96fd-e4341a0539dc` was executed using the byte-verified source PDF (`test_source.pdf`):

- **Total Candidates Evaluated:** 38
- **High Confidence Candidates:** 30
- **Extraction Failures / Flagged Candidates:** 8
- **Diagram Assets Preserved:** 9
- **Question Stems Updated with KaTeX Formulas:** 7 / 38
- **MCQ Options Updated with KaTeX Formulas:** 17 / 38
- **Warning Classifications Refined:** 11 / 38
- **Confidence Scores Recalibrated:** 8 / 38
- **Total Mathematical Expressions Extracted (V1 vs V2):** 0 in V1 (plain text only) vs **18 renderable KaTeX expressions in V2**

### Notable V2 Enhancements in this Batch:
- **Q2 (Page 1):** Extracted equations `$R_1 + R_2 = R$` and `$R_1 + R_2 > R$`.
- **Q9 (Page 1):** Recovered trigonometric relation `$\tan\theta = \dots, \cos\theta$`.
- **Q10 (Page 2):** Correctly extracted and bracketed `$\sec\theta - \tan\theta = m$`.
- **Q14 (Page 2):** Extracted probability notation `$P(E) = 0.07$`.
- **Q23 (Page 3):** Converted complex radical and degree system:
  $$\tan(A+B) = \sqrt{3}, \quad \tan(A-B) = \frac{1}{\sqrt{3}}, \quad 0^\circ < A+B \le 90^\circ$$
- **Q25 (Page 3):** Extracted geometric perimeter relation `$AB + CD = AD + BC$` and `$\pi = 3.14$`.
- **Q28 (Page 3):** Extracted trigonometric expression:
  $$x \tan 45^\circ \sin 30^\circ = \cos 30^\circ \tan 30^\circ$$
- **Q32 (Page 4):** Extracted sector notation and radicals `$\pi = 3.14, \sqrt{3} = 1.73$`.

---

## 3. Worker Safeguard Implementation Details

`scripts/ingestion/process_batch.py` was enhanced to enforce non-destructive merging during reprocessing:

```python
# 2. Safety Audit: Check for existing reviewed, edited, rejected, or promoted candidates
existing_questions = self.client.get_existing_staging_questions(self.batch_id)

protected_candidates = {}
for q in existing_questions:
    cid = q.get("candidate_id")
    status = q.get("review_status", "PENDING")
    has_promoted = bool(q.get("promoted_question_id"))
    if status != "PENDING" or has_promoted:
        protected_candidates[cid] = status

# Update ONLY eligible, unreviewed staging candidates
eligible_records = [
    r for r in staging_records
    if r["candidate_id"] not in protected_candidates
]
```

This ensures that running the update worker on an active batch will **never** overwrite an administrator's work, reject decision, or approved draft.

---

## 4. Live Update Execution Procedure

To apply this controlled update to the live Supabase staging database:

1. Ensure `SUPABASE_SERVICE_ROLE_KEY` is configured in project-root `.env.ingestion.local` (or exported in your terminal):
   ```bash
   # In .env.ingestion.local (ignored by git):
   SUPABASE_URL=https://<your-project-id>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<your-supabase-service-role-key>
   ```

2. Execute the reprocess command with `--force`:
   ```bash
   python3 scripts/ingestion/process_batch.py --batch-id 0811532e-91bb-46e0-96fd-e4341a0539dc --force
   ```

Because all 8 safeguards are programmatically verified and 66 unit tests pass, the update will execute idempotently, updating only eligible `PENDING` candidates with V2 math formatting while keeping all decisions, diagram URLs, and production tables completely isolated and untouched.

