-- ============================================================================
-- AuraMentor Competitive Dashboard Migration (Phase 2 - Production Security Specification)
-- File: supabase/migrations/20261117_competitive_dashboard.sql
--
-- Security & Integrity Hardening:
--   1. School Governance: Seeded illustrative schools default strictly to PENDING (is_verified = false).
--      No automated upgrade to VERIFIED via ON CONFLICT.
--      Administrative verification restricted exclusively to public.verify_school RPC (role = 'ADMIN').
--   2. Profile Protection: Direct client UPDATE on public.profiles is denied.
--      Profile updates for competitive preferences (opt-in and school selection)
--      are restricted to public.set_student_competitive_profile RPC, which validates that the
--      selected institution is verified and prevents modification of role or other columns.
--   3. RPC Input Validation: get_competitive_leaderboard explicitly rejects unsupported scopes
--      and clamps p_limit to [1, 100].
--   4. Verified School Enforcement: school_configured and city_configured require caller's school
--      to be actively VERIFIED. Students attached to unverified/pending/rejected schools
--      cannot form or enter school/city cohorts.
--   5. Correctness Alignment: Trigger, historical backfill, and leaderboard CTE use identical
--      safe evaluation rules, verifying jsonb_typeof before casting.
--   6. All 5 achievement tiers backfilled (FIRST_QUESTION, SOLVED_10, SOLVED_50, POINTS_100, POINTS_500).
--   7. Client writes to schools, ledger, and achievements are revoked at table level.
-- ============================================================================

BEGIN;

-- 1. Verified Schools Registry ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  board text NOT NULL DEFAULT 'CBSE',
  verification_status text NOT NULL DEFAULT 'PENDING'
    CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED')),
  is_verified boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_school_name_city UNIQUE (name, city),
  CONSTRAINT chk_school_verification_sync CHECK (
    (verification_status = 'VERIFIED' AND is_verified = true) OR
    (verification_status <> 'VERIFIED' AND is_verified = false)
  )
);

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;

-- Authenticated students and teachers can ONLY view institutions verified by an administrator
DROP POLICY IF EXISTS "Anyone authenticated can view verified schools" ON public.schools;
CREATE POLICY "Anyone authenticated can view verified schools"
  ON public.schools FOR SELECT
  TO authenticated
  USING (is_verified = true AND verification_status = 'VERIFIED');

