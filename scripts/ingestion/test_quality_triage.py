#!/usr/bin/env python3
"""
AuraMentor Universal Mathematical PDF & LaTeX Engine - Milestone 1 Unit Test Suite
Deterministic Quality Scorer & A/B/C Review Triage Classifier Test Suite

File: scripts/ingestion/test_quality_triage.py
"""

import sys
import unittest
from pathlib import Path

# Add ingestion path to sys.path
CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from math_engine.models import (
    CheckStatus,
    ReviewCategory,
    ValidationCheckResult,
    MathExpressionRecord,
    ExtractionQualityScore,
)
from math_engine.quality_scorer import MathematicalQualityScorer
from mineru_adapter import process_mineru_pdf


class TestDeterministicQualityScorerAndTriage(unittest.TestCase):
    """
    Validates the 7 independent checks and deterministic A/B/C review classification.
    """

    def setUp(self):
        self.scorer = MathematicalQualityScorer

    # -------------------------------------------------------------------------
    # 1. Structure & Model Contracts
    # -------------------------------------------------------------------------
    def test_validation_check_result_serialization(self):
        result = ValidationCheckResult(
            check_name="TEXT_COMPLETENESS",
            status=CheckStatus.PASS,
            code="TEXT_VALID",
            message="Question text complete.",
            details={"char_count": 50},
        )
        d = result.to_dict()
        self.assertEqual(d["check_name"], "TEXT_COMPLETENESS")
        self.assertEqual(d["status"], "PASS")
        self.assertEqual(d["code"], "TEXT_VALID")
        self.assertEqual(d["message"], "Question text complete.")
        self.assertEqual(d["details"]["char_count"], 50)

    def test_all_seven_checks_present_in_evaluation(self):
        quality = self.scorer.evaluate_candidate(
            candidate_text="Find the roots of the quadratic equation $x^2 - 5x + 6 = 0$.",
            detected_options=[],
            detected_subparts=[],
            math_expressions=[
                MathExpressionRecord(
                    expression_id="expr-1",
                    original_text="x^2 - 5x + 6 = 0",
                    latex="x^{2}- 5x + 6 = 0",
                    is_valid_latex=True,
                )
            ],
            inferred_type="SUBJECTIVE",
            diagram_count=0,
        )
        expected_checks = [
            "TEXT_COMPLETENESS",
            "MATHEMATICAL_INTEGRITY",
            "QUESTION_STRUCTURE",
            "MCQ_OPTION_COMPLETENESS",
            "DIAGRAM_ASSOCIATION",
            "TABLE_AND_SUBPARTS",
            "DUPLICATE_DETECTION",
        ]
        for chk in expected_checks:
            self.assertIn(chk, quality.checks)
            self.assertIsInstance(quality.checks[chk], ValidationCheckResult)

    # -------------------------------------------------------------------------
    # 2. Category A (Clean Candidates)
    # -------------------------------------------------------------------------
    def test_category_a_clean_mcq(self):
        quality = self.scorer.evaluate_candidate(
            candidate_text="If $\\alpha$ and $\\beta$ are the zeroes of a polynomial, find $\\alpha + \\beta$.",
            detected_options=[
                {"key": "a", "text": "$-b/a$"},
                {"key": "b", "text": "$c/a$"},
                {"key": "c", "text": "$-c/a$"},
                {"key": "d", "text": "$b/a$"},
            ],
            detected_subparts=[],
            math_expressions=[
                MathExpressionRecord("e1", "\\alpha", "\\alpha", is_valid_latex=True),
                MathExpressionRecord("e2", "\\beta", "\\beta", is_valid_latex=True),
            ],
            inferred_type="MCQ",
            diagram_count=0,
        )
        self.assertEqual(quality.review_category, ReviewCategory.CATEGORY_A.value)
        self.assertEqual(len(quality.gate_failures), 0)
        self.assertEqual(len(quality.inspection_targets), 0)
        self.assertEqual(quality.checks["TEXT_COMPLETENESS"].status, CheckStatus.PASS)
        self.assertEqual(quality.checks["MATHEMATICAL_INTEGRITY"].status, CheckStatus.PASS)
        self.assertEqual(quality.checks["QUESTION_STRUCTURE"].status, CheckStatus.PASS)
        self.assertEqual(quality.checks["MCQ_OPTION_COMPLETENESS"].status, CheckStatus.PASS)
        self.assertEqual(quality.checks["DIAGRAM_ASSOCIATION"].status, CheckStatus.PASS)

    def test_category_a_clean_subjective(self):
        quality = self.scorer.evaluate_candidate(
            candidate_text="Prove that $\\sqrt{5}$ is an irrational number.",
            detected_options=[],
            detected_subparts=[],
            math_expressions=[
                MathExpressionRecord("e1", "\\sqrt{5}", "\\sqrt{5}", is_valid_latex=True)
            ],
            inferred_type="SUBJECTIVE",
            diagram_count=0,
        )
        self.assertEqual(quality.review_category, ReviewCategory.CATEGORY_A.value)
        self.assertEqual(len(quality.gate_failures), 0)
        self.assertEqual(len(quality.inspection_targets), 0)
        self.assertEqual(quality.checks["MCQ_OPTION_COMPLETENESS"].status, CheckStatus.NOT_APPLICABLE)

    def test_category_a_clean_table_question(self):
        quality = self.scorer.evaluate_candidate(
            candidate_text="Find the mode of the following distribution:\n\n| Class | Frequency |\n| --- | --- |\n| 0-10 | 5 |\n| 10-20 | 8 |",
            detected_options=[],
            detected_subparts=[],
            math_expressions=[],
            inferred_type="SUBJECTIVE",
            diagram_count=0,
            raw_text="| Class | Frequency |\n| --- | --- |\n| 0-10 | 5 |\n| 10-20 | 8 |",
        )
        self.assertEqual(quality.review_category, ReviewCategory.CATEGORY_A.value)
        self.assertEqual(quality.checks["TABLE_AND_SUBPARTS"].status, CheckStatus.PASS)
        self.assertEqual(quality.checks["TABLE_AND_SUBPARTS"].code, "TABLE_STRUCTURE_VALID")

    # -------------------------------------------------------------------------
    # 3. Category B (Targeted Human Inspection Required)
    # -------------------------------------------------------------------------
    def test_category_b_repaired_ocr_sign(self):
        # Q1 edge case: Duplicated minus sign in raw extraction ('- -1') repaired to '-1'
        quality = self.scorer.evaluate_candidate(
            candidate_text="Simplified form of $\\frac{\\cos^2\\theta}{\\sin^2\\theta} - \\frac{1}{\\sin^2\\theta}$",
            detected_options=[
                {"key": "a", "text": "$\\tan^2\\theta$"},
                {"key": "b", "text": "$\\sec^2\\theta$"},
                {"key": "c", "text": "1"},
                {"key": "d", "text": "-1"},
            ],
            detected_subparts=[],
            math_expressions=[
                MathExpressionRecord("e1", "\\cos^2\\theta", "\\cos^2\\theta", is_valid_latex=True)
            ],
            inferred_type="MCQ",
            diagram_count=0,
            raw_text="Simplified form of ...\n(a) tan^2\n(b) sec^2\n(c) 1\n(d) - -1",
        )
        self.assertEqual(quality.review_category, ReviewCategory.CATEGORY_B.value)
        self.assertEqual(len(quality.gate_failures), 0)
        self.assertEqual(quality.checks["MATHEMATICAL_INTEGRITY"].status, CheckStatus.WARNING)
        self.assertEqual(quality.checks["MATHEMATICAL_INTEGRITY"].code, "MATH_WARNING")
        self.assertTrue(any("MATHEMATICAL_INTEGRITY" in t for t in quality.inspection_targets))

    def test_category_b_diagram_attached(self):
        # Q5 edge case: Diagram attached triggers targeted inspection for visual correspondence
        quality = self.scorer.evaluate_candidate(
            candidate_text="In the given figure, $DE \\parallel BC$. If $AD = 3$ cm, find $EC$.",
            detected_options=[
                {"key": "a", "text": "1 cm"},
                {"key": "b", "text": "2 cm"},
                {"key": "c", "text": "3 cm"},
                {"key": "d", "text": "4 cm"},
            ],
            detected_subparts=[],
            math_expressions=[
                MathExpressionRecord("e1", "DE \\parallel BC", "DE \\parallel BC", is_valid_latex=True)
            ],
            inferred_type="MCQ",
            diagram_count=1,
            detected_diagrams=[{"diagram_id": "diag-p1-1", "storage_path": "ingestion/diagrams/p1.png"}],
        )
        self.assertEqual(quality.review_category, ReviewCategory.CATEGORY_B.value)
        self.assertEqual(len(quality.gate_failures), 0)
        self.assertEqual(quality.checks["DIAGRAM_ASSOCIATION"].status, CheckStatus.WARNING)
        self.assertEqual(quality.checks["DIAGRAM_ASSOCIATION"].code, "DIAGRAM_ATTACHED_VERIFY_ASSOCIATION")
        self.assertTrue(any("DIAGRAM_ASSOCIATION" in t for t in quality.inspection_targets))

    def test_category_b_dual_diagrams_or_choice(self):
        # Q25 edge case: 2 diagrams attached for internal choice
        quality = self.scorer.evaluate_candidate(
            candidate_text="In the given figure, $AB$ is a diameter...\n\n## OR\n\nIn the given figure, $TP$ and $TQ$ are tangents...",
            detected_options=[],
            detected_subparts=[],
            math_expressions=[
                MathExpressionRecord("e1", "AB", "AB", is_valid_latex=True)
            ],
            inferred_type="SUBJECTIVE",
            diagram_count=2,
            detected_diagrams=[
                {"diagram_id": "diag-p3-3", "storage_path": "diag-1.png"},
                {"diagram_id": "diag-p3-4", "storage_path": "diag-2.png"},
            ],
        )
        self.assertEqual(quality.review_category, ReviewCategory.CATEGORY_B.value)
        self.assertEqual(len(quality.gate_failures), 0)
        self.assertEqual(quality.checks["DIAGRAM_ASSOCIATION"].status, CheckStatus.WARNING)
        self.assertEqual(quality.checks["DIAGRAM_ASSOCIATION"].code, "MULTIPLE_DIAGRAMS_INTERNAL_CHOICE")
        self.assertTrue(any("DIAGRAM_ASSOCIATION" in t for t in quality.inspection_targets))

    def test_category_b_non_standard_mcq_option_count(self):
        # Restriction 4: Do not assume every MCQ has exactly 4 options. 3 options -> WARNING, NOT FAIL!
        quality = self.scorer.evaluate_candidate(
            candidate_text="Choose the correct classification for the given linear system:",
            detected_options=[
                {"key": "a", "text": "Consistent and independent"},
                {"key": "b", "text": "Consistent and dependent"},
                {"key": "c", "text": "Inconsistent"},
            ],
            detected_subparts=[],
            math_expressions=[],
            inferred_type="MCQ",
            diagram_count=0,
        )
        self.assertEqual(quality.review_category, ReviewCategory.CATEGORY_B.value)
        self.assertEqual(len(quality.gate_failures), 0)
        self.assertEqual(quality.checks["MCQ_OPTION_COMPLETENESS"].status, CheckStatus.WARNING)
        self.assertEqual(quality.checks["MCQ_OPTION_COMPLETENESS"].code, "NON_STANDARD_OPTION_COUNT")

    def test_category_b_moderate_duplicate_similarity(self):
        # Moderate duplicate match (75% similarity) -> WARNING
        quality = self.scorer.evaluate_candidate(
            candidate_text="Find the distance between $(2, 3)$ and $(4, 1)$.",
            detected_options=[],
            detected_subparts=[],
            math_expressions=[],
            inferred_type="SUBJECTIVE",
            diagram_count=0,
            duplicate_match={"similarity_score": 0.75, "question_id": "prod-q-101"},
        )
        self.assertEqual(quality.review_category, ReviewCategory.CATEGORY_B.value)
        self.assertEqual(len(quality.gate_failures), 0)
        self.assertEqual(quality.checks["DUPLICATE_DETECTION"].status, CheckStatus.WARNING)
        self.assertEqual(quality.checks["DUPLICATE_DETECTION"].code, "MODERATE_SIMILARITY")

    # -------------------------------------------------------------------------
    # 4. Category C (Critical Gate Failures)
    # -------------------------------------------------------------------------
    def test_category_c_empty_stem(self):
        quality = self.scorer.evaluate_candidate(
            candidate_text="",
            detected_options=[],
            detected_subparts=[],
            math_expressions=[],
            inferred_type="SUBJECTIVE",
            diagram_count=0,
        )
        self.assertEqual(quality.review_category, ReviewCategory.CATEGORY_C.value)
        self.assertGreater(len(quality.gate_failures), 0)
        self.assertEqual(quality.checks["TEXT_COMPLETENESS"].status, CheckStatus.FAIL)
        self.assertEqual(quality.checks["TEXT_COMPLETENESS"].code, "EMPTY_STEM")

    def test_category_c_dangling_boundary_operator(self):
        # Truncated extraction ending with 'Simplified form of -'
        quality = self.scorer.evaluate_candidate(
            candidate_text="Simplified form of -",
            detected_options=[
                {"key": "a", "text": "1"},
                {"key": "b", "text": "2"},
                {"key": "c", "text": "3"},
                {"key": "d", "text": "4"},
            ],
            detected_subparts=[],
            math_expressions=[],
            inferred_type="MCQ",
            diagram_count=0,
        )
        self.assertEqual(quality.review_category, ReviewCategory.CATEGORY_C.value)
        self.assertGreater(len(quality.gate_failures), 0)
        self.assertEqual(quality.checks["TEXT_COMPLETENESS"].status, CheckStatus.FAIL)
        self.assertEqual(quality.checks["TEXT_COMPLETENESS"].code, "DANGLING_BOUNDARY_OPERATOR")

    def test_category_c_katex_syntax_error(self):
        # Unbalanced curly braces in LaTeX formula
        quality = self.scorer.evaluate_candidate(
            candidate_text="Calculate $\\frac{1}{2$ of the circumference.",
            detected_options=[],
            detected_subparts=[],
            math_expressions=[
                MathExpressionRecord(
                    expression_id="expr-broken",
                    original_text="\\frac{1}{2",
                    latex="\\frac{1}{2",
                    is_valid_latex=False,
                    validation_errors=["Expected '}', got EOF"],
                )
            ],
            inferred_type="SUBJECTIVE",
            diagram_count=0,
        )
        self.assertEqual(quality.review_category, ReviewCategory.CATEGORY_C.value)
        self.assertGreater(len(quality.gate_failures), 0)
        self.assertEqual(quality.checks["MATHEMATICAL_INTEGRITY"].status, CheckStatus.FAIL)
        self.assertEqual(quality.checks["MATHEMATICAL_INTEGRITY"].code, "KATEX_SYNTAX_ERROR")

    def test_category_c_unbalanced_math_delimiters(self):
        # Single unclosed dollar delimiter
        quality = self.scorer.evaluate_candidate(
            candidate_text="If the value of $x + y = 10 and $x - y = 2$, find $x$.",
            detected_options=[],
            detected_subparts=[],
            math_expressions=[],
            inferred_type="SUBJECTIVE",
            diagram_count=0,
        )
        self.assertEqual(quality.review_category, ReviewCategory.CATEGORY_C.value)
        self.assertGreater(len(quality.gate_failures), 0)
        self.assertEqual(quality.checks["MATHEMATICAL_INTEGRITY"].status, CheckStatus.FAIL)
        self.assertEqual(quality.checks["MATHEMATICAL_INTEGRITY"].code, "UNBALANCED_DOLLAR_DELIMITERS")

    def test_category_c_missing_referenced_diagram(self):
        # Stem says "in the given figure", but 0 diagrams attached
        quality = self.scorer.evaluate_candidate(
            candidate_text="In the given figure, find the value of angle $\\theta$.",
            detected_options=[],
            detected_subparts=[],
            math_expressions=[
                MathExpressionRecord("e1", "\\theta", "\\theta", is_valid_latex=True)
            ],
            inferred_type="SUBJECTIVE",
            diagram_count=0,
        )
        self.assertEqual(quality.review_category, ReviewCategory.CATEGORY_C.value)
        self.assertGreater(len(quality.gate_failures), 0)
        self.assertEqual(quality.checks["DIAGRAM_ASSOCIATION"].status, CheckStatus.FAIL)
        self.assertEqual(quality.checks["DIAGRAM_ASSOCIATION"].code, "MISSING_REFERENCED_DIAGRAM")

    def test_category_c_empty_option_in_mcq(self):
        # MCQ with empty option value
        quality = self.scorer.evaluate_candidate(
            candidate_text="What is the probability of an impossible event?",
            detected_options=[
                {"key": "a", "text": "0"},
                {"key": "b", "text": ""},
                {"key": "c", "text": "1"},
                {"key": "d", "text": "1/2"},
            ],
            detected_subparts=[],
            math_expressions=[],
            inferred_type="MCQ",
            diagram_count=0,
        )
        self.assertEqual(quality.review_category, ReviewCategory.CATEGORY_C.value)
        self.assertGreater(len(quality.gate_failures), 0)
        self.assertEqual(quality.checks["MCQ_OPTION_COMPLETENESS"].status, CheckStatus.FAIL)
        self.assertEqual(quality.checks["MCQ_OPTION_COMPLETENESS"].code, "EMPTY_OPTIONS")

    def test_category_c_duplicate_option_keys(self):
        # MCQ with duplicate keys (e.g. ['A', 'B', 'B', 'D'])
        quality = self.scorer.evaluate_candidate(
            candidate_text="Which of the following is a prime number?",
            detected_options=[
                {"key": "a", "text": "2"},
                {"key": "b", "text": "4"},
                {"key": "b", "text": "6"},
                {"key": "d", "text": "8"},
            ],
            detected_subparts=[],
            math_expressions=[],
            inferred_type="MCQ",
            diagram_count=0,
        )
        self.assertEqual(quality.review_category, ReviewCategory.CATEGORY_C.value)
        self.assertGreater(len(quality.gate_failures), 0)
        self.assertEqual(quality.checks["MCQ_OPTION_COMPLETENESS"].status, CheckStatus.FAIL)
        self.assertEqual(quality.checks["MCQ_OPTION_COMPLETENESS"].code, "DUPLICATE_OPTION_KEYS")

    def test_category_c_high_duplicate_collision(self):
        # Duplicate detection with >= 85% match against existing question bank
        quality = self.scorer.evaluate_candidate(
            candidate_text="Find the roots of $2x^2 - x - 6 = 0$.",
            detected_options=[],
            detected_subparts=[],
            math_expressions=[],
            inferred_type="SUBJECTIVE",
            diagram_count=0,
            duplicate_match={"similarity_score": 0.94, "question_id": "prod-existing-44"},
        )
        self.assertEqual(quality.review_category, ReviewCategory.CATEGORY_C.value)
        self.assertGreater(len(quality.gate_failures), 0)
        self.assertEqual(quality.checks["DUPLICATE_DETECTION"].status, CheckStatus.FAIL)
        self.assertEqual(quality.checks["DUPLICATE_DETECTION"].code, "HIGH_DUPLICATE_COLLISION")

    # -------------------------------------------------------------------------
    # 4b. Milestone 1.2 Regression Tests (Diagram Classification & Unwrapped Commands)
    # -------------------------------------------------------------------------
    def test_diagram_zero_count_unassociated_nearby_routes_to_category_b(self):
        # Task 1.1: diagram_count=0, unassociated_diagram_nearby=True -> WARNING, CATEGORY_B
        quality = self.scorer.evaluate_candidate(
            candidate_text="Find the area of a circle of radius 7 cm.",
            detected_options=[],
            detected_subparts=[],
            math_expressions=[],
            inferred_type="SUBJECTIVE",
            diagram_count=0,
            unassociated_diagram_nearby=True,
        )
        self.assertEqual(quality.review_category, ReviewCategory.CATEGORY_B.value)
        self.assertEqual(quality.checks["DIAGRAM_ASSOCIATION"].status, CheckStatus.WARNING)
        self.assertEqual(quality.checks["DIAGRAM_ASSOCIATION"].code, "UNASSOCIATED_DIAGRAM_ON_PAGE")
        self.assertTrue(any("DIAGRAM_ASSOCIATION" in t for t in quality.inspection_targets))

    def test_diagram_zero_count_no_reference_no_nearby_passes(self):
        # Task 1.4: No diagram reference and no diagram nearby -> PASS, CATEGORY_A
        quality = self.scorer.evaluate_candidate(
            candidate_text="Find the LCM and HCF of 12, 15 and 21.",
            detected_options=[],
            detected_subparts=[],
            math_expressions=[],
            inferred_type="SUBJECTIVE",
            diagram_count=0,
            unassociated_diagram_nearby=False,
        )
        self.assertEqual(quality.review_category, ReviewCategory.CATEGORY_A.value)
        self.assertEqual(quality.checks["DIAGRAM_ASSOCIATION"].status, CheckStatus.PASS)
        self.assertEqual(quality.checks["DIAGRAM_ASSOCIATION"].code, "NO_DIAGRAM_REQUIRED")

    def test_unwrapped_latex_command_in_table_header_q37_regression(self):
        # Task 4: Q37 '\sec' inside Markdown table header without $...$ delimiters
        stem = "| Time (in \\sec) | 0-20 | 20-40 |\n| --- | --- | --- |\n| No. of students | 8 | 10 |"
        quality = self.scorer.evaluate_candidate(
            candidate_text=stem,
            detected_options=[],
            detected_subparts=[],
            math_expressions=[],
            inferred_type="SUBJECTIVE",
            diagram_count=0,
        )
        self.assertEqual(quality.review_category, ReviewCategory.CATEGORY_B.value)
        self.assertEqual(quality.checks["MATHEMATICAL_INTEGRITY"].status, CheckStatus.WARNING)
        self.assertEqual(quality.checks["MATHEMATICAL_INTEGRITY"].code, "UNWRAPPED_LATEX_COMMAND")
        self.assertTrue(any("UNWRAPPED_LATEX_COMMAND" in w for w in quality.review_warnings))
        self.assertTrue(any("MATHEMATICAL_INTEGRITY" in t for t in quality.inspection_targets))

    def test_diagram_association_signal_score_renamed(self):
        # Task 3: Verify renamed visual metric key
        quality = self.scorer.evaluate_candidate(
            candidate_text="Find the roots of $x^2 - 4 = 0$.",
            detected_options=[],
            detected_subparts=[],
            math_expressions=[MathExpressionRecord("e1", "x^2 - 4 = 0", "x^2 - 4 = 0", is_valid_latex=True)],
            inferred_type="SUBJECTIVE",
            diagram_count=0,
        )
        d = quality.to_dict()
        self.assertIn("diagram_association_signal_score", d["sub_scores"])
        self.assertNotIn("source_visual_agreement_score", d["sub_scores"])

    # -------------------------------------------------------------------------
    # 5. Live 38-Question Benchmark Ingestion Contract Test
    # -------------------------------------------------------------------------
    def test_live_benchmark_mineru_adapter_triage_contract(self):
        res = process_mineru_pdf("scripts/ingestion/test_source.pdf")
        candidates = res["candidates"]
        self.assertEqual(len(candidates), 38)

        # Verify summary breakdown (26 clean Cat A, 12 Cat B including Q9/Q23/Q28/Q37 unwrapped commands, 0 Cat C)
        summary = res["summary"]
        self.assertEqual(summary["category_a_count"], 26)
        self.assertEqual(summary["category_b_count"], 12)
        self.assertEqual(summary["category_c_count"], 0)

        # Question 1: Must be Category B with OCR repaired sign target
        q1 = candidates[0]
        self.assertEqual(q1["review_category"], "CATEGORY_B")
        self.assertTrue(any("MATHEMATICAL_INTEGRITY" in t for t in q1["inspection_targets"]))
        self.assertEqual(q1["checks"]["MATHEMATICAL_INTEGRITY"]["status"], "WARNING")

        # Question 5: Must be Category B with diagram target
        q5 = candidates[4]
        self.assertEqual(q5["review_category"], "CATEGORY_B")
        self.assertTrue(any("DIAGRAM_ASSOCIATION" in t for t in q5["inspection_targets"]))
        self.assertEqual(q5["checks"]["DIAGRAM_ASSOCIATION"]["status"], "WARNING")

        # Question 25: Must be Category B with dual diagram target
        q25 = candidates[24]
        self.assertEqual(q25["review_category"], "CATEGORY_B")
        self.assertTrue(any("DIAGRAM_ASSOCIATION" in t for t in q25["inspection_targets"]))

        # Question 37: Must be Category B with diagram target
        q37 = candidates[36]
        self.assertEqual(q37["review_category"], "CATEGORY_B")
        self.assertTrue(any("DIAGRAM_ASSOCIATION" in t for t in q37["inspection_targets"]))

        # Clean text questions (Q2, Q3, Q12, Q21) must be Category A
        clean_indices = [1, 2, 11, 20]  # Q2, Q3, Q12, Q21
        for idx in clean_indices:
            q = candidates[idx]
            self.assertEqual(q["review_category"], "CATEGORY_A", f"Question {idx+1} should be Category A")
            self.assertEqual(len(q["gate_failures"]), 0)
            self.assertEqual(len(q["inspection_targets"]), 0)


if __name__ == "__main__":
    unittest.main()
