#!/usr/bin/env python3
"""
AuraMentor Universal Mathematical PDF & LaTeX Engine - 20 Category Recognizers & Transformers
File: scripts/ingestion/math_engine/categories.py
"""

import re
from typing import Dict, List, Optional, Tuple

from .models import MathCategory


# Unicode to LaTeX mappings for Greek symbols
GREEK_SYMBOL_MAP: Dict[str, str] = {
    "α": r"\alpha", "β": r"\beta", "γ": r"\gamma", "δ": r"\delta",
    "ε": r"\varepsilon", "ζ": r"\zeta", "η": r"\eta", "θ": r"\theta",
    "ι": r"\iota", "κ": r"\kappa", "λ": r"\lambda", "μ": r"\mu",
    "ν": r"\nu", "ξ": r"\xi", "π": r"\pi", "ρ": r"\rho",
    "σ": r"\sigma", "τ": r"\tau", "υ": r"\upsilon", "φ": r"\phi",
    "χ": r"\chi", "ψ": r"\psi", "ω": r"\omega",
    "Γ": r"\Gamma", "Δ": r"\Delta", "Θ": r"\Theta", "Λ": r"\Lambda",
    "Ξ": r"\Xi", "Π": r"\Pi", "Σ": r"\Sigma", "Υ": r"\Upsilon",
    "Φ": r"\Phi", "Ψ": r"\Psi", "Ω": r"\Omega",
}

# Unicode superscripts to regular digits
UNICODE_SUPERSCRIPTS: Dict[str, str] = {
    "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
    "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
    "⁺": "+", "⁻": "-", "⁼": "=", "⁽": "(", "⁾": ")",
    "ⁿ": "n", "ⁱ": "i",
}

# Unicode subscripts to regular digits
UNICODE_SUBSCRIPTS: Dict[str, str] = {
    "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
    "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
    "₊": "+", "₋": "-", "₌": "=", "₍": "(", "₎": ")",
    "ₐ": "a", "ₑ": "e", "ₒ": "o", "ₓ": "x", "ₕ": "h", "ₖ": "k",
    "ₗ": "l", "ₘ": "m", "ₙ": "n", "ₚ": "p", "ₛ": "s", "ₜ": "t",
    "ᵢ": "i", "ⱼ": "j",
}

# Common vulgar fraction characters
VULGAR_FRACTIONS: Dict[str, Tuple[str, str]] = {
    "½": ("1", "2"), "⅓": ("1", "3"), "⅔": ("2", "3"),
    "¼": ("1", "4"), "¾": ("3", "4"), "⅕": ("1", "5"),
    "⅖": ("2", "5"), "⅗": ("3", "5"), "⅘": ("4", "5"),
    "⅙": ("1", "6"), "⅚": ("5", "6"), "⅛": ("1", "8"),
    "⅜": ("3", "8"), "⅝": ("5", "8"), "⅞": ("7", "8"),
}

# Mathematical relations and operators
OPERATOR_SYMBOLS: Dict[str, str] = {
    "≤": r"\le", "≥": r"\ge", "≠": r"\ne", "≈": r"\approx",
    "≡": r"\equiv", "±": r"\pm", "∓": r"\mp", "×": r"\times",
    "÷": r"\div", "·": r"\cdot", "•": r"\cdot",
    "−": "-", "–": "-",
    "∠": r"\angle", "∆": r"\triangle", "Δ": r"\Delta",
    "⊥": r"\perp", "∥": r"\parallel", "≅": r"\cong", "∼": r"\sim",
    "√": r"\sqrt", "∛": r"\sqrt[3]", "∜": r"\sqrt[4]",
    "∞": r"\infty", "∫": r"\int", "∬": r"\iint", "∑": r"\sum",
    "∏": r"\prod", "∂": r"\partial", "∇": r"\nabla",
    "∈": r"\in", "∉": r"\notin", "⊂": r"\subset", "⊆": r"\subseteq",
    "∪": r"\cup", "∩": r"\cap", "∅": r"\emptyset",
    "→": r"\to", "⇒": r"\implies", "⇔": r"\iff",
}


