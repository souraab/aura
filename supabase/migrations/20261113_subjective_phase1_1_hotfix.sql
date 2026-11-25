-- ============================================================================
-- MathPractice: Subjective Evaluation Hotfix Migration (Phase 1.1)
-- File: supabase/migrations/20261113_subjective_phase1_1_hotfix.sql
--
-- Purpose:
--   Hotfix for deployed functions submit_student_answer and get_student_result:
--   1. Corrects column reference to student_attempts.student_id.
--   2. Corrects timestamp column references student_attempts.started_at and
--      student_attempts.submitted_at (was created_at).
--   3. Sets student_attempts.status upon attempt insertion satisfying check
--      constraint ('IN_PROGRESS', 'SUBMITTED', 'EVALUATED').
--
-- Security & Integrity Guarantees:
--   - Does NOT recreate or alter storage policies or app_private schema helper.
--   - Preserves atomic storage.objects row locking (FOR UPDATE) & validation.
--   - Preserves MCQ, TRUE_FALSE and FILL_BLANK evaluation logic & scoring rules.
--   - Preserves attempt debouncing, anti-spam throttle, and attempt sequencing.
--   - Preserves answer reveal gating (revealed only for FINALIZED PRACTICE).
--   - Hardens EXECUTE permissions strictly to authenticated role.
-- ============================================================================

BEGIN;

