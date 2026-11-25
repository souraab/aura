-- ============================================================================
-- AuraMentor Question Ingestion Pipeline (Phase 2B: Staging Database Schema)
-- File: supabase/migrations/20261119_question_ingestion_staging.sql
--
-- Architecture Specifications:
--   1. Single-Admin Operation: Initial release is strictly curated by administrator.
--      Administrative authority is enforced via public.profiles.role = 'ADMIN'.
--   2. Permanent PDF Retention: The original uploaded PDF is retained permanently
--      under ingestion/{batch_id}/source.pdf in Supabase Storage.
--   3. Storage Security & Diagram Availability:
--      Reuses existing private `question-media` bucket. Source PDFs and unpromoted
--      diagrams remain strictly ADMIN-ONLY. Students/teachers can only access diagram
--      signed URLs if actively linked to a question with status = 'PUBLISHED'.
--   4. Distributed Concurrency Fencing & Atomic Database Promotion:
--      - Distributed lease fencing via promotion_token (UUID) and promotion_generation (BIGINT).
--      - Atomic lease acquisition (acquire_promotion_lease) with 5-minute timeout.
--      - Atomic database-side promotion RPC (promote_staging_question_atomic):
--        Executes parent (questions) and child writes (question_options, question_answers,
--        question_media) inside a single PostgreSQL ACID transaction under an exclusive
--        row lock (FOR UPDATE).
--      - Rejects stale/zombie workers on token, generation, or lease expiry mismatch (<= v_now).
--      - Crash recovery probe checks public.questions.staging_id before inserting.
--      - Strictly separates promotion from publication: always creates or updates
--        production questions with status = 'DRAFT'. Promotion can NEVER publish or archive.
--      - Complete buildCorrectAnswerJson mapping for MCQ, TRUE_FALSE, FILL_BLANK, SUBJECTIVE.
--      - Preserves manual Question Composer and saveQuestionToDatabase completely untouched.
--   5. Service-Role / CLI Support: created_by allows NULL when auth.uid() is absent.
--   6. Candidate Uniqueness: Unique constraint on (batch_id, candidate_id).
--   7. Zero Parallel Production Schema: Production questions live strictly in
--      public.questions and child tables.
-- ============================================================================

BEGIN;

-- 1. Storage Bucket Registration & Configuration ------------------------------
-- Ensure existing private `question-media` bucket allows PDFs up to 50 MB
-- alongside standard mathematics diagram image formats (including image/gif).
-- Non-destructively preserves existing file size limits (preserving NULL as unlimited)
-- and non-destructively preserves allowed MIME types (preserving NULL as unrestricted).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'question-media',
  'question-media',
  false,
  52428800, -- 50 MB limit in bytes
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = CASE
    WHEN storage.buckets.file_size_limit IS NULL THEN NULL
    ELSE GREATEST(storage.buckets.file_size_limit, 52428800)
  END,
  allowed_mime_types = CASE
    WHEN storage.buckets.allowed_mime_types IS NULL THEN NULL
    ELSE (
      SELECT array_agg(DISTINCT m)
      FROM unnest(array_cat(
        storage.buckets.allowed_mime_types,
        ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif', 'application/pdf']::text[]
      )) AS m
    )
  END;

-- 2. Ingestion Batches Table -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ingestion_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Permanent Source PDF Storage & Provenance
  pdf_storage_path text NOT NULL,          -- e.g. "ingestion/{batch_id}/source.pdf"
  pdf_filename text NOT NULL,              -- original file name, e.g. "cbse_class10_2026.pdf"
  pdf_file_hash text NOT NULL,              -- SHA-256 hash of PDF binary for document deduplication
  pdf_file_size_bytes bigint NOT NULL,     -- byte size of uploaded document
  pdf_mime_type text NOT NULL DEFAULT 'application/pdf',
  
  -- Extractor Configuration & Metrics
  extractor_backend text NOT NULL DEFAULT 'MacPDFKit2D',
  total_pages int NOT NULL DEFAULT 1,
  total_questions int NOT NULL DEFAULT 0,
  extraction_failures_count int NOT NULL DEFAULT 0,
  high_confidence_count int NOT NULL DEFAULT 0,
  promoted_count int NOT NULL DEFAULT 0,
  
  -- Batch Workflow Status
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'IN_REVIEW', 'APPROVED', 'COMPLETED', 'ARCHIVED')),
  
  -- Document-level Diagnostics & Filtered Instructions
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  
  -- Ownership & Audit (Supports CLI/Service-Role where auth.uid() is NULL)
  created_by uuid NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
  organization_id uuid NULL,               -- Future multi-tenant anchor
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for ingestion_batches
CREATE INDEX IF NOT EXISTS idx_ingestion_batches_status ON public.ingestion_batches(status);
CREATE INDEX IF NOT EXISTS idx_ingestion_batches_created_by ON public.ingestion_batches(created_by);
CREATE INDEX IF NOT EXISTS idx_ingestion_batches_pdf_hash ON public.ingestion_batches(pdf_file_hash);

