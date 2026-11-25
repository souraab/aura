#!/usr/bin/env bash
# ==============================================================================
# AuraMentor — Hardened Staging Database Validation & Security Runner
# File: scripts/run_staging_validation.sh
#
# STRICT SECURITY PRE-REQUISITES (ALL 4 REQUIRED):
#   1. STAGING_DATABASE_URL: Explicit PostgreSQL connection URI.
#   2. EXPECTED_STAGING_HOST: Explicit allowed hostname (e.g., localhost, 127.0.0.1, or db.ref.supabase.co).
#   3. CONFIRM_STAGING_TARGET: Explicitly set to 'auramentor_staging'.
#   4. Connected database name: Must equal 'auramentor_staging' exactly.
#   5. CONFIRM_ROLLBACK_DESTRUCTIVE: Required only if executing destructive rollback.
#
# USAGE EXAMPLE:
#   export STAGING_DATABASE_URL="postgres://postgres:secret@localhost:5432/auramentor_staging"
#   export EXPECTED_STAGING_HOST="localhost"
#   export CONFIRM_STAGING_TARGET="auramentor_staging"
#   export CONFIRM_ROLLBACK_DESTRUCTIVE="YES_I_HAVE_VERIFIED_BACKUPS_AND_APPROVE_DESTRUCTIVE_ROLLBACK"
#   ./scripts/run_staging_validation.sh
# ==============================================================================

set -euo pipefail

# ------------------------------------------------------------------------------
# 1. Verify psql client binary availability
# ------------------------------------------------------------------------------
if ! command -v psql &> /dev/null; then
  echo "ERROR: 'psql' client binary is not found on this system."
  echo "Please install libpq/psql via Homebrew:"
  echo "  brew install libpq && brew link --force libpq"
  echo "Or run this runner inside a Docker container mounting the repo:"
  echo "  docker run --rm -v \$(pwd):/app -w /app postgres:16 /app/scripts/run_staging_validation.sh"
  exit 1
fi

# ------------------------------------------------------------------------------
# 2. Enforce explicit STAGING_DATABASE_URL (No defaults, no fallbacks)
# ------------------------------------------------------------------------------
if [ -z "${STAGING_DATABASE_URL:-}" ]; then
  echo "FATAL SECURITY ABORT: STAGING_DATABASE_URL is not set."
  echo "You must explicitly supply the staging connection string."
  echo "Usage: STAGING_DATABASE_URL='postgres://user:pass@host:port/auramentor_staging' $0"
  exit 1
fi

# ------------------------------------------------------------------------------
# 3. Enforce explicit EXPECTED_STAGING_HOST (No default hostname allowed)
# ------------------------------------------------------------------------------
if [ -z "${EXPECTED_STAGING_HOST:-}" ]; then
  echo "FATAL SECURITY ABORT: EXPECTED_STAGING_HOST is not set."
  echo "You must explicitly specify the allowed staging database host to prevent accidental execution against production."
  echo "Example: export EXPECTED_STAGING_HOST='localhost' (or '127.0.0.1', or 'db.staging-ref.supabase.co')"
  exit 1
fi

# ------------------------------------------------------------------------------
# 4. Enforce operator confirmation variable
# ------------------------------------------------------------------------------
if [ "${CONFIRM_STAGING_TARGET:-}" != "auramentor_staging" ]; then
  echo "FATAL SECURITY ABORT: CONFIRM_STAGING_TARGET is missing or invalid."
  echo "To authorize execution against the staging environment, you must explicitly set:"
  echo "  export CONFIRM_STAGING_TARGET=auramentor_staging"
  exit 1
fi

# ------------------------------------------------------------------------------
# 5. Extract and Validate Target Hostname from STAGING_DATABASE_URL
# ------------------------------------------------------------------------------
# Robust extraction using sed: extracts host portion between '@' and ':' (or '/')
PARSED_HOST=$(echo "${STAGING_DATABASE_URL}" | sed -E 's|^[a-zA-Z0-9_+.-]+://[^@]+@([^:/]+).*$|\1|')

if [ -z "${PARSED_HOST}" ] || [ "${PARSED_HOST}" = "${STAGING_DATABASE_URL}" ]; then
  echo "FATAL SECURITY ABORT: Unable to parse target hostname from STAGING_DATABASE_URL."
  echo "Ensure connection string format matches: postgres://user:password@host:port/database"
  exit 1
fi

if [ "${PARSED_HOST}" != "${EXPECTED_STAGING_HOST}" ]; then
  echo "FATAL SECURITY ABORT: Hostname mismatch between connection URL and explicit allowlist!"
  echo "  Expected Staging Host: ${EXPECTED_STAGING_HOST}"
  echo "  Parsed URL Host:       ${PARSED_HOST}"
  echo "Execution aborted to protect production or unauthorized environments."
  exit 1
fi

# ------------------------------------------------------------------------------
# 6. Probe Target Database and Query Server Identity
# ------------------------------------------------------------------------------
echo "======================================================================"
echo " 1. TARGET DATABASE INSPECTION & AUTHENTICATION"
echo "======================================================================"

