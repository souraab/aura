#!/usr/bin/env python3
"""
AuraMentor — Milestone 2: Batch Ingestion Triage Integration Test Suite
File: scripts/ingestion/test_batch_triage_integration.py

Tests shadow-mode quality triage integration in BatchQualityTriageRunner and
BatchIngestionWorker (--dry-run), verifying zero Supabase writes, content
preservation, exception isolation, and accurate batch-level JSON reporting.
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from math_engine.batch_triage import BatchQualityTriageRunner
from math_engine.quality_scorer import MathematicalQualityScorer
from mineru_adapter import process_mineru_pdf
from process_batch import BatchProcessor


class TestBatchTriageIntegration(unittest.TestCase):
    """Regression suite for Milestone 2 Shadow-Mode Batch Triage Integration."""

    def test_1_existing_38_question_benchmark_via_worker_dry_run(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            worker = BatchProcessor(
                batch_id="0811532e-91bb-46e0-96fd-e4341a0539dc",
                client=None,
                dry_run=True,
                local_pdf_override=str(CURRENT_DIR / "test_source.pdf"),
                engine="mineru",
                triage_report_dir=tmpdir,
            )
            audit_report = worker.run()

            self.assertTrue(audit_report["dry_run"])
            self.assertEqual(audit_report["total_candidates"], 38)
            self.assertIsNotNone(audit_report["triage_report_path"])
            report_path = Path(audit_report["triage_report_path"])
            self.assertTrue(report_path.exists())

            report = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertTrue(report["shadow_mode"])
            self.assertFalse(report["auto_approval_enabled"])
            self.assertEqual(report["total_candidates_processed"], 38)
            self.assertEqual(report["category_counts"]["CATEGORY_A"], 26)
            self.assertEqual(report["category_counts"]["CATEGORY_B"], 12)
            self.assertEqual(report["category_counts"]["CATEGORY_C"], 0)
            self.assertEqual(report["outcome_breakdown"]["evaluated_successfully"], 38)
            self.assertEqual(report["outcome_breakdown"]["quality_evaluation_failures"], 0)
            self.assertGreaterEqual(report["quality_engine_processing_time_ms"], 0.0)

    def test_2_empty_stem_candidate_classified_as_extraction_failure(self):
        data = {
            "candidates": [
                {
                    "candidate_id": "cand-empty",
                    "detected_question_label": "1.",
                    "candidate_question_text": "",
                    "detected_options": [],
                    "inferred_type": "SUBJECTIVE",
                    "detected_diagrams": [],
                }
            ]
        }
        report = BatchQualityTriageRunner.evaluate_batch(data, "test-empty", save_report=False)
        self.assertEqual(report["category_counts"]["CATEGORY_C"], 1)
        self.assertEqual(report["outcome_breakdown"]["extraction_failures"], 1)
        self.assertEqual(report["outcome_breakdown"]["quality_evaluation_failures"], 0)
        self.assertEqual(
            report["questions_requiring_critical_review"][0]["classification_type"],
            "EXTRACTION_FAILED",
        )

    def test_3_malformed_latex_classified_as_evaluated_category_c(self):
        data = {
            "candidates": [
                {
                    "candidate_id": "cand-bad-latex",
                    "detected_question_label": "2.",
                    "candidate_question_text": "Solve $\\frac{1}{2$ for $x$.",
                    "detected_options": [],
                    "inferred_type": "SUBJECTIVE",
                    "detected_diagrams": [],
                }
            ]
        }
        report = BatchQualityTriageRunner.evaluate_batch(data, "test-bad-latex", save_report=False)
        self.assertEqual(report["category_counts"]["CATEGORY_C"], 1)
        self.assertEqual(report["outcome_breakdown"]["evaluated_category_c"], 1)
        self.assertEqual(report["outcome_breakdown"]["quality_evaluation_failures"], 0)
        self.assertEqual(
            report["questions_requiring_critical_review"][0]["classification_type"],
            "EVALUATED_CATEGORY_C",
        )

    def test_4_unwrapped_math_command_routed_to_category_b(self):
        orig_text = "| Time (in \\sec) | 0-20 | 20-40 |\n| --- | --- | --- |\n| Students | 8 | 10 |"
        data = {
            "candidates": [
                {
                    "candidate_id": "cand-unwrapped",
                    "detected_question_label": "37.",
                    "candidate_question_text": orig_text,
                    "detected_options": [],
                    "inferred_type": "CASE_BASED",
                    "detected_diagrams": [],
                }
            ]
        }
        report = BatchQualityTriageRunner.evaluate_batch(data, "test-unwrapped", save_report=False)
        self.assertEqual(report["category_counts"]["CATEGORY_B"], 1)
        self.assertIn("UNWRAPPED_LATEX_COMMAND", report["warning_code_frequency"])
        # Content must remain completely unmodified
        self.assertEqual(data["candidates"][0]["candidate_question_text"], orig_text)

    def test_5_attached_diagram_routed_to_category_b(self):
        data = {
            "candidates": [
                {
                    "candidate_id": "cand-diag",
                    "detected_question_label": "5.",
                    "candidate_question_text": "In the given figure, find $x$.",
                    "detected_options": [],
                    "inferred_type": "SUBJECTIVE",
                    "detected_diagrams": [{"diagram_id": "diag-1"}],
                }
            ]
        }
        report = BatchQualityTriageRunner.evaluate_batch(data, "test-diag", save_report=False)
        self.assertEqual(report["category_counts"]["CATEGORY_B"], 1)
        self.assertIn("DIAGRAM_ATTACHED_VERIFY_ASSOCIATION", report["warning_code_frequency"])

    def test_6_unassociated_nearby_diagram_routed_to_category_b(self):
        data = {
            "candidates": [
                {
                    "candidate_id": "cand-nearby-diag",
                    "detected_question_label": "8.",
                    "candidate_question_text": "Find the area of a circle of radius 7 cm.",
                    "detected_options": [],
                    "inferred_type": "SUBJECTIVE",
                    "detected_diagrams": [],
                    "unassociated_diagram_nearby": True,
                }
            ]
        }
        report = BatchQualityTriageRunner.evaluate_batch(data, "test-nearby", save_report=False)
        self.assertEqual(report["category_counts"]["CATEGORY_B"], 1)
        self.assertIn("UNASSOCIATED_DIAGRAM_ON_PAGE", report["warning_code_frequency"])

    def test_7_missing_referenced_diagram_routed_to_category_c(self):
        data = {
            "candidates": [
                {
                    "candidate_id": "cand-missing-diag",
                    "detected_question_label": "6.",
                    "candidate_question_text": "In the given figure, find $\\angle BOC$.",
                    "detected_options": [],
                    "inferred_type": "SUBJECTIVE",
                    "detected_diagrams": [],
                }
            ]
        }
        report = BatchQualityTriageRunner.evaluate_batch(data, "test-missing-diag", save_report=False)
        self.assertEqual(report["category_counts"]["CATEGORY_C"], 1)
        self.assertIn("MISSING_REFERENCED_DIAGRAM", report["warning_code_frequency"])

    def test_8_quality_evaluation_exception_isolated_and_never_category_a(self):
        data = {
            "candidates": [
                {
                    "candidate_id": "cand-good-1",
                    "detected_question_label": "1.",
                    "candidate_question_text": "Find the HCF of 12 and 18.",
                    "detected_options": [],
                    "inferred_type": "SUBJECTIVE",
                    "detected_diagrams": [],
                },
                {
                    "candidate_id": "cand-boom",
                    "detected_question_label": "2.",
                    "candidate_question_text": "Trigger mocked scorer crash.",
                    "detected_options": [],
                    "inferred_type": "SUBJECTIVE",
                    "detected_diagrams": [],
                },
                {
                    "candidate_id": "cand-good-2",
                    "detected_question_label": "3.",
                    "candidate_question_text": "Find the LCM of 6 and 8.",
                    "detected_options": [],
                    "inferred_type": "SUBJECTIVE",
                    "detected_diagrams": [],
                },
            ]
        }

        real_eval = MathematicalQualityScorer.evaluate_candidate

        def flaky_eval(*args, **kwargs):
            if "Trigger mocked scorer crash" in kwargs.get("candidate_text", ""):
                raise RuntimeError("Simulated scorer AST crash")
            return real_eval(*args, **kwargs)

        with patch.object(MathematicalQualityScorer, "evaluate_candidate", side_effect=flaky_eval):
            report = BatchQualityTriageRunner.evaluate_batch(data, "test-exception", save_report=False)

        self.assertEqual(report["total_candidates_processed"], 3)
        self.assertEqual(report["category_counts"]["CATEGORY_A"], 2)
        self.assertEqual(report["category_counts"]["CATEGORY_C"], 1)
        self.assertEqual(report["outcome_breakdown"]["evaluated_successfully"], 2)
        self.assertEqual(report["outcome_breakdown"]["quality_evaluation_failures"], 1)
        self.assertEqual(len(report["errors"]), 1)
        self.assertEqual(report["errors"][0]["candidate_id"], "cand-boom")
        self.assertEqual(data["candidates"][1]["review_category"], "CATEGORY_C")
        self.assertEqual(data["candidates"][1]["shadow_triage"]["evaluation_status"], "EVALUATION_FAILED")

    def test_9_mixed_abc_batch_preserves_original_content(self):
        cands = [
            {
                "candidate_id": "cand-a",
                "detected_question_label": "1.",
                "candidate_question_text": "Find the roots of $x^2 - 5x + 6 = 0$.",
                "detected_options": [],
                "inferred_type": "SUBJECTIVE",
                "detected_diagrams": [],
            },
            {
                "candidate_id": "cand-b",
                "detected_question_label": "2.",
                "candidate_question_text": "In the given figure, find $x$.",
                "detected_options": [],
                "inferred_type": "SUBJECTIVE",
                "detected_diagrams": [{"diagram_id": "d1"}],
            },
            {
                "candidate_id": "cand-c",
                "detected_question_label": "3.",
                "candidate_question_text": "Simplified form of -",
                "detected_options": [],
                "inferred_type": "SUBJECTIVE",
                "detected_diagrams": [],
            },
        ]
        orig_texts = [c["candidate_question_text"] for c in cands]

        with tempfile.TemporaryDirectory() as tmpdir:
            report = BatchQualityTriageRunner.evaluate_batch(
                {"candidates": cands},
                batch_id="mixed-abc",
                report_dir=Path(tmpdir),
                save_report=True,
            )
            self.assertEqual(report["category_counts"]["CATEGORY_A"], 1)
            self.assertEqual(report["category_counts"]["CATEGORY_B"], 1)
            self.assertEqual(report["category_counts"]["CATEGORY_C"], 1)
            self.assertEqual([c["candidate_question_text"] for c in cands], orig_texts)
            self.assertTrue(Path(report["report_path"]).exists())
            self.assertTrue(report["report_verified"])
            self.assertEqual(report["report_generation_status"], "SUCCESS")

    # -------------------------------------------------------------------------
    # Milestone 2.2 Regression Tests
    # -------------------------------------------------------------------------
    def test_10_malformed_candidates_beginning_middle_end_isolated(self):
        cands = [
            None,
            {
                "candidate_id": "valid-1",
                "detected_question_label": "2.",
                "candidate_question_text": "Find the LCM of 12 and 18.",
                "detected_options": [],
                "inferred_type": "SUBJECTIVE",
                "detected_diagrams": [],
            },
            ["bad-list"],
            "bad-string",
            {
                "candidate_id": "valid-2",
                "detected_question_label": "5.",
                "candidate_question_text": "Prove that $\\sqrt{2}$ is irrational.",
                "detected_options": [],
                "inferred_type": "SUBJECTIVE",
                "detected_diagrams": [],
            },
            12345,
        ]
        report = BatchQualityTriageRunner.evaluate_batch(
            {"candidates": cands},
            batch_id="malformed-positions",
            save_report=False,
        )
        self.assertEqual(report["total_candidates_processed"], 6)
        self.assertEqual(report["category_counts"]["CATEGORY_A"], 2)
        self.assertEqual(report["category_counts"]["CATEGORY_C"], 4)
        self.assertEqual(report["outcome_breakdown"]["evaluated_successfully"], 2)
        self.assertEqual(report["outcome_breakdown"]["quality_evaluation_failures"], 4)
        self.assertEqual(len(report["errors"]), 4)
        self.assertEqual(cands[1]["review_category"], "CATEGORY_A")
        self.assertEqual(cands[4]["review_category"], "CATEGORY_A")

    def test_11_report_generation_unwritable_directory_handled_safely(self):
        cands = [
            {
                "candidate_id": "c1",
                "detected_question_label": "1.",
                "candidate_question_text": "Find the roots of $x^2 - 4 = 0$.",
                "detected_options": [],
                "inferred_type": "SUBJECTIVE",
                "detected_diagrams": [],
            }
        ]
        report = BatchQualityTriageRunner.evaluate_batch(
            {"candidates": cands},
            batch_id="unwritable-dir",
            report_dir=Path("/dev/null/impossible_dir"),
            save_report=True,
        )
        self.assertEqual(report["report_generation_status"], "FAILED")
        self.assertFalse(report["report_verified"])
        self.assertIsNone(report["report_path"])
        self.assertIsNotNone(report["report_generation_error"])
        self.assertEqual(cands[0]["review_category"], "CATEGORY_A")
        self.assertTrue(any(e["candidate_id"] == "__batch_report__" for e in report["errors"]))

    def test_12_report_generation_json_serialization_failure_handled_safely(self):
        cands = [
            {
                "candidate_id": "c1",
                "detected_question_label": "1.",
                "candidate_question_text": "Find the roots of $x^2 - 9 = 0$.",
                "detected_options": [],
                "inferred_type": "SUBJECTIVE",
                "detected_diagrams": [],
            }
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("math_engine.batch_triage.json.dumps", side_effect=TypeError("Object of type set is not JSON serializable")):
                report = BatchQualityTriageRunner.evaluate_batch(
                    {"candidates": cands},
                    batch_id="json-fail",
                    report_dir=Path(tmpdir),
                    save_report=True,
                )
        self.assertEqual(report["report_generation_status"], "FAILED")
        self.assertFalse(report["report_verified"])
        self.assertIsNone(report["report_path"])
        self.assertIn("TypeError", report["report_generation_error"])

    def test_13_report_generation_verification_failure_on_corrupted_file(self):
        cands = [
            {
                "candidate_id": "c1",
                "detected_question_label": "1.",
                "candidate_question_text": "Find the roots of $x^2 - 1 = 0$.",
                "detected_options": [],
                "inferred_type": "SUBJECTIVE",
                "detected_diagrams": [],
            }
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch.object(Path, "read_text", return_value="{corrupted-json"):
                report = BatchQualityTriageRunner.evaluate_batch(
                    {"candidates": cands},
                    batch_id="corrupt-verify",
                    report_dir=Path(tmpdir),
                    save_report=True,
                )
        self.assertEqual(report["report_generation_status"], "FAILED")
        self.assertFalse(report["report_verified"])
        self.assertIsNone(report["report_path"])

    def test_14_live_staging_blocked_when_triage_report_unverified(self):
        from unittest.mock import MagicMock
        mock_client = MagicMock()
        mock_client.get_batch.return_value = {
            "id": "00000000-0000-0000-0000-000000000099",
            "pdf_storage_path": "ingestion/00000000-0000-0000-0000-000000000099/source.pdf",
            "pdf_filename": "sample_math_paper.pdf",
            "pdf_file_hash": "0" * 64,
            "pdf_file_size_bytes": 0,
            "status": "PENDING",
            "metadata": {},
        }
        worker = BatchProcessor(
            batch_id="00000000-0000-0000-0000-000000000099",
            client=mock_client,
            dry_run=False,
            local_pdf_override=str(CURRENT_DIR / "sample_math_paper.pdf"),
            engine="v2",
            triage_report_dir="/dev/null/impossible_dir",
        )
        with self.assertRaises(RuntimeError) as ctx:
            worker.run()
        self.assertIn("blocking live staging write", str(ctx.exception))
        mock_client.upsert_staging_questions.assert_not_called()
        mock_client.update_staging_question.assert_not_called()

    def test_15_cli_offline_dry_run_makes_zero_network_calls(self):
        import process_batch
        test_argv = [
            "process_batch.py",
            "--batch-id", "0811532e-91bb-46e0-96fd-e4341a0539dc",
            "--local-pdf", str(CURRENT_DIR / "test_source.pdf"),
            "--engine", "mineru",
            "--dry-run",
        ]
        with patch.object(sys, "argv", test_argv), \
             patch("process_batch.load_ingestion_credentials", return_value=("https://example.supabase.co", "fake-key")), \
             patch("process_batch.SupabaseRestClient") as mock_rest_cls, \
             patch("process_batch.urllib.request.urlopen") as mock_urlopen:
            process_batch.main()
            mock_urlopen.assert_not_called()
            mock_rest_cls.assert_not_called()


if __name__ == "__main__":
    unittest.main()
