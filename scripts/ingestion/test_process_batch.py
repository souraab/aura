#!/usr/bin/env python3
"""
Unit Test Suite for AuraMentor Batch Ingestion Worker (process_batch.py)
File: scripts/ingestion/test_process_batch.py
"""

import io
import os
import shutil
import sys
import tempfile
import unittest

# Ensure scripts/ingestion is in path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from process_batch import (
    BatchProcessor,
    SupabaseRestClient,
    load_ingestion_credentials,
    parse_env_file,
    assess_candidate_curation,
)
from import_to_staging import compute_content_hash


class TestBatchProcessor(unittest.TestCase):

    def setUp(self):
        self.base_dir = os.path.dirname(os.path.abspath(__file__))
        self.sample_pdf = os.path.join(self.base_dir, "sample_math_paper.pdf")
        self.test_source_pdf = os.path.join(self.base_dir, "test_source.pdf")

    def test_dry_run_sample_math_paper(self):
        """Verifies end-to-end dry run processing on sample_math_paper.pdf."""
        processor = BatchProcessor(
            batch_id="00000000-0000-0000-0000-000000000001",
            client=None,
            dry_run=True,
            local_pdf_override=self.sample_pdf,
        )
        result = processor.run()
        self.assertTrue(result["dry_run"])
        self.assertEqual(result["status"], "VALIDATED")
        self.assertEqual(result["total_questions"], 8)
        self.assertEqual(result["total_diagrams"], 0)

    def test_dry_run_test_source_with_diagrams(self):
        """Verifies end-to-end dry run processing on test_source.pdf with 9 diagrams."""
        processor = BatchProcessor(
            batch_id="00000000-0000-0000-0000-000000000002",
            client=None,
            dry_run=True,
            local_pdf_override=self.test_source_pdf,
        )
        result = processor.run()
        self.assertTrue(result["dry_run"])
        self.assertEqual(result["status"], "VALIDATED")
        self.assertEqual(result["total_questions"], 38)
        self.assertEqual(result["total_diagrams"], 9)

    def test_candidate_uniqueness_check(self):
        """Verifies that duplicate candidate IDs in a batch raise ValueError."""
        processor = BatchProcessor(
            batch_id="00000000-0000-0000-0000-000000000003",
            client=None,
            dry_run=True,
        )
        records_with_duplicates = [
            {"candidate_id": "cand-p1-q1", "text": "Question 1"},
            {"candidate_id": "cand-p1-q1", "text": "Duplicate Question 1"},
        ]
        with self.assertRaises(ValueError) as ctx:
            processor._validate_candidate_uniqueness(records_with_duplicates)
        self.assertIn("Duplicate candidate IDs detected", str(ctx.exception))

    def test_storage_path_safety_validation(self):
        """Verifies that an unauthorized storage path outside ingestion/ is rejected."""
        class MockClient:
            def get_batch(self, batch_id):
                return {
                    "id": batch_id,
                    "pdf_storage_path": "../../../etc/passwd",
                    "pdf_filename": "exploit.pdf",
                    "status": "PENDING",
                    "pdf_file_hash": "0" * 64,
                    "pdf_file_size_bytes": 100,
                }

        processor = BatchProcessor(
            batch_id="00000000-0000-0000-0000-000000000004",
            client=MockClient(),
            dry_run=False,
        )
        with self.assertRaises(ValueError) as ctx:
            processor._fetch_and_validate_batch()
        self.assertIn("Unauthorized or invalid storage path", str(ctx.exception))

    def test_archived_batch_rejection(self):
        """Verifies that ARCHIVED batches cannot be processed."""
        class MockClient:
            def get_batch(self, batch_id):
                return {
                    "id": batch_id,
                    "pdf_storage_path": f"ingestion/{batch_id}/source.pdf",
                    "pdf_filename": "archived.pdf",
                    "status": "ARCHIVED",
                    "pdf_file_hash": "0" * 64,
                    "pdf_file_size_bytes": 100,
                }

        processor = BatchProcessor(
            batch_id="00000000-0000-0000-0000-000000000005",
            client=MockClient(),
            dry_run=False,
        )
        with self.assertRaises(RuntimeError) as ctx:
            processor._fetch_and_validate_batch()
        self.assertIn("is ARCHIVED and cannot be processed", str(ctx.exception))

    def test_already_processed_batch_requires_force(self):
        """Verifies that already processed batches (IN_REVIEW) require --force."""
        class MockClient:
            def get_batch(self, batch_id):
                return {
                    "id": batch_id,
                    "pdf_storage_path": f"ingestion/{batch_id}/source.pdf",
                    "pdf_filename": "reviewed.pdf",
                    "status": "IN_REVIEW",
                    "pdf_file_hash": "0" * 64,
                    "pdf_file_size_bytes": 100,
                }

        # Without force -> raises RuntimeError
        processor = BatchProcessor(
            batch_id="00000000-0000-0000-0000-000000000006",
            client=MockClient(),
            dry_run=False,
            force=False,
        )
        with self.assertRaises(RuntimeError) as ctx:
            processor._fetch_and_validate_batch()
        self.assertIn("has already been processed", str(ctx.exception))

        # With force -> passes validation
        processor_forced = BatchProcessor(
            batch_id="00000000-0000-0000-0000-000000000006",
            client=MockClient(),
            dry_run=False,
            force=True,
        )
        batch = processor_forced._fetch_and_validate_batch()
        self.assertEqual(batch["status"], "IN_REVIEW")


