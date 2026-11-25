#!/usr/bin/env python3
"""
AuraMentor Universal Mathematical PDF & LaTeX Engine - Domain Models
File: scripts/ingestion/math_engine/models.py
"""

from enum import Enum
from typing import Any, Dict, List, Optional


class MathCategory(str, Enum):
    FRACTIONS = "FRACTIONS"
    POWERS_AND_EXPONENTS = "POWERS_AND_EXPONENTS"
    SUBSCRIPTS = "SUBSCRIPTS"
    ROOTS_AND_RADICALS = "ROOTS_AND_RADICALS"
    GREEK_LETTERS = "GREEK_LETTERS"
    TRIGONOMETRY = "TRIGONOMETRY"
    LOGARITHMS = "LOGARITHMS"
    LIMITS = "LIMITS"
    CALCULUS = "CALCULUS"
    SUMMATIONS_AND_PRODUCTS = "SUMMATIONS_AND_PRODUCTS"
    MATRICES_AND_DETERMINANTS = "MATRICES_AND_DETERMINANTS"
    INEQUALITIES_AND_ABSOLUTE_VALUES = "INEQUALITIES_AND_ABSOLUTE_VALUES"
    SET_NOTATION = "SET_NOTATION"
    VECTORS = "VECTORS"
    COORDINATE_GEOMETRY = "COORDINATE_GEOMETRY"
    GEOMETRY_AND_ANGLES = "GEOMETRY_AND_ANGLES"
    PIECEWISE_FUNCTIONS = "PIECEWISE_FUNCTIONS"
    PROBABILITY = "PROBABILITY"
    STATISTICS = "STATISTICS"
    MULTILINE_EQUATIONS = "MULTILINE_EQUATIONS"
    GENERAL_ALGEBRA = "GENERAL_ALGEBRA"


class ExtractionMethod(str, Enum):
    DIGITAL_TEXT = "DIGITAL_TEXT"
    VECTOR_RECONSTRUCTED = "VECTOR_RECONSTRUCTED"
    OCR_RECOGNIZED = "OCR_RECOGNIZED"
    AST_SYNTHESIS = "AST_SYNTHESIS"
    HYBRID_FALLBACK = "HYBRID_FALLBACK"


class QualityStatus(str, Enum):
    HIGH_CONFIDENCE = "HIGH_CONFIDENCE"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    EXTRACTION_FAILED = "EXTRACTION_FAILED"


class ReviewCategory(str, Enum):
    CATEGORY_A = "CATEGORY_A"  # Zero configured deterministic warnings/failures; explicit teacher approval still required
    CATEGORY_B = "CATEGORY_B"  # Medium confidence, prioritised queue with targeted inspection
    CATEGORY_C = "CATEGORY_C"  # Low confidence, mandatory manual review & reconstruction


class CheckStatus(str, Enum):
    PASS = "PASS"
    WARNING = "WARNING"
    FAIL = "FAIL"
    NOT_APPLICABLE = "NOT_APPLICABLE"


class ValidationCheckResult:
    """
    Structured outcome of an individual deterministic quality check.
    Provides machine-readable codes and human-readable explanations.
    """

    def __init__(
        self,
        check_name: str,
        status: CheckStatus,
        code: str,
        message: str,
        details: Optional[Dict[str, Any]] = None,
    ):
        self.check_name = check_name
        self.status = status if isinstance(status, CheckStatus) else CheckStatus(status)
        self.code = code
        self.message = message
        self.details = details or {}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "check_name": self.check_name,
            "status": self.status.value,
            "code": self.code,
            "message": self.message,
            "details": self.details,
        }