-- 3. Staging Questions Table -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staging_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.ingestion_batches(id) ON DELETE CASCADE,
  
  -- Candidate Extraction Identifiers
  candidate_id text NOT NULL,              -- e.g. "cand-p1-q5"
  source_page_number int NOT NULL DEFAULT 1,
  detected_question_label text NOT NULL,   -- e.g. "5.", "Q. 1", "Case Study 1"
  question_heading text NULL,              -- e.g. "Assertion - Reason", "100 Metres Race"
  section text NULL,                       -- e.g. "SECTION A", "SECTION B"
  
  -- Extracted Content & Classification
  inferred_type text NOT NULL DEFAULT 'SUBJECTIVE'
    CHECK (inferred_type IN ('MCQ', 'TRUE_FALSE', 'FILL_BLANK', 'SUBJECTIVE', 'CASE_BASED')),
  candidate_question_text text NOT NULL,
  content_hash text NOT NULL,              -- SHA-256 of normalized text for candidate deduplication
  
  -- Structured Extracted Components (JSONB)
  detected_options jsonb NOT NULL DEFAULT '[]'::jsonb,   -- Array of { "key": "A", "text": "...", "is_correct": bool }
  detected_subparts jsonb NOT NULL DEFAULT '[]'::jsonb,  -- Array of { "label": "(i)", "text": "..." }
  detected_answer text NULL,
  detected_solution text NULL,
  detected_diagrams jsonb NOT NULL DEFAULT '[]'::jsonb,  -- Array of DiagramRecord objects
  
  -- Diagnostics, Flags & Confidence Scoring
  original_extracted_text text NOT NULL,
  extraction_warnings text[] NOT NULL DEFAULT '{}',
  has_extraction_failures boolean NOT NULL DEFAULT false,
  extraction_confidence numeric(3, 2) NOT NULL DEFAULT 1.00,
  
  -- Curriculum Curation & Target Parameters
  target_chapter_id uuid NULL REFERENCES public.chapters(id) ON DELETE SET NULL,
  target_topic_id uuid NULL REFERENCES public.topics(id) ON DELETE SET NULL,
  target_difficulty text NOT NULL DEFAULT 'MEDIUM'
    CHECK (target_difficulty IN ('EASY', 'MEDIUM', 'HARD')),
  target_marks numeric(4, 1) NOT NULL DEFAULT 1.0,
  target_negative_marks numeric(4, 1) NOT NULL DEFAULT 0.0,
  
  -- Curation & Publishing Workflow
  review_status text NOT NULL DEFAULT 'PENDING'
    CHECK (review_status IN ('PENDING', 'IN_REVIEW', 'ACCEPTED', 'EDITED', 'REJECTED', 'PROMOTING', 'PROMOTED')),
  review_notes text NULL,
  promoted_question_id uuid NULL REFERENCES public.questions(id) ON DELETE SET NULL,
  
  -- Distributed Lease Fencing & Concurrency Protection
  promotion_token uuid NULL,               -- Unique token assigned per active lease acquisition
  promotion_generation bigint NOT NULL DEFAULT 0, -- Monotonically incrementing fence counter
  promotion_started_at timestamptz NULL,   -- Timestamp when active lease was granted
  promotion_expires_at timestamptz NULL,   -- Timestamp when lease expires (5-minute lease)
  
  reviewed_by uuid NULL REFERENCES auth.users(id),
  reviewed_at timestamptz NULL,
  
  -- Ownership & Audit (Supports CLI/Service-Role where auth.uid() is NULL)
  created_by uuid NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Constraint: Candidate IDs are strictly unique within a batch
  CONSTRAINT uq_staging_questions_batch_candidate UNIQUE (batch_id, candidate_id)
);

-- Constraint: A promoted production question can belong to at most one staging question
CREATE UNIQUE INDEX IF NOT EXISTS idx_staging_questions_promoted_question_id
  ON public.staging_questions(promoted_question_id)
  WHERE promoted_question_id IS NOT NULL;

-- Indexes for staging_questions
CREATE INDEX IF NOT EXISTS idx_staging_questions_batch_id ON public.staging_questions(batch_id);
CREATE INDEX IF NOT EXISTS idx_staging_questions_review_status ON public.staging_questions(review_status);
CREATE INDEX IF NOT EXISTS idx_staging_questions_lease ON public.staging_questions(review_status, promotion_expires_at);
CREATE INDEX IF NOT EXISTS idx_staging_questions_content_hash ON public.staging_questions(content_hash);
CREATE INDEX IF NOT EXISTS idx_staging_questions_chapter_topic ON public.staging_questions(target_chapter_id, target_topic_id);

-- 4. Production Question Idempotency & Origin Tracking ------------------------
-- Minimal non-breaking addition to public.questions:
-- Allows PostgreSQL engine to strictly enforce that one staging question produces
-- at most one production question, and enables 100% reliable crash recovery.
-- Existing manual questions have staging_id = NULL and are completely unaffected.
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS staging_id uuid NULL
  CONSTRAINT fk_questions_staging_id REFERENCES public.staging_questions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_staging_id
  ON public.questions(staging_id)
  WHERE staging_id IS NOT NULL;

-- Supporting index on question_media(storage_path) for O(1) storage security checks
CREATE INDEX IF NOT EXISTS idx_question_media_storage_path ON public.question_media(storage_path);

