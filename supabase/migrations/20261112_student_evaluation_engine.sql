-- ============================================================================
-- MathPractice: Server-Side Student Answer Persistence & Secure Evaluation Engine
-- Migration: 20261112_student_evaluation_engine.sql
-- Idempotent, Non-destructive, Strict Security, Practice-Mode Only.
--
-- Target question: Q-CH01-U4Z3425 (UUID 76b9e223-c476-4675-9253-8f8fb42d0b67)
--
-- Confirmed Existing Tables (reused without modification):
--   - public.student_attempts (id, student_id, question_id, attempt_number, status, started_at, submitted_at)
--   - public.student_submissions (id, attempt_id, typed_answer, submission_status, submitted_at, created_at)
--   - public.submission_images (id, submission_id, storage_path, page_number, uploaded_at)
--   - public.evaluations (id, submission_id, evaluation_status, ai_suggested_marks, final_marks, ai_feedback, teacher_feedback, stepwise_feedback, evaluated_by, evaluated_at, created_at, updated_at)
--   - public.question_options (id, question_id, option_label, option_text, display_order)
--   - public.question_answers (question_id, correct_answer, model_answer, solution_steps, marking_scheme)
--   - public.questions (id, question_code, question_type, marks, negative_marks, status)
-- ============================================================================

-- 1. Index Safety: Check for duplicate submission_id in public.evaluations -----
DO $$
DECLARE
  v_duplicate_count int;
BEGIN
  SELECT COUNT(*) INTO v_duplicate_count
  FROM (
    SELECT submission_id
    FROM public.evaluations
    WHERE submission_id IS NOT NULL
    GROUP BY submission_id
    HAVING COUNT(*) > 1
  ) dups;

  IF v_duplicate_count > 0 THEN
    RAISE EXCEPTION 'MIGRATION HALTED: Found % submission_id value(s) with duplicate records in public.evaluations. Cannot safely create unique index evaluations_submission_id_key without data loss. To inspect duplicates, execute: SELECT submission_id, COUNT(*) FROM public.evaluations WHERE submission_id IS NOT NULL GROUP BY submission_id HAVING COUNT(*) > 1; Resolve the duplicates manually and re-run.', v_duplicate_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'evaluations'
      AND indexname = 'evaluations_submission_id_key'
  ) THEN
    CREATE UNIQUE INDEX evaluations_submission_id_key
      ON public.evaluations (submission_id);
  END IF;
END $$;

-- 2. Audit & Cleanup Legacy RPC Overloads (Dependency-Safe, No CASCADE) -------
DO $$
DECLARE
  r RECORD;
  v_dep_count int;
  v_sql text;
  v_is_intended boolean;
