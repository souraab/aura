-- ============================================================================
-- AuraMentor Competitive Dashboard — Profile Security & Negative RLS Test Suite
-- File: supabase/migrations/20261117_competitive_security_negative_suite.sql
--
-- PURPOSE:
--   Verifies database-level security boundaries, RLS policies, table grants,
--   and privilege escalation barriers under genuine 'authenticated' student roles.
--   Includes:
--     1. Catalog privilege and policy inspection.
--     2. Setting JWT claims in privileged session context before assuming role.
--     3. Explicit auth.uid() identity resolution checks.
--     4. Positive baseline student read test.
--     5. Five distinct negative security tests distinguishing expected RLS/privilege
--        denials from unexpected runtime SQL errors using exact SQLSTATE classifications:
--          - 42501: insufficient_privilege (table grant or function execution denial)
--          - 44000: with_check_option_violation (RLS WITH CHECK rejection)
--          - P0001: raise_exception (explicit PL/pgSQL authorization exception)
--     6. Affirmative privileged database state inspection after each attempt.
--     7. Exception-safe role restoration and transaction ROLLBACK.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Catalog Privileges & Policy Inspection
-- ----------------------------------------------------------------------------
-- A. Inspect Table Grants for 'authenticated' and 'anon' roles
SELECT
  grantee,
  table_schema,
  table_name,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('profiles', 'student_points_ledger', 'student_achievements', 'schools')
  AND grantee IN ('authenticated', 'anon', 'PUBLIC')
ORDER BY table_name, grantee, privilege_type;

-- B. Inspect Row Level Security (RLS) Policies on Competitive Tables
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'student_points_ledger', 'student_achievements', 'schools')
ORDER BY tablename, policyname;

-- C. Inspect Privileged Function Security & Ownership
SELECT
  p.proname AS function_name,
  pg_get_userbyid(p.proowner) AS owner,
  p.prosecdef AS is_security_definer,
  p.proconfig AS configuration_settings
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_competitive_leaderboard', 'set_student_competitive_profile', 'verify_school', 'fn_process_evaluation_points')
ORDER BY p.proname;

-- ----------------------------------------------------------------------------
-- 2. Security Execution & Affirmative State Verification
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_student_victim uuid;
  v_student_attacker uuid;
  v_school_pending_id uuid;
  v_school_verified_id uuid;
  v_auth_uid_check uuid;
  v_unauthorized_success boolean;
  v_sqlstate text;
  v_sqlerrm text;

  -- Privileged State Verification Tracking Variables
  v_self_name text;
  v_check_role text;
  v_check_name text;
  v_check_count int;
  v_check_status text;