-- 1. Corrected get_student_result ---------------------------------------------
CREATE OR REPLACE FUNCTION public.get_student_result(
  p_question_id text,
  p_attempt_number integer DEFAULT NULL
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
  v_selected_id text;
  v_selected_label text;
  v_is_correct boolean;
  v_correct_keys text[] := '{}';
  v_correct_ids text[] := '{}';
  v_accepted_answers text[] := '{}';
  v_total_attempts int := 0;
  v_persisted_mode text := NULL;
  v_reveal boolean := FALSE;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  BEGIN
    v_qid := p_question_id::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  SELECT id, marks, negative_marks, question_type
  INTO v_q
  FROM public.questions
  WHERE id = v_qid;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Count total attempts made by this student (uses student_id)
  SELECT count(*)::int
  INTO v_total_attempts
  FROM public.student_attempts
  WHERE student_id = v_uid AND question_id = v_qid;

  -- Retrieve specific or latest attempt (ordered by started_at DESC)
  IF p_attempt_number IS NOT NULL THEN
    SELECT *
    INTO v_attempt
    FROM public.student_attempts
    WHERE student_id = v_uid AND question_id = v_qid AND attempt_number = p_attempt_number
    ORDER BY started_at DESC
    LIMIT 1;
  ELSE
    SELECT *
    INTO v_attempt
    FROM public.student_attempts
    WHERE student_id = v_uid AND question_id = v_qid
    ORDER BY attempt_number DESC, started_at DESC
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_sub
  FROM public.student_submissions
  WHERE attempt_id = v_attempt.id
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_eval
  FROM public.evaluations
  WHERE submission_id = v_sub.id;

  -- Extract selected option info if present
  IF v_sub.typed_answer IS NOT NULL THEN
    BEGIN
      IF v_sub.typed_answer::jsonb ? 'selected_option_id' THEN
        v_selected_id := v_sub.typed_answer::jsonb->>'selected_option_id';
        IF v_selected_id IS NOT NULL AND v_selected_id <> '' THEN
          SELECT option_label INTO v_selected_label
          FROM public.question_options
          WHERE id = v_selected_id::uuid;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- typed_answer was not JSON
    END;
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
END;
$$;

-- 2. Corrected submit_student_answer ------------------------------------------
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
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  BEGIN
    v_qid := p_question_id::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid question ID format';
  END;

  -- 1. Anti-spam throttle (minimum 2 seconds between submissions for same question)
  -- Uses student_attempts.student_id
  SELECT s.submitted_at
  INTO v_recent_sub
  FROM public.student_attempts a
  JOIN public.student_submissions s ON s.attempt_id = a.id
  WHERE a.student_id = v_uid AND a.question_id = v_qid
  ORDER BY s.submitted_at DESC
  LIMIT 1;

  IF FOUND AND (clock_timestamp() - v_recent_sub.submitted_at) < interval '2 seconds' THEN
    RAISE EXCEPTION 'Please wait a moment before submitting again';
  END IF;

  -- 2. Validate Question Exists and is Active
  SELECT id, question_type, marks, negative_marks, status
  INTO v_q
  FROM public.questions
  WHERE id = v_qid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question not found';
  END IF;

  IF v_q.status IS NOT NULL AND v_q.status <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'Question is not open for practice submissions';
  END IF;

  v_type := UPPER(btrim(v_q.question_type));
  v_max := COALESCE(v_q.marks, 1);
  v_neg := COALESCE(v_q.negative_marks, 0);

  -- 3. Parse and Validate Client Payload
  IF p_typed_answer IS NOT NULL AND btrim(p_typed_answer) <> '' THEN
    BEGIN
      v_payload := p_typed_answer::jsonb;
    EXCEPTION WHEN OTHERS THEN
      v_payload := NULL;
    END;
  END IF;

  IF v_payload IS NOT NULL THEN
    v_selected_id := v_payload->>'selected_option_id';
    v_typed_text := COALESCE(v_payload->>'value', v_payload->>'text');
  ELSE
    v_typed_text := p_typed_answer;
  END IF;

  -- 4. Calculate Attempt Number (uses student_attempts.student_id)
  SELECT COALESCE(MAX(attempt_number), 0) + 1
  INTO v_attempt_num
  FROM public.student_attempts
  WHERE student_id = v_uid AND question_id = v_qid;

  -- 5. Branch Evaluation by Question Type
  IF v_type = 'MCQ' THEN
    v_auto := TRUE;
    IF v_selected_id IS NOT NULL AND btrim(v_selected_id) <> '' THEN
      SELECT option_label INTO v_selected_label
      FROM public.question_options
      WHERE id = v_selected_id::uuid AND question_id = v_qid;
    END IF;

    SELECT correct_answer INTO v_qa
    FROM public.question_answers
    WHERE question_id = v_qid;

    v_key := v_qa.correct_answer;

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

    IF cardinality(v_correct_keys) = 0 THEN
      v_auto := FALSE;
      v_eval_status := 'PENDING';
      v_eval_feedback := 'Answer key not configured; awaiting teacher evaluation';
      v_awarded := NULL;
    ELSIF v_selected_label IS NOT NULL AND UPPER(btrim(v_selected_label)) = ANY (v_correct_keys) THEN
      v_is_correct := TRUE;
      v_awarded := v_max;
      v_eval_status := 'FINALIZED';
      v_eval_feedback := 'Correct Answer';
    ELSE
      v_is_correct := FALSE;
      v_awarded := -v_neg;
      v_eval_status := 'FINALIZED';
      v_eval_feedback := 'Incorrect Answer';
    END IF;

  ELSIF v_type = 'TRUE_FALSE' THEN
    v_auto := TRUE;
    SELECT correct_answer INTO v_qa
    FROM public.question_answers
    WHERE question_id = v_qid;

    v_key := v_qa.correct_answer;
    v_candidate := UPPER(btrim(COALESCE(v_key->>'value', '')));

    IF v_candidate NOT IN ('TRUE', 'FALSE') THEN
      v_auto := FALSE;
      v_eval_status := 'PENDING';
      v_eval_feedback := 'Answer key not configured; awaiting teacher evaluation';
      v_awarded := NULL;
    ELSIF v_typed_text IS NOT NULL AND UPPER(btrim(v_typed_text)) = v_candidate THEN
      v_is_correct := TRUE;
      v_awarded := v_max;
      v_eval_status := 'FINALIZED';
      v_eval_feedback := 'Correct Answer';
    ELSE
      v_is_correct := FALSE;
      v_awarded := -v_neg;
      v_eval_status := 'FINALIZED';
      v_eval_feedback := 'Incorrect Answer';
    END IF;

  ELSIF v_type = 'FILL_BLANK' THEN
    v_auto := TRUE;
    SELECT correct_answer INTO v_qa
    FROM public.question_answers
    WHERE question_id = v_qid;

    v_key := v_qa.correct_answer;

    IF v_key IS NOT NULL AND jsonb_typeof(v_key) = 'object' THEN
      BEGIN
        SELECT COALESCE(ARRAY_AGG(ans), '{}')
        INTO v_accepted_answers
        FROM (
          SELECT jsonb_array_elements_text(v_key->'accepted_answers') AS ans
          WHERE jsonb_typeof(v_key->'accepted_answers') = 'array'
          UNION
          SELECT v_key->>'value'
          WHERE jsonb_typeof(v_key->'value') = 'string'
            AND COALESCE(v_key->>'value', '') <> ''
        ) u
        WHERE ans IS NOT NULL AND btrim(ans) <> '';
      EXCEPTION WHEN OTHERS THEN
        v_accepted_answers := '{}';
      END;
    END IF;

    IF cardinality(v_accepted_answers) = 0 THEN
      v_auto := FALSE;
      v_eval_status := 'PENDING';
      v_eval_feedback := 'Answer key not configured; awaiting teacher evaluation';
      v_awarded := NULL;
    ELSE
      v_is_correct := FALSE;
      IF v_typed_text IS NOT NULL THEN
        FOREACH v_candidate IN ARRAY v_accepted_answers LOOP
          IF public.mp_answers_equal(v_typed_text, v_candidate) THEN
            v_is_correct := TRUE;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF v_is_correct THEN
        v_awarded := v_max;
        v_eval_status := 'FINALIZED';
        v_eval_feedback := 'Correct Answer';
      ELSE
        v_awarded := -v_neg;
        v_eval_status := 'FINALIZED';
        v_eval_feedback := 'Incorrect Answer';
      END IF;
    END IF;

  ELSE
    -- SUBJECTIVE / OTHER
    v_auto := FALSE;
    v_eval_status := 'PENDING';
    v_eval_feedback := 'Awaiting Teacher Evaluation';
    v_awarded := NULL;
  END IF;

  -- 6. Insert Attempt and Submission
  -- Correct columns: student_id, question_id, attempt_number, status, started_at, submitted_at
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

  -- 7. Persist Evaluation with Server-Controlled PRACTICE Mode
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

  -- 8. Validated Image Ingestion & Concurrency Locking
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
      -- Once committed, the RLS DELETE policy's app_private.is_image_referenced check permanently blocks deletion.
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
END;
$$;

-- 3. Hardened Permissions -----------------------------------------------------
REVOKE ALL ON FUNCTION public.submit_student_answer(text, text, text[]) FROM public, anon;
REVOKE ALL ON FUNCTION public.get_student_result(text, integer) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.submit_student_answer(text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_result(text, integer) TO authenticated;

COMMIT;