BEGIN
  FOR r IN
    SELECT
      p.oid,
      n.nspname AS schema_name,
      p.proname AS func_name,
      COALESCE(
        (
          SELECT string_agg(pg_catalog.format_type(t.oid, NULL), ', ' ORDER BY t.ord)
          FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS t(oid, ord)
        ),
        ''
      ) AS arg_types,
      pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args,
      pg_catalog.format_type(p.prorettype, NULL) AS return_type,
      p.proretset AS returns_set,
      p.proargnames AS arg_names,
      p.proargmodes::text[] AS arg_modes,
      COALESCE(
        (
          SELECT string_agg(pg_catalog.format_type(t.oid, NULL), ', ' ORDER BY t.ord)
          FROM unnest(p.proallargtypes) WITH ORDINALITY AS t(oid, ord)
        ),
        ''
      ) AS all_arg_types
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'submit_student_answer',
        'get_student_result',
        'get_student_results',
        'student_question_options'
      )
  LOOP
    -- Identify whether this function matches one of the four intended signatures
    -- using normalized input argument type lists (immune to parameter names):
    v_is_intended := (
      (r.func_name = 'submit_student_answer' AND r.arg_types = 'text, text, text[]') OR
      (r.func_name = 'get_student_result' AND r.arg_types = 'text, integer') OR
      (r.func_name = 'get_student_results' AND r.arg_types = 'text[]') OR
      (r.func_name = 'student_question_options' AND r.arg_types = 'uuid[]')
    );

    IF v_is_intended THEN
      -- 1. Check scalar functions for unexpected OUT/INOUT modes or return types
      IF r.func_name IN ('submit_student_answer', 'get_student_result', 'get_student_results') THEN
        IF r.return_type <> 'jsonb' OR r.returns_set IS TRUE THEN
          RAISE EXCEPTION 'MIGRATION HALTED: Existing function public.%(%) has incompatible return type "%" (expected scalar "jsonb"). Incompatible return types cannot be replaced in-place. Dependent objects or callers may require manual resolution before migration. Do not use CASCADE.', r.func_name, r.arg_types, r.return_type;
        END IF;

        IF r.arg_modes IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(r.arg_modes) m WHERE m <> 'i') THEN
          RAISE EXCEPTION 'MIGRATION HALTED: Existing function public.%(%) has unexpected non-IN parameter modes: %. Cannot replace in-place. Resolve manually.', r.func_name, r.arg_types, r.arg_modes;
        END IF;

        -- Verify input parameter names match to prevent PostgreSQL CREATE OR REPLACE FUNCTION failure
        IF r.func_name = 'submit_student_answer' AND r.arg_names IS NOT NULL AND r.arg_names <> ARRAY['p_question_id', 'p_typed_answer', 'p_image_paths'] THEN
          RAISE EXCEPTION 'MIGRATION HALTED: Existing function public.submit_student_answer(text, text, text[]) has incompatible input parameter names: % (expected "p_question_id, p_typed_answer, p_image_paths"). PostgreSQL does not allow changing parameter names with CREATE OR REPLACE FUNCTION. Resolve manually without CASCADE.', r.arg_names;
        ELSIF r.func_name = 'get_student_result' AND r.arg_names IS NOT NULL AND r.arg_names <> ARRAY['p_question_id', 'p_attempt_number'] THEN
          RAISE EXCEPTION 'MIGRATION HALTED: Existing function public.get_student_result(text, integer) has incompatible input parameter names: % (expected "p_question_id, p_attempt_number"). PostgreSQL does not allow changing parameter names with CREATE OR REPLACE FUNCTION. Resolve manually without CASCADE.', r.arg_names;
        ELSIF r.func_name = 'get_student_results' AND r.arg_names IS NOT NULL AND r.arg_names <> ARRAY['p_question_ids'] THEN
          RAISE EXCEPTION 'MIGRATION HALTED: Existing function public.get_student_results(text[]) has incompatible input parameter names: % (expected "p_question_ids"). PostgreSQL does not allow changing parameter names with CREATE OR REPLACE FUNCTION. Resolve manually without CASCADE.', r.arg_names;
        END IF;

      -- 2. Check table function student_question_options for exact OUT/TABLE compatibility
      ELSIF r.func_name = 'student_question_options' THEN
        IF r.return_type <> 'record' OR r.returns_set IS NOT TRUE THEN
          RAISE EXCEPTION 'MIGRATION HALTED: Existing function public.student_question_options(uuid[]) has incompatible return type "%" (expected SETOF record / TABLE). Incompatible return types cannot be replaced in-place. Do not use CASCADE.', r.return_type;
        END IF;

        -- Verify TABLE column modes: 1 IN argument, 5 TABLE columns
        IF r.arg_modes IS NOT NULL AND r.arg_modes <> ARRAY['i', 't', 't', 't', 't', 't'] THEN
          RAISE EXCEPTION 'MIGRATION HALTED: Existing function public.student_question_options(uuid[]) has incompatible parameter modes: % (expected i, t, t, t, t, t). Cannot change TABLE return structure with CREATE OR REPLACE FUNCTION.', r.arg_modes;
        END IF;

        -- Verify TABLE column names and order
        IF r.arg_names IS NOT NULL AND r.arg_names <> ARRAY['p_question_ids', 'id', 'question_id', 'option_label', 'option_text', 'display_order'] THEN
          RAISE EXCEPTION 'MIGRATION HALTED: Existing function public.student_question_options(uuid[]) has incompatible TABLE column names or order: % (expected p_question_ids, id, question_id, option_label, option_text, display_order). Cannot change TABLE column names with CREATE OR REPLACE FUNCTION.', r.arg_names;
        END IF;

        -- Verify TABLE column types: uuid[], uuid, uuid, text, text, integer
        IF r.all_arg_types <> '' AND r.all_arg_types <> 'uuid[], uuid, uuid, text, text, integer' THEN
          RAISE EXCEPTION 'MIGRATION HALTED: Existing function public.student_question_options(uuid[]) has incompatible TABLE column types: % (expected "uuid[], uuid, uuid, text, text, integer"). Cannot change TABLE column types with CREATE OR REPLACE FUNCTION.', r.all_arg_types;
        END IF;
      END IF;

      -- Function matches an intended signature and has fully compatible signature and return structure:
      -- DO NOT DROP. It will be safely updated in-place via CREATE OR REPLACE FUNCTION.
      RAISE NOTICE 'Retaining intended function signature: public.%(%) [returns %]', r.func_name, r.arg_types, r.return_type;

    ELSE
      -- Obsolete overload: inspect pg_depend for dependent database objects
      SELECT COUNT(*)::int INTO v_dep_count
      FROM pg_catalog.pg_depend d
      WHERE d.refclassid = 'pg_catalog.pg_proc'::regclass
        AND d.refobjid = r.oid
        AND d.deptype NOT IN ('i', 'p');

      IF v_dep_count > 0 THEN
        RAISE EXCEPTION 'MIGRATION HALTED: Obsolete function public.%(%) cannot be safely dropped because % dependent database object(s) exist in pg_depend. Dependent objects prevent a safe change without CASCADE. Inspect pg_depend before dropping.', r.func_name, r.identity_args, v_dep_count;
      END IF;

      v_sql := 'REVOKE ALL ON FUNCTION public.' || quote_ident(r.func_name) || '(' || r.identity_args || ') FROM public, anon, authenticated;';
      EXECUTE v_sql;

      -- Drop without CASCADE
      v_sql := 'DROP FUNCTION public.' || quote_ident(r.func_name) || '(' || r.identity_args || ');';
      EXECUTE v_sql;

      RAISE NOTICE 'Cleaned up obsolete overload: public.%(%)', r.func_name, r.identity_args;
    END IF;
  END LOOP;
