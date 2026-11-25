#!/usr/bin/env python3
"""
AuraMentor Universal Mathematical PDF & LaTeX Engine - Document & Page Classifier
File: scripts/ingestion/math_engine/document_classifier.py
"""

from typing import List, Dict, Any


class PageStrategyClassification:
    def __init__(
        self,
        page_number: int,
        strategy: str,
        char_count: int,
        vector_count: int,
        image_count: int,
        is_digital: bool,
    ):
        self.page_number = page_number
        self.strategy = strategy  # DIGITAL_TEXT, VECTOR_RICH, SCANNED_IMAGE, HYBRID_MIXED
        self.char_count = char_count
        self.vector_count = vector_count
        self.image_count = image_count
        self.is_digital = is_digital

    def to_dict(self) -> Dict[str, Any]:
        return {
            "page_number": self.page_number,
            "strategy": self.strategy,
            "char_count": self.char_count,
            "vector_count": self.vector_count,
            "image_count": self.image_count,
            "is_digital": self.is_digital,
        }


class DocumentClassifier:
    """
    Classifies documents and individual pages to choose the optimal extraction pipeline:
      - NCERT / CBSE Digital Papers -> High-accuracy 2D spatial digital layout
      - JEE / TeX Papers -> Vector-aware fraction and radical synthesis
      - Scanned Exams -> OCR + Visual Math Cropping
      - Coaching Modules -> Hybrid Multi-Page Dispatcher
    """

    @classmethod
    def classify_page(
        cls,
        page_number: int,
        text: str,
        vector_count: int = 0,
        image_count: int = 0,
    ) -> PageStrategyClassification:
        char_count = len(text.strip())
        is_digital = char_count >= 20

        if vector_count >= 15:
            strategy = "VECTOR_RICH"
        elif not is_digital and image_count > 0:
            strategy = "SCANNED_IMAGE"
        elif is_digital and image_count > 0:
            strategy = "HYBRID_MIXED"
        elif is_digital:
            strategy = "DIGITAL_TEXT"
        else:
            strategy = "EMPTY_OR_UNREADABLE"

        return PageStrategyClassification(
            page_number=page_number,
            strategy=strategy,
            char_count=char_count,
            vector_count=vector_count,
            image_count=image_count,
            is_digital=is_digital,
        )

    @classmethod
    def classify_document(
        cls,
        page_classifications: List[PageStrategyClassification],
    ) -> Dict[str, Any]:
        total_pages = len(page_classifications)
        digital_pages = sum(1 for p in page_classifications if p.is_digital)
        scanned_pages = sum(1 for p in page_classifications if p.strategy == "SCANNED_IMAGE")
        vector_pages = sum(1 for p in page_classifications if p.strategy == "VECTOR_RICH")

        if scanned_pages == total_pages and total_pages > 0:
            doc_type = "SCANNED_EXAM_PAPER"
            recommended_pipeline = "OCR_AND_VISUAL_CROPS"
        elif digital_pages == total_pages and vector_pages > 0:
            doc_type = "VECTOR_COMPILED_MATH_PAPER"
            recommended_pipeline = "VECTOR_SYNTHESIS_AND_2D_LAYOUT"
        elif digital_pages == total_pages:
            doc_type = "DIGITAL_EDUCATIONAL_DOCUMENT"
            recommended_pipeline = "STANDARD_2D_SPATIAL_LAYOUT"
        elif digital_pages > 0 and scanned_pages > 0:
            doc_type = "MIXED_EDUCATIONAL_MODULE"
            recommended_pipeline = "PAGE_BY_PAGE_HYBRID_DISPATCH"
        else:
            doc_type = "UNKNOWN_OR_CORRUPT"
            recommended_pipeline = "FALLBACK_STREAM"

        return {
            "document_type": doc_type,
            "recommended_pipeline": recommended_pipeline,
            "total_pages": total_pages,
            "digital_pages": digital_pages,
            "scanned_pages": scanned_pages,
            "vector_rich_pages": vector_pages,
            "pages": [p.to_dict() for p in page_classifications],
        }