class MathExpressionRecord:
    """
    Retains granular provenance and validation for every single extracted mathematical expression.
    Never discards source text if LaTeX conversion fails.
    """

    def __init__(
        self,
        expression_id: str,
        original_text: str,
        latex: str,
        category: str = MathCategory.GENERAL_ALGEBRA.value,
        page_number: int = 1,
        bbox: Optional[List[float]] = None,
        method: str = ExtractionMethod.DIGITAL_TEXT.value,
        confidence: float = 1.0,
        is_valid_latex: bool = True,
        validation_errors: Optional[List[str]] = None,
        review_warnings: Optional[List[str]] = None,
    ):
        self.expression_id = expression_id
        self.original_text = original_text
        self.latex = latex
        self.category = category
        self.page_number = page_number
        self.bbox = bbox or []
        self.method = method
        self.confidence = max(0.0, min(1.0, round(confidence, 2)))
        self.is_valid_latex = is_valid_latex
        self.validation_errors = validation_errors or []
        self.review_warnings = review_warnings or []

    def to_dict(self) -> Dict[str, Any]:
        return {
            "expression_id": self.expression_id,
            "original_text": self.original_text,
            "latex": self.latex,
            "category": self.category,
            "page_number": self.page_number,
            "bbox": self.bbox,
            "method": self.method,
            "confidence": self.confidence,
            "is_valid_latex": self.is_valid_latex,
            "validation_errors": self.validation_errors,
            "review_warnings": self.review_warnings,
        }