-- 5. Helper Function: Check if an Ingestion Diagram Belongs to a PUBLISHED Question
-- Used by Storage RLS to strictly prevent students from probing unpromoted or draft diagrams.
-- Operates on the existing production column public.question_media.storage_path.
CREATE OR REPLACE FUNCTION public.is_ingestion_diagram_published(p_object_name text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.question_media qm
    JOIN public.questions q ON q.id = qm.question_id
    WHERE q.status = 'PUBLISHED'
      AND (
        qm.storage_path = p_object_name
        OR qm.storage_path = ('storage://question-media/' || p_object_name)
        OR qm.storage_path = ('question-media/' || p_object_name)
        OR p_object_name = ('storage://question-media/' || qm.storage_path)
        OR p_object_name = ('question-media/' || qm.storage_path)
      )
  );
$$;

-- 6. Atomic Lease Acquisition Function ----------------------------------------
-- Atomically generates a new UUID token, increments promotion_generation,
-- grants a lease under an exclusive row lock (FOR UPDATE), and blocks
-- concurrent workers from acquiring the same active lease.
-- Evaluates clock_timestamp() strictly AFTER obtaining the row lock.
CREATE OR REPLACE FUNCTION public.acquire_promotion_lease(
  p_staging_id uuid,
  p_lease_duration_seconds int DEFAULT 300
)
RETURNS TABLE (
  acquired boolean,
  promotion_token uuid,
  promotion_generation bigint,
  promotion_expires_at timestamptz,
  message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staging record;
  v_new_token uuid;
  v_new_generation bigint;
  v_new_expires_at timestamptz;
  v_now timestamptz;
BEGIN
  -- 1. Security Check: Trusted service_role OR authenticated admin required
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     OR auth.role() = 'service_role' THEN
    NULL;
  ELSIF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'
  ) THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'UNAUTHORIZED: Administrator or service-role privileges required.';
  END IF;

  -- 2. Validate lease duration parameter (10 seconds to 1 hour)
  IF p_lease_duration_seconds IS NULL OR p_lease_duration_seconds < 10 OR p_lease_duration_seconds > 3600 THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: p_lease_duration_seconds must be between 10 and 3600 seconds (got %)', p_lease_duration_seconds;
  END IF;

  -- 3. Lock Staging Row Exclusively (FOR UPDATE)
  SELECT * INTO v_staging
  FROM public.staging_questions
  WHERE id = p_staging_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, 0::bigint, NULL::timestamptz, 'Staging question not found'::text;
    RETURN;
  END IF;

  -- Evaluate current timestamp strictly AFTER obtaining the row lock
  v_now := clock_timestamp();

  -- 4. Idempotency Check: Already promoted
  IF v_staging.review_status = 'PROMOTED' THEN
    RETURN QUERY SELECT false, v_staging.promotion_token, v_staging.promotion_generation, v_staging.promotion_expires_at, 'Question is already promoted'::text;
    RETURN;
  END IF;

  -- 5. Review Status & Promotion Eligibility Check
  -- Only ACCEPTED or EDITED questions (or PROMOTING when recovering an expired lease) are eligible for promotion.
  IF v_staging.review_status = 'REJECTED' THEN
    RETURN QUERY SELECT false, NULL::uuid, 0::bigint, NULL::timestamptz, 'Cannot acquire promotion lease: staging question is REJECTED'::text;
    RETURN;
  ELSIF v_staging.review_status = 'PENDING' THEN
    RETURN QUERY SELECT false, NULL::uuid, 0::bigint, NULL::timestamptz, 'Cannot acquire promotion lease: staging question is PENDING review'::text;
    RETURN;
  ELSIF v_staging.review_status = 'IN_REVIEW' THEN
    RETURN QUERY SELECT false, NULL::uuid, 0::bigint, NULL::timestamptz, 'Cannot acquire promotion lease: staging question is currently IN_REVIEW'::text;
    RETURN;
  ELSIF v_staging.review_status NOT IN ('ACCEPTED', 'EDITED', 'PROMOTING') THEN
    RETURN QUERY SELECT false, NULL::uuid, 0::bigint, NULL::timestamptz, ('Cannot acquire promotion lease: unsupported review_status ' || v_staging.review_status)::text;
    RETURN;
  END IF;

  -- 6. Active Lease Check: Prevent concurrent workers from acquiring active lease
  IF v_staging.review_status = 'PROMOTING'
     AND v_staging.promotion_expires_at IS NOT NULL
     AND v_staging.promotion_expires_at > v_now THEN
    RETURN QUERY SELECT false, v_staging.promotion_token, v_staging.promotion_generation, v_staging.promotion_expires_at, 'Active lease held by another worker'::text;
    RETURN;
  END IF;

  -- 6. Acquire new lease or take over expired lease with fresh token & incremented generation
  v_new_token := gen_random_uuid();
  v_new_generation := COALESCE(v_staging.promotion_generation, 0) + 1;
  v_new_expires_at := v_now + (p_lease_duration_seconds || ' seconds')::interval;

  UPDATE public.staging_questions
  SET review_status = 'PROMOTING',
      promotion_token = v_new_token,
      promotion_generation = v_new_generation,
      promotion_started_at = v_now,
      promotion_expires_at = v_new_expires_at,
      updated_at = v_now
  WHERE id = p_staging_id;

  RETURN QUERY SELECT true, v_new_token, v_new_generation, v_new_expires_at, 'Lease successfully acquired'::text;
END;
$$;