BEGIN
  -- --------------------------------------------------------------------------
  -- STEP 0: Collision-Safe Fixture Setup (Runs in Session Superuser/Admin Context)
  -- --------------------------------------------------------------------------
  -- Ensure fixture UUIDs do not collide with any existing auth.users or profiles
  LOOP
    v_student_victim := gen_random_uuid();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_student_victim)
         AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_student_victim);
  END LOOP;

  LOOP
    v_student_attacker := gen_random_uuid();
    EXIT WHEN v_student_attacker <> v_student_victim
         AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_student_attacker)
         AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_student_attacker);
  END LOOP;

  LOOP
    v_school_pending_id := gen_random_uuid();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.schools WHERE id = v_school_pending_id);
  END LOOP;

  LOOP
    v_school_verified_id := gen_random_uuid();
    EXIT WHEN v_school_verified_id <> v_school_pending_id
         AND NOT EXISTS (SELECT 1 FROM public.schools WHERE id = v_school_verified_id);
  END LOOP;

  -- Setup test schools (one PENDING for security denial checks, one VERIFIED for positive read checks)
  INSERT INTO public.schools (id, name, city, state, board, is_verified, verification_status)
  VALUES
    (v_school_pending_id, 'Security Test Academy Pending ' || v_school_pending_id::text, 'Delhi', 'Delhi', 'CBSE', false, 'PENDING'),
    (v_school_verified_id, 'Security Test Academy Verified ' || v_school_verified_id::text, 'Delhi', 'Delhi', 'CBSE', true, 'VERIFIED');

  -- Create authentic test users in auth.users
  -- If Supabase has an auth trigger (e.g. on_auth_user_created), it will populate public.profiles using raw_user_meta_data
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_student_victim, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sec_victim_' || v_student_victim || '@internal.net', 'hash', now(), '{"provider":"email"}'::jsonb, '{"full_name":"Victim Student","role":"STUDENT"}'::jsonb, now(), now()),
    (v_student_attacker, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sec_attacker_' || v_student_attacker || '@internal.net', 'hash', now(), '{"provider":"email"}'::jsonb, '{"full_name":"Attacker Student","role":"STUDENT"}'::jsonb, now(), now());

  -- Setup baseline profiles safely without overwriting any existing profiles
  -- Handles environments with or without automatic auth triggers cleanly without duplicate key violations
  INSERT INTO public.profiles (id, full_name, role)
  VALUES
    (v_student_victim, 'Victim Student', 'STUDENT'),
    (v_student_attacker, 'Attacker Student', 'STUDENT')
  ON CONFLICT (id) DO NOTHING;

  -- Explicitly verify that both test profiles exist and have the expected full_name and STUDENT role
  v_check_name := NULL;
  v_check_role := NULL;
  SELECT full_name, role INTO v_check_name, v_check_role
  FROM public.profiles
  WHERE id = v_student_victim;

  IF v_check_name IS NULL OR v_check_role IS NULL THEN
    RAISE EXCEPTION 'SETUP FAILED: Victim profile was not created (id=%)!', v_student_victim;
  END IF;

  IF v_check_name <> 'Victim Student' OR v_check_role <> 'STUDENT' THEN
    RAISE EXCEPTION 'SETUP FAILED: Victim profile state mismatch. Expected (Victim Student, STUDENT), found (%, %)',
      v_check_name, v_check_role;
  END IF;

  v_check_name := NULL;
  v_check_role := NULL;
  SELECT full_name, role INTO v_check_name, v_check_role
  FROM public.profiles
  WHERE id = v_student_attacker;

  IF v_check_name IS NULL OR v_check_role IS NULL THEN
    RAISE EXCEPTION 'SETUP FAILED: Attacker profile was not created (id=%)!', v_student_attacker;
  END IF;

  IF v_check_name <> 'Attacker Student' OR v_check_role <> 'STUDENT' THEN
    RAISE EXCEPTION 'SETUP FAILED: Attacker profile state mismatch. Expected (Attacker Student, STUDENT), found (%, %)',
      v_check_name, v_check_role;
  END IF;

  -- --------------------------------------------------------------------------
  -- STEP 1: Set JWT Claims in Privileged Context BEFORE Dropping to Authenticated Role
  -- --------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_student_attacker::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_attacker, 'role', 'authenticated')::text, true);

  -- Drop privileges to authenticated student role
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- Assert auth.uid() resolves to v_student_attacker
  v_auth_uid_check := auth.uid();
  IF v_auth_uid_check IS NULL OR v_auth_uid_check <> v_student_attacker THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'SETUP FAILED: auth.uid() failed to resolve to student identity! Expected %, found %', v_student_attacker, v_auth_uid_check;
  END IF;

  -- --------------------------------------------------------------------------
  -- TEST 0 (POSITIVE): Student CAN Read Own Profile and Verified School Directory
  --                     Student CANNOT Read Unverified/Pending Schools
  -- --------------------------------------------------------------------------
  SELECT full_name INTO v_self_name
  FROM public.profiles
  WHERE id = v_student_attacker;

  IF v_self_name <> 'Attacker Student' THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'POSITIVE TEST 0 FAILED: Authenticated student was unable to read own profile! Found %', v_self_name;
  END IF;

  -- 1. Student CAN read verified school directory
  SELECT COUNT(*) INTO v_check_count
  FROM public.schools
  WHERE id = v_school_verified_id;

  IF v_check_count <> 1 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'POSITIVE TEST 0 FAILED: Authenticated student was unable to read verified school directory! Expected 1, found %', v_check_count;
  END IF;

  -- 2. Student CANNOT read pending/unverified schools (RLS policy must filter them out)
  SELECT COUNT(*) INTO v_check_count
  FROM public.schools
  WHERE id = v_school_pending_id;

  IF v_check_count <> 0 THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'POSITIVE TEST 0 FAILED: Authenticated student was able to view unverified/pending school! Expected 0, found %', v_check_count;
  END IF;

  RAISE NOTICE 'POSITIVE TEST 0 PASSED: Authenticated student read own profile and verified school; pending school remains hidden.';

  -- --------------------------------------------------------------------------
  -- TEST A: Student CANNOT update their own role directly to ADMIN
  -- --------------------------------------------------------------------------
  v_unauthorized_success := false;
  BEGIN
    UPDATE public.profiles
    SET role = 'ADMIN'
    WHERE id = v_student_attacker;

    -- In PostgreSQL RLS, if UPDATE is denied by row security, 0 rows are updated
    IF FOUND THEN
      v_unauthorized_success := true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_sqlerrm = MESSAGE_TEXT;
    -- Expected error codes: 42501 (insufficient_privilege) or 44000 (with_check_option_violation)
    IF v_sqlstate IN ('42501', '44000') THEN
      v_unauthorized_success := false;
    ELSE
      EXECUTE 'RESET ROLE';
      RAISE EXCEPTION 'TEST A UNEXPECTED ERROR: [%] %', v_sqlstate, v_sqlerrm;
    END IF;
  END;

  IF v_unauthorized_success THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'SECURITY BREACH (TEST A): Student was able to escalate their own role to ADMIN via direct UPDATE!';
  END IF;

  -- Privileged State Verification: Switch to session superuser to inspect actual database row
  EXECUTE 'RESET ROLE';
  IF current_user = 'authenticated' THEN
    RAISE EXCEPTION 'TEST A FAILURE: RESET ROLE failed to restore privileged session user!';
  END IF;

  SELECT role INTO v_check_role
  FROM public.profiles
  WHERE id = v_student_attacker;

  IF v_check_role <> 'STUDENT' THEN
    RAISE EXCEPTION 'SECURITY BREACH (TEST A): Attacker role was mutated in database! Found %, expected STUDENT', v_check_role;
  ELSE
    RAISE NOTICE 'NEGATIVE TEST A PASSED: Role escalation blocked. Privileged inspection confirmed role remains STUDENT.';
  END IF;

  -- --------------------------------------------------------------------------
  -- TEST B: Student CANNOT update another student's profile (Cross-Student Attack)
  -- --------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_student_attacker::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_attacker, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  v_unauthorized_success := false;
  BEGIN
    UPDATE public.profiles
    SET full_name = 'Hacked Profile'
    WHERE id = v_student_victim;

    IF FOUND THEN
      v_unauthorized_success := true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_sqlerrm = MESSAGE_TEXT;
    -- Expected error codes: 42501 (insufficient_privilege) or 44000 (with_check_option_violation)
    IF v_sqlstate IN ('42501', '44000') THEN
      v_unauthorized_success := false;
    ELSE
      EXECUTE 'RESET ROLE';
      RAISE EXCEPTION 'TEST B UNEXPECTED ERROR: [%] %', v_sqlstate, v_sqlerrm;
    END IF;
  END;

  IF v_unauthorized_success THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'SECURITY BREACH (TEST B): Student was able to modify another student profile!';
  END IF;

  -- Privileged State Verification
  EXECUTE 'RESET ROLE';
  IF current_user = 'authenticated' THEN
    RAISE EXCEPTION 'TEST B FAILURE: RESET ROLE failed to restore privileged session user!';
  END IF;

  SELECT full_name INTO v_check_name
  FROM public.profiles
  WHERE id = v_student_victim;

  IF v_check_name <> 'Victim Student' THEN
    RAISE EXCEPTION 'SECURITY BREACH (TEST B): Victim full_name was mutated! Found %, expected Victim Student', v_check_name;
  ELSE
    RAISE NOTICE 'NEGATIVE TEST B PASSED: Cross-student update blocked. Privileged inspection confirmed victim full_name intact.';
  END IF;

  -- --------------------------------------------------------------------------
  -- TEST C: Student CANNOT directly insert points into student_points_ledger
  -- --------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_student_attacker::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_attacker, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  v_unauthorized_success := false;
  BEGIN
    INSERT INTO public.student_points_ledger (
      student_id, question_id, attempt_id, points_awarded, difficulty, reason
    ) VALUES (
      v_student_attacker, gen_random_uuid(), gen_random_uuid(), 1000, 'HARD', 'EXPLOIT_ATTEMPT'
    );
    v_unauthorized_success := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_sqlerrm = MESSAGE_TEXT;
    -- Expected: 42501 (insufficient_privilege) or 44000 (with_check_option_violation via RLS)
    IF v_sqlstate IN ('42501', '44000') THEN
      v_unauthorized_success := false;
    ELSE
      EXECUTE 'RESET ROLE';
      RAISE EXCEPTION 'TEST C UNEXPECTED ERROR: [%] %', v_sqlstate, v_sqlerrm;
    END IF;
  END;

  IF v_unauthorized_success THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'SECURITY BREACH (TEST C): Student was able to insert arbitrary points directly into ledger!';
  END IF;

  -- Privileged State Verification
  EXECUTE 'RESET ROLE';
  IF current_user = 'authenticated' THEN
    RAISE EXCEPTION 'TEST C FAILURE: RESET ROLE failed to restore privileged session user!';
  END IF;

  SELECT COUNT(*) INTO v_check_count
  FROM public.student_points_ledger
  WHERE student_id = v_student_attacker;

  IF v_check_count <> 0 THEN
    RAISE EXCEPTION 'SECURITY BREACH (TEST C): Points ledger entries exist for attacker! Found % rows, expected 0', v_check_count;
  ELSE
    RAISE NOTICE 'NEGATIVE TEST C PASSED: Direct points insertion blocked. Privileged inspection confirmed count=0.';
  END IF;

  -- --------------------------------------------------------------------------
  -- TEST D: Student CANNOT directly insert achievements into student_achievements
  -- --------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_student_attacker::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_attacker, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  v_unauthorized_success := false;
  BEGIN
    INSERT INTO public.student_achievements (
      student_id, achievement_code
    ) VALUES (
      v_student_attacker, 'POINTS_500'
    );
    v_unauthorized_success := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_sqlerrm = MESSAGE_TEXT;
    -- Expected: 42501 (insufficient_privilege) or 44000 (with_check_option_violation via RLS)
    IF v_sqlstate IN ('42501', '44000') THEN
      v_unauthorized_success := false;
    ELSE
      EXECUTE 'RESET ROLE';
      RAISE EXCEPTION 'TEST D UNEXPECTED ERROR: [%] %', v_sqlstate, v_sqlerrm;
    END IF;
  END;

  IF v_unauthorized_success THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'SECURITY BREACH (TEST D): Student was able to insert unearned achievements directly!';
  END IF;

  -- Privileged State Verification
  EXECUTE 'RESET ROLE';
  IF current_user = 'authenticated' THEN
    RAISE EXCEPTION 'TEST D FAILURE: RESET ROLE failed to restore privileged session user!';
  END IF;

  SELECT COUNT(*) INTO v_check_count
  FROM public.student_achievements
  WHERE student_id = v_student_attacker;

  IF v_check_count <> 0 THEN
    RAISE EXCEPTION 'SECURITY BREACH (TEST D): Achievements exist for attacker! Found % rows, expected 0', v_check_count;
  ELSE
    RAISE NOTICE 'NEGATIVE TEST D PASSED: Direct achievement insertion blocked. Privileged inspection confirmed count=0.';
  END IF;

  -- --------------------------------------------------------------------------
  -- TEST E: Non-admin Student CANNOT execute verify_school
  -- --------------------------------------------------------------------------
  PERFORM set_config('request.jwt.claim.sub', v_student_attacker::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_student_attacker, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  v_unauthorized_success := false;
  BEGIN
    PERFORM public.verify_school(v_school_pending_id, 'VERIFIED');
    v_unauthorized_success := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_sqlerrm = MESSAGE_TEXT;
    -- verify_school raises 'P0001' with message 'Access denied: Only system administrators can verify institutions.'
    IF v_sqlstate = 'P0001' AND v_sqlerrm LIKE '%Access denied%' THEN
      v_unauthorized_success := false;
    ELSIF v_sqlstate = '42501' THEN
      v_unauthorized_success := false;
    ELSE
      EXECUTE 'RESET ROLE';
      RAISE EXCEPTION 'TEST E UNEXPECTED ERROR: [%] %', v_sqlstate, v_sqlerrm;
    END IF;
  END;

  IF v_unauthorized_success THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'SECURITY BREACH (TEST E): Non-admin student was able to verify an institution!';
  END IF;

  -- Privileged State Verification
  EXECUTE 'RESET ROLE';
  IF current_user = 'authenticated' THEN
    RAISE EXCEPTION 'TEST E FAILURE: RESET ROLE failed to restore privileged session user!';
  END IF;

  SELECT verification_status INTO v_check_status
  FROM public.schools
  WHERE id = v_school_pending_id;

  IF v_check_status <> 'PENDING' THEN
    RAISE EXCEPTION 'SECURITY BREACH (TEST E): School verification status was altered! Found %, expected PENDING', v_check_status;
  ELSE
    RAISE NOTICE 'NEGATIVE TEST E PASSED: Non-admin school verification blocked. Privileged inspection confirmed status=PENDING.';
  END IF;

  -- Safe session cleanup
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE NOTICE 'ALL NEGATIVE SECURITY TESTS COMPLETED SUCCESSFULLY WITH 100%% PRIVILEGED AFFIRMATIVE PROOFS.';

EXCEPTION WHEN OTHERS THEN
  -- Exception-safe role restoration
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  RAISE;
END $$;

ROLLBACK;