END $$;

-- 3. Answer Normalisation Helper Functions -----------------------------------
CREATE OR REPLACE FUNCTION public.mp_try_numeric(t text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
BEGIN
  IF t ~ '^-?[0-9]+(\.[0-9]+)?$' THEN
    RETURN t::numeric;
  ELSIF t ~ '^-?[0-9]+/[0-9]+$' THEN
    IF split_part(t, '/', 2)::numeric = 0 THEN
      RETURN NULL;
    END IF;
    RETURN split_part(t, '/', 1)::numeric / split_part(t, '/', 2)::numeric;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.mp_norm_answer(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT regexp_replace(
    lower(
      replace(
        replace(COALESCE(t, ''), '−', '-'),
        '×', '*'
      )
    ),
    '[\s$\\{}]', '', 'g'
  );
$$;

CREATE OR REPLACE FUNCTION public.mp_answers_equal(a text, b text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  na text := public.mp_norm_answer(a);
  nb text := public.mp_norm_answer(b);
  xa numeric;
  xb numeric;
BEGIN
  IF na = '' OR nb = '' THEN
    RETURN FALSE;
  END IF;
  IF na = nb THEN
    RETURN TRUE;
  END IF;
  xa := public.mp_try_numeric(na);
  xb := public.mp_try_numeric(nb);
  RETURN xa IS NOT NULL AND xb IS NOT NULL AND xa = xb;
END $$;

-- 4. Student-Safe Options Function (No answer key disclosure) ----------------
CREATE OR REPLACE FUNCTION public.student_question_options(p_question_ids uuid[])
RETURNS TABLE (
  id uuid,
  question_id uuid,
  option_label text,
  option_text text,
  display_order int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    o.id,
    o.question_id,
    o.option_label,
    o.option_text,
    COALESCE(o.display_order, 0)::int
  FROM public.question_options o
  JOIN public.questions q ON q.id = o.question_id
  WHERE q.status = 'PUBLISHED'
    AND o.question_id = ANY (p_question_ids)
  ORDER BY COALESCE(o.display_order, 0), o.id;
$$;

-- 5. Secure Read Function for Student Results --------------------------------
-- Answers and explanations are revealed ONLY if the persisted submission
-- record independently confirms PRACTICE mode and evaluation_status = 'FINALIZED'.
-- Missing or unverified mode defaults to NULL and CANNOT reveal answer keys.
CREATE OR REPLACE FUNCTION public.get_student_result(
  p_question_id text,
  p_attempt_number int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_uid uuid;
  v_qid uuid;
  v_q record;
  v_attempt record;
  v_sub record;
  v_eval record;
  v_qa record;
  v_key jsonb;
  v_persisted_mode text := NULL;
  v_reveal boolean := FALSE;
  v_correct_ids text[] := '{}';
  v_correct_keys text[] := '{}';
  v_accepted_answers text[] := '{}';
  v_selected_id text := NULL;
  v_selected_label text := NULL;
  v_is_correct boolean := NULL;
  v_sub_payload jsonb;
  v_total_attempts int := 0;
BEGIN
  -- Strict authentication verification
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  BEGIN
    v_qid := p_question_id::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  SELECT id, question_type, marks, negative_marks, status
  INTO v_q
  FROM public.questions
  WHERE id = v_qid;

  IF v_q.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Count total attempts made by this student
  SELECT COUNT(*)::int
  INTO v_total_attempts
  FROM public.student_attempts
  WHERE student_id = v_uid AND question_id = v_qid;

  -- Select specific attempt if requested, otherwise fetch latest
  IF p_attempt_number IS NOT NULL THEN
    SELECT a.id, a.attempt_number, a.status AS attempt_status, a.submitted_at
    INTO v_attempt
    FROM public.student_attempts a
    WHERE a.student_id = v_uid
      AND a.question_id = v_qid
      AND a.attempt_number = p_attempt_number
    LIMIT 1;
  ELSE
    SELECT a.id, a.attempt_number, a.status AS attempt_status, a.submitted_at
    INTO v_attempt
    FROM public.student_attempts a
    WHERE a.student_id = v_uid
      AND a.question_id = v_qid
    ORDER BY a.attempt_number DESC, a.started_at DESC
    LIMIT 1;
  END IF;

  IF v_attempt.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Retrieve submission owned by this student attempt
  SELECT s.id, s.attempt_id, s.typed_answer, s.submission_status, s.submitted_at
  INTO v_sub
  FROM public.student_submissions s
  WHERE s.attempt_id = v_attempt.id
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF v_sub.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Retrieve evaluation for this submission
  SELECT e.id, e.submission_id, e.evaluation_status, e.final_marks, e.ai_feedback, e.stepwise_feedback
  INTO v_eval
  FROM public.evaluations e
  WHERE e.submission_id = v_sub.id;

  -- Parse typed_answer JSON safely
  BEGIN
    v_sub_payload := v_sub.typed_answer::jsonb;
    v_selected_id := COALESCE(v_sub_payload->>'selected_option_id', v_sub_payload->>'option_id');
  EXCEPTION WHEN OTHERS THEN
    v_sub_payload := NULL;
    IF v_sub.typed_answer ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_selected_id := v_sub.typed_answer;
    END IF;
  END;

  IF v_selected_id IS NOT NULL THEN
    SELECT option_label INTO v_selected_label
    FROM public.question_options
    WHERE question_id = v_qid AND id::text = v_selected_id;
  END IF;

  -- Read persisted submission mode strictly from server evaluation record.
  -- DO NOT default missing mode to PRACTICE. Default remains NULL.
  IF v_eval.stepwise_feedback IS NOT NULL AND (v_eval.stepwise_feedback ? 'submission_mode') THEN
    v_persisted_mode := UPPER(btrim(v_eval.stepwise_feedback->>'submission_mode'));
  END IF;

  -- Extract evaluated correctness
  IF v_eval.stepwise_feedback IS NOT NULL AND (v_eval.stepwise_feedback ? 'is_correct') THEN
    v_is_correct := (v_eval.stepwise_feedback->>'is_correct')::boolean;
  ELSIF v_eval.final_marks IS NOT NULL THEN
    v_is_correct := (v_eval.final_marks = COALESCE(v_q.marks, 1));
  END IF;

  -- REVEAL RULE:
  -- Answers are revealed ONLY when the server record independently confirms
  -- submission_mode = 'PRACTICE' AND evaluation_status = 'FINALIZED'.
  -- Missing mode, NULL, or any unverified status yields reveal = FALSE.
  v_reveal := (v_persisted_mode = 'PRACTICE') AND (v_eval.evaluation_status = 'FINALIZED');

  IF NOT v_reveal THEN
    RETURN jsonb_build_object(
      'submitted', TRUE,
      'attempt_id', v_attempt.id,
      'attempt_number', v_attempt.attempt_number,
      'total_attempts', v_total_attempts,
      'submission_id', v_sub.id,
      'submission_status', v_sub.submission_status,
      'evaluation_status', COALESCE(v_eval.evaluation_status, 'PENDING'),
      'is_correct', NULL,
      'final_marks', NULL,
      'marks_awarded', NULL,
      'max_marks', COALESCE(v_q.marks, 1),
      'selected_option_id', v_selected_id,
      'selected_option_label', v_selected_label,
      'typed_answer', v_sub.typed_answer,
      'mode', v_persisted_mode,
      'reveal', FALSE,
      'images', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'page_number', img.page_number,
            'storage_path', img.storage_path
          ) ORDER BY img.page_number
        ), '[]'::jsonb)
        FROM public.submission_images img
        WHERE img.submission_id = v_sub.id
      ),
      'feedback', COALESCE(v_eval.ai_feedback, 'Awaiting Teacher Evaluation')
    );
  END IF;

  -- Verified PRACTICE mode reveal: fetch answer key safely
  SELECT correct_answer, model_answer, solution_steps
  INTO v_qa
  FROM public.question_answers
  WHERE question_id = v_qid;

  v_key := v_qa.correct_answer;

  -- Safely parse answer-key JSON structures
  IF v_key IS NOT NULL AND jsonb_typeof(v_key) = 'object' THEN
    BEGIN
      -- Extract candidate MCQ option keys
      SELECT COALESCE(ARRAY_AGG(UPPER(k)), '{}')
      INTO v_correct_keys
      FROM (
        SELECT jsonb_array_elements_text(v_key->'correct_option_keys') AS k
        WHERE jsonb_typeof(v_key->'correct_option_keys') = 'array'
        UNION
        SELECT UPPER(btrim(v_key->>'value'))
        WHERE jsonb_typeof(v_key->'value') = 'string'
          AND COALESCE(v_key->>'value', '') <> ''
      ) u
      WHERE k IS NOT NULL AND btrim(k) <> '';

      SELECT COALESCE(ARRAY_AGG(o.id::text), '{}')
      INTO v_correct_ids
      FROM public.question_options o
      WHERE o.question_id = v_qid
        AND UPPER(btrim(o.option_label)) = ANY (v_correct_keys);
    EXCEPTION WHEN OTHERS THEN
      v_correct_keys := '{}';
      v_correct_ids := '{}';
    END;

    BEGIN
      -- Extract candidate FILL_BLANK accepted answers
      SELECT COALESCE(ARRAY_AGG(btrim(ans)), '{}')
      INTO v_accepted_answers
      FROM (
        SELECT jsonb_array_elements_text(v_key->'accepted_answers') AS ans
        WHERE jsonb_typeof(v_key->'accepted_answers') = 'array'
        UNION
        SELECT btrim(v_key->>'value')
        WHERE jsonb_typeof(v_key->'value') = 'string'
          AND COALESCE(v_key->>'value', '') <> ''
      ) u
      WHERE ans IS NOT NULL AND btrim(ans) <> '';
    EXCEPTION WHEN OTHERS THEN
      v_accepted_answers := '{}';
    END;
  END IF;

  RETURN jsonb_build_object(
    'submitted', TRUE,
    'attempt_id', v_attempt.id,
    'attempt_number', v_attempt.attempt_number,
    'total_attempts', v_total_attempts,
    'submission_id', v_sub.id,
    'submission_status', v_sub.submission_status,
    'evaluation_status', v_eval.evaluation_status,
    'is_correct', v_is_correct,
    'final_marks', v_eval.final_marks,
    'marks_awarded', v_eval.final_marks,
    'max_marks', COALESCE(v_q.marks, 1),
    'negative_marks', COALESCE(v_q.negative_marks, 0),
    'selected_option_id', v_selected_id,
    'selected_option_label', v_selected_label,
    'typed_answer', v_sub.typed_answer,
    'mode', v_persisted_mode,
    'reveal', TRUE,
    'images', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'page_number', img.page_number,
          'storage_path', img.storage_path
        ) ORDER BY img.page_number
      ), '[]'::jsonb)
      FROM public.submission_images img
      WHERE img.submission_id = v_sub.id
    ),
    'correct_option_ids', to_jsonb(v_correct_ids),
    'correct_keys', to_jsonb(v_correct_keys),
    'correct_option_label', CASE WHEN cardinality(v_correct_keys) > 0 THEN v_correct_keys[1] ELSE NULL END,
    'correct_answer_text', COALESCE(v_key->>'value', CASE WHEN cardinality(v_accepted_answers) > 0 THEN v_accepted_answers[1] ELSE NULL END),
    'accepted_answers', to_jsonb(v_accepted_answers),
    'model_answer', v_qa.model_answer,
    'solution_steps', v_qa.solution_steps,
    'feedback', COALESCE(
      v_eval.ai_feedback,
      CASE WHEN v_is_correct THEN 'Correct Answer' ELSE 'Incorrect Answer' END
    )
  );