-- 7. Atomic PostgreSQL Promotion RPC ------------------------------------------
-- Executes parent and child writes (questions, question_options, question_answers,
-- question_media, staging_questions) inside a SINGLE atomic PostgreSQL transaction.
-- Fences out stale workers via p_promotion_token and p_promotion_generation validation
-- under an exclusive row lock (FOR UPDATE).
-- Evaluates clock_timestamp() strictly AFTER obtaining the row lock.
-- Validates promotion_expires_at <= v_now for expired lease rejection.
-- Defaults question status to 'DRAFT' unless authorized override supplied.
-- Matches buildCorrectAnswerJson representation faithfully.
CREATE OR REPLACE FUNCTION public.promote_staging_question_atomic(
  p_staging_id uuid,
  p_promotion_token uuid,
  p_promotion_generation bigint,
  p_overrides jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_staging record;
  v_question_id uuid;
  v_chapter_id uuid;
  v_topic_id uuid;
  v_case_study_id uuid;
  v_difficulty text;
  v_marks numeric;
  v_negative_marks numeric;
  v_q_text text;
  v_q_type text;
  v_answer_type text;
  v_mcq_mode text;
  v_target_status text;
  v_code text;
  v_options jsonb;
  v_diagrams jsonb;
  v_opt jsonb;
  v_diag jsonb;
  v_idx int;
  v_diag_idx int;
  v_diag_storage_path text;
  v_opt_key text;
  v_ans_json jsonb;
  v_now timestamptz;
  v_correct_keys text[] := '{}';
  v_correct_texts text[] := '{}';
  v_accepted_answers text[] := '{}';
  v_model_answer text;
  v_single_val text;
  v_is_correct boolean;
BEGIN
  -- 1. Security Check: Trusted service_role OR authenticated admin required
  IF COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     OR auth.role() = 'service_role' THEN
    NULL;
  ELSIF auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'
  ) THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'UNAUTHORIZED: Administrator or service-role privileges required.';
  END IF;

  -- 2. Lock Staging Row Exclusively (FOR UPDATE)
  SELECT * INTO v_staging
  FROM public.staging_questions
  WHERE id = p_staging_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: Staging question % does not exist.', p_staging_id;
  END IF;

  -- Evaluate current timestamp strictly AFTER obtaining the row lock
  v_now := clock_timestamp();

  -- 3. Idempotency Check: Already promoted returns existing question immediately
  IF v_staging.review_status = 'PROMOTED' AND v_staging.promoted_question_id IS NOT NULL THEN
    RETURN v_staging.promoted_question_id;
  END IF;

  -- 4. Independent Promotion Eligibility Verification
  -- Questions in PENDING, IN_REVIEW, or REJECTED state cannot be promoted under any circumstance.
  IF v_staging.review_status = 'REJECTED' THEN
    RAISE EXCEPTION 'ELIGIBILITY_ERROR: Staging question % has status REJECTED and cannot be promoted.', p_staging_id;
  ELSIF v_staging.review_status IN ('PENDING', 'IN_REVIEW') THEN
    RAISE EXCEPTION 'ELIGIBILITY_ERROR: Staging question % is in status % and is not curated for promotion (must be ACCEPTED or EDITED).',
      p_staging_id, v_staging.review_status;
  ELSIF v_staging.review_status != 'PROMOTING' THEN
    RAISE EXCEPTION 'INVALID_STATE: Staging question % is in status %, expected PROMOTING. Must acquire lease first.',
      p_staging_id, v_staging.review_status;
  END IF;

  -- 5. Fencing Validation: Validate token, generation, and lease expiry

  IF p_promotion_token IS NULL OR v_staging.promotion_token IS DISTINCT FROM p_promotion_token THEN
    RAISE EXCEPTION 'STALE_TOKEN: Worker token % does not match active lease token %.',
      p_promotion_token, v_staging.promotion_token;
  END IF;

  IF p_promotion_generation IS NULL OR v_staging.promotion_generation IS DISTINCT FROM p_promotion_generation THEN
    RAISE EXCEPTION 'STALE_GENERATION: Worker generation % is superseded by generation %.',
      p_promotion_generation, v_staging.promotion_generation;
  END IF;

  -- Expiry validation: Must not be expired (promotion_expires_at <= v_now)
  IF v_staging.promotion_expires_at IS NULL OR v_staging.promotion_expires_at <= v_now THEN
    RAISE EXCEPTION 'LEASE_EXPIRED: Worker lease expired at %. Current time is %.',
      v_staging.promotion_expires_at, v_now;
  END IF;

  -- 6. Resolve Question Parameters (Overrides coalesce Staging fields)
  v_chapter_id := COALESCE((p_overrides->>'target_chapter_id')::uuid, v_staging.target_chapter_id);
  IF v_chapter_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Target chapter ID is required for promotion.';
  END IF;

  v_topic_id := COALESCE((p_overrides->>'target_topic_id')::uuid, v_staging.target_topic_id);
  v_case_study_id := COALESCE((p_overrides->>'case_study_id')::uuid, NULL);

  v_q_text := TRIM(COALESCE(p_overrides->>'candidate_question_text', v_staging.candidate_question_text));
  IF v_q_text = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Question text cannot be empty.';
  END IF;

  v_q_type := COALESCE(p_overrides->>'inferred_type', v_staging.inferred_type, 'SUBJECTIVE');
  IF v_q_type NOT IN ('MCQ', 'TRUE_FALSE', 'FILL_BLANK', 'SUBJECTIVE', 'CASE_BASED') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: Invalid question type %.', v_q_type;
  END IF;

  v_answer_type := COALESCE(p_overrides->>'answer_type', NULL);
  IF v_q_type IN ('SUBJECTIVE', 'CASE_BASED') THEN
    IF v_answer_type IS NOT NULL AND v_answer_type NOT IN ('VERY_SHORT', 'SHORT', 'LONG') THEN
      v_answer_type := 'SHORT';
    END IF;
  ELSE
    v_answer_type := NULL;
  END IF;

  v_mcq_mode := COALESCE(p_overrides->>'mcq_mode', 'SINGLE');
  IF v_mcq_mode NOT IN ('SINGLE', 'MULTIPLE') THEN
    v_mcq_mode := 'SINGLE';
  END IF;

  v_difficulty := COALESCE(p_overrides->>'target_difficulty', v_staging.target_difficulty, 'MEDIUM');
  IF v_difficulty NOT IN ('EASY', 'MEDIUM', 'HARD') THEN
    v_difficulty := 'MEDIUM';
  END IF;

  v_marks := COALESCE((p_overrides->>'target_marks')::numeric, v_staging.target_marks, 1.0);
  v_negative_marks := COALESCE((p_overrides->>'target_negative_marks')::numeric, v_staging.target_negative_marks, 0.0);
  
  -- Strict Separation of Promotion from Publication:
  -- The promotion RPC MUST always create or update the production question with status = 'DRAFT'.
  -- Publishing and archiving are strictly prohibited through promotion and must occur through
  -- the existing authorized question-management workflow as a separate administrative action.
  IF p_overrides->>'status' IS NOT NULL AND p_overrides->>'status' != 'DRAFT' THEN
    RAISE EXCEPTION 'INVALID_ARGUMENT: Promotion RPC creates questions exclusively in DRAFT status. Cannot set status to % during promotion.', p_overrides->>'status';
  END IF;
  v_target_status := 'DRAFT';

  v_options := COALESCE(p_overrides->'detected_options', v_staging.detected_options, '[]'::jsonb);
  v_diagrams := COALESCE(p_overrides->'detected_diagrams', v_staging.detected_diagrams, '[]'::jsonb);

  -- 7. Crash Recovery Probe: Check if production question already exists for this staging_id
  SELECT id INTO v_question_id
  FROM public.questions
  WHERE staging_id = p_staging_id;

  -- Generate or resolve question code
  v_code := COALESCE(
    p_overrides->>'question_code',
    'Q-ING-' || UPPER(SUBSTRING(REPLACE(p_staging_id::text, '-', '') FROM 1 FOR 8))
  );

  -- 8. Atomic Insert or Update public.questions
  IF v_question_id IS NULL THEN
    INSERT INTO public.questions (
      question_code,
      chapter_id,
      topic_id,
      case_study_id,
      question_text,
      question_type,
      answer_type,
      difficulty,
      marks,
      negative_marks,
      status,
      staging_id
    )
    VALUES (
      v_code,
      v_chapter_id,
      v_topic_id,
      v_case_study_id,
      v_q_text,
      v_q_type,
      v_answer_type,
      v_difficulty,
      v_marks,
      v_negative_marks,
      v_target_status,
      p_staging_id
    )
    RETURNING id INTO v_question_id;
  ELSE
    UPDATE public.questions
    SET chapter_id = v_chapter_id,
        topic_id = v_topic_id,
        case_study_id = v_case_study_id,
        question_text = v_q_text,
        question_type = v_q_type,
        answer_type = v_answer_type,
        difficulty = v_difficulty,
        marks = v_marks,
        negative_marks = v_negative_marks,
        status = 'DRAFT',
        updated_at = v_now
    WHERE id = v_question_id;
  END IF;

  -- 9. Atomic Synchronize question_options & Collect Option Correctness
  DELETE FROM public.question_options WHERE question_id = v_question_id;
  
  IF jsonb_array_length(v_options) > 0 THEN
    v_idx := 1;
    FOR v_opt IN SELECT * FROM jsonb_array_elements(v_options) LOOP
      v_opt_key := UPPER(TRIM(COALESCE(v_opt->>'key', CHR(64 + v_idx))));
      
      -- Option correctness resolution:
      -- 1. Explicit is_correct boolean on the option, OR
      -- 2. Explicit administrator override (p_overrides->>'correct_answer'), OR
      -- 3. Strict, unambiguous match against detected_answer (e.g. 'A', '(A)', 'Ans: A', 'Option A')
      -- If none of these match, v_is_correct remains FALSE. We do NOT guess or fabricate an answer.
      v_is_correct := false;

      IF (v_opt->>'is_correct')::boolean IS TRUE THEN
        v_is_correct := true;
      ELSIF p_overrides->>'correct_answer' IS NOT NULL THEN
        IF UPPER(TRIM(p_overrides->>'correct_answer')) = v_opt_key THEN
          v_is_correct := true;
        END IF;
      ELSIF v_staging.detected_answer IS NOT NULL AND TRIM(v_staging.detected_answer) != '' THEN
        -- Only resolve if detected_answer cleanly and unambiguously designates a single option key
        IF UPPER(TRIM(v_staging.detected_answer)) IN (v_opt_key, '(' || v_opt_key || ')', 'OPTION ' || v_opt_key, 'ANS: ' || v_opt_key, 'ANSWER: ' || v_opt_key)
           OR UPPER(TRIM(v_staging.detected_answer)) ~ ('^(ANS[:\s]*|ANSWER[:\s]*|OPTION[:\s]*)?\(?' || v_opt_key || '\)?[\.\s]*$') THEN
          v_is_correct := true;
        END IF;
      END IF;

      IF v_is_correct THEN
        v_correct_keys := array_append(v_correct_keys, v_opt_key);
        v_correct_texts := array_append(v_correct_texts, TRIM(COALESCE(v_opt->>'text', '')));
      END IF;

      -- Insert into question_options (only for MCQ and CASE_BASED with options)
      IF v_q_type IN ('MCQ', 'CASE_BASED') THEN
        INSERT INTO public.question_options (
          question_id,
          option_label,
          option_text,
          display_order
        )
        VALUES (
          v_question_id,
          v_opt_key,
          COALESCE(v_opt->>'text', ''),
          v_idx
        );
      END IF;

      v_idx := v_idx + 1;
    END LOOP;
  END IF;

  -- 10. Faithful Answer Representation (matching buildCorrectAnswerJson)
  v_model_answer := COALESCE(p_overrides->>'model_answer', v_staging.detected_solution, '');

  IF v_q_type = 'MCQ' THEN
    v_ans_json := jsonb_build_object(
      'type', 'MCQ',
      'selection_mode', v_mcq_mode,
      'correct_option_keys', COALESCE(to_jsonb(v_correct_keys), '[]'::jsonb),
      'correct_option_texts', COALESCE(to_jsonb(v_correct_texts), '[]'::jsonb),
      'value', CASE 
        WHEN v_mcq_mode = 'SINGLE' THEN (
          CASE WHEN COALESCE(array_length(v_correct_keys, 1), 0) > 0 THEN to_jsonb(v_correct_keys[1]) ELSE 'null'::jsonb END
        )
        ELSE COALESCE(to_jsonb(v_correct_keys), '[]'::jsonb)
      END
    );
  ELSIF v_q_type = 'TRUE_FALSE' THEN
    v_single_val := UPPER(TRIM(COALESCE(
      p_overrides->>'correct_true_false',
      p_overrides->>'correct_answer',
      v_staging.detected_answer,
      ''
    )));
    IF v_single_val IN ('TRUE', 'FALSE') THEN
      v_ans_json := jsonb_build_object(
        'type', 'TRUE_FALSE',
        'value', v_single_val,
        'correct_option_keys', jsonb_build_array(v_single_val)
      );
    ELSE
      -- Missing or unverified answer: preserve unknown state without fabricating TRUE or FALSE
      v_ans_json := jsonb_build_object(
        'type', 'TRUE_FALSE',
        'value', 'null'::jsonb,
        'correct_option_keys', '[]'::jsonb
      );
    END IF;
  ELSIF v_q_type = 'FILL_BLANK' THEN
    v_single_val := TRIM(COALESCE(
      p_overrides->>'correct_fill_blank',
      p_overrides->>'correct_answer',
      v_staging.detected_answer,
      ''
    ));
    SELECT ARRAY(
      SELECT TRIM(elem)
      FROM unnest(string_to_array(v_single_val, '|')) AS elem
      WHERE TRIM(elem) != ''
    ) INTO v_accepted_answers;
    v_ans_json := jsonb_build_object(
      'type', 'FILL_BLANK',
      'value', v_single_val,
      'accepted_answers', to_jsonb(v_accepted_answers)
    );
  ELSE
    -- SUBJECTIVE & CASE_BASED
    v_single_val := TRIM(COALESCE(
      p_overrides->>'correct_subjective_summary',
      p_overrides->>'model_answer',
      v_staging.detected_solution,
      v_staging.detected_answer,
      ''
    ));
    v_ans_json := jsonb_build_object(
      'type', v_q_type,
      'answer_type', v_answer_type,
      'value', v_single_val
    );
    IF array_length(v_correct_keys, 1) > 0 THEN
      v_ans_json := v_ans_json || jsonb_build_object(
        'selection_mode', v_mcq_mode,
        'correct_option_keys', to_jsonb(v_correct_keys),
        'correct_option_texts', to_jsonb(v_correct_texts)
      );
    END IF;
  END IF;

  -- 11. Synchronize question_answers
  -- Verified schema constraint: public.question_answers has an explicit UNIQUE (question_id) constraint.
  INSERT INTO public.question_answers (
    question_id,
    correct_answer,
    model_answer,
    solution_steps,
    marking_scheme
  )
  VALUES (
    v_question_id,
    v_ans_json,
    v_model_answer,
    COALESCE(p_overrides->'step_by_step_solution', p_overrides->'solution_steps', '[]'::jsonb),
    COALESCE(p_overrides->'marking_scheme', '[]'::jsonb)
  )
  ON CONFLICT (question_id) DO UPDATE SET
    correct_answer = EXCLUDED.correct_answer,
    model_answer = EXCLUDED.model_answer,
    solution_steps = EXCLUDED.solution_steps,
    marking_scheme = EXCLUDED.marking_scheme;

  -- 12. Atomic Synchronize question_media
  -- Conforms strictly to production schema: (question_id, storage_path, media_type, display_order)
  DELETE FROM public.question_media WHERE question_id = v_question_id;
  IF jsonb_array_length(v_diagrams) > 0 THEN
    v_diag_idx := 1;
    FOR v_diag IN SELECT * FROM jsonb_array_elements(v_diagrams) LOOP
      -- Resolve storage path relative to question-media bucket
      v_diag_storage_path := TRIM(COALESCE(
        v_diag->>'storage_path',
        REPLACE(REPLACE(v_diag->>'storage_url', 'storage://question-media/', ''), 'question-media/', ''),
        ''
      ));

      IF v_diag_storage_path != '' THEN
        INSERT INTO public.question_media (
          question_id,
          storage_path,
          media_type,
          display_order
        )
        VALUES (
          v_question_id,
          v_diag_storage_path,
          COALESCE(v_diag->>'media_type', 'IMAGE'),
          COALESCE((v_diag->>'display_order')::int, v_diag_idx)
        );
      END IF;

      v_diag_idx := v_diag_idx + 1;
    END LOOP;
  END IF;

  -- 13. Finalize Staging State
  UPDATE public.staging_questions
  SET review_status = 'PROMOTED',
      promoted_question_id = v_question_id,
      updated_at = v_now
  WHERE id = p_staging_id;

  RETURN v_question_id;