-- Seed illustrative benchmark CBSE schools marked strictly as PENDING (not auto-verified)
INSERT INTO public.schools (name, city, state, board, is_verified, verification_status, verified_at, verified_by)
VALUES
  ('Delhi Public School, R.K. Puram', 'New Delhi', 'Delhi', 'CBSE', false, 'PENDING', NULL, NULL),
  ('Delhi Public School, Vasant Kunj', 'New Delhi', 'Delhi', 'CBSE', false, 'PENDING', NULL, NULL),
  ('Sardar Patel Vidyalaya', 'New Delhi', 'Delhi', 'CBSE', false, 'PENDING', NULL, NULL),
  ('The Mother''s International School', 'New Delhi', 'Delhi', 'CBSE', false, 'PENDING', NULL, NULL),
  ('National Public School, Indiranagar', 'Bengaluru', 'Karnataka', 'CBSE', false, 'PENDING', NULL, NULL),
  ('National Public School, Koramangala', 'Bengaluru', 'Karnataka', 'CBSE', false, 'PENDING', NULL, NULL),
  ('Delhi Public School, Bangalore South', 'Bengaluru', 'Karnataka', 'CBSE', false, 'PENDING', NULL, NULL),
  ('DAV Boys Senior Secondary School, Gopalapuram', 'Chennai', 'Tamil Nadu', 'CBSE', false, 'PENDING', NULL, NULL),
  ('Padma Seshadri Bala Bhavan (PSBB)', 'Chennai', 'Tamil Nadu', 'CBSE', false, 'PENDING', NULL, NULL),
  ('The Cathedral & John Connon School', 'Mumbai', 'Maharashtra', 'CBSE', false, 'PENDING', NULL, NULL),
  ('RN Podar School, Santacruz', 'Mumbai', 'Maharashtra', 'CBSE', false, 'PENDING', NULL, NULL),
  ('Delhi Public School, Nerul', 'Navi Mumbai', 'Maharashtra', 'CBSE', false, 'PENDING', NULL, NULL),
  ('Hyderabad Public School, Begumpet', 'Hyderabad', 'Telangana', 'CBSE', false, 'PENDING', NULL, NULL),
  ('Delhi Public School, Hyderabad', 'Hyderabad', 'Telangana', 'CBSE', false, 'PENDING', NULL, NULL),
  ('The Sanskaar Valley School', 'Bhopal', 'Madhya Pradesh', 'CBSE', false, 'PENDING', NULL, NULL),
  ('Delhi Public School, Ruby Park', 'Kolkata', 'West Bengal', 'CBSE', false, 'PENDING', NULL, NULL),
  ('South Point High School', 'Kolkata', 'West Bengal', 'CBSE', false, 'PENDING', NULL, NULL),
  ('City Montessori School, Gomti Nagar', 'Lucknow', 'Uttar Pradesh', 'CBSE', false, 'PENDING', NULL, NULL),
  ('Delhi Public School, Gomti Nagar', 'Lucknow', 'Uttar Pradesh', 'CBSE', false, 'PENDING', NULL, NULL),
  ('St. Xavier''s Senior Secondary School', 'Jaipur', 'Rajasthan', 'CBSE', false, 'PENDING', NULL, NULL),
  ('Step by Step School', 'Noida', 'Uttar Pradesh', 'CBSE', false, 'PENDING', NULL, NULL),
  ('Lotus Valley International School', 'Noida', 'Uttar Pradesh', 'CBSE', false, 'PENDING', NULL, NULL),
  ('The Shri Ram School, Aravali', 'Gurugram', 'Haryana', 'CBSE', false, 'PENDING', NULL, NULL),
  ('Delhi Public School, Sector 45', 'Gurugram', 'Haryana', 'CBSE', false, 'PENDING', NULL, NULL),
  ('Bhavan Vidyalaya', 'Chandigarh', 'Chandigarh', 'CBSE', false, 'PENDING', NULL, NULL)
ON CONFLICT (name, city) DO NOTHING;

