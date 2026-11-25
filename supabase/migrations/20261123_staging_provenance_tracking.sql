-- ============================================================================
-- AuraMentor Ingestion Pipeline: Explicit Provenance Tracking Migration
-- File: supabase/migrations/20261123_staging_provenance_tracking.sql
--
-- Purpose:
--   Provides an explicit, tamper-evident provenance record distinguishing
--   automated pipeline re-extractions (V1 -> V2) from human administrator curation.
--
-- Architecture:
--   1. Non-blocking: Adds `pipeline_provenance` JSONB column with non-null default.
--   2. Records baseline pipeline hashes for stem and options.
--   3. Explicit `is_admin_modified` boolean set whenever curation endpoints update the candidate.
--   4. Fully backward compatible with existing staging queries and promotion RPCs.
-- ============================================================================

BEGIN;

-- 1. Add pipeline_provenance to public.staging_questions
ALTER TABLE public.staging_questions
  ADD COLUMN IF NOT EXISTS pipeline_provenance jsonb NOT NULL
  DEFAULT jsonb_build_object(
    'is_admin_modified', false,
    'pipeline_version', 'v1',
    'baseline_content_hash', null,
    'last_pipeline_update_at', null
  );

-- 2. Supporting index on provenance modification status
CREATE INDEX IF NOT EXISTS idx_staging_questions_admin_modified
  ON public.staging_questions(((pipeline_provenance->>'is_admin_modified')::boolean));

COMMIT;

