#!/usr/bin/env python3
"""
AuraMentor Universal Mathematical PDF & LaTeX Engine - Vector Math Path Detector
File: scripts/ingestion/math_engine/vector_math_detector.py
"""

import os
import re
from typing import List, Dict, Any, Optional, Tuple


class VectorPathSegment:
    def __init__(self, x1: float, y1: float, x2: float, y2: float, path_type: str = "LINE"):
        self.x1 = min(x1, x2)
        self.y1 = min(y1, y2)
        self.x2 = max(x1, x2)
        self.y2 = max(y1, y2)
        self.width = abs(x2 - x1)
        self.height = abs(y2 - y1)
        self.path_type = path_type

    @property
    def is_horizontal_vinculum(self) -> bool:
        """Horizontal line that may represent a fraction bar."""
        return self.width >= 6.0 and self.height <= 2.5


class VectorMathDetector:
    """
    Detects vector graphics, fraction bars (vinculums), and drawing paths
    used to render mathematical notation instead of standard font glyphs.
    """

    @classmethod
    def detect_vector_paths_in_page_stream(cls, page_stream_bytes: bytes) -> List[VectorPathSegment]:
        """
        Parses PDF vector drawing operators:
          - 'x y w h re' (rectangles)
          - 'x1 y1 m x2 y2 l S' (lines)
        """
        segments: List[VectorPathSegment] = []
        try:
            stream_str = page_stream_bytes.decode("latin1", errors="ignore")
        except Exception:
            return segments

        # 1. Match rectangle operators: x y w h re
        re_matches = re.finditer(
            r'(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+re',
            stream_str
        )
        for m in re_matches:
            x, y, w, h = float(m.group(1)), float(m.group(2)), float(m.group(3)), float(m.group(4))
            segments.append(VectorPathSegment(x, y, x + w, y + h, path_type="RECT"))

        # 2. Match line operators: x1 y1 m x2 y2 l
        line_matches = re.finditer(
            r'(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+m\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+l',
            stream_str
        )
        for m in line_matches:
            x1, y1, x2, y2 = float(m.group(1)), float(m.group(2)), float(m.group(3)), float(m.group(4))
            segments.append(VectorPathSegment(x1, y1, x2, y2, path_type="LINE"))

        return segments

    @classmethod
    def synthesize_vector_fractions(
        cls,
        text_boxes: List[Dict[str, Any]],
        vector_segments: List[VectorPathSegment],
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Correlates horizontal vinculum lines with text immediately above (numerator)
        and below (denominator) to reconstruct proper LaTeX fractions: \\frac{num}{den}.
        Returns (reconstructed_boxes, remaining_ambiguous_paths).
        """
        vinculums = [s for s in vector_segments if s.is_horizontal_vinculum]
        if not vinculums or not text_boxes:
            return text_boxes, []

        used_boxes = set()
        synthesized_fractions = []
        ambiguous_paths = []

        for vinc in vinculums:
            # Find numerator: text box whose bottom y is just above vinculum y (within 8pt) and horizontally aligned
            numerator_box = None
            denominator_box = None

            for i, box in enumerate(text_boxes):
                if i in used_boxes:
                    continue
                bx, by, bw, bh = box.get("x", 0), box.get("y", 0), box.get("w", 0), box.get("h", 0)

                # Numerator: directly above
                if 0 <= (by - vinc.y1) <= 12 and abs((bx + bw / 2) - (vinc.x1 + vinc.width / 2)) <= vinc.width:
                    numerator_box = (i, box)
                # Denominator: directly below
                elif 0 <= (vinc.y1 - (by + bh)) <= 12 and abs((bx + bw / 2) - (vinc.x1 + vinc.width / 2)) <= vinc.width:
                    denominator_box = (i, box)

            if numerator_box and denominator_box:
                num_idx, num = numerator_box
                den_idx, den = denominator_box
                used_boxes.add(num_idx)
                used_boxes.add(den_idx)

                frac_latex = f"\\frac{{{num.get('text', '').strip()}}}{{{den.get('text', '').strip()}}}"
                synthesized_fractions.append({
                    "text": frac_latex,
                    "x": vinc.x1,
                    "y": den.get("y", vinc.y1),
                    "w": vinc.width,
                    "h": (num.get("y", 0) + num.get("h", 0)) - den.get("y", 0),
                    "is_synthesized": True,
                })
            else:
                ambiguous_paths.append({
                    "bbox": [vinc.x1, vinc.y1, vinc.x2, vinc.y2],
                    "type": vinc.path_type,
                    "requires_visual_crop": True,
                })

        remaining_boxes = [b for i, b in enumerate(text_boxes) if i not in used_boxes]
        return remaining_boxes + synthesized_fractions, ambiguous_paths

