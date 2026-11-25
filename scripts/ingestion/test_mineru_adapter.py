#!/usr/bin/env python3
"""
Unit and Regression Tests for MinerU Adapter and Question Reconstruction Pipeline
File: scripts/ingestion/test_mineru_adapter.py
"""

import unittest
from pathlib import Path

from scripts.ingestion.mineru_adapter import (
    canonicalize_latex_math,
    extract_mcq_options,
    extract_subparts,
    compute_content_hash,
    process_mineru_pdf,
)
from scripts.ingestion.math_engine.latex_validator import LatexValidator
from scripts.ingestion.process_batch import (
    BatchProcessor,
    SupabaseRestClient,
    assess_candidate_curation,
)


class TestMinerUAdapter(unittest.TestCase):
    """Verifies MinerU adapter functions, KaTeX validation, and reconstruction quality."""

    def test_canonicalize_trigonometric_spacing(self):
        raw = r"\frac { c o s ^ { 2 } \theta } { s i n ^ { 2 } \theta } - \frac { 1 } { s i n ^ { 2 } \theta }"
        cleaned = canonicalize_latex_math(raw)
        self.assertIn(r"\cos^{2}\theta", cleaned)
        self.assertIn(r"\sin^{2}\theta", cleaned)
        self.assertNotIn("c o s", cleaned)
        self.assertNotIn("s i n", cleaned)

        # Validate with KaTeX validator
        val = LatexValidator.validate(cleaned)
        self.assertTrue(val.is_valid, f"KaTeX validation failed: {val.errors}")

    def test_canonicalize_dangling_operator(self):
        raw = r"\tan $( \mathrm{A}- \mathrm{B}) = 1 / \sqrt{3}, \; 0^{\circ}< \mathrm{A}+ \mathrm{B}\leq 90^{\circ}; \; \mathrm{A}>$ B, find A and B."
        cleaned = canonicalize_latex_math(raw)
        self.assertIn(r"\mathrm{A}> B$", cleaned)

    def test_extract_mcq_options_standard(self):
        text = "Simplified form of expression a) $\\tan^{2}\\theta$ b) $\\sec^{2}\\theta$ c) 1 d) -1"
        stem, opts = extract_mcq_options(text)
        self.assertEqual(stem, "Simplified form of expression")
        self.assertEqual(len(opts), 4)
        self.assertEqual([o["key"] for o in opts], ["a", "b", "c", "d"])
        self.assertEqual(opts[0]["text"], "$\\tan^{2}\\theta$")
        self.assertEqual(opts[2]["text"], "1")

    def test_extract_mcq_options_unicode_math(self):
        text = "An unbiased die is thrown once. The probability is 𝑎) $\\frac{2}{5}$ 𝑏) $\\frac{1}{3}$ 𝑐) $\\frac{2}{3}$ 𝑑) $\\frac{1}{2}$"
        stem, opts = extract_mcq_options(text)
        self.assertEqual(len(opts), 4)
        self.assertEqual([o["key"] for o in opts], ["a", "b", "c", "d"])
        self.assertIn("die is thrown once", stem)

    def test_extract_assertion_reason_options(self):
        text = (
            "Assertion (A): The radius is 8 cm. Reason (R): Volume of cone is 1/3 pi r^2 h. "
            "(a) Both assertion (A) and reason (R) are true and reason (R) is correct explanation. "
            "(b) Both assertion (A) and reason (R) are true but reason (R) is not correct. "
            "(c) Assertion (A) is true but reason (R) is false. "
            "(d) Assertion (A) is false but reason (R) is true."
        )
        stem, opts = extract_mcq_options(text)
        self.assertEqual(len(opts), 4)
        self.assertEqual([o["key"] for o in opts], ["a", "b", "c", "d"])
        self.assertIn("Assertion (A): The radius is 8 cm", stem)
        self.assertIn("Reason (R): Volume of cone is 1/3 pi r^2 h.", stem)

    def test_extract_subparts(self):
        text = "Solve the following:\n(a) Find the roots of the equation\n(b) Verify the discriminant"
        subparts = extract_subparts(text)
        self.assertEqual(len(subparts), 2)
        self.assertEqual(subparts[0]["label"], "a")
        self.assertEqual(subparts[1]["label"], "b")

    def test_duplicated_signs_regression(self):
        """Regression test ensuring duplicated mathematical signs are not introduced and are normalized."""
        raw_options = "a) $\\tan^{2}\\theta$ b) $\\sec^{2}\\theta$ c) 1 d) - -1"
        stem, opts = extract_mcq_options(raw_options)
        self.assertEqual(opts[3]["text"], "-1")
        self.assertNotIn("- -1", opts[3]["text"])
        self.assertNotIn("--", opts[3]["text"])

        # Also test with various dash types (en-dash, em-dash, unicode minus)
        self.assertEqual(canonicalize_latex_math("- -1"), "-1")
        self.assertEqual(canonicalize_latex_math("--5"), "-5")
        self.assertEqual(canonicalize_latex_math("− -1"), "-1")

    def test_reconstruct_full_38_candidates(self):
        test_pdf = Path("scripts/ingestion/test_source.pdf")
        res = process_mineru_pdf(str(test_pdf))
        candidates = res["candidates"]
        self.assertEqual(len(candidates), 38)

        # Question 1 verification
        q1 = candidates[0]
        self.assertEqual(q1["detected_question_label"], "1.")
        self.assertEqual(q1["inferred_type"], "MCQ")
        self.assertEqual(len(q1["detected_options"]), 4)
        self.assertIn(r"\frac{\cos^{2}\theta}{\sin^{2}\theta}", q1["candidate_question_text"])
        # Verify option d is -1, not - -1
        self.assertEqual(q1["detected_options"][3]["text"], "-1")
        # Verify confidence is appropriately discounted due to OCR repair
        self.assertLess(q1["extraction_confidence"], 1.0)
        self.assertIn("OCR_DEFECT_REPAIRED: Duplicated mathematical sign in raw extraction corrected.", q1["extraction_warnings"])

        # Diagrams verification: 8 questions have diagrams, total 9 diagrams (Q25 has 2)
        diag_candidates = [c for c in candidates if c["detected_diagrams"]]
        self.assertEqual(len(diag_candidates), 8)  # Q5, Q6, Q25, Q31, Q32, Q36, Q37, Q38
        total_diags = sum(len(c["detected_diagrams"]) for c in candidates)
        self.assertEqual(total_diags, 9)
        # Verify Q25 has both diagrams
        q25 = candidates[24]
        self.assertEqual(len(q25["detected_diagrams"]), 2)

        # KaTeX validation across all expressions
        import re
        total_expressions = 0
        for c in candidates:
            self.assertTrue(len(c["candidate_question_text"]) > 0)
            exprs = re.findall(r"\$([^\$]+)\$", c["candidate_question_text"])
            for opt in c["detected_options"]:
                exprs.extend(re.findall(r"\$([^\$]+)\$", opt["text"]))
            for expr in exprs:
                total_expressions += 1
                val = LatexValidator.validate(expr)
                self.assertTrue(val.is_valid, f"KaTeX error in {c['detected_question_label']}: {val.errors}")

        self.assertGreaterEqual(total_expressions, 70)

    def test_content_hash_integrity(self):
        text1 = "Simplified form of $\\frac{\\cos^{2}\\theta}{\\sin^{2}\\theta}$"
        text2 = "Simplified   form  of   $\\frac{\\cos^{2}\\theta}{\\sin^{2}\\theta}$  "
        h1 = compute_content_hash(text1)
        h2 = compute_content_hash(text2)
        self.assertEqual(h1, h2)