class CategoryRecognizer:
    """
    Detects and categorizes mathematical constructs into the 20 distinct educational math domains.
    """

    @classmethod
    def is_plain_english_phrase(cls, text: str) -> bool:
        """Determines if a candidate string is an ordinary English phrase rather than math."""
        t = text.strip()
        if not t:
            return True
        # Explicit non-math patterns like "right-angle template", "right-angled", "wide-angle"
        if re.search(r'\b(?:right|wide|acute|obtuse|case|long|short|side|step|well|first|second)\s*-\s*(?:angle|angled|based|answer|order|study|step|hand)\b', t, re.IGNORECASE):
            return True
        if re.fullmatch(r'[a-zA-Z\s\-]+', t):
            words = [w for w in re.split(r'[\s\-]+', t) if w]
            if len(words) >= 2 and all(len(w) >= 3 for w in words):
                math_keywords = {"sin", "cos", "tan", "sec", "csc", "cot", "log", "lim", "det", "vec", "integral", "matrix"}
                if not any(w.lower() in math_keywords for w in words):
                    return True
        return False

    @classmethod
    def identify_category(cls, text: str) -> str:
        t = text.strip()

        # Check for plain English phrases
        if cls.is_plain_english_phrase(t):
            return "NON_MATH_TEXT"

        # 1. Calculus (integrals, derivatives, partials)
        if re.search(r'(?:\\int|\bdy/dx\b|\bd\^2y/dx\^2\b|\b\d*d/dx\b|\\partial|\\iint)', t, re.IGNORECASE):
            return MathCategory.CALCULUS.value

        # 2. Limits
        if re.search(r'(?:\\lim|\blim\s*_\s*\{|\blim(?:its)?\s*[\(\[]?[a-zA-Z]\s*(?:->|→|\\to)\s*)', t, re.IGNORECASE):
            return MathCategory.LIMITS.value

        # 3. Matrices and Determinants
        if re.search(r'(?:\\begin\{(?:p|b|v|V)?matrix\}|\|\s*[a-zA-Z0-9\-\+]+\s+[a-zA-Z0-9\-\+]+\s*\|)', t):
            return MathCategory.MATRICES_AND_DETERMINANTS.value

        # 4. Piecewise functions
        if re.search(r'(?:\\begin\{cases\}|f\([a-zA-Z]\)\s*=\s*\{)', t):
            return MathCategory.PIECEWISE_FUNCTIONS.value

        # 5. Summations and Products
        if re.search(r'(?:\\sum|\\prod|\b\u2211|\b\u220f)', t):
            return MathCategory.SUMMATIONS_AND_PRODUCTS.value

        # 6. Trigonometry
        if re.search(r'(?:\\sin|\\cos|\\tan|\\sec|\\csc|\\cot|\bsin\b|\bcos\b|\btan\b|\bsec\b|\bcsc\b|\bcot\b|\bcosec\b)', t, re.IGNORECASE):
            return MathCategory.TRIGONOMETRY.value

        # 7. Logarithms and Exponentials
        if re.search(r'(?:\\log|\\ln|\blog(?:_\d+)?\b|\bln\b|\be\^\{|\be\^[a-zA-Z0-9])', t, re.IGNORECASE):
            return MathCategory.LOGARITHMS.value

        # 8. Vectors
        if re.search(r'(?:\\vec|\bvec\b|\\mathbf|\\hat\{?[ijk]\}?|[ijk]\^|\bvector\b)', t):
            return MathCategory.VECTORS.value

        # 9. Probability
        if re.search(r'(?:P\([A-Z](?:\|[A-Z])?\)|\bE\([X-Z]\)\b|\bVar\([X-Z]\)\b|P\([A-Z]\s*(?:\\cap|\\cup|\band\b|\bor\b)\s*[A-Z]\))', t):
            return MathCategory.PROBABILITY.value

        # 10. Statistics
        if re.search(r'(?:\\bar\{x\}|\bmean\b|\bmedian\b|\bmode\b|\bvariance\b|\\sigma\b|\bf_i\s*x_i\b)', t, re.IGNORECASE):
            return MathCategory.STATISTICS.value

        # 11. Coordinate Geometry
        if re.search(r'\(\s*-?\d+\s*,\s*-?\d+\s*\)|\(\s*x_?[12]\s*,\s*y_?[12]\s*\)|\bmidpoint\b|\bsection\s+formula\b', t, re.IGNORECASE):
            return MathCategory.COORDINATE_GEOMETRY.value

        # 12. Geometry and Angles
        if re.search(r'(?:\\angle|\\triangle|\\perp|\\parallel|\\cong|\\sim|\bangle\b|\btriangle\b|°|\^\\circ)', t, re.IGNORECASE):
            return MathCategory.GEOMETRY_AND_ANGLES.value

        # 13. Roots and Radicals
        if re.search(r'(?:\\sqrt|√|∛|∜)', t):
            return MathCategory.ROOTS_AND_RADICALS.value

        # 14. Fractions
        if re.search(r'(?:\\frac|\\dfrac|\\tfrac|\d+/\d+|\([a-zA-Z0-9\+\-\s]+\)/\([a-zA-Z0-9\+\-\s]+\)|[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])', t):
            return MathCategory.FRACTIONS.value

        # 15. Set Notation
        if re.search(r'(?:\\in|\\notin|\\subset|\\subseteq|\\cup|\\cap|\\emptyset|\\mathbb\{[RNZQ]\}|[∈∉⊂⊆∪∩∅])', t):
            return MathCategory.SET_NOTATION.value

        # 16. Inequalities & Absolute Values
        if re.search(r'(?:\\le|\\ge|\\ne|[≤≥≠]|\|[a-zA-Z0-9\+\-\s]+\|\s*[\<\>\=])', t):
            return MathCategory.INEQUALITIES_AND_ABSOLUTE_VALUES.value

        # 17. Greek Letters
        if any(g in t for g in GREEK_SYMBOL_MAP.keys()) or re.search(r'\\(?:alpha|beta|gamma|theta|lambda|pi|sigma|omega|phi|Delta)', t):
            return MathCategory.GREEK_LETTERS.value

        # 18. Powers and Exponents
        if re.search(r'[\^⁰¹²³⁴⁵⁶⁷⁸⁹ⁿⁱ]', t) or re.search(r'[a-zA-Z0-9]\^[a-zA-Z0-9]', t):
            return MathCategory.POWERS_AND_EXPONENTS.value

        # 19. Subscripts
        if re.search(r'[_₀₁₂₃₄₅₆₇₈₉ₙᵢⱼ]', t) or re.search(r'[a-zA-Z0-9]_[a-zA-Z0-9]', t):
            return MathCategory.SUBSCRIPTS.value

        # 20. Multiline Equations
        if "\n" in t and ("=" in t or r"\begin{aligned}" in t):
            return MathCategory.MULTILINE_EQUATIONS.value

        return MathCategory.GENERAL_ALGEBRA.value
