"""
AuraMentor Universal Mathematical PDF & LaTeX Engine Package
"""

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
from .ocr_interface import (
    BaseOcrProvider,
    LocalTesseractOcrProvider,
    MathpixConfigurableOcrProvider,
    VisualFallbackCropProvider,
)
from .engine import UniversalMathEngine

__all__ = [
    "UniversalMathEngine",
    "MathCategory",
    "ExtractionMethod",
    "QualityStatus",
    "MathExpressionRecord",
    "ExtractionQualityScore",
    "LatexValidator",
    "ValidationResult",
    "CategoryRecognizer",
    "LatexTransformer",
    "MathDocumentParser",
    "MathematicalQualityScorer",
    "DocumentClassifier",
    "PageStrategyClassification",
    "VectorMathDetector",
    "BaseOcrProvider",
    "LocalTesseractOcrProvider",
    "MathpixConfigurableOcrProvider",
    "VisualFallbackCropProvider",
]

