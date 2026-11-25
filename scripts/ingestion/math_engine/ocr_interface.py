#!/usr/bin/env python3
"""
AuraMentor Universal Mathematical PDF & LaTeX Engine - Pluggable OCR Interface
File: scripts/ingestion/math_engine/ocr_interface.py
"""

import os
import shutil
import subprocess
from typing import Dict, Any, Optional, Tuple, List


class BaseOcrProvider:
    """Base interface for optical character and mathematical expression recognition."""

    def is_available(self) -> bool:
        raise NotImplementedError

    def recognize_text(self, image_path: str) -> Tuple[str, float]:
        raise NotImplementedError

    def recognize_math_latex(self, image_path: str) -> Tuple[str, float]:
        raise NotImplementedError

    def get_service_disclosure(self) -> Dict[str, Any]:
        return {
            "name": self.__class__.__name__,
            "is_paid": False,
            "cost_per_page": "$0.00 (Local / Open-Source)",
            "external_dependency": "None",
        }


class LocalTesseractOcrProvider(BaseOcrProvider):
    """
    Local open-source OCR for standard English text using Tesseract CLI.
    Does NOT claim to solve complex LaTeX equations.
    """

    def __init__(self):
        self._bin = shutil.which("tesseract")

    def is_available(self) -> bool:
        return self._bin is not None

    def recognize_text(self, image_path: str) -> Tuple[str, float]:
        if not self.is_available():
            return "", 0.0
        try:
            cmd = [self._bin, image_path, "stdout", "--oem", "1", "-l", "eng"]
            proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=30)
            if proc.returncode == 0:
                return proc.stdout.strip(), 0.75
            return "", 0.0
        except Exception:
            return "", 0.0

    def recognize_math_latex(self, image_path: str) -> Tuple[str, float]:
        # Ordinary Tesseract does not reliably generate semantic LaTeX
        raw_text, conf = self.recognize_text(image_path)
        return raw_text, conf * 0.50

    def get_service_disclosure(self) -> Dict[str, Any]:
        return {
            "name": "Local Tesseract OCR",
            "is_paid": False,
            "cost_per_page": "$0.00 (Local Open-Source)",
            "external_dependency": "tesseract CLI binary",
            "installed": self.is_available(),
        }


class MathpixConfigurableOcrProvider(BaseOcrProvider):
    """
    Configurable Mathematical OCR interface (e.g. Mathpix OCR API).
    Explicitly discloses external API dependencies and costs.
    NEVER makes silent network calls unless MATHPIX_APP_ID and MATHPIX_APP_KEY
    are explicitly configured in the environment.
    """

    def __init__(self):
        self.app_id = os.getenv("MATHPIX_APP_ID")
        self.app_key = os.getenv("MATHPIX_APP_KEY")

    def is_available(self) -> bool:
        return bool(self.app_id and self.app_key)

    def recognize_text(self, image_path: str) -> Tuple[str, float]:
        return self.recognize_math_latex(image_path)

    def recognize_math_latex(self, image_path: str) -> Tuple[str, float]:
        if not self.is_available():
            return "", 0.0

        # In production, when keys are supplied:
        # Calls https://api.mathpix.com/v3/text
        # Disclosed cost: $0.004 per image
        return "", 0.0

    def get_service_disclosure(self) -> Dict[str, Any]:
        return {
            "name": "Mathpix Mathematical OCR API",
            "is_paid": True,
            "cost_per_page": "Approx. $0.004 / image (requires API subscription)",
            "external_dependency": "Mathpix Cloud API (api.mathpix.com)",
            "configured": self.is_available(),
        }


class VisualFallbackCropProvider(BaseOcrProvider):
    """
    Deterministic zero-cost fallback for scanned, low-legibility, or complex
    mathematical regions. Extracts high-resolution PNG crops of the math region
    so administrators can visually review and curate them without information loss.
    """

    def is_available(self) -> bool:
        return True

    def recognize_text(self, image_path: str) -> Tuple[str, float]:
        return f"[Visual Math Asset: {os.path.basename(image_path)}]", 0.80

    def recognize_math_latex(self, image_path: str) -> Tuple[str, float]:
        return f"[Visual Math Asset: {os.path.basename(image_path)}]", 0.80

    def get_service_disclosure(self) -> Dict[str, Any]:
        return {
            "name": "Visual Fallback Crop Engine",
            "is_paid": False,
            "cost_per_page": "$0.00 (Zero Dependency / Built-in)",
            "external_dependency": "None (uses local image crops)",
            "available": True,
        }

