#!/usr/bin/env python3
"""
Unit Test Suite for AuraMentor Question Ingestion Staging Pipeline (Phase 2C)
File: scripts/ingestion/test_staging_pipeline.py
"""

import json
import os
import sys
import unittest

# Ensure current dir is in Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from import_to_staging import (
    compute_file_sha256,
    normalize_question_text,
    compute_content_hash,
    prepare_staging_payloads
)


class TestStagingPipeline(unittest.TestCase):

    def setUp(self):
        self.base_dir = os.path.dirname(os.path.abspath(__file__))
        self.test_source_pdf = os.path.join(self.base_dir, "test_source.pdf")
        self.real_test_json = os.path.join(self.base_dir, "real_test_output_v3.json")
        self.second_test_pdf = os.path.join(self.base_dir, "second_test.pdf")
        self.cross_doc_json = os.path.join(self.base_dir, "cross_document_test_output_v2.json")

    def test_compute_file_sha256(self):
        """Verify binary SHA-256 and byte size computation."""
        file_hash, size = compute_file_sha256(self.test_source_pdf)
        self.assertEqual(len(file_hash), 64)
        self.assertEqual(file_hash, "dd5883247730127622356fa77e45391a022ff09c8782c6606ca6b85e2afb7995")
        self.assertEqual(size, 791291)

    def test_normalize_question_text(self):
        """Verify text normalization strips LaTeX, punctuation and extra spaces."""
        raw_text = "Find the roots of \\frac{x^2 - 4}{2} = 0, where x \\in \\mathbb{R}."
        norm = normalize_question_text(raw_text)
        self.assertEqual(norm, "find the roots of x 2 4 2 0 where x r")

    def test_compute_content_hash_deterministic(self):
        """Verify content hash is identical across formatting variations."""
        text1 = "Solve for x: 2x + 5 = 15."
        text2 = "  solve for x: 2x+5=15.  "
        hash1 = compute_content_hash(text1)
        hash2 = compute_content_hash(text2)
        self.assertEqual(hash1, hash2)
        self.assertEqual(len(hash1), 64)

    def test_prepare_staging_payloads_structure(self):
        """Verify staging batch and questions payload conforms to schema."""
        with open(self.real_test_json, "r", encoding="utf-8") as f:
            data = json.load(f)

        plan = prepare_staging_payloads(
            pdf_path=self.test_source_pdf,
            extraction_data=data,
            batch_id="test-batch-uuid-1234",
            default_chapter_id="chap-ch01-uuid"
        )

        # Batch record assertions
        batch_rec = plan["batch_record"]
        self.assertEqual(batch_rec["id"], "test-batch-uuid-1234")
        self.assertEqual(batch_rec["pdf_filename"], "test_source.pdf")
        self.assertEqual(batch_rec["pdf_storage_path"], "ingestion/test-batch-uuid-1234/source.pdf")
        self.assertEqual(batch_rec["total_questions"], 38)
        self.assertEqual(batch_rec["status"], "PENDING")

        # Staging questions assertions
        staging_recs = plan["staging_records"]
        self.assertEqual(len(staging_recs), 38)

        # Candidate IDs must be strictly unique within the batch
        cand_ids = [r["candidate_id"] for r in staging_recs]
        self.assertEqual(len(cand_ids), len(set(cand_ids)))

        # Target chapter ID populated
        for r in staging_recs:
            self.assertEqual(r["target_chapter_id"], "chap-ch01-uuid")
            self.assertEqual(r["review_status"], "PENDING")
            self.assertIsNotNone(r["content_hash"])

    def test_diagram_storage_remapping(self):
        """Verify diagram URLs are remapped to canonical storage://question-media/... URIs."""
        mock_data = {
            "metadata": {"extractor_backend": "MacPDFKit2D"},
            "summary": {"total_pages": 1},
            "candidates": [
                {
                    "candidate_id": "cand-p1-q1",
                    "candidate_question_text": "In the given figure, find angle O.",
                    "detected_diagrams": [
                        {
                            "diagram_id": "diag-p1-1",
                            "source_page": 1,
                            "bbox": [100, 200, 300, 400]
                        }
                    ]
                }
            ]
        }

        plan = prepare_staging_payloads(
            pdf_path=self.test_source_pdf,
            extraction_data=mock_data,
            batch_id="b-999"
        )

        staging_rec = plan["staging_records"][0]
        diag = staging_rec["detected_diagrams"][0]
        self.assertEqual(diag["storage_path"], "ingestion/b-999/diagrams/diag-p1-1.png")
        self.assertEqual(diag["storage_url"], "storage://question-media/ingestion/b-999/diagrams/diag-p1-1.png")

    def test_cross_document_staging_plan(self):
        """Verify cross_document payload generation adheres to candidate constraints."""
        with open(self.cross_doc_json, "r", encoding="utf-8") as f:
            data = json.load(f)

        plan = prepare_staging_payloads(
            pdf_path=self.second_test_pdf,
            extraction_data=data
        )

        staging_recs = plan["staging_records"]
        self.assertEqual(len(staging_recs), 20)
        cand_ids = [r["candidate_id"] for r in staging_recs]
        self.assertEqual(len(cand_ids), len(set(cand_ids)))


if __name__ == "__main__":
    unittest.main()