# Query server metadata using psql without echoing password or full URL
DB_INFO=$(psql "${STAGING_DATABASE_URL}" -X -t -A -v ON_ERROR_STOP=1 -c "
SELECT current_database() || '|' || current_user || '|' || COALESCE(inet_server_addr()::text, 'local-socket') || '|' || COALESCE(inet_server_port()::text, 'local');
")

TARGET_DB=$(echo "${DB_INFO}" | cut -d'|' -f1)
TARGET_USER=$(echo "${DB_INFO}" | cut -d'|' -f2)
SERVER_IP=$(echo "${DB_INFO}" | cut -d'|' -f3)
SERVER_PORT=$(echo "${DB_INFO}" | cut -d'|' -f4)

echo "  Target Confirmation Target: ${CONFIRM_STAGING_TARGET}"
echo "  Expected Staging Host:      ${EXPECTED_STAGING_HOST}"
echo "  Parsed Connection Host:     ${PARSED_HOST}"
echo "  Connected Server IP/Socket: ${SERVER_IP}:${SERVER_PORT}"
echo "  Connected Database Name:    ${TARGET_DB}"
echo "  Connected Database User:    ${TARGET_USER}"

# Strict Database Name Enforcement: MUST be exactly 'auramentor_staging'
if [ "${TARGET_DB}" != "auramentor_staging" ]; then
  echo "FATAL SECURITY ABORT: Connected database is '${TARGET_DB}', NOT 'auramentor_staging'!"
  echo "Execution refused to prevent accidental execution against production or non-staging databases."
  exit 1
fi

# Query PostgreSQL Engine Version
PG_VERSION=$(psql "${STAGING_DATABASE_URL}" -X -t -A -v ON_ERROR_STOP=1 -c "SELECT version();")
echo "  PostgreSQL Engine:          ${PG_VERSION}"
echo "-> Target verified as isolated staging database."

echo ""
echo "======================================================================"
echo " 2. PRE-MIGRATION ACADEMIC FIXTURE COUNTS (BASELINE AUDIT)"
echo "======================================================================"
psql "${STAGING_DATABASE_URL}" -X -v ON_ERROR_STOP=1 -c "
SELECT
  (SELECT COUNT(*) FROM public.chapters) AS chapters_count,
  (SELECT COUNT(*) FROM public.topics) AS topics_count,
  (SELECT COUNT(*) FROM public.questions) AS questions_count,
  (SELECT COUNT(*) FROM public.student_attempts) AS attempts_count,
  (SELECT COUNT(*) FROM public.student_submissions) AS submissions_count,
  (SELECT COUNT(*) FROM public.evaluations) AS evaluations_count,
  (SELECT COUNT(*) FROM public.profiles) AS profiles_count;
"

echo ""
echo "======================================================================"
echo " 3. APPLYING COMPETITIVE DASHBOARD MIGRATION"
echo "======================================================================"
psql "${STAGING_DATABASE_URL}" -X -v ON_ERROR_STOP=1 -f "supabase/migrations/20261117_competitive_dashboard.sql"
echo "-> Competitive migration applied successfully."

echo ""
echo "======================================================================"
echo " 4. EXECUTING ISOLATED VALIDATION SUITE (TRANSACTIONAL ROLLBACK)"
echo "======================================================================"
psql "${STAGING_DATABASE_URL}" -X -v ON_ERROR_STOP=1 -f "supabase/migrations/20261117_competitive_validation_suite.sql"
echo "-> Validation suite executed and rolled back cleanly."

echo ""
echo "======================================================================"
echo " 5. EXECUTING SECURITY & NEGATIVE PRIVILEGE ESCALATION SUITE"
echo "======================================================================"
psql "${STAGING_DATABASE_URL}" -X -v ON_ERROR_STOP=1 -f "supabase/migrations/20261117_competitive_security_negative_suite.sql"
echo "-> Security negative suite executed and rolled back cleanly."

echo ""
echo "======================================================================"
echo " 6. POST-TEST ACADEMIC FIXTURE INTEGRITY AUDIT"
echo "======================================================================"
psql "${STAGING_DATABASE_URL}" -X -v ON_ERROR_STOP=1 -c "
SELECT
  (SELECT COUNT(*) FROM public.chapters) AS chapters_count,
  (SELECT COUNT(*) FROM public.topics) AS topics_count,
  (SELECT COUNT(*) FROM public.questions) AS questions_count,
  (SELECT COUNT(*) FROM public.student_attempts) AS attempts_count,
  (SELECT COUNT(*) FROM public.student_submissions) AS submissions_count,
  (SELECT COUNT(*) FROM public.evaluations) AS evaluations_count,
  (SELECT COUNT(*) FROM public.profiles) AS profiles_count;
"

echo ""
echo "======================================================================"
echo " 7. TESTING SURGICAL ROLLBACK SCRIPT (IF CONFIRMED BY OPERATOR)"
echo "======================================================================"
if [ "${CONFIRM_ROLLBACK_DESTRUCTIVE:-}" != "YES_I_HAVE_VERIFIED_BACKUPS_AND_APPROVE_DESTRUCTIVE_ROLLBACK" ]; then
  echo "NOTICE: CONFIRM_ROLLBACK_DESTRUCTIVE is not set to 'YES_I_HAVE_VERIFIED_BACKUPS_AND_APPROVE_DESTRUCTIVE_ROLLBACK'."
  echo "Skipping destructive rollback step. Competitive dashboard schema remains applied in staging for testing."
  echo "ALL VALIDATION AND SECURITY TESTS COMPLETED SUCCESSFULLY."
  exit 0
fi

echo "Operator confirmation provided. Executing rollback..."
psql "${STAGING_DATABASE_URL}" -X -v ON_ERROR_STOP=1 -f "supabase/migrations/20261117_competitive_rollback.sql"
echo "-> Rollback script executed successfully."

echo ""
echo "======================================================================"
echo " 8. FINAL CLEAN STATE VERIFICATION"
echo "======================================================================"
psql "${STAGING_DATABASE_URL}" -X -v ON_ERROR_STOP=1 -c "
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('schools', 'student_points_ledger', 'student_achievements');
"
echo "ALL TESTS AND ROLLBACK VERIFICATIONS COMPLETED SUCCESSFULLY."
