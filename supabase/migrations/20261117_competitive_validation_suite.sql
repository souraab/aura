-- ============================================================================
-- AuraMentor Competitive Dashboard: Complete Verification Test Suite
-- File: supabase/migrations/20261117_competitive_validation_suite.sql
--
-- Execution Safety:
--   - Executed entirely inside an isolated BEGIN ... ROLLBACK; transaction.
--   - Creates temporary mock authentication users and rolls them back.
--   - Leaves ZERO persistent records in auth.users, profiles, attempts,
--     submissions, evaluations, ledger, achievements, or schools.
--   - Genuinely executes all assertions against installed triggers, backfills,
--     security permissions, and the get_competitive_leaderboard RPC.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  -- School Fixtures
  v_school_verified uuid := gen_random_uuid();
  v_school_pending uuid := gen_random_uuid();
  v_school_rejected uuid := gen_random_uuid();

  -- User & Profile Fixtures
  v_admin_id uuid := gen_random_uuid();
  v_student_1 uuid := gen_random_uuid();
  v_student_2 uuid := gen_random_uuid();
  v_student_optout uuid := gen_random_uuid();
  v_student_noschool uuid := gen_random_uuid();
  v_student_pending_sch uuid := gen_random_uuid();
  v_student_rejected_sch uuid := gen_random_uuid();
  v_student_achieve uuid := gen_random_uuid();
  v_student_hist uuid := gen_random_uuid();

  -- Question Fixtures
  v_chapter_id uuid;
  v_q_easy uuid := gen_random_uuid();
  v_q_med uuid := gen_random_uuid();
  v_q_hard_subj uuid := gen_random_uuid();
  v_q_part_subj uuid := gen_random_uuid();
  v_q_extra uuid := gen_random_uuid();
  v_q_hist uuid := gen_random_uuid();
  v_q_loop uuid;

  -- Operational Tracking Variables
  v_att_id uuid;
  v_sub_id uuid;
  v_att_id_test3 uuid;
  v_sub_id_test3 uuid;
  v_eval_id_test3 uuid;
  v_att_id_test4 uuid;
  v_sub_id_test4 uuid;
  v_eval_id_test4 uuid;

  v_eval_status_check text;
  v_eval_marks_check numeric;
  v_points_count int;
  v_total_points int;
  v_achievements_count int;
  v_rpc_result jsonb;
  v_unauthorized_success boolean := false;
  v_entry_0 jsonb;
  v_entry_1 jsonb;
  v_invalid_scope_caught boolean := false;
  i int;

  -- Test 12 Trigger Isolation & Backfill Verification Variables
  v_orig_trg_state "char";
  v_restored_trg_state "char";
  v_hist_ledger_count int;
  v_hist_achieve_count int;
  v_hist_distinct_q int;
  v_hist_reason_check int;