class MockSupabaseClient(SupabaseRestClient):
    """Mock Supabase REST Client for offline tests."""

    def __init__(self, batch_data, staging_data):
        self.batch_data = batch_data
        self.staging_data = staging_data
        self.updated_records = []
        self.supabase_url = "https://mock.supabase.co"

    def get_batch(self, batch_id):
        return self.batch_data

    def get_staging_questions_for_batch(self, batch_id):
        return self.staging_data

    def get_existing_staging_questions(self, batch_id):
        return self.staging_data

    def acquire_processing_lock(self, batch_id, lease_seconds=300):
        return "mock-lease-token"

    def update_staging_question(self, staging_id, fields, expected_updated_at=None):
        self.updated_records.append((staging_id, fields, expected_updated_at))
        return True

    def upsert_staging_questions(self, records):
        return len(records)

    def update_batch_status(self, batch_id, status, error_message=None, metrics=None):
        return True


class TestBatchProcessorWithMinerUEngine(unittest.TestCase):
    """Verifies that BatchProcessor with engine='mineru' seamlessly integrates."""

    def test_mineru_dry_run_audit(self):
        mock_batch = {
            "id": "00000000-0000-0000-0000-000000000002",
            "pdf_filename": "test_source.pdf",
            "pdf_storage_path": "ingestion/00000000-0000-0000-0000-000000000002/source.pdf",
            "pdf_file_hash": "dd5883247730127622356fa77e45391a022ff09c8782c6606ca6b85e2afb7995",
            "pdf_file_size_bytes": 1000,
            "status": "PENDING",
            "metadata": {},
        }
        mock_client = MockSupabaseClient(mock_batch, [])
        processor = BatchProcessor(
            batch_id="00000000-0000-0000-0000-000000000002",
            client=mock_client,
            dry_run=True,
            force=False,
            local_pdf_override=str(Path("scripts/ingestion/test_source.pdf").resolve()),
            engine="mineru",
        )
        report = processor.run()
        self.assertEqual(report["status"], "VALIDATED")
        self.assertEqual(report["total_candidates"], 38)
        self.assertEqual(report["eligible_for_v2_update"], 38)
        self.assertEqual(report["protected_by_curation"], 0)


if __name__ == "__main__":
    unittest.main()