class ExtractionQualityScore:
    """
    Multi-dimensional quality score distinguishing between:
    - Text extraction fidelity
    - Mathematical expression recognition
    - Structural completeness
    - LaTeX syntax & KaTeX rendering validity
    - Diagram association metadata & keyword signal (does not perform visual PDF verification)
    """

    def __init__(
        self,
        text_extraction_score: float = 1.0,
        math_expression_score: float = 1.0,
        structural_completeness_score: float = 1.0,
        latex_syntax_score: float = 1.0,
        diagram_association_signal_score: float = 1.0,
        review_warnings: Optional[List[str]] = None,
        extraction_failures: Optional[List[str]] = None,
        checks: Optional[Dict[str, ValidationCheckResult]] = None,
        category_reasons: Optional[List[str]] = None,
        review_category: Optional[str] = None,
        inspection_targets: Optional[List[str]] = None,
        gate_failures: Optional[List[str]] = None,
    ):
        self.text_extraction_score = max(0.0, min(1.0, round(text_extraction_score, 2)))
        self.math_expression_score = max(0.0, min(1.0, round(math_expression_score, 2)))
        self.structural_completeness_score = max(0.0, min(1.0, round(structural_completeness_score, 2)))
        self.latex_syntax_score = max(0.0, min(1.0, round(latex_syntax_score, 2)))
        self.diagram_association_signal_score = max(0.0, min(1.0, round(diagram_association_signal_score, 2)))

        # Weighted aggregate confidence
        self.overall_confidence = round(
            0.20 * self.text_extraction_score
            + 0.25 * self.math_expression_score
            + 0.20 * self.structural_completeness_score
            + 0.25 * self.latex_syntax_score
            + 0.10 * self.diagram_association_signal_score,
            2,
        )

        self.review_warnings = review_warnings or []
        self.extraction_failures = extraction_failures or []
        self.checks = checks or {}

        # Determine status
        if self.extraction_failures or self.overall_confidence < 0.60 or self.latex_syntax_score < 0.50:
            self.status = QualityStatus.EXTRACTION_FAILED.value
        elif self.overall_confidence >= 0.85 and self.latex_syntax_score >= 0.85 and not self.review_warnings:
            self.status = QualityStatus.HIGH_CONFIDENCE.value
        else:
            self.status = QualityStatus.NEEDS_REVIEW.value

        # Determine Review Category (Category A / B / C)
        computed_gate_failures = list(gate_failures) if gate_failures is not None else []
        computed_inspection_targets = list(inspection_targets) if inspection_targets is not None else []
        computed_reasons = list(category_reasons) if category_reasons is not None else []

        if gate_failures is None:
            if self.extraction_failures:
                computed_gate_failures.extend(self.extraction_failures)
            if self.latex_syntax_score < 0.70:
                computed_gate_failures.append("FATAL_LATEX_SYNTAX_ERROR: Formula syntax invalid or corrupted.")
            if self.structural_completeness_score < 0.60:
                computed_gate_failures.append("STRUCTURAL_DEFECT: Incomplete question options or missing stem.")
            if self.diagram_association_signal_score < 0.60:
                computed_gate_failures.append("MISSING_DIAGRAM: Referenced visual asset is missing.")
            if self.overall_confidence < 0.70:
                computed_gate_failures.append(f"LOW_CONFIDENCE: Overall score ({self.overall_confidence}) below acceptable threshold.")

        if inspection_targets is None:
            # Identify specific inspection targets for Category B
            for w in self.review_warnings:
                if "OCR_DEFECT_REPAIRED" in w:
                    computed_inspection_targets.append("REPAIRED_MATH_SIGN: Check corrected mathematical sign/notation.")
                elif "DIAGRAM" in w or "VISUAL" in w:
                    computed_inspection_targets.append("DIAGRAM_ASSOCIATION: Verify diagram alignment and crop.")
                elif "OPTIONS" in w:
                    computed_inspection_targets.append("OPTIONS_FORMATTING: Verify option choices and keys.")
                elif "CASE_STUDY" in w:
                    computed_inspection_targets.append("CASE_STUDY_SUBPARTS: Verify subpart structure and marks.")
                elif "AMBIGUOUS" in w:
                    computed_inspection_targets.append("AMBIGUOUS_GLYPH: Verify potential font encoding artifact.")

        # Triage determination (No category automatically approves or publishes)
        if review_category is not None:
            self.review_category = review_category
        elif computed_gate_failures:
            self.review_category = ReviewCategory.CATEGORY_C.value
            if not computed_reasons:
                computed_reasons = [f"Critical Gate Failure: {f}" for f in computed_gate_failures]
        elif (
            self.overall_confidence >= 0.92
            and self.latex_syntax_score >= 0.95
            and self.structural_completeness_score >= 0.90
            and self.diagram_association_signal_score >= 0.90
            and not self.review_warnings
        ):
            self.review_category = ReviewCategory.CATEGORY_A.value
            if not computed_reasons:
                computed_reasons = ["No deterministic warnings or failures detected. Teacher approval is still mandatory."]
        else:
            self.review_category = ReviewCategory.CATEGORY_B.value
            if not computed_reasons:
                computed_reasons = [f"Targeted review required: {w}" for w in self.review_warnings]

        self.gate_failures = computed_gate_failures
        self.inspection_targets = list(dict.fromkeys(computed_inspection_targets))
        self.category_reasons = computed_reasons
        self.quality_breakdown = {
            "math": self.math_expression_score,
            "struct": self.structural_completeness_score,
            "diagram_signal": self.diagram_association_signal_score,
            "text": self.text_extraction_score,
            "latex": self.latex_syntax_score,
        }

    def to_dict(self) -> Dict[str, Any]:
        return {
            "overall_confidence": self.overall_confidence,
            "status": self.status,
            "review_category": self.review_category,
            "category_reasons": self.category_reasons,
            "sub_scores": {
                "text_extraction_score": self.text_extraction_score,
                "math_expression_score": self.math_expression_score,
                "structural_completeness_score": self.structural_completeness_score,
                "latex_syntax_score": self.latex_syntax_score,
                "diagram_association_signal_score": self.diagram_association_signal_score,
            },
            "quality_breakdown": self.quality_breakdown,
            "checks": {k: v.to_dict() if hasattr(v, "to_dict") else v for k, v in self.checks.items()},
            "gate_failures": self.gate_failures,
            "inspection_targets": self.inspection_targets,
            "review_warnings": self.review_warnings,
            "extraction_failures": self.extraction_failures,
        }