END $$;

-- 6. Batch Get Student Results -----------------------------------------------
CREATE OR REPLACE FUNCTION public.get_student_results(
  p_question_ids text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_uid uuid;
  v_out jsonb := '{}'::jsonb;
  v_id text;
  v_res jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOREACH v_id IN ARRAY p_question_ids LOOP
    v_res := public.get_student_result(v_id);
    IF v_res IS NOT NULL THEN
      v_out := v_out || jsonb_build_object(v_id, v_res);
    END IF;
  END LOOP;

  RETURN v_out;
END $$;

-- 7. Submit and Evaluate Student Answer (Practice Mode Only) -----------------
CREATE OR REPLACE FUNCTION public.submit_student_answer(
  p_question_id text,
  p_typed_answer text,
  p_image_paths text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_uid uuid;
  v_qid uuid;
  v_q record;
  v_qa record;
  v_key jsonb;
  v_type text;
  v_max numeric;
  v_neg numeric;
  v_attempt_id uuid;
  v_sub_id uuid;
  v_attempt_num int := 1;
  v_auto boolean := FALSE;
  v_is_correct boolean := FALSE;
  v_awarded numeric := 0;
  v_selected_id text := NULL;
  v_typed_text text := NULL;
  v_selected_label text := NULL;
  v_correct_keys text[] := '{}';
  v_accepted_answers text[] := '{}';
  v_candidate text;
  v_payload jsonb;
  v_path text;
  v_clean_path text;
  v_page int := 0;
  v_recent_sub record;
  v_eval_feedback text;
  v_eval_status text;
BEGIN
  -- 1. Authentication Check
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 2. Validate Question ID format
  BEGIN
    v_qid := p_question_id::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid question ID format';
  END;

  -- 3. Fetch Published Question
  SELECT id, question_code, question_type, marks, negative_marks, status
  INTO v_q
  FROM public.questions
  WHERE id = v_qid AND status = 'PUBLISHED';

  IF v_q.id IS NULL THEN
    RAISE EXCEPTION 'Question is not published or not available';
  END IF;

  -- 4. Serialise concurrent clicks for the same student + question
  PERFORM pg_advisory_xact_lock(hashtext(v_uid::text || ':' || p_question_id));

  -- 5. Debouncing: If identical answer submitted within 3s, return existing attempt
  SELECT s.id, a.id AS attempt_id
  INTO v_recent_sub
  FROM public.student_attempts a
  JOIN public.student_submissions s ON s.attempt_id = a.id
  WHERE a.student_id = v_uid
    AND a.question_id = v_qid
    AND s.typed_answer = p_typed_answer
    AND s.submitted_at > (now() - INTERVAL '3 seconds')
  ORDER BY a.attempt_number DESC
  LIMIT 1;

  IF v_recent_sub.id IS NOT NULL THEN
    RETURN public.get_student_result(p_question_id);
  END IF;

  v_type := COALESCE(v_q.question_type, 'MCQ');
  v_max := COALESCE(v_q.marks, 1);
  v_neg := GREATEST(COALESCE(v_q.negative_marks, 0), 0);

  -- 6. Load Authoritative Answer Key
  SELECT correct_answer, model_answer, solution_steps, marking_scheme
  INTO v_qa
  FROM public.question_answers
  WHERE question_id = v_qid;

  v_key := v_qa.correct_answer;

  -- 7. Parse Answer Payload
  BEGIN
    v_payload := p_typed_answer::jsonb;
    v_selected_id := COALESCE(v_payload->>'selected_option_id', v_payload->>'option_id');
    v_typed_text := COALESCE(v_payload->>'text', v_payload->>'answer_text', v_payload->>'value');
  EXCEPTION WHEN OTHERS THEN
    v_payload := NULL;
    IF p_typed_answer ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_selected_id := p_typed_answer;
    ELSE
      v_typed_text := p_typed_answer;
    END IF;
  END;

  -- 8. Safe Answer Key Integrity Verification & Evaluation
  -- Missing/malformed answer keys NEVER penalize the student with negative marks.
  IF v_type IN ('MCQ', 'CASE_BASED') AND v_selected_id IS NOT NULL THEN
    SELECT option_label
    INTO v_selected_label
    FROM public.question_options
    WHERE question_id = v_qid AND id::text = v_selected_id;

    IF v_selected_label IS NULL THEN
      RAISE EXCEPTION 'Selected option does not belong to this question';
    END IF;

    -- Safely parse candidate correct keys, protecting against malformed JSON types
    IF v_key IS NOT NULL AND jsonb_typeof(v_key) = 'object' THEN
      BEGIN
        SELECT COALESCE(ARRAY_AGG(UPPER(k)), '{}')
        INTO v_correct_keys
        FROM (
          SELECT jsonb_array_elements_text(v_key->'correct_option_keys') AS k
          WHERE jsonb_typeof(v_key->'correct_option_keys') = 'array'
          UNION
          SELECT UPPER(btrim(v_key->>'value'))
          WHERE jsonb_typeof(v_key->'value') = 'string'
            AND COALESCE(v_key->>'value', '') <> ''
        ) u
        WHERE k IS NOT NULL AND btrim(k) <> '';
      EXCEPTION WHEN OTHERS THEN
        v_correct_keys := '{}';
      END;
    END IF;

    -- If key is missing or malformed, route to PENDING without awarding negative marks
    IF v_correct_keys IS NULL OR cardinality(v_correct_keys) = 0 THEN
      v_auto := FALSE;
      v_is_correct := NULL;
      v_awarded := NULL;
      v_eval_status := 'PENDING';
      v_eval_feedback := 'Awaiting Teacher Evaluation — Question answer key is not configured or malformed';
    ELSE
      v_auto := TRUE;
      v_is_correct := (UPPER(btrim(v_selected_label)) = ANY (v_correct_keys));
      v_awarded := CASE WHEN v_is_correct THEN v_max ELSE -v_neg END;
      v_eval_status := 'FINALIZED';
      v_eval_feedback := CASE WHEN v_is_correct THEN 'Correct Answer' ELSE 'Incorrect Answer' END;
    END IF;

  ELSIF v_type = 'TRUE_FALSE' THEN
    IF v_typed_text IS NULL OR btrim(v_typed_text) = '' THEN
      RAISE EXCEPTION 'Please choose True or False';
    END IF;

    -- Validate student input: must be TRUE or FALSE
    IF UPPER(btrim(v_typed_text)) NOT IN ('TRUE', 'FALSE') THEN
      RAISE EXCEPTION 'Invalid selection for True/False question. Expected TRUE or FALSE';
    END IF;

    IF v_key IS NULL OR jsonb_typeof(v_key) <> 'object'
       OR v_key->>'value' IS NULL OR btrim(v_key->>'value') = ''
       OR UPPER(btrim(v_key->>'value')) NOT IN ('TRUE', 'FALSE') THEN
      v_auto := FALSE;
      v_is_correct := NULL;
      v_awarded := NULL;
      v_eval_status := 'PENDING';
      v_eval_feedback := 'Awaiting Teacher Evaluation — Question answer key is not configured or malformed';
    ELSE
      v_auto := TRUE;
      v_is_correct := (UPPER(btrim(v_typed_text)) = UPPER(btrim(v_key->>'value')));
      v_awarded := CASE WHEN v_is_correct THEN v_max ELSE -v_neg END;
      v_eval_status := 'FINALIZED';
      v_eval_feedback := CASE WHEN v_is_correct THEN 'Correct Answer' ELSE 'Incorrect Answer' END;
    END IF;

  ELSIF v_type = 'FILL_BLANK' THEN
    IF v_typed_text IS NULL OR btrim(v_typed_text) = '' THEN
      RAISE EXCEPTION 'Please type your answer';
    END IF;

    -- Safely read primary value + accepted_answers array, checking JSON types
    IF v_key IS NOT NULL AND jsonb_typeof(v_key) = 'object' THEN
      BEGIN
        SELECT COALESCE(ARRAY_AGG(btrim(ans)), '{}')
        INTO v_accepted_answers
        FROM (
          SELECT jsonb_array_elements_text(v_key->'accepted_answers') AS ans
          WHERE jsonb_typeof(v_key->'accepted_answers') = 'array'
          UNION
          SELECT btrim(v_key->>'value')
          WHERE jsonb_typeof(v_key->'value') = 'string'
            AND COALESCE(v_key->>'value', '') <> ''
        ) u
        WHERE ans IS NOT NULL AND btrim(ans) <> '';
      EXCEPTION WHEN OTHERS THEN
        v_accepted_answers := '{}';
      END;
    END IF;

    IF v_accepted_answers IS NULL OR cardinality(v_accepted_answers) = 0 THEN
      -- No valid answer key configured
      v_auto := FALSE;
      v_is_correct := NULL;
      v_awarded := NULL;
      v_eval_status := 'PENDING';
      v_eval_feedback := 'Awaiting Teacher Evaluation — Question answer key is not configured or malformed';
    ELSE
      v_auto := TRUE;
      v_is_correct := FALSE;
      -- Award full marks if any accepted answer matches
      FOREACH v_candidate IN ARRAY v_accepted_answers LOOP
        IF public.mp_answers_equal(v_typed_text, v_candidate) THEN
          v_is_correct := TRUE;
          EXIT;
        END IF;
      END LOOP;
      v_awarded := CASE WHEN v_is_correct THEN v_max ELSE -v_neg END;
      v_eval_status := 'FINALIZED';
      v_eval_feedback := CASE WHEN v_is_correct THEN 'Correct Answer' ELSE 'Incorrect Answer' END;
    END IF;

  ELSE
    -- Subjective / Written answer
    v_auto := FALSE;
    v_is_correct := NULL;
    v_awarded := NULL;
    v_eval_status := 'PENDING';
    v_eval_feedback := 'Awaiting Teacher Evaluation';
  END IF;

  -- 9. Incremented Attempt Number
  SELECT COALESCE(MAX(attempt_number), 0) + 1
  INTO v_attempt_num
  FROM public.student_attempts
  WHERE student_id = v_uid AND question_id = v_qid;

  -- Insert into public.student_attempts
  INSERT INTO public.student_attempts (
    student_id,
    question_id,
    attempt_number,
    status,
    started_at,
    submitted_at
  ) VALUES (
    v_uid,
    v_qid,
    v_attempt_num,
    CASE WHEN v_auto THEN 'EVALUATED' ELSE 'SUBMITTED' END,
    now(),
    now()
  ) RETURNING id INTO v_attempt_id;

  -- Insert into public.student_submissions
  INSERT INTO public.student_submissions (
    attempt_id,
    typed_answer,
    submission_status,
    submitted_at,
    created_at
  ) VALUES (
    v_attempt_id,
    p_typed_answer,
    CASE WHEN v_auto THEN 'EVALUATED' ELSE 'SUBMITTED' END,
    now(),
    now()
  ) RETURNING id INTO v_sub_id;

  -- Persist server-controlled PRACTICE mode
  IF v_auto THEN
    INSERT INTO public.evaluations (
      submission_id,
      evaluation_status,
      final_marks,
      ai_feedback,
      stepwise_feedback,
      evaluated_at,
      created_at,
      updated_at
    ) VALUES (
      v_sub_id,
      v_eval_status,
      v_awarded,
      v_eval_feedback,
      jsonb_build_object(
        'is_correct', v_is_correct,
        'final_marks', v_awarded,
        'max_marks', v_max,
        'negative_marks', v_neg,
        'selected_option_label', v_selected_label,
        'submission_mode', 'PRACTICE',
        'attempt_number', v_attempt_num
      ),
      now(),
      now(),
      now()
    ) ON CONFLICT (submission_id) DO NOTHING;
  ELSE
    INSERT INTO public.evaluations (
      submission_id,
      evaluation_status,
      final_marks,
      ai_feedback,
      stepwise_feedback,
      created_at,
      updated_at
    ) VALUES (
      v_sub_id,
      v_eval_status,
      NULL,
      v_eval_feedback,
      jsonb_build_object(
        'status', 'PENDING',
        'max_marks', v_max,
        'submission_mode', 'PRACTICE',
        'attempt_number', v_attempt_num
      ),
      now(),
      now()
    ) ON CONFLICT (submission_id) DO NOTHING;
  END IF;

  -- 10. Validated Image Ingestion & Concurrency Locking
  IF p_image_paths IS NOT NULL AND cardinality(p_image_paths) > 0 THEN
    -- Enforce maximum of 10 pages per submission
    IF cardinality(p_image_paths) > 10 THEN
      RAISE EXCEPTION 'A submission cannot exceed 10 pages';
    END IF;

    FOREACH v_path IN ARRAY p_image_paths LOOP
      v_clean_path := btrim(v_path);
      IF v_clean_path LIKE 'student-submissions/%' THEN
        v_clean_path := substr(v_clean_path, 21);
      END IF;

      -- Validate path format: must belong to authenticated user, have allowed extension, and no traversal
      IF NOT (
        v_clean_path ~ ('^' || v_uid::text || '/[a-zA-Z0-9_\-\.\/]+$')
        AND v_clean_path ~* '\.(jpe?g|png|pdf)$'
        AND v_clean_path NOT LIKE '%..%'
      ) THEN
        RAISE EXCEPTION 'Invalid or unauthorized submission image path format: %', v_path;
      END IF;

      -- Concurrency Lock & Existence Verification:
      -- Lock the target row in storage.objects FOR UPDATE.
      -- If another transaction is attempting to delete the file concurrently,
      -- that DELETE will block until this submission transaction commits.
      -- Once committed, the RLS DELETE policy's mp_is_image_referenced check permanently blocks deletion.
      -- If the file was already deleted or never existed, NOT FOUND triggers RAISE EXCEPTION,
      -- rolling back the entire submission transaction atomically.
      PERFORM 1
      FROM storage.objects
      WHERE bucket_id = 'student-submissions'
        AND name = v_clean_path
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Submission image does not exist in storage: %', v_path;
      END IF;

      v_page := v_page + 1;
      INSERT INTO public.submission_images (
        submission_id,
        storage_path,
        page_number,
        uploaded_at
      ) VALUES (
        v_sub_id,
        v_clean_path,
        v_page,
        now()
      );
    END LOOP;
  END IF;

  RETURN public.get_student_result(p_question_id);
END $$;

-- 8. Hardened Execution Grants ------------------------------------------------
-- Public RPCs: revoke public and anon access; grant strictly to authenticated
REVOKE ALL ON FUNCTION public.submit_student_answer(text, text, text[]) FROM public, anon;
REVOKE ALL ON FUNCTION public.get_student_result(text, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.get_student_results(text[]) FROM public, anon;
REVOKE ALL ON FUNCTION public.student_question_options(uuid[]) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.submit_student_answer(text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_result(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_results(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_question_options(uuid[]) TO authenticated;

-- Helper functions: revoke default PUBLIC/anon execution permissions
REVOKE ALL ON FUNCTION public.mp_try_numeric(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.mp_norm_answer(text) FROM public, anon;
REVOKE ALL ON FUNCTION public.mp_answers_equal(text, text) FROM public, anon;
DROP FUNCTION IF EXISTS public.mp_is_image_referenced(text);

GRANT EXECUTE ON FUNCTION public.mp_try_numeric(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_norm_answer(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mp_answers_equal(text, text) TO authenticated;

-- 9. Storage Bucket & Policies ------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'student-submissions',
  'student-submissions',
  false,
  10485760, -- 10 MB limit
  ARRAY['image/jpeg', 'image/png', 'image/jpg', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];

-- Non-exposed private schema for internal RLS helper functions.
-- PostgREST only exposes the `public` schema by default, so functions in
-- `app_private` are completely unreachable via PostgREST / Supabase RPC endpoints.
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM public, anon, authenticated;
GRANT USAGE ON SCHEMA app_private TO authenticated;

-- Helper function to check if an image path is referenced by any submission.
-- Declared SECURITY DEFINER to bypass any table-level RLS on public.submission_images.
-- Hardened with dual-layer security:
-- 1. Private schema (app_private) prevents RPC/HTTP exposure.
-- 2. Caller-scoping guard ensures students can only probe paths inside their own folder;
--    any attempt to probe another student's path fails closed (returns TRUE -> deletion blocked).
CREATE OR REPLACE FUNCTION app_private.is_image_referenced(p_storage_path text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_clean text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN TRUE; -- Fail closed: deny deletion if unauthenticated
  END IF;

  v_clean := btrim(p_storage_path);
  IF v_clean LIKE 'student-submissions/%' THEN
    v_clean := substr(v_clean, 21);
  END IF;

  -- Caller-scoping guard: student can only inspect references to files in their own folder.
  -- Probing another student's storage path fails closed, returning TRUE (deletion denied).
  IF NOT (v_clean ~ ('^' || v_uid::text || '/')) THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.submission_images si
    WHERE si.storage_path = v_clean
       OR si.storage_path = ('student-submissions/' || v_clean)
       OR ('student-submissions/' || si.storage_path) = v_clean
  );
END;
$$;

REVOKE ALL ON FUNCTION app_private.is_image_referenced(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION app_private.is_image_referenced(text) TO authenticated;

-- 9.1 Student Upload Policy (Insert own folder only)
DROP POLICY IF EXISTS "students upload own submissions" ON storage.objects;
CREATE POLICY "students upload own submissions" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'student-submissions'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 9.2 Student Read Policy (Select own folder only)
DROP POLICY IF EXISTS "students read own submissions" ON storage.objects;
CREATE POLICY "students read own submissions" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'student-submissions'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 9.3 Teacher & Admin Read Policy (Role-scoped access across all submissions)
-- Note: As verified in catalog audit, no teacher-student / cohort / class mapping
-- tables exist in the schema. Access is granted to all verified TEACHER and ADMIN roles.
DROP POLICY IF EXISTS "teachers read student submissions" ON storage.objects;
CREATE POLICY "teachers read student submissions" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'student-submissions'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('TEACHER', 'ADMIN')
    )
  );

-- 9.4 Student Safe Delete Policy (Unsubmitted drafts only)
-- Students may delete draft uploads before submission. Once a file is referenced
-- in public.submission_images for a submitted answer, deletion is strictly forbidden.
DROP POLICY IF EXISTS "students delete own drafts" ON storage.objects;
DROP POLICY IF EXISTS "students delete own unsubmitted draft uploads" ON storage.objects;
CREATE POLICY "students delete own unsubmitted draft uploads" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'student-submissions'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND NOT app_private.is_image_referenced(name)
  );

