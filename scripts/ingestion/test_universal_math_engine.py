#!/usr/bin/env python3
"""
AuraMentor Universal Mathematical PDF & LaTeX Engine - Generalized Regression Test Suite
File: scripts/ingestion/test_universal_math_engine.py

Verifies mathematical expression recognition, AST LaTeX transformation,
deep KaTeX validation, 5-dimensional quality scoring, and document classification
across all 20 required educational math domains against verified ground truth.
"""

import os
import sys
import unittest

# Ensure scripts/ingestion is in path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from math_engine import (
    UniversalMathEngine,
    MathCategory,
    QualityStatus,
    LatexValidator,
    LatexTransformer,
    MathDocumentParser,
    MathematicalQualityScorer,
    DocumentClassifier,
    VectorMathDetector,
)


class TestUniversalMathematicalEngine(unittest.TestCase):
    """
    Generalized regression test corpus verifying mathematical accuracy across
    NCERT, CBSE, JEE Main/Advanced, and coaching institute paper formats.
    """

    def setUp(self):
        self.engine = UniversalMathEngine()

    # -------------------------------------------------------------------------
    # 1. Simple Algebraic Expressions
    # -------------------------------------------------------------------------
    def test_algebraic_expressions(self):
        source = "Find the roots of the quadratic equation x^2 - 5x + 6 = 0."
        formatted, exprs = MathDocumentParser.process_text_and_extract_expressions(source)
        self.assertGreaterEqual(len(exprs), 1)
        self.assertIn("x^2 - 5x + 6 = 0", formatted)
        val = LatexValidator.validate("x^2 - 5x + 6 = 0")
        self.assertTrue(val.is_valid)

    # -------------------------------------------------------------------------
    # 2. Complex & Nested Fractions
    # -------------------------------------------------------------------------
    def test_complex_and_nested_fractions(self):
        # Slash fraction
        slash_src = "(x + 1)/(x - 1) = 3/4"
        transformed = LatexTransformer.transform_expression(slash_src)
        self.assertIn(r"\frac{x + 1}{x - 1}", transformed)
        self.assertIn(r"\frac{3}{4}", transformed)
        val = LatexValidator.validate(transformed)
        self.assertTrue(val.is_valid)

        # Vulgar fractions
        vulgar_src = "A mixture contains ½ litre of milk and ¾ litre of water."
        formatted, exprs = MathDocumentParser.process_text_and_extract_expressions(vulgar_src)
        self.assertIn(r"\frac{1}{2}", formatted)
        self.assertIn(r"\frac{3}{4}", formatted)

    # -------------------------------------------------------------------------
    # 3. Powers and Exponents
    # -------------------------------------------------------------------------
    def test_powers_and_exponents(self):
        # Unicode superscripts: x² + y³ = z⁴
        src = "Evaluate x² + y³ = z⁴ for x = 2, y = 3."
        transformed = LatexTransformer.transform_expression("x² + y³ = z⁴")
        self.assertIn("x^2 + y^3 = z^4", transformed)
        val = LatexValidator.validate(transformed)
        self.assertTrue(val.is_valid)

        # Parenthesized power: e^(2x + 1)
        pow_src = "f(x) = e^(2x + 1)"
        transformed_pow = LatexTransformer.transform_expression(pow_src)
        self.assertIn(r"e^{2x + 1}", transformed_pow)

    # -------------------------------------------------------------------------
    # 4. Roots and Radicals
    # -------------------------------------------------------------------------
    def test_roots_and_radicals(self):
        # Square root, cube root, fourth root
        sq_src = "√5 + √(x + 1) + ∛(27) + ∜(16)"
        transformed = LatexTransformer.transform_expression(sq_src)
        self.assertIn(r"\sqrt{5}", transformed)
        self.assertIn(r"\sqrt{x + 1}", transformed)
        self.assertIn(r"\sqrt[3]{27}", transformed)
        self.assertIn(r"\sqrt[4]{16}", transformed)
        val = LatexValidator.validate(transformed)
        self.assertTrue(val.is_valid)

    # -------------------------------------------------------------------------
    # 5. Greek Letters
    # -------------------------------------------------------------------------
    def test_greek_letters(self):
        src = "In a circle with radius r, if angle is θ and arc is s, then s = rθ. Also let α + β = π."
        transformed = LatexTransformer.transform_expression("s = rθ and α + β = π")
        self.assertIn(r"\theta", transformed)
        self.assertIn(r"\alpha", transformed)
        self.assertIn(r"\beta", transformed)
        self.assertIn(r"\pi", transformed)
        val = LatexValidator.validate(transformed)
        self.assertTrue(val.is_valid)

    # -------------------------------------------------------------------------
    # 6. Trigonometric Identities
    # -------------------------------------------------------------------------
    def test_trigonometric_identities(self):
        src = "Prove that sin² θ + cos² θ = 1 and 1 + tan² A = sec² A."
        transformed = LatexTransformer.transform_expression("sin² θ + cos² θ = 1")
        self.assertIn(r"\sin^2", transformed)
        self.assertIn(r"\cos^2", transformed)
        self.assertIn(r"\theta", transformed)
        val = LatexValidator.validate(transformed)
        self.assertTrue(val.is_valid)

        # Cosecant normalization
        csc_src = "cosec θ = 1 / sin θ"
        transformed_csc = LatexTransformer.transform_expression(csc_src)
        self.assertIn(r"\csc", transformed_csc)

    # -------------------------------------------------------------------------
    # 7. Logarithms and Exponentials
    # -------------------------------------------------------------------------
    def test_logarithms_and_exponentials(self):
        src = "If log_10(x) = 3, find the value of ln(x)."
        cat = self.engine.process_candidate_mathematics({
            "candidate_question_text": src,
            "detected_options": [],
            "inferred_type": "SUBJECTIVE",
        })
        exprs = cat["detected_math_expressions"]
        self.assertTrue(any(e["category"] == MathCategory.LOGARITHMS.value for e in exprs))

    # -------------------------------------------------------------------------
    # 8. Limits
    # -------------------------------------------------------------------------
    def test_limits(self):
        src = "Evaluate lim x->0 (sin x)/x."
        transformed = LatexTransformer.transform_expression(src)
        self.assertIn(r"\lim_{x \to 0}", transformed)
        val = LatexValidator.validate(transformed)
        self.assertTrue(val.is_valid)

    # -------------------------------------------------------------------------
    # 9. Calculus (Derivatives & Integrals)
    # -------------------------------------------------------------------------
    def test_calculus_derivatives_and_integrals(self):
        diff_src = "If y = x^3 - 4x + 1, find dy/dx and d^2y/dx^2."
        transformed_diff = LatexTransformer.transform_expression(diff_src)
        self.assertIn(r"\frac{dy}{dx}", transformed_diff)
        self.assertIn(r"\frac{d^2y}{dx^2}", transformed_diff)
        val = LatexValidator.validate(transformed_diff)
        self.assertTrue(val.is_valid)

        # Integrals
        int_src = r"\int_0^1 x^2 dx"
        val_int = LatexValidator.validate(int_src)
        self.assertTrue(val_int.is_valid)

    # -------------------------------------------------------------------------
    # 10. Summations and Products
    # -------------------------------------------------------------------------
    def test_summations_and_products(self):
        src = r"\sum_{i=1}^{n} i = \frac{n(n+1)}{2}"
        val = LatexValidator.validate(src)
        self.assertTrue(val.is_valid)

    # -------------------------------------------------------------------------
    # 11. Matrices and Determinants
    # -------------------------------------------------------------------------
    def test_matrices_and_determinants(self):
        matrix_latex = r"\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}"
        val_m = LatexValidator.validate(matrix_latex)
        self.assertTrue(val_m.is_valid)

        det_latex = r"\begin{vmatrix} a & b \\ c & d \end{vmatrix}"
        val_d = LatexValidator.validate(det_latex)
        self.assertTrue(val_d.is_valid)

    # -------------------------------------------------------------------------
    # 12. Inequalities and Absolute Values
    # -------------------------------------------------------------------------
    def test_inequalities_and_absolute_values(self):
        src = "|x - 3| ≤ 5 and 2x + 1 ≥ 7 and x ≠ 0"
        transformed = LatexTransformer.transform_expression(src)
        self.assertIn(r"\le", transformed)
        self.assertIn(r"\ge", transformed)
        self.assertIn(r"\ne", transformed)
        val = LatexValidator.validate(transformed)
        self.assertTrue(val.is_valid)

    # -------------------------------------------------------------------------
    # 13. Set Notation
    # -------------------------------------------------------------------------
    def test_set_notation(self):
        src = r"x \in \mathbb{R}, A \subset B, A \cup B, A \cap B = \emptyset"
        val = LatexValidator.validate(src)
        self.assertTrue(val.is_valid)

    # -------------------------------------------------------------------------
    # 14. Vectors
    # -------------------------------------------------------------------------
    def test_vectors(self):
        src = r"\vec{a} \cdot \vec{b} = 0 \text{ and } \hat{i} + 2\hat{j} - \hat{k}"
        val = LatexValidator.validate(src)
        self.assertTrue(val.is_valid)

    # -------------------------------------------------------------------------
    # 15. Coordinate Geometry
    # -------------------------------------------------------------------------
    def test_coordinate_geometry(self):
        src = "Find the distance between the points A(2, 3) and B(-4, 1)."
        cat = self.engine.process_candidate_mathematics({
            "candidate_question_text": src,
            "detected_options": [],
            "inferred_type": "SUBJECTIVE",
        })
        self.assertIsNotNone(cat["quality_scoring"])
        self.assertGreaterEqual(cat["quality_scoring"]["overall_confidence"], 0.85)

    # -------------------------------------------------------------------------
    # 16. Geometry and Angles
    # -------------------------------------------------------------------------
    def test_geometry_and_angles(self):
        src = "In ΔABC, ∠B = 90°, AB = 3 cm, BC = 4 cm. If DE ⊥ BC, find ∠A."
        transformed = LatexTransformer.transform_expression("∠B = 90° and DE ⊥ BC")
        self.assertIn(r"\angle", transformed)
        self.assertIn(r"90^\circ", transformed)
        self.assertIn(r"\perp", transformed)
        val = LatexValidator.validate(transformed)
        self.assertTrue(val.is_valid)

    # -------------------------------------------------------------------------
    # 17. Piecewise Functions
    # -------------------------------------------------------------------------
    def test_piecewise_functions(self):
        src = r"\begin{cases} 2x + 1 & x > 0 \\ 0 & x = 0 \\ -2x + 1 & x < 0 \end{cases}"
        val = LatexValidator.validate(src)
        self.assertTrue(val.is_valid)

    # -------------------------------------------------------------------------
    # 18. Probability Notation
    # -------------------------------------------------------------------------
    def test_probability_notation(self):
        src = "If P(A) = 0.6, P(B) = 0.5, and P(A|B) = 0.4, find P(A and B)."
        transformed = LatexTransformer.transform_expression("P(A|B) = 0.4")
        self.assertIn(r"P(A \mid B)", transformed)
        val = LatexValidator.validate(transformed)
        self.assertTrue(val.is_valid)

    # -------------------------------------------------------------------------
    # 19. Statistical Expressions
    # -------------------------------------------------------------------------
    def test_statistical_expressions(self):
        src = r"\bar{x} = \frac{\sum f_i x_i}{\sum f_i}"
        val = LatexValidator.validate(src)
        self.assertTrue(val.is_valid)

    # -------------------------------------------------------------------------
    # 20. Multi-line Equations
    # -------------------------------------------------------------------------
    def test_multiline_equations(self):
        src = r"\begin{aligned} 2x + 3y &= 7 \\ 4x - y &= 3 \end{aligned}"
        val = LatexValidator.validate(src)
        self.assertTrue(val.is_valid)

    # -------------------------------------------------------------------------
    # Deep LaTeX Validator: Error & Boundary Detection
    # -------------------------------------------------------------------------
    def test_latex_validator_catches_malformed_syntax(self):
        # 1. Unclosed curly brace
        val1 = LatexValidator.validate(r"\frac{1}{2")
        self.assertFalse(val1.is_valid)
        self.assertTrue(any("UNCLOSED_BRACE" in e for e in val1.errors))

        # 2. Incomplete frac
        val2 = LatexValidator.validate(r"\frac{1}")
        self.assertFalse(val2.is_valid)
        self.assertTrue(any("INCOMPLETE_COMMAND" in e for e in val2.errors))

        # 3. Empty fraction
        val3 = LatexValidator.validate(r"\frac{}{}")
        self.assertFalse(val3.is_valid)
        self.assertTrue(any("EMPTY_ARGUMENT" in e for e in val3.errors))

        # 4. Unmatched dollar
        val4 = LatexValidator.validate(r"$x + y = 2")
        self.assertFalse(val4.is_valid)
        self.assertTrue(any("UNMATCHED_DOLLAR" in e for e in val4.errors))

        # 5. Unsupported KaTeX command
        val5 = LatexValidator.validate(r"\xymatrix{ A \ar[r] & B }")
        self.assertFalse(val5.is_valid)
        self.assertTrue(any("UNSUPPORTED_KATEX_COMMAND" in e for e in val5.errors))

    # -------------------------------------------------------------------------
    # 5-Dimensional Quality Scorer Tests
    # -------------------------------------------------------------------------
    def test_5_dimensional_quality_scorer(self):
        # High confidence candidate
        score_high = MathematicalQualityScorer.evaluate_candidate(
            candidate_text="Find the discriminant of the quadratic equation 2x^2 - 4x + 3 = 0.",
            detected_options=[
                {"key": "A", "text": "-8"},
                {"key": "B", "text": "8"},
                {"key": "C", "text": "0"},
                {"key": "D", "text": "16"},
            ],
            detected_subparts=[],
            math_expressions=[],
            inferred_type="MCQ",
        )
        self.assertEqual(score_high.status, QualityStatus.HIGH_CONFIDENCE.value)
        self.assertGreaterEqual(score_high.overall_confidence, 0.85)

        # Extraction failed candidate (missing options in MCQ)
        score_failed = MathematicalQualityScorer.evaluate_candidate(
            candidate_text="A polynomial of degree 3 has at most 3 real zeroes.",
            detected_options=[],
            detected_subparts=[],
            math_expressions=[],
            inferred_type="MCQ",
        )
        self.assertEqual(score_failed.status, QualityStatus.EXTRACTION_FAILED.value)
        self.assertTrue(any("NO_OPTIONS_DETECTED" in f for f in score_failed.extraction_failures))

    # -------------------------------------------------------------------------
    # Document & Page Strategy Classifier
    # -------------------------------------------------------------------------
    def test_document_and_page_classification(self):
        # Digital page
        p_dig = DocumentClassifier.classify_page(page_number=1, text="Mathematics Question Paper Class 10...", vector_count=2, image_count=0)
        self.assertEqual(p_dig.strategy, "DIGITAL_TEXT")

        # Scanned page (no text, full page image)
        p_scan = DocumentClassifier.classify_page(page_number=2, text="", vector_count=0, image_count=1)
        self.assertEqual(p_scan.strategy, "SCANNED_IMAGE")

        # Vector rich (compiled TeX)
        p_vec = DocumentClassifier.classify_page(page_number=3, text="Solve for x...", vector_count=25, image_count=0)
        self.assertEqual(p_vec.strategy, "VECTOR_RICH")

        # Full document classification
        doc_summary = DocumentClassifier.classify_document([p_dig, p_scan])
        self.assertEqual(doc_summary["document_type"], "MIXED_EDUCATIONAL_MODULE")
        self.assertEqual(doc_summary["recommended_pipeline"], "PAGE_BY_PAGE_HYBRID_DISPATCH")