END;
$$;

-- 8. Row-Level Security (RLS) Policies ---------------------------------------
ALTER TABLE public.ingestion_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staging_questions ENABLE ROW LEVEL SECURITY;

-- Ingestion Batches: Restricted strictly to Administrator profiles
DROP POLICY IF EXISTS "Admins have full access to ingestion batches" ON public.ingestion_batches;
CREATE POLICY "Admins have full access to ingestion batches"
  ON public.ingestion_batches
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'ADMIN'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'ADMIN'
    )
  );

-- Staging Questions: Restricted strictly to Administrator profiles
DROP POLICY IF EXISTS "Admins have full access to staging questions" ON public.staging_questions;
CREATE POLICY "Admins have full access to staging questions"
  ON public.staging_questions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'ADMIN'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'ADMIN'
    )
  );

-- 9. Storage RLS Policies for `question-media` Bucket ------------------------
-- Policy A: Administrators have FULL access (SELECT, INSERT, UPDATE, DELETE)
-- across all objects in ingestion/ (PDFs and diagrams).
DROP POLICY IF EXISTS "Admins have full access to ingestion storage" ON storage.objects;
CREATE POLICY "Admins have full access to ingestion storage"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'question-media'
    AND COALESCE((storage.foldername(name))[1], '') = 'ingestion'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'ADMIN'
    )
  )
  WITH CHECK (
    bucket_id = 'question-media'
    AND COALESCE((storage.foldername(name))[1], '') = 'ingestion'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'ADMIN'
    )
  );