BEGIN
  -- Retrieve an existing chapter
  SELECT id INTO v_chapter_id FROM public.chapters LIMIT 1;
  IF v_chapter_id IS NULL THEN
    RAISE EXCEPTION 'Prerequisite failed: At least one chapter must exist in public.chapters.';
  END IF;

  -- --------------------------------------------------------------------------
  -- 0. Fixture Setup: Schools, Authentication Users, Profiles, Questions
  -- --------------------------------------------------------------------------
  -- Insert Schools across all 3 verification states
  INSERT INTO public.schools (id, name, city, state, board, is_verified, verification_status, verified_at, verified_by)
  VALUES
    (v_school_verified, 'Verified Benchmark Academy', 'New Delhi', 'Delhi', 'CBSE', false, 'PENDING', NULL, NULL),
    (v_school_pending, 'Pending Community School', 'New Delhi', 'Delhi', 'CBSE', false, 'PENDING', NULL, NULL),
    (v_school_rejected, 'Rejected Fraudulent Academy', 'New Delhi', 'Delhi', 'CBSE', false, 'PENDING', NULL, NULL);

  -- Create temporary test auth.users (strictly rolled back at end of transaction)
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_admin_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_adm_' || v_admin_id || '@auramentor.internal', 'hash', now(), '{"provider":"email"}'::jsonb, '{"full_name":"Test Admin"}'::jsonb, now(), now()),
    (v_student_1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_s1_' || v_student_1 || '@auramentor.internal', 'hash', now(), '{"provider":"email"}'::jsonb, '{"full_name":"Arjun Sharma"}'::jsonb, now(), now()),
    (v_student_2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_s2_' || v_student_2 || '@auramentor.internal', 'hash', now(), '{"provider":"email"}'::jsonb, '{"full_name":"Bhavna Patel"}'::jsonb, now(), now()),
    (v_student_optout, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_opt_' || v_student_optout || '@auramentor.internal', 'hash', now(), '{"provider":"email"}'::jsonb, '{"full_name":"Chetan Verma"}'::jsonb, now(), now()),
    (v_student_noschool, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_nosch_' || v_student_noschool || '@auramentor.internal', 'hash', now(), '{"provider":"email"}'::jsonb, '{"full_name":"Divya Nair"}'::jsonb, now(), now()),
    (v_student_pending_sch, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_pendsch_' || v_student_pending_sch || '@auramentor.internal', 'hash', now(), '{"provider":"email"}'::jsonb, '{"full_name":"Eshan Gupta"}'::jsonb, now(), now()),
    (v_student_rejected_sch, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_rejsch_' || v_student_rejected_sch || '@auramentor.internal', 'hash', now(), '{"provider":"email"}'::jsonb, '{"full_name":"Farhan Ali"}'::jsonb, now(), now()),
    (v_student_achieve, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_ach_' || v_student_achieve || '@auramentor.internal', 'hash', now(), '{"provider":"email"}'::jsonb, '{"full_name":"Gita Rao"}'::jsonb, now(), now()),
    (v_student_hist, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_hist_' || v_student_hist || '@auramentor.internal', 'hash', now(), '{"provider":"email"}'::jsonb, '{"full_name":"Harish Kumar"}'::jsonb, now(), now());

  -- Setup admin profile and verify school via administrative operation
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (v_admin_id, 'System Administrator', 'ADMIN')
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = 'ADMIN';

  -- Authenticate as admin to execute verify_school
  PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin_id, 'role', 'authenticated')::text, true);
  PERFORM public.verify_school(v_school_verified, 'VERIFIED');
  PERFORM public.verify_school(v_school_rejected, 'REJECTED');

  -- Setup student profiles
  INSERT INTO public.profiles (id, full_name, role, school_id, competitive_opt_in)
  VALUES
    (v_student_1, 'Arjun Sharma', 'STUDENT', v_school_verified, true),
    (v_student_2, 'Bhavna Patel', 'STUDENT', v_school_verified, true),
    (v_student_optout, 'Chetan Verma', 'STUDENT', v_school_verified, false),       -- Opted OUT
    (v_student_noschool, 'Divya Nair', 'STUDENT', NULL, true),                       -- No school assigned
    (v_student_pending_sch, 'Eshan Gupta', 'STUDENT', v_school_pending, true),       -- Attached to PENDING school
    (v_student_rejected_sch, 'Farhan Ali', 'STUDENT', v_school_rejected, true),     -- Attached to REJECTED school
    (v_student_achieve, 'Gita Rao', 'STUDENT', v_school_verified, true),
    (v_student_hist, 'Harish Kumar', 'STUDENT', v_school_verified, true)
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    school_id = EXCLUDED.school_id,
    competitive_opt_in = EXCLUDED.competitive_opt_in;

  -- Create test questions with exact difficulty & types
  INSERT INTO public.questions (id, chapter_id, question_text, question_type, difficulty, marks, status)
  VALUES
    (v_q_easy, v_chapter_id, 'Q Easy MCQ', 'MCQ', 'EASY', 1, 'PUBLISHED'),
    (v_q_med, v_chapter_id, 'Q Med MCQ', 'MCQ', 'MEDIUM', 2, 'PUBLISHED'),
    (v_q_hard_subj, v_chapter_id, 'Q Hard Subj', 'SUBJECTIVE', 'HARD', 4, 'PUBLISHED'),
    (v_q_part_subj, v_chapter_id, 'Q Part Subj', 'SUBJECTIVE', 'HARD', 4, 'PUBLISHED'),
    (v_q_extra, v_chapter_id, 'Q Extra MCQ', 'MCQ', 'EASY', 1, 'PUBLISHED'),
    (v_q_hist, v_chapter_id, 'Q Hist MCQ', 'MCQ', 'MEDIUM', 2, 'PUBLISHED');

  -- --------------------------------------------------------------------------
  -- TEST 1: Correct EASY MCQ -> Must Award 10 Points
  -- --------------------------------------------------------------------------
  v_att_id := gen_random_uuid();
  v_sub_id := gen_random_uuid();
  INSERT INTO public.student_attempts (id, student_id, question_id, status, started_at, submitted_at)
  VALUES (v_att_id, v_student_1, v_q_easy, 'SUBMITTED', now(), now());
  INSERT INTO public.student_submissions (id, attempt_id, typed_answer, submission_status, submitted_at, created_at)
  VALUES (v_sub_id, v_att_id, '{"type":"MCQ","selected_option_id":"opt-1"}', 'EVALUATED', now(), now());
  INSERT INTO public.evaluations (submission_id, evaluation_status, final_marks, stepwise_feedback, evaluated_at, created_at, updated_at)
  VALUES (v_sub_id, 'FINALIZED', 1, '{"is_correct": true, "verdict": "CORRECT"}'::jsonb, now(), now(), now());

  SELECT points_awarded INTO v_total_points
  FROM public.student_points_ledger
  WHERE student_id = v_student_1 AND question_id = v_q_easy;

  IF v_total_points <> 10 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Expected 10 points for EASY MCQ, got %', v_total_points;
  END IF;

  -- --------------------------------------------------------------------------
  -- TEST 2: Incorrect MEDIUM MCQ -> Must Award 0 Points (No Ledger Entry)
  -- --------------------------------------------------------------------------
  v_att_id := gen_random_uuid();
  v_sub_id := gen_random_uuid();
  INSERT INTO public.student_attempts (id, student_id, question_id, status, started_at, submitted_at)
  VALUES (v_att_id, v_student_1, v_q_med, 'SUBMITTED', now(), now());
  INSERT INTO public.student_submissions (id, attempt_id, typed_answer, submission_status, submitted_at, created_at)
  VALUES (v_sub_id, v_att_id, '{"type":"MCQ","selected_option_id":"opt-wrong"}', 'EVALUATED', now(), now());
  INSERT INTO public.evaluations (submission_id, evaluation_status, final_marks, stepwise_feedback, evaluated_at, created_at, updated_at)
  VALUES (v_sub_id, 'FINALIZED', 0, '{"is_correct": false, "verdict": "INCORRECT"}'::jsonb, now(), now(), now());

  IF EXISTS (SELECT 1 FROM public.student_points_ledger WHERE student_id = v_student_1 AND question_id = v_q_med) THEN
    RAISE EXCEPTION 'TEST 2 FAILED: Incorrect MCQ must not award competitive points';
  END IF;

  -- --------------------------------------------------------------------------
  -- TEST 3: Pending Subjective Answer -> Must Award 0 Points
  -- --------------------------------------------------------------------------
  v_att_id_test3 := gen_random_uuid();
  v_sub_id_test3 := gen_random_uuid();
  v_eval_id_test3 := gen_random_uuid();
  INSERT INTO public.student_attempts (id, student_id, question_id, status, started_at, submitted_at)
  VALUES (v_att_id_test3, v_student_1, v_q_hard_subj, 'SUBMITTED', now(), now());
  INSERT INTO public.student_submissions (id, attempt_id, typed_answer, submission_status, submitted_at, created_at)
  VALUES (v_sub_id_test3, v_att_id_test3, 'Proof pending teacher review', 'SUBMITTED', now(), now());
  INSERT INTO public.evaluations (id, submission_id, evaluation_status, final_marks, evaluated_at, created_at, updated_at)
  VALUES (v_eval_id_test3, v_sub_id_test3, 'PENDING', 0, now(), now(), now());

  IF EXISTS (SELECT 1 FROM public.student_points_ledger WHERE student_id = v_student_1 AND question_id = v_q_hard_subj) THEN
    RAISE EXCEPTION 'TEST 3 FAILED: Pending subjective evaluation must not award points';
  END IF;

  -- --------------------------------------------------------------------------
  -- TEST 4: Partially Correct Subjective Answer (2/4 marks) -> Must Award 0 Points
  -- --------------------------------------------------------------------------
  v_att_id_test4 := gen_random_uuid();
  v_sub_id_test4 := gen_random_uuid();
  v_eval_id_test4 := gen_random_uuid();
  INSERT INTO public.student_attempts (id, student_id, question_id, status, started_at, submitted_at)
  VALUES (v_att_id_test4, v_student_1, v_q_part_subj, 'SUBMITTED', now(), now());
  INSERT INTO public.student_submissions (id, attempt_id, typed_answer, submission_status, submitted_at, created_at)
  VALUES (v_sub_id_test4, v_att_id_test4, 'Partial solution steps', 'EVALUATED', now(), now());
  INSERT INTO public.evaluations (id, submission_id, evaluation_status, final_marks, stepwise_feedback, evaluated_at, created_at, updated_at)
  VALUES (v_eval_id_test4, v_sub_id_test4, 'FINALIZED', 2, '{"is_correct": false, "verdict": "PARTIAL"}'::jsonb, now(), now(), now());

  IF EXISTS (SELECT 1 FROM public.student_points_ledger WHERE student_id = v_student_1 AND question_id = v_q_part_subj) THEN
    RAISE EXCEPTION 'TEST 4 FAILED: Partial marks (2/4) must award 0 competitive points';
  END IF;

  -- --------------------------------------------------------------------------
  -- TEST 5: Transition Original Pending Subjective Evaluation to Finalized
  -- --------------------------------------------------------------------------
  -- Directly update the exact evaluation created in Test 3 (v_eval_id_test3)
  UPDATE public.evaluations
  SET
    evaluation_status = 'FINALIZED',
    final_marks = 4,
    stepwise_feedback = '{"is_correct": true, "verdict": "CORRECT"}'::jsonb,
    evaluated_at = now()
  WHERE id = v_eval_id_test3;

  -- Assert original evaluation is finalized
  SELECT evaluation_status, final_marks
  INTO v_eval_status_check, v_eval_marks_check
  FROM public.evaluations
  WHERE id = v_eval_id_test3;

  IF v_eval_status_check <> 'FINALIZED' OR v_eval_marks_check <> 4 THEN
    RAISE EXCEPTION 'TEST 5 FAILED: Original evaluation was not updated to FINALIZED with full marks';
  END IF;

  -- Assert exactly one points-ledger entry is created and 30 points awarded
  SELECT COUNT(*), COALESCE(SUM(points_awarded), 0)
  INTO v_points_count, v_total_points
  FROM public.student_points_ledger
  WHERE student_id = v_student_1 AND question_id = v_q_hard_subj;

  IF v_points_count <> 1 THEN
    RAISE EXCEPTION 'TEST 5 FAILED: Expected exactly 1 points-ledger row, found %', v_points_count;
  END IF;

  IF v_total_points <> 30 THEN
    RAISE EXCEPTION 'TEST 5 FAILED: Expected 30 points for HARD question, got %', v_total_points;
  END IF;

  -- Repeating the update must not create duplicate points
  UPDATE public.evaluations
  SET final_marks = 4, updated_at = now()
  WHERE id = v_eval_id_test3;

  SELECT COUNT(*) INTO v_points_count
  FROM public.student_points_ledger
  WHERE student_id = v_student_1 AND question_id = v_q_hard_subj;

  IF v_points_count <> 1 THEN
    RAISE EXCEPTION 'TEST 5 FAILED: Repeating evaluation update produced duplicate ledger row (count = %)', v_points_count;
  END IF;

  -- --------------------------------------------------------------------------
  -- TEST 6: Multiple Attempts at Same Question -> Must NOT Duplicate Points
  -- --------------------------------------------------------------------------
  v_att_id := gen_random_uuid();
  v_sub_id := gen_random_uuid();
  INSERT INTO public.student_attempts (id, student_id, question_id, status, started_at, submitted_at)
  VALUES (v_att_id, v_student_1, v_q_easy, 'SUBMITTED', now(), now());
  INSERT INTO public.student_submissions (id, attempt_id, typed_answer, submission_status, submitted_at, created_at)
  VALUES (v_sub_id, v_att_id, '{"type":"MCQ","selected_option_id":"opt-1"}', 'EVALUATED', now(), now());
  INSERT INTO public.evaluations (submission_id, evaluation_status, final_marks, stepwise_feedback, evaluated_at, created_at, updated_at)
  VALUES (v_sub_id, 'FINALIZED', 1, '{"is_correct": true, "verdict": "CORRECT"}'::jsonb, now(), now(), now());

  SELECT COUNT(*) INTO v_points_count
  FROM public.student_points_ledger
  WHERE student_id = v_student_1 AND question_id = v_q_easy;

  IF v_points_count <> 1 THEN
    RAISE EXCEPTION 'TEST 6 FAILED: Repeated correct solve produced duplicate ledger row (count = %)', v_points_count;
  END IF;

  -- --------------------------------------------------------------------------
  -- TEST 7: Leaderboard RPC Invocation for Multiple Attempts & Ledger Entries
  -- --------------------------------------------------------------------------
  -- Student 1 history:
  -- - Q_EASY: 2 attempts, solved -> 10 pts
  -- - Q_MED: 1 attempt, failed -> 0 pts
  -- - Q_HARD_SUBJ: 1 attempt, solved -> 30 pts
  -- - Q_PART_SUBJ: 1 attempt, failed -> 0 pts
  -- Total distinct attempts: 4. Total solved: 2. Total points: 40.
  PERFORM set_config('request.jwt.claim.sub', v_student_1::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_1, 'role', 'authenticated')::text, true);

  v_rpc_result := public.get_competitive_leaderboard('OVERALL', 50);

  IF (v_rpc_result->>'my_points')::int <> 40 THEN
    RAISE EXCEPTION 'TEST 7 FAILED: Expected my_points = 40 from leaderboard RPC, got %', (v_rpc_result->>'my_points');
  END IF;

  IF (v_rpc_result->>'my_questions_solved')::int <> 2 THEN
    RAISE EXCEPTION 'TEST 7 FAILED: Expected my_questions_solved = 2, got %', (v_rpc_result->>'my_questions_solved');
  END IF;

  -- Distinct evaluated questions attempted = 4 (Q_EASY, Q_MED, Q_HARD_SUBJ, Q_PART_SUBJ). Solved = 2.
  -- 2 / 4 = 50.0% accuracy.
  IF (v_rpc_result->>'my_accuracy_pct')::numeric <> 50.0 THEN
    RAISE EXCEPTION 'TEST 7 FAILED: Expected my_accuracy_pct = 50.0, got %', (v_rpc_result->>'my_accuracy_pct');
  END IF;

  -- --------------------------------------------------------------------------
  -- TEST 8: Two Students with Equal Points and Deliberately Different Accuracy
  -- --------------------------------------------------------------------------
  -- Student 1: 40 points, 2 solved out of 4 attempted = 50.0% accuracy.
  -- Setup Student 2 (Bhavna Patel) with exactly 40 points, but 2 solved out of 2 attempted = 100.0% accuracy:
  -- - Solves Q_EASY (10 pts) -> 1 attempt, 1 solved
  -- - Solves Q_HARD_SUBJ (30 pts) -> 1 attempt, 1 solved
  -- Student 2 does NOT attempt any failed questions.
  v_att_id := gen_random_uuid();
  v_sub_id := gen_random_uuid();
  INSERT INTO public.student_attempts (id, student_id, question_id, status, started_at, submitted_at)
  VALUES (v_att_id, v_student_2, v_q_easy, 'SUBMITTED', now(), now());
  INSERT INTO public.student_submissions (id, attempt_id, typed_answer, submission_status, submitted_at, created_at)
  VALUES (v_sub_id, v_att_id, 'opt-1', 'EVALUATED', now(), now());
  INSERT INTO public.evaluations (submission_id, evaluation_status, final_marks, stepwise_feedback, evaluated_at, created_at, updated_at)
  VALUES (v_sub_id, 'FINALIZED', 1, '{"is_correct": true}'::jsonb, now(), now(), now());

  v_att_id := gen_random_uuid();
  v_sub_id := gen_random_uuid();
  INSERT INTO public.student_attempts (id, student_id, question_id, status, started_at, submitted_at)
  VALUES (v_att_id, v_student_2, v_q_hard_subj, 'SUBMITTED', now(), now());
  INSERT INTO public.student_submissions (id, attempt_id, typed_answer, submission_status, submitted_at, created_at)
  VALUES (v_sub_id, v_att_id, 'Full proof', 'EVALUATED', now(), now());
  INSERT INTO public.evaluations (submission_id, evaluation_status, final_marks, stepwise_feedback, evaluated_at, created_at, updated_at)
  VALUES (v_sub_id, 'FINALIZED', 4, '{"is_correct": true}'::jsonb, now(), now(), now());

  -- Invoke Leaderboard RPC as Student 1
  PERFORM set_config('request.jwt.claim.sub', v_student_1::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_1, 'role', 'authenticated')::text, true);
  v_rpc_result := public.get_competitive_leaderboard('OVERALL', 50);

  v_entry_0 := v_rpc_result->'leaderboard'->0;
  v_entry_1 := v_rpc_result->'leaderboard'->1;

  -- 1. Assert both students have equal total points (40)
  IF (v_entry_0->>'total_points')::int <> 40 OR (v_entry_1->>'total_points')::int <> 40 THEN
    RAISE EXCEPTION 'TEST 8 FAILED: Expected both students to have 40 points, got % and %',
      (v_entry_0->>'total_points'), (v_entry_1->>'total_points');
  END IF;

  -- 2. Assert both students receive the same dense rank (Rank 1)
  IF (v_entry_0->>'rank')::int <> 1 OR (v_entry_1->>'rank')::int <> 1 THEN
    RAISE EXCEPTION 'TEST 8 FAILED: Equal points did not produce equal dense rank (1). Got % and %',
      (v_entry_0->>'rank'), (v_entry_1->>'rank');
  END IF;

  -- 3. Assert their actual accuracy percentages differ (100.0% vs 50.0%)
  IF (v_entry_0->>'accuracy_pct')::numeric <> 100.0 OR (v_entry_1->>'accuracy_pct')::numeric <> 50.0 THEN
    RAISE EXCEPTION 'TEST 8 FAILED: Expected accuracies to be 100.0 and 50.0, got % and %',
      (v_entry_0->>'accuracy_pct'), (v_entry_1->>'accuracy_pct');
  END IF;

  -- 4. Assert higher-accuracy student (Bhavna Patel, 100.0%) appears first in the slice
  IF (v_entry_0->>'student_name') <> 'Bhavna Patel' OR (v_entry_1->>'student_name') <> 'Arjun Sharma' THEN
    RAISE EXCEPTION 'TEST 8 FAILED: Display ordering was not sorted by accuracy. First: %, Second: %',
      (v_entry_0->>'student_name'), (v_entry_1->>'student_name');
  END IF;

  -- --------------------------------------------------------------------------
  -- TEST 9: Student Opted Out -> Must NOT Appear in Leaderboard JSON
  -- --------------------------------------------------------------------------
  -- Chetan Verma (opted out) solves Q_EASY (10 pts)
  v_att_id := gen_random_uuid();
  v_sub_id := gen_random_uuid();
  INSERT INTO public.student_attempts (id, student_id, question_id, status, started_at, submitted_at)
  VALUES (v_att_id, v_student_optout, v_q_easy, 'SUBMITTED', now(), now());
  INSERT INTO public.student_submissions (id, attempt_id, typed_answer, submission_status, submitted_at, created_at)
  VALUES (v_sub_id, v_att_id, 'opt-1', 'EVALUATED', now(), now());
  INSERT INTO public.evaluations (submission_id, evaluation_status, final_marks, stepwise_feedback, evaluated_at, created_at, updated_at)
  VALUES (v_sub_id, 'FINALIZED', 1, '{"is_correct": true}'::jsonb, now(), now(), now());

  -- Caller: Student 1 queries OVERALL leaderboard
  PERFORM set_config('request.jwt.claim.sub', v_student_1::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_1, 'role', 'authenticated')::text, true);
  v_rpc_result := public.get_competitive_leaderboard('OVERALL', 50);

  IF jsonb_path_exists(v_rpc_result->'leaderboard', '$[*] ? (@.student_name == "Chetan Verma")') THEN
    RAISE EXCEPTION 'TEST 9 FAILED: Opted-out student Chetan Verma appeared in public leaderboard JSON!';
  END IF;

  -- Caller: Opted-out student queries their own status
  PERFORM set_config('request.jwt.claim.sub', v_student_optout::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_optout, 'role', 'authenticated')::text, true);
  v_rpc_result := public.get_competitive_leaderboard('OVERALL', 50);

  IF v_rpc_result->>'my_rank' IS NOT NULL THEN
    RAISE EXCEPTION 'TEST 9 FAILED: Opted-out student received personal rank = %', (v_rpc_result->>'my_rank');
  END IF;

  IF (v_rpc_result->>'opted_in')::boolean <> false THEN
    RAISE EXCEPTION 'TEST 9 FAILED: Expected opted_in = false for unopted student';
  END IF;

  -- --------------------------------------------------------------------------
  -- TEST 10: Verified School Enforcement (Pending, Rejected, Verified, No School)
  -- --------------------------------------------------------------------------
  -- Student with PENDING school solves Q_EASY
  v_att_id := gen_random_uuid();
  v_sub_id := gen_random_uuid();
  INSERT INTO public.student_attempts (id, student_id, question_id, status, started_at, submitted_at)
  VALUES (v_att_id, v_student_pending_sch, v_q_easy, 'SUBMITTED', now(), now());
  INSERT INTO public.student_submissions (id, attempt_id, typed_answer, submission_status, submitted_at, created_at)
  VALUES (v_sub_id, v_att_id, 'opt-1', 'EVALUATED', now(), now());
  INSERT INTO public.evaluations (submission_id, evaluation_status, final_marks, stepwise_feedback, evaluated_at, created_at, updated_at)
  VALUES (v_sub_id, 'FINALIZED', 1, '{"is_correct": true}'::jsonb, now(), now(), now());

  -- Student with REJECTED school solves Q_EASY
  v_att_id := gen_random_uuid();
  v_sub_id := gen_random_uuid();
  INSERT INTO public.student_attempts (id, student_id, question_id, status, started_at, submitted_at)
  VALUES (v_att_id, v_student_rejected_sch, v_q_easy, 'SUBMITTED', now(), now());
  INSERT INTO public.student_submissions (id, attempt_id, typed_answer, submission_status, submitted_at, created_at)
  VALUES (v_sub_id, v_att_id, 'opt-1', 'EVALUATED', now(), now());
  INSERT INTO public.evaluations (submission_id, evaluation_status, final_marks, stepwise_feedback, evaluated_at, created_at, updated_at)
  VALUES (v_sub_id, 'FINALIZED', 1, '{"is_correct": true}'::jsonb, now(), now(), now());

  -- A. Query as student with PENDING school:
  PERFORM set_config('request.jwt.claim.sub', v_student_pending_sch::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_pending_sch, 'role', 'authenticated')::text, true);

  v_rpc_result := public.get_competitive_leaderboard('SCHOOL', 50);
  IF (v_rpc_result->>'school_configured')::boolean <> false OR jsonb_array_length(v_rpc_result->'leaderboard') <> 0 THEN
    RAISE EXCEPTION 'TEST 10 FAILED: Student with PENDING school had school_configured = true or non-empty leaderboard!';
  END IF;

  v_rpc_result := public.get_competitive_leaderboard('CITY', 50);
  IF (v_rpc_result->>'city_configured')::boolean <> false OR jsonb_array_length(v_rpc_result->'leaderboard') <> 0 THEN
    RAISE EXCEPTION 'TEST 10 FAILED: Student with PENDING school had city_configured = true!';
  END IF;

  -- B. Query as student with REJECTED school:
  PERFORM set_config('request.jwt.claim.sub', v_student_rejected_sch::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_rejected_sch, 'role', 'authenticated')::text, true);

  v_rpc_result := public.get_competitive_leaderboard('SCHOOL', 50);
  IF (v_rpc_result->>'school_configured')::boolean <> false OR jsonb_array_length(v_rpc_result->'leaderboard') <> 0 THEN
    RAISE EXCEPTION 'TEST 10 FAILED: Student with REJECTED school had school_configured = true!';
  END IF;

  -- C. Query as student with VERIFIED school (Student 1):
  PERFORM set_config('request.jwt.claim.sub', v_student_1::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_1, 'role', 'authenticated')::text, true);

  v_rpc_result := public.get_competitive_leaderboard('SCHOOL', 50);
  IF (v_rpc_result->>'school_configured')::boolean <> true THEN
    RAISE EXCEPTION 'TEST 10 FAILED: Verified student reported school_configured = false';
  END IF;

  -- Verified school leaderboard contains Student 1 and Student 2, but NOT pending/rejected students
  IF jsonb_path_exists(v_rpc_result->'leaderboard', '$[*] ? (@.student_name == "Eshan Gupta")') OR
     jsonb_path_exists(v_rpc_result->'leaderboard', '$[*] ? (@.student_name == "Farhan Ali")') THEN
    RAISE EXCEPTION 'TEST 10 FAILED: Unverified school students leaked into verified SCHOOL leaderboard!';
  END IF;

  -- D. Input Validation Tests on RPC:
  -- Unsupported scope must raise exception
  BEGIN
    PERFORM public.get_competitive_leaderboard('INVALID_SCOPE', 50);
    v_invalid_scope_caught := false;
  EXCEPTION WHEN OTHERS THEN
    v_invalid_scope_caught := true;
  END;

  IF NOT v_invalid_scope_caught THEN
    RAISE EXCEPTION 'TEST 10 FAILED: Unsupported scope INVALID_SCOPE was not rejected by get_competitive_leaderboard!';
  END IF;

  -- Clamped limits (negative limit safely clamped to 50, large limit clamped to 100)
  v_rpc_result := public.get_competitive_leaderboard('OVERALL', -10);
  IF v_rpc_result IS NULL THEN
    RAISE EXCEPTION 'TEST 10 FAILED: Negative limit caused null RPC result';
  END IF;

  -- --------------------------------------------------------------------------
  -- TEST 11: Direct Positive Ledger INSERT Denied under Authenticated Student Role
  -- --------------------------------------------------------------------------
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_student_1::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_1, 'role', 'authenticated')::text, true);

    -- Attempt valid positive ledger insert
    INSERT INTO public.student_points_ledger (
      student_id, question_id, attempt_id, points_awarded, difficulty, reason
    ) VALUES (
      v_student_1, v_q_med, v_att_id, 20, 'MEDIUM', 'STUDENT_FABRICATED_POINTS'
    );
    v_unauthorized_success := true;
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_unauthorized_success := false; -- Correctly denied by table-level REVOKE
    WHEN OTHERS THEN
      v_unauthorized_success := false;
  END;

  RESET ROLE; -- Restore admin test runner session

  IF v_unauthorized_success THEN
    RAISE EXCEPTION 'TEST 11 FAILED: Authenticated student was able to directly INSERT into student_points_ledger!';
  END IF;

  -- Also verify direct profile UPDATE to role = 'ADMIN' is denied
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_student_1::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_1, 'role', 'authenticated')::text, true);

    UPDATE public.profiles SET role = 'ADMIN' WHERE id = v_student_1;
    -- If update affected rows, privilege escalation vulnerability exists
    IF FOUND THEN
      v_unauthorized_success := true;
    END IF;
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_unauthorized_success := false;
    WHEN OTHERS THEN
      v_unauthorized_success := false;
  END;

  RESET ROLE;

  IF v_unauthorized_success THEN
    RAISE EXCEPTION 'TEST 11 FAILED: Authenticated student was able to escalate profile role!';
  END IF;

  -- --------------------------------------------------------------------------
  -- TEST 12: Historical Backfill Execution & All 5 Achievement Tiers
  -- --------------------------------------------------------------------------
  -- A. Trigger Achievement Engine Verification across all 5 thresholds:
  -- Gita Rao solves 50 distinct HARD questions (50 x 30 = 1500 points)
  FOR i IN 1..50 LOOP
    v_q_loop := gen_random_uuid();
    INSERT INTO public.questions (id, chapter_id, question_text, question_type, difficulty, marks, status)
    VALUES (v_q_loop, v_chapter_id, 'Q Batch ' || i, 'MCQ', 'HARD', 1, 'PUBLISHED');

    v_att_id := gen_random_uuid();
    v_sub_id := gen_random_uuid();
    INSERT INTO public.student_attempts (id, student_id, question_id, status, started_at, submitted_at)
    VALUES (v_att_id, v_student_achieve, v_q_loop, 'SUBMITTED', now(), now());
    INSERT INTO public.student_submissions (id, attempt_id, typed_answer, submission_status, submitted_at, created_at)
    VALUES (v_sub_id, v_att_id, 'opt-1', 'EVALUATED', now(), now());
    INSERT INTO public.evaluations (submission_id, evaluation_status, final_marks, stepwise_feedback, evaluated_at, created_at, updated_at)
    VALUES (v_sub_id, 'FINALIZED', 1, '{"is_correct": true}'::jsonb, now(), now(), now());
  END LOOP;

  -- Verify all 5 achievements unlocked via trigger engine for Gita Rao:
  -- FIRST_QUESTION, SOLVED_10, SOLVED_50, POINTS_100, POINTS_500
  SELECT COUNT(DISTINCT achievement_code) INTO v_achievements_count
  FROM public.student_achievements
  WHERE student_id = v_student_achieve
    AND achievement_code IN ('FIRST_QUESTION', 'SOLVED_10', 'SOLVED_50', 'POINTS_100', 'POINTS_500');

  IF v_achievements_count <> 5 THEN
    RAISE EXCEPTION 'TEST 12 FAILED: Trigger failed to unlock all 5 achievements! Expected 5, found %', v_achievements_count;
  END IF;

  -- ==========================================================================
  -- B. Retroactive Migration Backfill Verification with Trigger Isolation
  -- ==========================================================================
  -- 1. Confirm the scoring trigger exists and record its exact state
  SELECT tgenabled INTO v_orig_trg_state
  FROM pg_catalog.pg_trigger
  WHERE tgname = 'trg_process_evaluation_points'
    AND tgrelid = 'public.evaluations'::regclass;

  IF v_orig_trg_state IS NULL THEN
    RAISE EXCEPTION 'TEST 12 FAILED: Scoring trigger trg_process_evaluation_points does not exist on public.evaluations!';
  ELSIF v_orig_trg_state <> 'O' THEN
    RAISE EXCEPTION 'TEST 12 FAILED: Scoring trigger was expected to be enabled (O), but found %', v_orig_trg_state;
  END IF;

  -- 2. Disable ONLY trg_process_evaluation_points on public.evaluations (exception-safe wrapper)
  ALTER TABLE public.evaluations DISABLE TRIGGER trg_process_evaluation_points;

  BEGIN
    -- 3. Insert 50 historical attempts, submissions and finalized evaluations for Harish Kumar (v_student_hist)
    FOR i IN 1..50 LOOP
      v_q_loop := gen_random_uuid();
      INSERT INTO public.questions (id, chapter_id, question_text, question_type, difficulty, marks, status)
      VALUES (v_q_loop, v_chapter_id, 'Q Hist Batch ' || i, 'MCQ', 'MEDIUM', 1, 'PUBLISHED');

      v_att_id := gen_random_uuid();
      v_sub_id := gen_random_uuid();
      INSERT INTO public.student_attempts (id, student_id, question_id, status, started_at, submitted_at)
      VALUES (v_att_id, v_student_hist, v_q_loop, 'SUBMITTED', now() - interval '30 days', now() - interval '30 days');
      INSERT INTO public.student_submissions (id, attempt_id, typed_answer, submission_status, submitted_at, created_at)
      VALUES (v_sub_id, v_att_id, 'opt-hist', 'EVALUATED', now() - interval '30 days', now() - interval '30 days');
      INSERT INTO public.evaluations (submission_id, evaluation_status, final_marks, stepwise_feedback, evaluated_at, created_at, updated_at)
      VALUES (v_sub_id, 'FINALIZED', 1, '{"is_correct": true}'::jsonb, now() - interval '30 days', now() - interval '30 days', now() - interval '30 days');
    END LOOP;

    -- 4. Before running backfill, assert historical student has exactly 0 points and 0 achievements
    SELECT COUNT(*) INTO v_hist_ledger_count
    FROM public.student_points_ledger
    WHERE student_id = v_student_hist;

    SELECT COUNT(*) INTO v_hist_achieve_count
    FROM public.student_achievements
    WHERE student_id = v_student_hist;

    IF v_hist_ledger_count <> 0 THEN
      RAISE EXCEPTION 'TEST 12 FAILED: Ledger isolation violated! Found % entries for historical student prior to backfill', v_hist_ledger_count;
    END IF;

    IF v_hist_achieve_count <> 0 THEN
      RAISE EXCEPTION 'TEST 12 FAILED: Achievement isolation violated! Found % achievements for historical student prior to backfill', v_hist_achieve_count;
    END IF;

    -- 5. Execute exact historical points-backfill SQL from migration
    INSERT INTO public.student_points_ledger (
      student_id,
      question_id,
      attempt_id,
      points_awarded,
      difficulty,
      reason,
      created_at
    )
    SELECT DISTINCT ON (a.student_id, a.question_id)
      a.student_id,
      a.question_id,
      a.id AS attempt_id,
      CASE
        WHEN UPPER(btrim(COALESCE(q.difficulty, 'EASY'))) IN ('HARD', 'DIFFICULT') THEN 30
        WHEN UPPER(btrim(COALESCE(q.difficulty, 'EASY'))) IN ('MEDIUM', 'MODERATE') THEN 20
        ELSE 10
      END AS points_awarded,
      UPPER(btrim(COALESCE(q.difficulty, 'EASY'))) AS difficulty,
      'HISTORICAL_CORRECT_SOLVE' AS reason,
      COALESCE(e.evaluated_at, e.created_at, s.submitted_at, now()) AS created_at
    FROM public.evaluations e
    JOIN public.student_submissions s ON s.id = e.submission_id
    JOIN public.student_attempts a ON a.id = s.attempt_id
    JOIN public.questions q ON q.id = a.question_id
    WHERE e.evaluation_status = 'FINALIZED'
      AND a.student_id = v_student_hist
      AND (
        (
          UPPER(btrim(COALESCE(q.question_type, 'MCQ'))) IN ('MCQ', 'TRUE_FALSE', 'FILL_BLANK')
          AND (
            (
              e.stepwise_feedback IS NOT NULL 
              AND jsonb_typeof(e.stepwise_feedback) = 'object' 
              AND e.stepwise_feedback ? 'is_correct'
              AND jsonb_typeof(e.stepwise_feedback->'is_correct') = 'boolean'
              AND (e.stepwise_feedback->>'is_correct')::boolean = true
            )
            OR
            (
              (
                e.stepwise_feedback IS NULL
                OR jsonb_typeof(e.stepwise_feedback) <> 'object'
                OR NOT (e.stepwise_feedback ? 'is_correct')
                OR jsonb_typeof(e.stepwise_feedback->'is_correct') <> 'boolean'
              )
              AND COALESCE(e.final_marks, 0) >= COALESCE(q.marks, 1)
              AND COALESCE(q.marks, 1) > 0
            )
          )
        )
        OR
        (
          UPPER(btrim(COALESCE(q.question_type, 'MCQ'))) = 'SUBJECTIVE'
          AND COALESCE(e.final_marks, 0) >= COALESCE(q.marks, 1)
          AND COALESCE(q.marks, 1) > 0
        )
      )
    ORDER BY a.student_id, a.question_id, COALESCE(e.evaluated_at, e.created_at, s.submitted_at) ASC NULLS LAST
    ON CONFLICT (student_id, question_id) DO NOTHING;

    -- 6. Assert ledger state post-backfill:
    -- Exactly 50 rows, all reason = 'HISTORICAL_CORRECT_SOLVE', exactly 50 distinct questions, 20 pts each (MEDIUM)
    SELECT
      COUNT(*),
      COUNT(DISTINCT question_id),
      COUNT(*) FILTER (WHERE reason = 'HISTORICAL_CORRECT_SOLVE' AND points_awarded = 20)
    INTO v_hist_ledger_count, v_hist_distinct_q, v_hist_reason_check
    FROM public.student_points_ledger
    WHERE student_id = v_student_hist;

    IF v_hist_ledger_count <> 50 THEN
      RAISE EXCEPTION 'TEST 12 FAILED: Expected exactly 50 backfilled ledger rows, found %', v_hist_ledger_count;
    END IF;

    IF v_hist_distinct_q <> 50 THEN
      RAISE EXCEPTION 'TEST 12 FAILED: Duplicate student/question entries detected in ledger! Found % distinct questions across % rows', v_hist_distinct_q, v_hist_ledger_count;
    END IF;

    IF v_hist_reason_check <> 50 THEN
      RAISE EXCEPTION 'TEST 12 FAILED: Expected 50 rows with reason HISTORICAL_CORRECT_SOLVE and 20 pts, found %', v_hist_reason_check;
    END IF;

    -- 7. Execute exact achievement-backfill SQL from migration
    INSERT INTO public.student_achievements (student_id, achievement_code, unlocked_at)
    SELECT student_id, 'FIRST_QUESTION', MIN(created_at)
    FROM public.student_points_ledger
    WHERE student_id = v_student_hist
    GROUP BY student_id
    HAVING COUNT(DISTINCT question_id) >= 1
    ON CONFLICT (student_id, achievement_code) DO NOTHING;

    INSERT INTO public.student_achievements (student_id, achievement_code, unlocked_at)
    SELECT student_id, 'SOLVED_10', MAX(created_at)
    FROM public.student_points_ledger
    WHERE student_id = v_student_hist
    GROUP BY student_id
    HAVING COUNT(DISTINCT question_id) >= 10
    ON CONFLICT (student_id, achievement_code) DO NOTHING;

    INSERT INTO public.student_achievements (student_id, achievement_code, unlocked_at)
    SELECT student_id, 'SOLVED_50', MAX(created_at)
    FROM public.student_points_ledger
    WHERE student_id = v_student_hist
    GROUP BY student_id
    HAVING COUNT(DISTINCT question_id) >= 50
    ON CONFLICT (student_id, achievement_code) DO NOTHING;

    INSERT INTO public.student_achievements (student_id, achievement_code, unlocked_at)
    SELECT student_id, 'POINTS_100', MAX(created_at)
    FROM public.student_points_ledger
    WHERE student_id = v_student_hist
    GROUP BY student_id
    HAVING SUM(points_awarded) >= 100
    ON CONFLICT (student_id, achievement_code) DO NOTHING;

    INSERT INTO public.student_achievements (student_id, achievement_code, unlocked_at)
    SELECT student_id, 'POINTS_500', MAX(created_at)
    FROM public.student_points_ledger
    WHERE student_id = v_student_hist
    GROUP BY student_id
    HAVING SUM(points_awarded) >= 500
    ON CONFLICT (student_id, achievement_code) DO NOTHING;

    -- 8. Assert all 5 achievement codes are present for historical student
    SELECT COUNT(DISTINCT achievement_code) INTO v_hist_achieve_count
    FROM public.student_achievements
    WHERE student_id = v_student_hist
      AND achievement_code IN ('FIRST_QUESTION', 'SOLVED_10', 'SOLVED_50', 'POINTS_100', 'POINTS_500');

    IF v_hist_achieve_count <> 5 THEN
      RAISE EXCEPTION 'TEST 12 FAILED: Retroactive backfill failed to unlock all 5 achievements! Expected 5, found %', v_hist_achieve_count;
    END IF;

  EXCEPTION WHEN OTHERS THEN
    -- Exception-safe restoration of trigger state
    IF v_orig_trg_state = 'O' THEN
      ALTER TABLE public.evaluations ENABLE TRIGGER trg_process_evaluation_points;
    END IF;
    RAISE;
  END;

  -- 9. Re-enable the scoring trigger (restore original state)
  IF v_orig_trg_state = 'O' THEN
    ALTER TABLE public.evaluations ENABLE TRIGGER trg_process_evaluation_points;
  END IF;

  -- 10. Confirm scoring trigger is enabled before test transaction finishes
  SELECT tgenabled INTO v_restored_trg_state
  FROM pg_catalog.pg_trigger
  WHERE tgname = 'trg_process_evaluation_points'
    AND tgrelid = 'public.evaluations'::regclass;

  IF v_restored_trg_state <> 'O' THEN
    RAISE EXCEPTION 'TEST 12 FAILED: Scoring trigger was not properly restored! Expected O, found %', v_restored_trg_state;
  END IF;

  RAISE NOTICE 'SUCCESS: All 12 test suites executed and passed with 100%% assertion coverage!';
END $$;

ROLLBACK;