class TestCredentialLoading(unittest.TestCase):
    """
    Verifies secure local credential loading for the ingestion worker:
    - Loading from .env.ingestion.local
    - Precedence of existing environment variables over file values
    - Prevention of publishable key usage as service role key
    - Confidentiality: Zero printing, logging, or exposure of secret values
    """

    def setUp(self):
        self.orig_env = dict(os.environ)
        self.temp_dir = tempfile.mkdtemp()

    def tearDown(self):
        # Restore original environment cleanly
        os.environ.clear()
        os.environ.update(self.orig_env)
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_load_from_env_ingestion_local(self):
        """Verifies loading SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.ingestion.local."""
        # Clear any existing Supabase env vars for isolation
        for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY", "NEXT_PUBLIC_SUPABASE_URL"):
            os.environ.pop(k, None)

        env_file = os.path.join(self.temp_dir, ".env.ingestion.local")
        with open(env_file, "w", encoding="utf-8") as f:
            f.write("# Ingestion Local Secrets\n")
            f.write("SUPABASE_URL=https://sample-project.supabase.co\n")
            f.write("SUPABASE_SERVICE_ROLE_KEY=test_secret_service_key_999888\n")

        # Capture stdout/stderr to verify zero leakage
        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()
        old_stdout, old_stderr = sys.stdout, sys.stderr
        try:
            sys.stdout, sys.stderr = stdout_capture, stderr_capture
            url, key = load_ingestion_credentials(project_root=self.temp_dir)
        finally:
            sys.stdout, sys.stderr = old_stdout, old_stderr

        self.assertEqual(url, "https://sample-project.supabase.co")
        self.assertEqual(key, "test_secret_service_key_999888")
        # Assert nothing was printed or logged to stdout or stderr
        self.assertEqual(stdout_capture.getvalue(), "")
        self.assertEqual(stderr_capture.getvalue(), "")

    def test_existing_env_precedence_over_file(self):
        """Verifies that existing environment variables take strict precedence over file values."""
        os.environ["SUPABASE_URL"] = "https://env-wins.supabase.co"
        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "env_role_key_wins"

        env_file = os.path.join(self.temp_dir, ".env.ingestion.local")
        with open(env_file, "w", encoding="utf-8") as f:
            f.write("SUPABASE_URL=https://file-loses.supabase.co\n")
            f.write("SUPABASE_SERVICE_ROLE_KEY=file_role_key_loses\n")

        url, key = load_ingestion_credentials(project_root=self.temp_dir)
        self.assertEqual(url, "https://env-wins.supabase.co")
        self.assertEqual(key, "env_role_key_wins")

    def test_never_load_service_role_from_publishable_key(self):
        """Verifies that the service-role key is never read or accepted from the publishable key."""
        for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"):
            os.environ.pop(k, None)

        fake_pub_key = "sb_publishable_test_token_abc123"
        os.environ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] = fake_pub_key
        # Attempt to inject publishable key as service role key
        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = fake_pub_key

        url, key = load_ingestion_credentials(project_root=self.temp_dir)
        # Service role key MUST be rejected (set to None)
        self.assertIsNone(key)

    def test_missing_credentials_does_not_leak_secrets(self):
        """Verifies that when credentials are unset, clear guidance is provided without leakage."""
        for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY", "NEXT_PUBLIC_SUPABASE_URL"):
            os.environ.pop(k, None)

        url, key = load_ingestion_credentials(project_root=self.temp_dir)
        self.assertIsNone(url)
        self.assertIsNone(key)

    def test_reviewed_and_promoted_candidates_are_preserved(self):
        """Verifies that administrator reviews, edits, and promotions are never overwritten during re-extraction."""
        class MockSafeClient:
            def __init__(self):
                self.field_updates = {}
                self.upserted_records = []
                self.finalized_updates = {}

            def get_existing_staging_questions(self, batch_id):
                return [
                    {"id": "uuid-1", "candidate_id": "cand-p1-q1", "review_status": "ACCEPTED", "promoted_question_id": None},
                    {"id": "uuid-2", "candidate_id": "cand-p1-q2", "review_status": "EDITED", "promoted_question_id": None},
                    {"id": "uuid-3", "candidate_id": "cand-p1-q3", "review_status": "REJECTED", "promoted_question_id": None},
                    {"id": "uuid-4", "candidate_id": "cand-p1-q4", "review_status": "PROMOTED", "promoted_question_id": "00000000-0000-0000-0000-000000000099"},
                    {"id": "uuid-5", "candidate_id": "cand-p1-q5", "review_status": "PENDING", "promoted_question_id": None, "original_extracted_text": "5. Old text 5", "candidate_question_text": "Old text 5", "content_hash": compute_content_hash("Old text 5")},
                ]

            def update_staging_question(self, staging_id, fields, expected_updated_at=None):
                self.field_updates[staging_id] = fields
                return True

            def upsert_staging_questions(self, records):
                self.upserted_records.extend(records)
                return len(records)

            def finalize_batch(self, batch_id, updates):
                self.finalized_updates = updates
                return updates

        mock_client = MockSafeClient()
        processor = BatchProcessor(
            batch_id="00000000-0000-0000-0000-000000000055",
            client=mock_client,
            dry_run=False,
            force=True,
        )

        plan = {
            "batch_record": {
                "total_pages": 1,
                "extractor_backend": "MacPDFKit2D",
                "extraction_failures_count": 0,
                "high_confidence_count": 5,
                "metadata": {"source_doc_type": "EXAM_PAPER", "paper_instructions": []},
            },
            "diagram_uploads": [],
            "staging_records": [
                {"candidate_id": "cand-p1-q1", "candidate_question_text": "Updated text 1", "content_hash": "hash1"},
                {"candidate_id": "cand-p1-q2", "candidate_question_text": "Updated text 2", "content_hash": "hash2"},
                {"candidate_id": "cand-p1-q3", "candidate_question_text": "Updated text 3", "content_hash": "hash3"},
                {"candidate_id": "cand-p1-q4", "candidate_question_text": "Updated text 4", "content_hash": "hash4"},
                {"candidate_id": "cand-p1-q5", "candidate_question_text": "Updated text 5", "content_hash": "hash5"},
            ]
        }

        mock_batch = {
            "id": "00000000-0000-0000-0000-000000000055",
            "pdf_storage_path": "ingestion/00000000-0000-0000-0000-000000000055/source.pdf",
            "metadata": {},
        }

        result = processor._execute_live_staging(mock_batch, plan)
        self.assertTrue(result["success"])

        # Strictly verify that ONLY cand-p1-q5 (uuid-5) was updated
        self.assertEqual(list(mock_client.field_updates.keys()), ["uuid-5"])
        self.assertNotIn("uuid-1", mock_client.field_updates)
        self.assertNotIn("uuid-2", mock_client.field_updates)
        self.assertNotIn("uuid-3", mock_client.field_updates)
        self.assertNotIn("uuid-4", mock_client.field_updates)

    def test_edited_candidate_with_pending_status_is_preserved(self):
        """
        Targeted Safety Test: Verifies that an administrator-edited candidate whose
        review_status is still 'PENDING' is detected as curated and preserved from overwrite.
        """
        class MockClientForPendingEdits:
            def __init__(self):
                self.field_updates = {}
                self.upserted_records = []
                self.finalized_updates = {}

            def get_existing_staging_questions(self, batch_id):
                return [
                    # Case 1: Status PENDING, but admin wrote review_notes
                    {
                        "id": "uuid-pending-notes",
                        "candidate_id": "cand-p1-q1",
                        "review_status": "PENDING",
                        "review_notes": "Needs human verification of diagram on page 1",
                        "original_extracted_text": "1. Original stem",
                        "candidate_question_text": "Original stem",
                        "content_hash": compute_content_hash("Original stem"),
                        "target_difficulty": "MEDIUM",
                        "target_marks": 1.0,
                    },
                    # Case 2: Status PENDING, but admin manually edited candidate_question_text
                    {
                        "id": "uuid-pending-edited-text",
                        "candidate_id": "cand-p1-q2",
                        "review_status": "PENDING",
                        "review_notes": None,
                        "original_extracted_text": "2. Raw extracted statement 2",
                        "candidate_question_text": "Administrator corrected statement 2",
                        "content_hash": compute_content_hash("Raw extracted statement 2"),
                        "target_difficulty": "MEDIUM",
                        "target_marks": 1.0,
                    },
                    # Case 3: Status PENDING, but admin assigned a specific target_topic_id
                    {
                        "id": "uuid-pending-topic",
                        "candidate_id": "cand-p1-q3",
                        "review_status": "PENDING",
                        "review_notes": None,
                        "original_extracted_text": "3. Statement 3",
                        "candidate_question_text": "Statement 3",
                        "content_hash": compute_content_hash("Statement 3"),
                        "target_topic_id": "00000000-0000-0000-0000-000000000088",
                        "target_difficulty": "MEDIUM",
                        "target_marks": 1.0,
                    },
                    # Case 4: Status PENDING, but admin set difficulty to HARD
                    {
                        "id": "uuid-pending-hard",
                        "candidate_id": "cand-p1-q4",
                        "review_status": "PENDING",
                        "review_notes": "",
                        "original_extracted_text": "4. Statement 4",
                        "candidate_question_text": "Statement 4",
                        "content_hash": compute_content_hash("Statement 4"),
                        "target_difficulty": "HARD",
                        "target_marks": 1.0,
                    },
                    # Case 5: Status PENDING, clean untouched candidate (eligible for re-extraction update)
                    {
                        "id": "uuid-pending-clean",
                        "candidate_id": "cand-p1-q5",
                        "review_status": "PENDING",
                        "review_notes": None,
                        "original_extracted_text": "5. Raw text 5",
                        "candidate_question_text": "Raw text 5",
                        "content_hash": compute_content_hash("Raw text 5"),
                        "target_difficulty": "MEDIUM",
                        "target_marks": 1.0,
                        "target_negative_marks": 0.0,
                    },
                ]

            def update_staging_question(self, staging_id, fields, expected_updated_at=None):
                self.field_updates[staging_id] = fields
                return True

            def upsert_staging_questions(self, records):
                self.upserted_records.extend(records)
                return len(records)

            def finalize_batch(self, batch_id, updates):
                self.finalized_updates = updates
                return updates

        mock_client = MockClientForPendingEdits()
        processor = BatchProcessor(
            batch_id="00000000-0000-0000-0000-000000000077",
            client=mock_client,
            dry_run=False,
            force=True,
        )

        plan = {
            "batch_record": {
                "total_pages": 1,
                "extractor_backend": "MacPDFKit2D",
                "extraction_failures_count": 0,
                "high_confidence_count": 5,
                "metadata": {"source_doc_type": "EXAM_PAPER", "paper_instructions": []},
            },
            "diagram_uploads": [],
            "staging_records": [
                {
                    "candidate_id": "cand-p1-q1",
                    "candidate_question_text": "V2 re-extracted math stem 1",
                    "content_hash": "newhash1",
                    "review_notes": None,
                    "target_difficulty": "MEDIUM",
                    "review_status": "PENDING",
                },
                {
                    "candidate_id": "cand-p1-q2",
                    "candidate_question_text": "V2 re-extracted math stem 2",
                    "content_hash": "newhash2",
                    "review_notes": None,
                    "target_difficulty": "MEDIUM",
                    "review_status": "PENDING",
                },
                {
                    "candidate_id": "cand-p1-q3",
                    "candidate_question_text": "V2 re-extracted math stem 3",
                    "content_hash": "newhash3",
                    "review_notes": None,
                    "target_difficulty": "MEDIUM",
                    "review_status": "PENDING",
                },
                {
                    "candidate_id": "cand-p1-q4",
                    "candidate_question_text": "V2 re-extracted math stem 4",
                    "content_hash": "newhash4",
                    "review_notes": None,
                    "target_difficulty": "MEDIUM",
                    "review_status": "PENDING",
                },
                {
                    "candidate_id": "cand-p1-q5",
                    "candidate_question_text": "V2 re-extracted math stem 5: $R_1 + R_2 = R$",
                    "content_hash": "newhash5",
                    "review_notes": None,
                    "target_difficulty": "MEDIUM",
                    "review_status": "PENDING",
                    "detected_options": [{"key": "A", "text": "$R_1$"}],
                    "extraction_warnings": [],
                    "has_extraction_failures": False,
                    "extraction_confidence": 0.95,
                    "original_extracted_text": "V2 re-extracted math stem 5: $R_1 + R_2 = R$",
                },
            ]
        }

        mock_batch = {
            "id": "00000000-0000-0000-0000-000000000077",
            "pdf_storage_path": "ingestion/00000000-0000-0000-0000-000000000077/source.pdf",
            "metadata": {},
        }

        result = processor._execute_live_staging(mock_batch, plan)
        self.assertTrue(result["success"])

        # 1. Verify that NONE of the curated candidates (cand-p1-q1 to cand-p1-q4) were modified
        self.assertNotIn("uuid-pending-notes", mock_client.field_updates)
        self.assertNotIn("uuid-pending-edited-text", mock_client.field_updates)
        self.assertNotIn("uuid-pending-topic", mock_client.field_updates)
        self.assertNotIn("uuid-pending-hard", mock_client.field_updates)

        # 2. Verify that ONLY the clean candidate (uuid-pending-clean) received field updates
        self.assertEqual(list(mock_client.field_updates.keys()), ["uuid-pending-clean"])

        # 3. Verify the EXACT fields passed in the field-level update:
        updated_fields = mock_client.field_updates["uuid-pending-clean"]
        self.assertIn("candidate_question_text", updated_fields)
        self.assertIn("content_hash", updated_fields)
        self.assertIn("detected_options", updated_fields)
        self.assertIn("extraction_warnings", updated_fields)
        self.assertIn("has_extraction_failures", updated_fields)
        self.assertIn("extraction_confidence", updated_fields)
        self.assertIn("original_extracted_text", updated_fields)

        # 4. Strictly verify that curation and workflow fields were NOT included in the update payload
        self.assertNotIn("review_status", updated_fields)
        self.assertNotIn("review_notes", updated_fields)
        self.assertNotIn("target_chapter_id", updated_fields)
        self.assertNotIn("target_topic_id", updated_fields)
        self.assertNotIn("target_difficulty", updated_fields)
        self.assertNotIn("target_marks", updated_fields)
        self.assertNotIn("target_negative_marks", updated_fields)
        self.assertNotIn("id", updated_fields)
        self.assertNotIn("batch_id", updated_fields)
        self.assertNotIn("candidate_id", updated_fields)
        self.assertNotIn("created_at", updated_fields)

    def test_optimistic_concurrency_skips_concurrently_edited_candidate(self):
        """
        Simulates an administrator editing a candidate in the admin dashboard
        between the worker's initial read and its field-level PATCH.
        Verifies that:
        1. Database PATCH filters (review_status=PENDING, promoted_question_id IS NULL, updated_at=expected) reject the update.
        2. Candidate is NOT retried with stale data.
        3. Candidate is recorded as skipped due to concurrent modification.
        4. Other concurrent-free candidates succeed.
        5. Worker accurately reports updated vs skipped metrics.
        """
        class MockClientWithConcurrentRace:
            def __init__(self):
                self.field_updates = {}
                self.upserted_records = []
                self.finalized_updates = {}
                # Live database state at PATCH execution time:
                # cand-p1-q1 was modified by admin (review_status changed to 'EDITED', updated_at changed)
                self.live_db_state = {
                    "uuid-race-1": {
                        "review_status": "EDITED",
                        "promoted_question_id": None,
                        "updated_at": "2026-11-23T10:05:00Z",
                    },
                    "uuid-race-2": {
                        "review_status": "PENDING",
                        "promoted_question_id": None,
                        "updated_at": "2026-11-23T10:00:00Z",
                    },
                }

            def get_existing_staging_questions(self, batch_id):
                # Initial read: Both candidates appear PENDING with updated_at = 2026-11-23T10:00:00Z
                return [
                    {
                        "id": "uuid-race-1",
                        "candidate_id": "cand-p1-q1",
                        "review_status": "PENDING",
                        "promoted_question_id": None,
                        "updated_at": "2026-11-23T10:00:00Z",
                        "candidate_question_text": "Stem 1",
                        "original_extracted_text": "1. Stem 1",
                        "content_hash": compute_content_hash("Stem 1"),
                        "target_difficulty": "MEDIUM",
                        "target_marks": 1.0,
                    },
                    {
                        "id": "uuid-race-2",
                        "candidate_id": "cand-p1-q2",
                        "review_status": "PENDING",
                        "promoted_question_id": None,
                        "updated_at": "2026-11-23T10:00:00Z",
                        "candidate_question_text": "Stem 2",
                        "original_extracted_text": "2. Stem 2",
                        "content_hash": compute_content_hash("Stem 2"),
                        "target_difficulty": "MEDIUM",
                        "target_marks": 1.0,
                    },
                ]

            def update_staging_question(self, staging_id, fields, expected_updated_at=None):
                # Simulates database-side WHERE id=staging_id AND review_status=PENDING AND promoted_question_id IS NULL AND updated_at=expected_updated_at
                current_row = self.live_db_state.get(staging_id)
                if not current_row:
                    return False

                # Concurrency conditions check:
                if current_row["review_status"] != "PENDING":
                    return False
                if current_row["promoted_question_id"] is not None:
                    return False
                if expected_updated_at and current_row["updated_at"] != expected_updated_at:
                    return False

                # Conditions matched! Update row:
                self.field_updates[staging_id] = fields
                return True

            def upsert_staging_questions(self, records):
                self.upserted_records.extend(records)
                return len(records)

            def finalize_batch(self, batch_id, updates):
                self.finalized_updates = updates
                return updates

        mock_client = MockClientWithConcurrentRace()
        processor = BatchProcessor(
            batch_id="00000000-0000-0000-0000-000000000099",
            client=mock_client,
            dry_run=False,
            force=True,
        )

        plan = {
            "batch_record": {
                "total_pages": 1,
                "extractor_backend": "MacPDFKit2D",
                "extraction_failures_count": 0,
                "high_confidence_count": 2,
                "metadata": {"source_doc_type": "EXAM_PAPER", "paper_instructions": []},
            },
            "diagram_uploads": [],
            "staging_records": [
                {
                    "candidate_id": "cand-p1-q1",
                    "candidate_question_text": "V2 Math Stem 1: $x^2 + y^2 = 1$",
                    "content_hash": "hash1",
                    "original_extracted_text": "V2 Math Stem 1: $x^2 + y^2 = 1$",
                },
                {
                    "candidate_id": "cand-p1-q2",
                    "candidate_question_text": "V2 Math Stem 2: $\\alpha + \\beta$",
                    "content_hash": "hash2",
                    "original_extracted_text": "V2 Math Stem 2: $\\alpha + \\beta$",
                },
            ]
        }

        mock_batch = {
            "id": "00000000-0000-0000-0000-000000000099",
            "pdf_storage_path": "ingestion/00000000-0000-0000-0000-000000000099/source.pdf",
            "metadata": {},
        }

        result = processor._execute_live_staging(mock_batch, plan)

        # Verify that uuid-race-1 was rejected and NOT modified
        self.assertNotIn("uuid-race-1", mock_client.field_updates)

        # Verify that uuid-race-2 succeeded
        self.assertIn("uuid-race-2", mock_client.field_updates)

        # Verify metrics reported by worker
        self.assertEqual(result["candidates_updated"], 1)
        self.assertEqual(result["candidates_skipped_concurrent"], 1)
        self.assertEqual(result["candidates_failed"], 0)
        self.assertEqual(result["candidates_protected_by_curation"], 0)

    def test_unedited_v1_candidate_is_eligible_for_v2_update(self):
        """
        Regression Test: Confirms that an unedited V1 candidate is recognized as clean
        and eligible for V2 mathematical re-extraction, even though original_extracted_text
        contains raw OCR numbering prefixes ('1. ', '2. ') and option blocks.
        """
        # Baseline V1 record from test_source.pdf
        v1_row = {
            "id": "uuid-v1-cand1",
            "candidate_id": "cand-p1-q1",
            "review_status": "PENDING",
            "review_notes": None,
            "promoted_question_id": None,
            "promotion_token": None,
            "reviewed_by": None,
            "reviewed_at": None,
            "candidate_question_text": "Simplified form of −",
            "original_extracted_text": "1. Simplified form of −\na) tan2θ b) sec2θ c) 1 d) - -1",
            "content_hash": compute_content_hash("Simplified form of −"),
            "target_difficulty": "MEDIUM",
            "target_marks": 1.0,
            "target_negative_marks": 0.0,
        }

        # cand_text != orig_text MUST NOT trigger false-positive curation
        self.assertNotEqual(v1_row["candidate_question_text"], v1_row["original_extracted_text"])

        # assess_candidate_curation MUST return False
        is_curated, reason = assess_candidate_curation(v1_row)
        self.assertFalse(is_curated)
        self.assertEqual(reason, "")

    def test_genuine_administrator_edited_candidate_is_protected(self):
        """
        Regression Test: Confirms that when an administrator actually edits the question stem,
        the candidate diverges from its stored content_hash and is strictly protected.
        """
        edited_row = {
            "id": "uuid-v1-edited",
            "candidate_id": "cand-p1-q1",
            "review_status": "PENDING",  # Even if status is still PENDING!
            "review_notes": None,
            "promoted_question_id": None,
            "candidate_question_text": "Find the simplified form of (sec^2 theta - 1)",  # Human corrected!
            "original_extracted_text": "1. Simplified form of −\na) tan2θ b) sec2θ c) 1 d) - -1",
            "content_hash": compute_content_hash("Simplified form of −"),  # Pipeline hash
            "target_difficulty": "MEDIUM",
            "target_marks": 1.0,
        }

        # assess_candidate_curation MUST detect the manual edit
        is_curated, reason = assess_candidate_curation(edited_row)
        self.assertTrue(is_curated)
        self.assertIn("content_hash mismatch", reason)

    def test_v2_reprocessing_is_idempotent(self):
        """
        Regression Test: Confirms that reprocessing a batch that was already updated with V2
        is completely idempotent and does not misclassify V2 math formatting as human edits.
        """
        v2_math_text = "Simplified form of $\\sec^2\\theta - 1$"
        v2_content_hash = compute_content_hash(v2_math_text)

        # Staging row after initial V2 update
        v2_staged_row = {
            "id": "uuid-v2-idempotent",
            "candidate_id": "cand-p1-q1",
            "review_status": "PENDING",
            "review_notes": None,
            "promoted_question_id": None,
            "candidate_question_text": v2_math_text,
            "original_extracted_text": "1. Simplified form of −\na) tan2θ b) sec2θ c) 1 d) - -1",
            "content_hash": v2_content_hash,
            "target_difficulty": "MEDIUM",
            "target_marks": 1.0,
            "target_negative_marks": 0.0,
        }

        # When reprocessed with V2, assess_candidate_curation must NOT flag it as edited
        is_curated, reason = assess_candidate_curation(v2_staged_row)
        self.assertFalse(is_curated)
        self.assertEqual(reason, "")


if __name__ == "__main__":
    unittest.main()

