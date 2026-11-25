-- ============================================================================
-- AuraMentor Competitive Dashboard Rollback Migration (Hardened with Dependency Guards)
-- File: supabase/migrations/20261117_competitive_rollback.sql
--
-- TARGETED ROLLBACK SPECIFICATION:
--   - Reverses ONLY objects created or modified by 20261117_competitive_dashboard.sql.
--   - Preserves pre-existing public.profiles columns (full_name, id, role, updated_at).
--   - Preserves all pre-existing public.profiles RLS policies and table grants.
--   - Preserves core academic history (student_attempts, student_submissions, evaluations,
--     questions, chapters, topics) and existing RPCs (submit_student_answer, get_student_result).
--
-- SAFETY & DEPENDENCY GUARDS:
--   - Eliminates unconditional CASCADE on table drops.
--   - Inspects pg_depend, pg_rewrite and pg_constraint for unexpected dependencies
--     (such as custom views, foreign keys from third-party tables, or custom functions).
--   - REFUSES rollback and raises an exception if unexpected dependent objects exist.
--   - Uses RESTRICT on all table drops to guarantee no silent object deletion.
--
-- PERMANENT DATA LOSS IMPACT DISCLOSURE:
--   1. Dropping public.student_points_ledger permanently deletes all student competitive
--      points, rank ledgers, and audit trails.
--   2. Dropping public.student_achievements permanently deletes all unlocked badges.
--   3. Removing school_id, competitive_opt_in, and class_grade from public.profiles
--      resets student institution affiliations and competitive consent flags.
--   4. Dropping public.schools permanently removes the institution directory.
--   5. THIS ROLLBACK IS IRREVERSIBLE WITHOUT PRIOR PRE-ROLLBACK DATA EXPORTS.
--      Documenting backup instructions below does NOT guarantee that a backup exists.
--      The database administrator or operator is solely responsible for verifying
--      that all four exported backup files exist on disk before running this script.
--
-- ============================================================================
-- MANDATORY PRE-ROLLBACK BACKUP PROCEDURES (FOUR CRITICAL DATASETS)
-- ============================================================================
--
-- The operator must export the following FOUR datasets prior to rollback:
--   1. 'schools': Institutional directory of verified, pending, and rejected schools.
--   2. 'student_points_ledger': Point transactions, difficulty weightings, and solve audit trail.
--   3. 'student_achievements': Unlocked student badges and milestone achievement timestamps.
--   4. 'profiles (competitive columns)': Student school affiliations (school_id), competitive
--      opt-in consent (competitive_opt_in), and class level (class_grade).
--
-- CHOOSE ONE OF THE TWO COMPATIBLE EXPORT WORKFLOWS:
--
-- METHOD A: Supabase Dashboard (Web UI - Recommended for Cloud Staging/Production)
--   NOTE: Raw 'COPY ... TO STDOUT' does NOT function in the web SQL Editor.
--   Use the Table Editor export feature instead:
--     1. Open Supabase Dashboard -> Table Editor.
--     2. Select 'schools' -> click "Export to CSV" -> save as 'backup_schools.csv'.
--     3. Select 'student_points_ledger' -> click "Export to CSV" -> save as 'backup_points_ledger.csv'.
--     4. Select 'student_achievements' -> click "Export to CSV" -> save as 'backup_achievements.csv'.
--     5. Open SQL Editor -> execute the following query to extract profile affiliations:
--          SELECT id, school_id, competitive_opt_in, class_grade
--          FROM public.profiles
--          WHERE school_id IS NOT NULL OR competitive_opt_in = true;
--        Click "Export" -> "Download CSV" -> save as 'backup_profiles_comp.csv'.
--
-- METHOD B: Terminal CLI (psql client streaming connection - NOT web SQL Editor):
--   Execute via client-side psql \copy (which streams data across libpq directly to local files):
--     psql "$STAGING_DATABASE_URL" -c "\copy public.schools TO 'backup_schools.csv' WITH CSV HEADER"
--     psql "$STAGING_DATABASE_URL" -c "\copy public.student_points_ledger TO 'backup_points_ledger.csv' WITH CSV HEADER"
--     psql "$STAGING_DATABASE_URL" -c "\copy public.student_achievements TO 'backup_achievements.csv' WITH CSV HEADER"
--     psql "$STAGING_DATABASE_URL" -c "\copy (SELECT id, school_id, competitive_opt_in, class_grade FROM public.profiles WHERE school_id IS NOT NULL OR competitive_opt_in = true) TO 'backup_profiles_comp.csv' WITH CSV HEADER"
--
-- ============================================================================
-- OPERATOR PRE-EXECUTION CHECKLIST (ALL BOXES MUST BE CHECKED BEFORE RUNNING)
-- ============================================================================
--   [ ] 1. backup_schools.csv exists, is non-empty, and contains valid school rows.
--   [ ] 2. backup_points_ledger.csv exists, is non-empty, and contains valid ledger rows.
--   [ ] 3. backup_achievements.csv exists, is non-empty, and contains valid badge rows.
--   [ ] 4. backup_profiles_comp.csv exists, is non-empty, and contains student preferences.
--   [ ] 5. Explicit confirmation that competitive data destruction is approved.
-- ============================================================================