-- Policy B: Authenticated users (students & teachers) have SELECT access strictly
-- to diagrams (ingestion/{batch_id}/diagrams/*) THAT BELONG TO PUBLISHED QUESTIONS.
-- Unpromoted staging diagrams, draft questions, and source PDFs remain 100% BLOCKED.
DROP POLICY IF EXISTS "Authenticated users can read published ingestion diagrams" ON storage.objects;
CREATE POLICY "Authenticated users can read published ingestion diagrams"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'question-media'
    AND COALESCE((storage.foldername(name))[1], '') = 'ingestion'
    AND COALESCE((storage.foldername(name))[3], '') = 'diagrams'
    AND (
      -- Admins can read all diagrams
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.role = 'ADMIN'
      )
      OR
      -- Students/teachers can only read if associated question is PUBLISHED
      public.is_ingestion_diagram_published(name)
    )
  );

-- Policy C: Restrictive Security Guard for SELECT on `question-media/ingestion/`.
-- PostgreSQL evaluates multiple permissive policies with OR. If any broad permissive policy
-- exists on storage.objects affecting question-media (e.g. created via Supabase Dashboard),
-- this RESTRICTIVE policy acts as an inescapable filter (evaluated with AND):
-- 1. Buckets outside question-media (e.g. student-submissions) evaluate to TRUE (unaffected).
-- 2. Folders outside ingestion/ (e.g. statement/, solution/, attachment/) and root-level
--    objects (where foldername is NULL) evaluate to TRUE (unaffected).
-- 3. Inside ingestion/, source.pdf is strictly administrator-only.
-- 4. Inside ingestion/, diagrams can ONLY be read by administrators OR when linked to a PUBLISHED question.
-- 5. Trusted service-role operations pass through safely.
-- 6. Unauthenticated (anon) callers are completely blocked from ingestion/.
DROP POLICY IF EXISTS "Restrictive guard on question-media ingestion" ON storage.objects;
CREATE POLICY "Restrictive guard on question-media ingestion"
  ON storage.objects
  AS RESTRICTIVE
  FOR SELECT
  TO public
  USING (
    bucket_id != 'question-media'
    OR COALESCE((storage.foldername(name))[1], '') != 'ingestion'
    OR auth.role() = 'service_role'
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR (
      auth.role() = 'authenticated'
      AND (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE profiles.id = auth.uid() AND profiles.role = 'ADMIN'
        )
        OR (
          COALESCE((storage.foldername(name))[3], '') = 'diagrams'
          AND public.is_ingestion_diagram_published(name)
        )
      )
    )
  );

-- Policy D: Restrictive Security Guard for INSERT on `question-media/ingestion/`.
-- Restricts upload/creation of objects under ingestion/ strictly to authenticated ADMINs
-- or trusted service-role callers. Even if a broad permissive insert policy exists on
-- storage.objects, non-admin users (students, teachers, anon) are strictly blocked.
-- Objects outside ingestion/ (including root-level files) are NULL-safely preserved.
DROP POLICY IF EXISTS "Restrictive guard on question-media ingestion insert" ON storage.objects;
CREATE POLICY "Restrictive guard on question-media ingestion insert"
  ON storage.objects
  AS RESTRICTIVE
  FOR INSERT
  TO public
  WITH CHECK (
    bucket_id != 'question-media'
    OR COALESCE((storage.foldername(name))[1], '') != 'ingestion'
    OR auth.role() = 'service_role'
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR (
      auth.role() = 'authenticated'
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.role = 'ADMIN'
      )
    )
  );

-- Policy E: Restrictive Security Guard for UPDATE on `question-media/ingestion/`.
-- Restricts modification/overwriting of objects under ingestion/ strictly to authenticated ADMINs
-- or trusted service-role callers.
DROP POLICY IF EXISTS "Restrictive guard on question-media ingestion update" ON storage.objects;
CREATE POLICY "Restrictive guard on question-media ingestion update"
  ON storage.objects
  AS RESTRICTIVE
  FOR UPDATE
  TO public
  USING (
    bucket_id != 'question-media'
    OR COALESCE((storage.foldername(name))[1], '') != 'ingestion'
    OR auth.role() = 'service_role'
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR (
      auth.role() = 'authenticated'
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.role = 'ADMIN'
      )
    )
  )
  WITH CHECK (
    bucket_id != 'question-media'
    OR COALESCE((storage.foldername(name))[1], '') != 'ingestion'
    OR auth.role() = 'service_role'
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR (
      auth.role() = 'authenticated'
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.role = 'ADMIN'
      )
    )
  );

-- Policy F: Restrictive Security Guard for DELETE on `question-media/ingestion/`.
-- Restricts deletion of objects under ingestion/ strictly to authenticated ADMINs
-- or trusted service-role callers. Prevents accidental or unauthorized deletion of source PDFs and diagrams.
DROP POLICY IF EXISTS "Restrictive guard on question-media ingestion delete" ON storage.objects;
CREATE POLICY "Restrictive guard on question-media ingestion delete"
  ON storage.objects
  AS RESTRICTIVE
  FOR DELETE
  TO public
  USING (
    bucket_id != 'question-media'
    OR COALESCE((storage.foldername(name))[1], '') != 'ingestion'
    OR auth.role() = 'service_role'
    OR COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role'
    OR (
      auth.role() = 'authenticated'
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.role = 'ADMIN'
      )
    )
  );

-- 10. Table and Procedure Execution Grants ------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingestion_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staging_questions TO authenticated;
GRANT ALL ON public.ingestion_batches TO service_role;
GRANT ALL ON public.staging_questions TO service_role;

-- Revoke all execution permissions from PUBLIC and untrusted anon callers
REVOKE ALL ON FUNCTION public.acquire_promotion_lease(uuid, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.promote_staging_question_atomic(uuid, uuid, bigint, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_ingestion_diagram_published(text) FROM PUBLIC, anon;

-- Grant execution strictly to authenticated and service_role
GRANT EXECUTE ON FUNCTION public.acquire_promotion_lease(uuid, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.promote_staging_question_atomic(uuid, uuid, bigint, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_ingestion_diagram_published(text) TO authenticated, service_role;

COMMIT;

-- ============================================================================
-- VERIFIED ROLLBACK SCRIPT (Execute only if rolling back this migration):
--
-- BEGIN;
-- DROP POLICY IF EXISTS "Restrictive guard on question-media ingestion delete" ON storage.objects;
-- DROP POLICY IF EXISTS "Restrictive guard on question-media ingestion update" ON storage.objects;
-- DROP POLICY IF EXISTS "Restrictive guard on question-media ingestion insert" ON storage.objects;
-- DROP POLICY IF EXISTS "Restrictive guard on question-media ingestion" ON storage.objects;
-- DROP POLICY IF EXISTS "Authenticated users can read published ingestion diagrams" ON storage.objects;
-- DROP POLICY IF EXISTS "Admins have full access to ingestion storage" ON storage.objects;
--
-- -- Non-destructively restore original question-media bucket settings (10 MB limit, unrestricted MIME types)
-- UPDATE storage.buckets
-- SET file_size_limit = 10485760,
--     allowed_mime_types = NULL
-- WHERE id = 'question-media';
--
-- DROP FUNCTION IF EXISTS public.promote_staging_question_atomic(uuid, uuid, bigint, jsonb);
-- DROP FUNCTION IF EXISTS public.acquire_promotion_lease(uuid, int);
-- DROP FUNCTION IF EXISTS public.is_ingestion_diagram_published(text);
-- DROP INDEX IF EXISTS public.idx_question_media_storage_path;
-- DROP POLICY IF EXISTS "Admins have full access to staging questions" ON public.staging_questions;
-- DROP POLICY IF EXISTS "Admins have full access to ingestion batches" ON public.ingestion_batches;
-- DROP TABLE IF EXISTS public.staging_questions CASCADE;
-- DROP TABLE IF EXISTS public.ingestion_batches CASCADE;
-- DROP INDEX IF EXISTS public.idx_questions_staging_id;
-- ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS fk_questions_staging_id;
-- ALTER TABLE public.questions DROP COLUMN IF EXISTS staging_id;
-- COMMIT;
-- ============================================================================