class TestMathematicalExtractionAccuracyV2Regression(unittest.TestCase):
    """
    Regression test suite covering the 7 benchmark failure categories:
      1. Degree glyph encoding detection & flagging.
      2. Angle symbol (∠, \angle) and degree (°) preservation.
      3. Radical boundaries and chained equation preservation.
      4. English vs math phrase classification (rejection of adjectives).
      5. Truncated equations & multiline equation joining.
      6. Variable subscripts (R1 -> R_1) and flattened powers (tan2θ -> \tan^2 \theta).
      7. Inline equations with Unicode minus signs and Greek variables.
    """

    def setUp(self):
        self.engine = UniversalMathEngine()

    def test_regression_degree_glyph_encoding_detection(self):
        # Must detect ambiguous glyph 450 representing 45° and route to review
        res = self.engine.process_candidate_mathematics({
            "candidate_question_text": "If two poles are 25m and 15m high and the line joining their tops makes an angle 450 with the horizontal.",
            "detected_options": [],
            "inferred_type": "SUBJECTIVE",
        })
        scoring = res["quality_scoring"]
        self.assertEqual(scoring["status"], QualityStatus.NEEDS_REVIEW.value)
        self.assertTrue(any("AMBIGUOUS_GLYPH_ENCODING" in w for w in scoring["review_warnings"]))

    def test_regression_angle_symbols(self):
        # Preserves ∠ and ° in geometric angle relations
        src = "If ∠ABC = 3x + 15° and ∠CDE = 5x − 25°, find x."
        fmt, exprs = MathDocumentParser.process_text_and_extract_expressions(src)
        self.assertEqual(len(exprs), 2)
        latex_texts = [e.latex for e in exprs]
        self.assertTrue(any(r"\angle ABC" in l and r"15^\circ" in l for l in latex_texts))
        self.assertTrue(any(r"\angle CDE" in l and r"25^\circ" in l for l in latex_texts))

    def test_regression_radical_boundaries(self):
        # Chained radicals must be parsed intact without split or dangling closing braces
        src = r"Distance = \sqrt{(-6)^2 + 8^2} = \sqrt{36 + 64} = \sqrt{100} = 10"
        fmt, exprs = MathDocumentParser.process_text_and_extract_expressions(src)
        self.assertTrue(len(exprs) >= 1)
        chain_expr = next((e for e in exprs if r"\sqrt" in e.latex), None)
        self.assertIsNotNone(chain_expr)
        self.assertTrue(chain_expr.is_valid_latex)
        self.assertNotIn("}}", chain_expr.latex)
        # Radical slash fraction
        slash_res = LatexTransformer.transform_expression(r"1/\sqrt{3}")
        self.assertIn(r"\frac{1}{\sqrt{3}}", slash_res)

    def test_regression_english_math_classification(self):
        # English phrases must NOT be classified as mathematical expressions
        non_math_samples = [
            "A carpenter wants to use triangle ABC as a right-angle template.",
            "Explain why triangle ABC is right-angled, and use similarity.",
            "A wide-angle camera was mounted on a tripod.",
        ]
        for s in non_math_samples:
            fmt, exprs = MathDocumentParser.process_text_and_extract_expressions(s)
            self.assertEqual(len(exprs), 0, f"False positive math expression extracted from: {s}")

        # Legitimate geometry expression must be extracted
        valid_geom = "In triangle ABC, ∠B = 90° and ∠C = 45°."
        fmt, exprs = MathDocumentParser.process_text_and_extract_expressions(valid_geom)
        self.assertEqual(len(exprs), 2)

    def test_regression_truncated_equations(self):
        # Dangling operators must be marked invalid
        val = LatexValidator.validate("AOB =")
        self.assertFalse(val.is_valid)
        self.assertTrue(any("DANGLING_OPERATOR" in err for err in val.errors))

        # Equations broken across lines must be joined
        broken_text = "If \\tan (A + B) =\\sqrt{3} and A >\nB, find A and B."
        fmt, exprs = MathDocumentParser.process_text_and_extract_expressions(broken_text)
        self.assertTrue(any("A > B" in e.latex for e in exprs))

    def test_regression_superscripts_and_subscripts(self):
        # Subscripts in single uppercase variables with digit: R1 + R2 = R -> R_1 + R_2 = R
        trans_sub = LatexTransformer.transform_expression("R1 + R2 = R")
        self.assertIn("R_1 + R_2 = R", trans_sub)

        # Flattened trig powers: tan2θ -> \tan^2 \theta
        trans_trig = LatexTransformer.transform_expression("tan2θ")
        self.assertIn(r"\tan^2", trans_trig)
        self.assertIn(r"\theta", trans_trig)

    def test_regression_inline_equations_unicode_minus(self):
        # Unicode minus and dense variables: secθ−tanθ=m
        src = "If secθ−tanθ=m, then find the value."
        fmt, exprs = MathDocumentParser.process_text_and_extract_expressions(src)
        self.assertEqual(len(exprs), 1)
        self.assertIn(r"\sec", exprs[0].latex)
        self.assertIn(r"\tan", exprs[0].latex)
        self.assertIn(r"\theta", exprs[0].latex)
        self.assertIn("=m", exprs[0].latex.replace(" ", ""))
        # Prose trimming: a = 5c for some integer c
        src2 = "Let a = 5c for some integer c."
        fmt2, exprs2 = MathDocumentParser.process_text_and_extract_expressions(src2)
        self.assertEqual(len(exprs2), 1)
        self.assertEqual(exprs2[0].latex, "a = 5c")


if __name__ == "__main__":
    unittest.main()