BEGIN;

-- 1. Drop trigger and scoring function introduced by this migration
DROP TRIGGER IF EXISTS trg_process_evaluation_points ON public.evaluations;
DROP FUNCTION IF EXISTS public.fn_process_evaluation_points();

-- 2. Drop competitive RPCs introduced by this migration
DROP FUNCTION IF EXISTS public.get_competitive_leaderboard(text, int);
DROP FUNCTION IF EXISTS public.set_student_competitive_profile(boolean, uuid);
DROP FUNCTION IF EXISTS public.verify_school(uuid, text);

-- 3. Revert profile extensions and constraints
-- Dropping fk_profiles_school removes the known foreign key dependency from profiles to schools.
DROP INDEX IF EXISTS public.idx_profiles_school_id;
DROP INDEX IF EXISTS public.idx_profiles_competitive_opt_in;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS fk_profiles_school,
  DROP COLUMN IF EXISTS school_id,
  DROP COLUMN IF EXISTS competitive_opt_in,
  DROP COLUMN IF EXISTS class_grade;

-- 4. Pre-Flight Dependency Inspection DO Block:
-- Scans for ANY unexpected dependent views, foreign keys, or objects referencing
-- student_achievements, student_points_ledger, or schools before dropping them.
DO $$
DECLARE
  v_rec record;
  v_unexpected_found boolean := false;
  v_err_details text := '';
BEGIN
  -- Check for unexpected views referencing competitive tables
  FOR v_rec IN (
    SELECT DISTINCT
      c.relname AS view_name,
      n.nspname AS schema_name,
      target.relname AS target_table
    FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid
    JOIN pg_class c ON c.oid = r.ev_class
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_class target ON target.oid = d.refobjid
    JOIN pg_namespace tn ON tn.oid = target.relnamespace
    WHERE tn.nspname = 'public'
      AND target.relname IN ('schools', 'student_points_ledger', 'student_achievements')
      AND c.relkind IN ('v', 'm')
  ) LOOP
    v_unexpected_found := true;
    v_err_details := v_err_details || format(E'\n- Dependent View: %I.%I depends on %I', v_rec.schema_name, v_rec.view_name, v_rec.target_table);
  END LOOP;

  -- Check for foreign keys from other tables referencing schools
  FOR v_rec IN (
    SELECT
      c.conname AS constraint_name,
      src.relname AS source_table,
      n.nspname AS schema_name,
      tgt.relname AS target_table
    FROM pg_constraint c
    JOIN pg_class src ON src.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = src.relnamespace
    JOIN pg_class tgt ON tgt.oid = c.confrelid
    JOIN pg_namespace tn ON tn.oid = tgt.relnamespace
    WHERE tn.nspname = 'public'
      AND tgt.relname IN ('schools', 'student_points_ledger', 'student_achievements')
      AND c.contype = 'f'
      -- Ignore internal cross-references between the three tables being dropped
      AND src.relname NOT IN ('schools', 'student_points_ledger', 'student_achievements')
  ) LOOP
    v_unexpected_found := true;
    v_err_details := v_err_details || format(E'\n- Foreign Key Constraint: %I on %I.%I references %I', v_rec.constraint_name, v_rec.schema_name, v_rec.source_table, v_rec.target_table);
  END LOOP;

  IF v_unexpected_found THEN
    RAISE EXCEPTION 'ROLLBACK REFUSED: Unexpected dependent objects detected on competitive tables!% \nRollback has been aborted to prevent silent object loss. Please drop or alter dependent objects manually before re-running rollback.', v_err_details;
  END IF;
END $$;

-- 5. Drop competitive tables using RESTRICT (fails if any unexpected dependency exists)
DROP TABLE IF EXISTS public.student_achievements RESTRICT;
DROP TABLE IF EXISTS public.student_points_ledger RESTRICT;
DROP TABLE IF EXISTS public.schools RESTRICT;

COMMIT;
