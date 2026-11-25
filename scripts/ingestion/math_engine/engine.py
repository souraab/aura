#!/usr/bin/env python3
"""
AuraMentor Universal Mathematical PDF & LaTeX Engine - Unified Engine Facade
File: scripts/ingestion/math_engine/engine.py
"""

from typing import Dict, Any, List, Tuple, Optional

from .models import (
    MathCategory,
    ExtractionMethod,
    QualityStatus,
    MathExpressionRecord,
    ExtractionQualityScore,
)
from .latex_validator import LatexValidator, ValidationResult
from .categories import CategoryRecognizer
from .latex_ast import LatexTransformer, MathDocumentParser
from .quality_scorer import MathematicalQualityScorer
from .document_classifier import DocumentClassifier, PageStrategyClassification
from .vector_math_detector import VectorMathDetector
from .ocr_interface import LocalTesseractOcrProvider, MathpixConfigurableOcrProvider, VisualFallbackCropProvider


class UniversalMathEngine:
    """
    Main orchestration engine for universal educational mathematics extraction.
    Provides end-to-end normalization, mathematical recognition, KaTeX generation,
    and quality scoring across digital, vector, scanned, and mixed PDFs.
    """

    def __init__(self):
        self.local_ocr = LocalTesseractOcrProvider()
        self.mathpix_ocr = MathpixConfigurableOcrProvider()
        self.visual_fallback = VisualFallbackCropProvider()

    def process_candidate_mathematics(
        self,
        candidate_data: Dict[str, Any],
        page_number: int = 1,
        extraction_method: str = ExtractionMethod.DIGITAL_TEXT.value,
        diagram_count: int = 0,
        unassociated_diagram_nearby: bool = False,
    ) -> Dict[str, Any]:
        """
        Enhances a candidate question by:
          1. Recognizing and converting mathematical notation to KaTeX in question text, options, subparts, answers.
          2. Preserving all individual mathematical expression records with validation and confidence.
          3. Generating a 5-dimensional quality score with clear status.
          4. Retaining the raw original extracted text.
        """
        raw_statement = candidate_data.get("candidate_question_text", "")
        raw_options = candidate_data.get("detected_options", [])
        raw_subparts = candidate_data.get("detected_subparts", [])
        raw_answer = candidate_data.get("detected_answer", "")
        raw_solution = candidate_data.get("detected_solution", "")
        inferred_type = candidate_data.get("inferred_type", "SUBJECTIVE")

        all_expressions: List[MathExpressionRecord] = []

        # 1. Process Question Statement
        formatted_statement, stmt_exprs = MathDocumentParser.process_text_and_extract_expressions(
            raw_statement, page_number=page_number, method=extraction_method
        )
        all_expressions.extend(stmt_exprs)

        # 2. Process MCQ Options
        formatted_options = []
        for opt in raw_options:
            opt_key = opt.get("key", "")
            opt_text = opt.get("text", "")
            f_opt_text, opt_exprs = MathDocumentParser.process_text_and_extract_expressions(
                opt_text, page_number=page_number, method=extraction_method
            )
            all_expressions.extend(opt_exprs)
            formatted_options.append({
                "key": opt_key,
                "text": f_opt_text,
                "original_text": opt_text,
            })

        # 3. Process Subparts
        formatted_subparts = []
        for sub in raw_subparts:
            sub_lbl = sub.get("label", "")
            sub_text = sub.get("text", "")
            f_sub_text, sub_exprs = MathDocumentParser.process_text_and_extract_expressions(
                sub_text, page_number=page_number, method=extraction_method
            )
            all_expressions.extend(sub_exprs)
            formatted_subparts.append({
                "label": sub_lbl,
                "text": f_sub_text,
                "original_text": sub_text,
            })

        # 4. Process Answer & Solution if present
        formatted_answer = None
        if raw_answer:
            f_ans, ans_exprs = MathDocumentParser.process_text_and_extract_expressions(
                raw_answer, page_number=page_number, method=extraction_method
            )
            all_expressions.extend(ans_exprs)
            formatted_answer = f_ans

        formatted_solution = None
        if raw_solution:
            f_sol, sol_exprs = MathDocumentParser.process_text_and_extract_expressions(
                raw_solution, page_number=page_number, method=extraction_method
            )
            all_expressions.extend(sol_exprs)
            formatted_solution = f_sol

        # 5. Evaluate 5-Dimensional Quality Score
        quality_score = MathematicalQualityScorer.evaluate_candidate(
            candidate_text=formatted_statement,
            detected_options=formatted_options,
            detected_subparts=formatted_subparts,
            math_expressions=all_expressions,
            inferred_type=inferred_type,
            diagram_count=diagram_count,
            unassociated_diagram_nearby=unassociated_diagram_nearby,
        )

        return {
            "formatted_question_text": formatted_statement,
            "formatted_options": formatted_options,
            "formatted_subparts": formatted_subparts,
            "formatted_answer": formatted_answer,
            "formatted_solution": formatted_solution,
            "detected_math_expressions": [e.to_dict() for e in all_expressions],
            "quality_scoring": quality_score.to_dict(),
            "extraction_confidence": quality_score.overall_confidence,
            "review_status_recommendation": quality_score.status,
        }

    def get_system_disclosures(self) -> List[Dict[str, Any]]:
        """Returns OCR engine availability, dependencies, and external costs."""
        return [
            self.local_ocr.get_service_disclosure(),
            self.mathpix_ocr.get_service_disclosure(),
            self.visual_fallback.get_service_disclosure(),
        ]