-- 2. Administrator-Only School Verification Operation ------------------------
CREATE OR REPLACE FUNCTION public.verify_school(
  p_school_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role text;
  v_target_status text;
  v_school record;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  -- Verify administrative authorization strictly from public.profiles
  SELECT role INTO v_caller_role
  FROM public.profiles
  WHERE id = v_caller_id;

  IF v_caller_role IS NULL OR UPPER(btrim(v_caller_role)) <> 'ADMIN' THEN
    RAISE EXCEPTION 'Access denied: Only administrators can verify institutions.';
  END IF;

  v_target_status := UPPER(btrim(COALESCE(p_status, '')));
  IF v_target_status NOT IN ('VERIFIED', 'REJECTED', 'PENDING') THEN
    RAISE EXCEPTION 'Invalid status: %. Must be VERIFIED, REJECTED, or PENDING.', p_status;
  END IF;

  UPDATE public.schools
  SET
    verification_status = v_target_status,
    is_verified = (v_target_status = 'VERIFIED'),
    verified_at = CASE WHEN v_target_status = 'VERIFIED' THEN now() ELSE NULL END,
    verified_by = CASE WHEN v_target_status = 'VERIFIED' THEN v_caller_id ELSE NULL END
  WHERE id = p_school_id
  RETURNING id, name, city, verification_status, is_verified, verified_at, verified_by
  INTO v_school;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'School not found with id %', p_school_id;
  END IF;

  RETURN jsonb_build_object(
    'school_id', v_school.id,
    'name', v_school.name,
    'city', v_school.city,
    'verification_status', v_school.verification_status,
    'is_verified', v_school.is_verified,
    'verified_at', v_school.verified_at,
    'verified_by', v_school.verified_by
  );
END;
$$;

-- 3. Extend Profiles with Verified School & Explicit Consent ------------------
-- Note: No broad client UPDATE policy is added to public.profiles.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS competitive_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS class_grade text NOT NULL DEFAULT 'Class 10';

CREATE INDEX IF NOT EXISTS idx_profiles_school_id ON public.profiles(school_id);
CREATE INDEX IF NOT EXISTS idx_profiles_competitive_opt_in ON public.profiles(competitive_opt_in);

-- Scoped student profile update routine: allows student to update ONLY their competitive preferences
-- and prevents students from changing role, email, or assigning unverified schools.
CREATE OR REPLACE FUNCTION public.set_student_competitive_profile(
  p_competitive_opt_in boolean,
  p_school_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid;
  v_role text;
  v_school_verified boolean;
  v_school_name text;
  v_school_city text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = v_uid;

  IF v_role IS NULL OR UPPER(btrim(v_role)) <> 'STUDENT' THEN
    RAISE EXCEPTION 'Access denied: Only students can update competitive preferences.';
  END IF;

  -- If school_id is provided, enforce that it exists and is strictly VERIFIED
  IF p_school_id IS NOT NULL THEN
    SELECT is_verified, name, city
    INTO v_school_verified, v_school_name, v_school_city
    FROM public.schools
    WHERE id = p_school_id AND verification_status = 'VERIFIED' AND is_verified = true;

    IF NOT FOUND OR v_school_verified <> true THEN
      RAISE EXCEPTION 'Selected school is not a verified institution.';
    END IF;
  END IF;

  UPDATE public.profiles
  SET
    competitive_opt_in = COALESCE(p_competitive_opt_in, false),
    school_id = p_school_id,
    updated_at = now()
  WHERE id = v_uid;

  RETURN jsonb_build_object(
    'student_id', v_uid,
    'competitive_opt_in', COALESCE(p_competitive_opt_in, false),
    'school_id', p_school_id,
    'school_name', v_school_name,
    'city', v_school_city
  );
END;
$$;

-- 4. Auditable Points Ledger --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_points_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL REFERENCES public.student_attempts(id) ON DELETE CASCADE,
  points_awarded int NOT NULL CHECK (points_awarded > 0),
  difficulty text NOT NULL,
  reason text NOT NULL DEFAULT 'FIRST_CORRECT_SOLVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_student_question_points UNIQUE (student_id, question_id)
);

ALTER TABLE public.student_points_ledger ENABLE ROW LEVEL SECURITY;

-- Students can read their own points entries; client writes are strictly blocked
DROP POLICY IF EXISTS "Students can view own points ledger" ON public.student_points_ledger;
CREATE POLICY "Students can view own points ledger"
  ON public.student_points_ledger FOR SELECT
  TO authenticated
  USING (student_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_points_ledger_student ON public.student_points_ledger(student_id);
CREATE INDEX IF NOT EXISTS idx_points_ledger_question ON public.student_points_ledger(question_id);

-- 5. Achievements Registry ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_code text NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_student_achievement UNIQUE (student_id, achievement_code)
);

ALTER TABLE public.student_achievements ENABLE ROW LEVEL SECURITY;

-- Students can read their own achievements; client writes are strictly blocked
DROP POLICY IF EXISTS "Students can view own achievements" ON public.student_achievements;
CREATE POLICY "Students can view own achievements"
  ON public.student_achievements FOR SELECT
  TO authenticated
  USING (student_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_student_achievements_student ON public.student_achievements(student_id);

-- 6. Server-Side Automated Points & Achievements Engine -----------------------
CREATE OR REPLACE FUNCTION public.fn_process_evaluation_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_student_id uuid;
  v_question_id uuid;
  v_attempt_id uuid;
  v_difficulty text;
  v_max_marks numeric;
  v_q_type text;
  v_points int := 10;
  v_is_fully_correct boolean := false;
  v_total_correct int := 0;
  v_total_points int := 0;
BEGIN
  -- Safe validation: evaluate only finalized records
  IF NEW.evaluation_status IS NULL OR NEW.evaluation_status <> 'FINALIZED' THEN
    RETURN NEW;
  END IF;

  -- Trace submission -> attempt -> question relationships
  SELECT s.attempt_id, a.student_id, a.question_id, q.difficulty, q.marks, q.question_type
  INTO v_attempt_id, v_student_id, v_question_id, v_difficulty, v_max_marks, v_q_type
  FROM public.student_submissions s
  JOIN public.student_attempts a ON a.id = s.attempt_id
  JOIN public.questions q ON q.id = a.question_id
  WHERE s.id = NEW.submission_id;

  IF v_student_id IS NULL OR v_question_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Guard against duplicate execution: if question points already exist for this student, exit immediately
  IF EXISTS (
    SELECT 1 FROM public.student_points_ledger
    WHERE student_id = v_student_id AND question_id = v_question_id
  ) THEN
    RETURN NEW;
  END IF;

  -- Determine full correctness strictly by question category
  v_q_type := UPPER(btrim(COALESCE(v_q_type, 'MCQ')));
  v_max_marks := COALESCE(v_max_marks, 1);

  IF v_q_type IN ('MCQ', 'TRUE_FALSE', 'FILL_BLANK') THEN
    -- Objective questions: validate JSON boolean before casting, with safe fallback to marks
    IF NEW.stepwise_feedback IS NOT NULL 
       AND jsonb_typeof(NEW.stepwise_feedback) = 'object'
       AND NEW.stepwise_feedback ? 'is_correct'
       AND jsonb_typeof(NEW.stepwise_feedback->'is_correct') = 'boolean' THEN
      v_is_fully_correct := (NEW.stepwise_feedback->>'is_correct')::boolean;
    ELSE
      v_is_fully_correct := (COALESCE(NEW.final_marks, 0) >= v_max_marks AND v_max_marks > 0);
    END IF;
  ELSE
    -- Subjective questions: full marks are mandatory for competitive points
    v_is_fully_correct := (COALESCE(NEW.final_marks, 0) >= v_max_marks AND v_max_marks > 0);
  END IF;

  IF NOT v_is_fully_correct THEN
    RETURN NEW;
  END IF;

  -- Scoring schedule strictly conforming to questions.difficulty catalog (EASY, MEDIUM, HARD)
  v_difficulty := UPPER(btrim(COALESCE(v_difficulty, 'EASY')));
  IF v_difficulty IN ('HARD', 'DIFFICULT') THEN
    v_points := 30;
  ELSIF v_difficulty IN ('MEDIUM', 'MODERATE') THEN
    v_points := 20;
  ELSE
    v_points := 10;
  END IF;

  -- Atomically insert into points ledger (unique constraint prevents race duplicates)
  INSERT INTO public.student_points_ledger (
    student_id,
    question_id,
    attempt_id,
    points_awarded,
    difficulty,
    reason,
    created_at
  ) VALUES (
    v_student_id,
    v_question_id,
    v_attempt_id,
    v_points,
    v_difficulty,
    'FIRST_CORRECT_SOLVE',
    now()
  ) ON CONFLICT (student_id, question_id) DO NOTHING;

  -- Audit achievements dynamically based on verified ledger
  SELECT count(DISTINCT question_id), COALESCE(sum(points_awarded), 0)
  INTO v_total_correct, v_total_points
  FROM public.student_points_ledger
  WHERE student_id = v_student_id;

  IF v_total_correct >= 1 THEN
    INSERT INTO public.student_achievements (student_id, achievement_code)
    VALUES (v_student_id, 'FIRST_QUESTION')
    ON CONFLICT (student_id, achievement_code) DO NOTHING;
  END IF;

  IF v_total_correct >= 10 THEN
    INSERT INTO public.student_achievements (student_id, achievement_code)
    VALUES (v_student_id, 'SOLVED_10')
    ON CONFLICT (student_id, achievement_code) DO NOTHING;
  END IF;

  IF v_total_correct >= 50 THEN
    INSERT INTO public.student_achievements (student_id, achievement_code)
    VALUES (v_student_id, 'SOLVED_50')
    ON CONFLICT (student_id, achievement_code) DO NOTHING;
  END IF;

  IF v_total_points >= 100 THEN
    INSERT INTO public.student_achievements (student_id, achievement_code)
    VALUES (v_student_id, 'POINTS_100')
    ON CONFLICT (student_id, achievement_code) DO NOTHING;
  END IF;

  IF v_total_points >= 500 THEN
    INSERT INTO public.student_achievements (student_id, achievement_code)
    VALUES (v_student_id, 'POINTS_500')
    ON CONFLICT (student_id, achievement_code) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_process_evaluation_points ON public.evaluations;
CREATE TRIGGER trg_process_evaluation_points
  AFTER INSERT OR UPDATE OF evaluation_status, stepwise_feedback, final_marks
  ON public.evaluations
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_process_evaluation_points();

-- 7. Retroactive Backfill for Verified Historical Solves ---------------------
-- Identical correctness rules applied to historical evaluations
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

-- Backfill all 5 achievement tiers supported by the trigger
INSERT INTO public.student_achievements (student_id, achievement_code, unlocked_at)
SELECT student_id, 'FIRST_QUESTION', MIN(created_at)
FROM public.student_points_ledger
GROUP BY student_id
HAVING COUNT(DISTINCT question_id) >= 1
ON CONFLICT (student_id, achievement_code) DO NOTHING;

INSERT INTO public.student_achievements (student_id, achievement_code, unlocked_at)
SELECT student_id, 'SOLVED_10', MAX(created_at)
FROM public.student_points_ledger
GROUP BY student_id
HAVING COUNT(DISTINCT question_id) >= 10
ON CONFLICT (student_id, achievement_code) DO NOTHING;

INSERT INTO public.student_achievements (student_id, achievement_code, unlocked_at)
SELECT student_id, 'SOLVED_50', MAX(created_at)
FROM public.student_points_ledger
GROUP BY student_id
HAVING COUNT(DISTINCT question_id) >= 50
ON CONFLICT (student_id, achievement_code) DO NOTHING;

INSERT INTO public.student_achievements (student_id, achievement_code, unlocked_at)
SELECT student_id, 'POINTS_100', MAX(created_at)
FROM public.student_points_ledger
GROUP BY student_id
HAVING SUM(points_awarded) >= 100
ON CONFLICT (student_id, achievement_code) DO NOTHING;

INSERT INTO public.student_achievements (student_id, achievement_code, unlocked_at)
SELECT student_id, 'POINTS_500', MAX(created_at)
FROM public.student_points_ledger
GROUP BY student_id
HAVING SUM(points_awarded) >= 500
ON CONFLICT (student_id, achievement_code) DO NOTHING;

-- 8. Secure Leaderboard RPC (Unified Chained CTE Architecture) ----------------
CREATE OR REPLACE FUNCTION public.get_competitive_leaderboard(
  p_scope text DEFAULT 'OVERALL',
  p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid;
  v_my_profile record;
  v_scope text;
  v_limit int;
  v_leaderboard jsonb := '[]'::jsonb;
  v_my_rank int := NULL;
  v_my_points int := 0;
  v_my_solved int := 0;
  v_my_accuracy numeric := 0;
  v_next_rank_points int := NULL;
  v_total_competitors int := 0;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 1. Validate Scope & Limit Inputs
  v_scope := UPPER(btrim(COALESCE(p_scope, '')));
  IF v_scope NOT IN ('OVERALL', 'SCHOOL', 'CITY') THEN
    RAISE EXCEPTION 'Invalid scope: %. Must be OVERALL, SCHOOL, or CITY.', p_scope;
  END IF;

  IF p_limit IS NULL OR p_limit <= 0 THEN
    v_limit := 50;
  ELSIF p_limit > 100 THEN
    v_limit := 100;
  ELSE
    v_limit := p_limit;
  END IF;

  -- 2. Load caller profile requiring active VERIFIED status for school affiliation
  -- Unverified, pending, or rejected schools yield NULL school_id, school_name, and city
  SELECT
    p.id,
    p.full_name,
    s.id AS school_id,
    s.name AS school_name,
    s.city,
    p.competitive_opt_in
  INTO v_my_profile
  FROM public.profiles p
  LEFT JOIN public.schools s
    ON s.id = p.school_id
   AND s.is_verified = true
   AND s.verification_status = 'VERIFIED'
  WHERE p.id = v_uid;

  -- 3. Execute unified ranking aggregation in a single query
  WITH student_points AS (
    SELECT
      student_id,
      SUM(points_awarded)::int AS total_points,
      COUNT(DISTINCT question_id)::int AS questions_solved
    FROM public.student_points_ledger
    GROUP BY student_id
  ),
  student_question_evaluations AS (
    SELECT
      a.student_id,
      a.question_id,
      BOOL_OR(
        CASE
          WHEN UPPER(btrim(COALESCE(q.question_type, 'MCQ'))) IN ('MCQ', 'TRUE_FALSE', 'FILL_BLANK') THEN
            (
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
          WHEN UPPER(btrim(COALESCE(q.question_type, 'MCQ'))) = 'SUBJECTIVE' THEN
            (COALESCE(e.final_marks, 0) >= COALESCE(q.marks, 1) AND COALESCE(q.marks, 1) > 0)
          ELSE false
        END
      ) AS is_question_mastered
    FROM public.student_attempts a
    JOIN public.student_submissions s ON s.attempt_id = a.id
    JOIN public.evaluations e ON e.submission_id = s.id
    JOIN public.questions q ON q.id = a.question_id
    WHERE e.evaluation_status = 'FINALIZED'
    GROUP BY a.student_id, a.question_id
  ),
  student_accuracy AS (
    SELECT
      student_id,
      COUNT(DISTINCT question_id)::int AS total_evaluated_questions,
      COUNT(DISTINCT CASE WHEN is_question_mastered THEN question_id ELSE NULL END)::int AS correct_evaluated_questions
    FROM student_question_evaluations
    GROUP BY student_id
  ),
  eligible_cohort AS (
    SELECT
      p.id AS s_id,
      COALESCE(NULLIF(btrim(p.full_name), ''), 'Student ' || SUBSTRING(p.id::text, 1, 4)) AS student_name,
      sch.name AS school_name,
      sch.city AS city,
      COALESCE(pts.total_points, 0)::int AS total_points,
      COALESCE(pts.questions_solved, 0)::int AS questions_solved,
      ROUND(
        COALESCE(
          (acc.correct_evaluated_questions::numeric / NULLIF(acc.total_evaluated_questions, 0)::numeric) * 100,
          0
        ),
        1
      ) AS accuracy_pct
    FROM public.profiles p
    LEFT JOIN public.schools sch
      ON sch.id = p.school_id
     AND sch.is_verified = true
     AND sch.verification_status = 'VERIFIED'
    LEFT JOIN student_points pts ON pts.student_id = p.id
    LEFT JOIN student_accuracy acc ON acc.student_id = p.id
    WHERE p.role = 'STUDENT'
      AND p.competitive_opt_in = true
      AND (
        v_scope = 'OVERALL'
        OR (v_scope = 'SCHOOL' AND v_my_profile.school_id IS NOT NULL AND p.school_id = v_my_profile.school_id AND sch.id IS NOT NULL)
        OR (v_scope = 'CITY' AND v_my_profile.city IS NOT NULL AND sch.city IS NOT NULL AND LOWER(sch.city) = LOWER(v_my_profile.city) AND sch.id IS NOT NULL)
      )
  ),
  ranked_cohort AS (
    SELECT
      s_id,
      student_name,
      school_name,
      city,
      total_points,
      questions_solved,
      accuracy_pct,
      -- Equal points receive equal rank
      DENSE_RANK() OVER (ORDER BY total_points DESC) AS rank
    FROM eligible_cohort
  ),
  cohort_totals AS (
    -- Population metric evaluated across entire eligible cohort independently of limit
    SELECT COUNT(*)::int AS total_competitor_count FROM ranked_cohort
  ),
  top_leaderboard_slice AS (
    -- Explicit deterministic ordering strictly applied BEFORE LIMIT
    SELECT
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'rank', r.rank,
            'student_name', r.student_name,
            'school_name', r.school_name,
            'city', r.city,
            'total_points', r.total_points,
            'questions_solved', r.questions_solved,
            'accuracy_pct', r.accuracy_pct,
            'is_current_user', (r.s_id = v_uid)
          ) ORDER BY r.rank ASC, r.accuracy_pct DESC, r.questions_solved DESC, r.student_name ASC, r.s_id ASC
        ),
        '[]'::jsonb
      ) AS leaderboard_json
    FROM (
      SELECT *
      FROM ranked_cohort
      ORDER BY rank ASC, accuracy_pct DESC, questions_solved DESC, student_name ASC, s_id ASC
      LIMIT v_limit
    ) r
  ),
  caller_position AS (
    SELECT
      r.rank AS my_rank,
      r.total_points AS my_points,
      r.questions_solved AS my_solved,
      r.accuracy_pct AS my_accuracy
    FROM ranked_cohort r
    WHERE r.s_id = v_uid
  ),
  gap_to_next AS (
    -- Points needed to enter the next higher point tier (rank - 1)
    SELECT
      (MIN(r.total_points) - COALESCE((SELECT my_points FROM caller_position), 0)) AS points_to_next
    FROM ranked_cohort r
    WHERE r.rank = (SELECT my_rank - 1 FROM caller_position)
  )
  SELECT
    tls.leaderboard_json,
    ct.total_competitor_count,
    cp.my_rank,
    COALESCE(cp.my_points, 0),
    COALESCE(cp.my_solved, 0),
    COALESCE(cp.my_accuracy, 0),
    gtn.points_to_next
  INTO
    v_leaderboard,
    v_total_competitors,
    v_my_rank,
    v_my_points,
    v_my_solved,
    v_my_accuracy,
    v_next_rank_points
  FROM cohort_totals ct
  CROSS JOIN top_leaderboard_slice tls
  LEFT JOIN caller_position cp ON true
  LEFT JOIN gap_to_next gtn ON true;

  RETURN jsonb_build_object(
    'scope', v_scope,
    'total_competitors', COALESCE(v_total_competitors, 0),
    'leaderboard', COALESCE(v_leaderboard, '[]'::jsonb),
    'my_rank', v_my_rank,
    'my_points', v_my_points,
    'my_questions_solved', v_my_solved,
    'my_accuracy_pct', v_my_accuracy,
    'points_to_next_rank', v_next_rank_points,
    'school_configured', (v_my_profile.school_id IS NOT NULL),
    'school_name', v_my_profile.school_name,
    'city_configured', (v_my_profile.city IS NOT NULL),
    'city', v_my_profile.city,
    'opted_in', COALESCE(v_my_profile.competitive_opt_in, false)
  );
END;
$$;

-- 9. Hardened Permissions & Table Access Control ------------------------------
-- Revoke all direct client modifications to competitive tables
REVOKE ALL ON TABLE public.schools FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.student_points_ledger FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.student_achievements FROM public, anon, authenticated;

-- Grant selective read-only permissions via authenticated role (filtered strictly by RLS)
GRANT SELECT ON TABLE public.schools TO authenticated;
GRANT SELECT ON TABLE public.student_points_ledger TO authenticated;
GRANT SELECT ON TABLE public.student_achievements TO authenticated;

-- Service role retains full administrative access
GRANT ALL ON TABLE public.schools TO service_role;
GRANT ALL ON TABLE public.student_points_ledger TO service_role;
GRANT ALL ON TABLE public.student_achievements TO service_role;

-- Secure execution on RPCs
REVOKE ALL ON FUNCTION public.fn_process_evaluation_points() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_school(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.set_student_competitive_profile(boolean, uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.get_competitive_leaderboard(text, int) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.verify_school(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_student_competitive_profile(boolean, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_competitive_leaderboard(text, int) TO authenticated;

COMMIT;
