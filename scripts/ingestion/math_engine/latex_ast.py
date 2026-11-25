#!/usr/bin/env python3
"""
AuraMentor Universal Mathematical PDF & LaTeX Engine - Semantic AST & LaTeX Converter
File: scripts/ingestion/math_engine/latex_ast.py
"""

import re
from typing import List, Tuple, Dict, Any, Optional

from .categories import (
    GREEK_SYMBOL_MAP,
    UNICODE_SUPERSCRIPTS,
    UNICODE_SUBSCRIPTS,
    VULGAR_FRACTIONS,
    OPERATOR_SYMBOLS,
    CategoryRecognizer,
)
from .models import MathExpressionRecord, MathCategory, ExtractionMethod
from .latex_validator import LatexValidator


class LatexTransformer:
    """
    Transforms raw mathematical text streams and expressions into clean,
    valid, renderable KaTeX LaTeX strings. Preserves mathematical semantics,
    operator precedence, and grouping.
    """

    @classmethod
    def transform_expression(cls, raw_text: str) -> str:
        """Transforms a single mathematical expression into valid KaTeX."""
        if not raw_text or not raw_text.strip():
            return ""

        t = raw_text.strip()

        # 1. Vulgar fractions
        for vf, (num, den) in VULGAR_FRACTIONS.items():
            t = t.replace(vf, f"\\frac{{{num}}}{{{den}}}")

        # 2. Unicode superscripts -> ^{...}
        t = cls._convert_unicode_superscripts(t)

        # 3. Unicode subscripts -> _{...}
        t = cls._convert_unicode_subscripts(t)

        # 4. Greek letters (isolated or in math terms)
        for greek_char, latex_cmd in GREEK_SYMBOL_MAP.items():
            t = t.replace(greek_char, latex_cmd + " ")

        # 5. Math operators & relations
        for op_char, latex_cmd in OPERATOR_SYMBOLS.items():
            if op_char in {"√", "∛", "∜"}:
                continue  # handled separately
            t = t.replace(op_char, f" {latex_cmd} ")

        # 6. Radical & Root symbols (√x, √(x + 1), ∛x)
        t = cls._convert_radicals(t)

        # 7. Trigonometric functions & powers (sin, cos, tan, sec, csc, cot, cosec)
        t = cls._convert_trigonometry(t)

        # 8. Logarithms and exponentials (log_10(x), ln(x))
        t = cls._convert_logarithms(t)

        # 9. Calculus (dy/dx, d^2y/dx^2, integrals)
        t = cls._convert_calculus(t)

        # 10. Limits (lim x->0, lim_(x->0))
        t = cls._convert_limits(t)

        # 11. Summations & Products
        t = cls._convert_summations(t)

        # 12. Fractions with slash (e.g. 1/2, (x+1)/(x-1))
        t = cls._convert_slash_fractions(t)

        # 13. Standard exponent carets x^2 -> x^{2}, e^(2x) -> e^{2x}
        t = cls._normalize_exponents_and_subscripts(t)

        # 14. Degrees (e.g. 30 deg, 45°)
        t = re.sub(r'(\d+)\s*(?:°|deg(?:rees)?\b)', lambda m: f"{m.group(1)}^\\circ", t)

        # 15. Probability conditionals P(A|B) -> P(A \mid B)
        t = re.sub(
            r'\bP\s*\(\s*([A-Za-z0-9]+)\s*\|\s*([A-Za-z0-9]+)\s*\)',
            lambda m: f"P({m.group(1)} \\mid {m.group(2)})",
            t
        )

        # 16. Clean up redundant spaces around backslashes and brackets
        t = re.sub(r'\\([a-zA-Z]+)\s+([a-zA-Z0-9_{}\(\)\^])', lambda m: f"\\{m.group(1)} {m.group(2)}", t)
        t = re.sub(r'\s+', ' ', t).strip()

        return t

    @classmethod
    def _convert_unicode_superscripts(cls, text: str) -> str:
        """Converts strings containing unicode superscripts into ^2 or ^{...}."""
        result = []
        i = 0
        while i < len(text):
            ch = text[i]
            if ch in UNICODE_SUPERSCRIPTS:
                run = []
                while i < len(text) and text[i] in UNICODE_SUPERSCRIPTS:
                    run.append(UNICODE_SUPERSCRIPTS[text[i]])
                    i += 1
                exponent = "".join(run)
                if len(exponent) == 1 and exponent.isalnum():
                    result.append(f"^{exponent}")
                else:
                    result.append(f"^{{{exponent}}}")
            else:
                result.append(ch)
                i += 1
        return "".join(result)

    @classmethod
    def _convert_unicode_subscripts(cls, text: str) -> str:
        """Converts strings containing unicode subscripts into _1 or _{...}."""
        result = []
        i = 0
        while i < len(text):
            ch = text[i]
            if ch in UNICODE_SUBSCRIPTS:
                run = []
                while i < len(text) and text[i] in UNICODE_SUBSCRIPTS:
                    run.append(UNICODE_SUBSCRIPTS[text[i]])
                    i += 1
                subscript = "".join(run)
                if len(subscript) == 1 and subscript.isalnum():
                    result.append(f"_{subscript}")
                else:
                    result.append(f"_{{{subscript}}}")
            else:
                result.append(ch)
                i += 1
        return "".join(result)

    @classmethod
    def _convert_radicals(cls, text: str) -> str:
        """Converts √, ∛, ∜ and unbraced \\sqrt into valid \\sqrt{...}."""
        t = text
        t = re.sub(r'∛\s*\(([^)]+)\)', lambda m: f"\\sqrt[3]{{{m.group(1)}}}", t)
        t = re.sub(r'∛\s*([a-zA-Z0-9]+)', lambda m: f"\\sqrt[3]{{{m.group(1)}}}", t)
        t = re.sub(r'∜\s*\(([^)]+)\)', lambda m: f"\\sqrt[4]{{{m.group(1)}}}", t)
        t = re.sub(r'∜\s*([a-zA-Z0-9]+)', lambda m: f"\\sqrt[4]{{{m.group(1)}}}", t)
        t = re.sub(r'√\s*\(([^)]+)\)', lambda m: f"\\sqrt{{{m.group(1)}}}", t)
        t = re.sub(r'√\s*([a-zA-Z0-9]+)', lambda m: f"\\sqrt{{{m.group(1)}}}", t)
        t = re.sub(r'\\sqrt\s+([a-zA-Z0-9]+)(?!\{)', lambda m: f"\\sqrt{{{m.group(1)}}}", t)
        return t

    @classmethod
    def _convert_trigonometry(cls, text: str) -> str:
        """Converts trig names into KaTeX macros with proper power and argument handling."""
        t = text
        t = re.sub(r'\bcosec\b', r'\\csc', t)

        funcs = ["sin", "cos", "tan", "sec", "csc", "cot"]
        for fn in funcs:
            # Handle flattened power without caret: e.g. tan2θ -> \tan^2 \theta, sin2x -> \sin^2 x
            pat_flat = r'(?<!\\)\b' + fn + r'([2-4])(?=[a-zA-Zθαβγ\\])'
            t = re.sub(pat_flat, lambda m, f=fn: f"\\{f}^{m.group(1)} ", t, flags=re.IGNORECASE)

            pat_pow = r'(?<!\\)\b' + fn + r'\b\s*\^\s*\{?([0-9a-zA-Z\-]+)\}?'
            t = re.sub(
                pat_pow,
                lambda m, f=fn: f"\\{f}^{m.group(1)}" if len(m.group(1)) == 1 and m.group(1).isalnum() else f"\\{f}^{{{m.group(1)}}}",
                t,
                flags=re.IGNORECASE
            )

            pat_std = r'(?<!\\)\b' + fn + r'\b(?!\^)'
            t = re.sub(pat_std, lambda m, f=fn: f"\\{f}", t, flags=re.IGNORECASE)
        return t

    @classmethod
    def _convert_logarithms(cls, text: str) -> str:
        """Converts log, ln expressions to KaTeX macros \\log, \\ln."""
        t = text
        t = re.sub(r'(?<!\\)\blog_\{?([0-9a-zA-Z]+)\}?', lambda m: f"\\log_{{{m.group(1)}}}", t)
        t = re.sub(r'(?<!\\)\blog\b', r'\\log', t)
        t = re.sub(r'(?<!\\)\bln\b', r'\\ln', t)
        return t

    @classmethod
    def _convert_calculus(cls, text: str) -> str:
        """Converts derivatives and integrals into standard LaTeX."""
        t = text
        t = re.sub(r'\bd\^2([a-zA-Z])\/d([a-zA-Z])\^2\b', lambda m: f"\\frac{{d^2{m.group(1)}}}{{d{m.group(2)}^2}}", t)
        t = re.sub(r'\bd([a-zA-Z])\/d([a-zA-Z])\b', lambda m: f"\\frac{{d{m.group(1)}}}{{d{m.group(2)}}}", t)
        t = re.sub(r'\bd\/d([a-zA-Z])\b', lambda m: f"\\frac{{d}}{{d{m.group(1)}}}", t)
        t = re.sub(r'\\int_([a-zA-Z0-9])\^([a-zA-Z0-9])', lambda m: f"\\int_{{{m.group(1)}}}^{{{m.group(2)}}}", t)
        return t

    @classmethod
    def _convert_limits(cls, text: str) -> str:
        """Converts limits into KaTeX format: \lim_{x \to 0}."""
        t = text
        t = re.sub(
            r'\blim\s*(?:its)?\s*[\(\[]?\s*([a-zA-Z])\s*(?:->|→|\\to)\s*([a-zA-Z0-9\-\+\\infty]+)\s*[\)\]]?',
            lambda m: f"\\lim_{{{m.group(1)} \\to {m.group(2)}}}",
            t,
            flags=re.IGNORECASE
        )
        return t

    @classmethod
    def _convert_summations(cls, text: str) -> str:
        """Converts sum/prod indices into KaTeX \\sum_{i=1}^{n}."""
        t = text
        t = re.sub(
            r'\\sum_\{?([a-zA-Z]\s*=\s*\d+)\}?\^\{?([a-zA-Z0-9]+)\}?',
            lambda m: f"\\sum_{{{m.group(1)}}}^{{{m.group(2)}}}",
            t
        )
        return t

    @classmethod
    def _convert_slash_fractions(cls, text: str) -> str:
        """Converts slash fractions like (x + 1)/(x - 1) or 3/4 into \\frac{...}{...}."""
        t = text
        t = re.sub(
            r'\(([a-zA-Z0-9\s\+\-\*\^_{}\\]+)\)\s*\/\s*\(([a-zA-Z0-9\s\+\-\*\^_{}\\]+)\)',
            lambda m: f"\\frac{{{m.group(1)}}}{{{m.group(2)}}}",
            t
        )
        t = re.sub(
            r'(?<!\d\/)(?<![a-zA-Z0-9_])(\d+)\s*\/\s*(\d+)(?!\/\d)(?![a-zA-Z0-9_])',
            lambda m: f"\\frac{{{m.group(1)}}}{{{m.group(2)}}}",
            t
        )
        t = re.sub(
            r'(?<![a-zA-Z0-9_\\/])([a-zA-Z])\s*\/\s*([a-zA-Z0-9])(?![a-zA-Z0-9_\\/])',
            lambda m: f"\\frac{{{m.group(1)}}}{{{m.group(2)}}}",
            t
        )
        # Slash fractions involving radicals: e.g. 1/\sqrt{3}, \sqrt{3}/2, a/\sqrt{b}
        t = re.sub(
            r'([a-zA-Z0-9]+)\s*\/\s*(\\sqrt(?:\[\d+\])?\{[^}]+\})',
            lambda m: f"\\frac{{{m.group(1)}}}{{{m.group(2)}}}",
            t
        )
        t = re.sub(
            r'(\\sqrt(?:\[\d+\])?\{[^}]+\})\s*\/\s*([a-zA-Z0-9]+)',
            lambda m: f"\\frac{{{m.group(1)}}}{{{m.group(2)}}}",
            t
        )
        return t

    @classmethod
    def _normalize_exponents_and_subscripts(cls, text: str) -> str:
        """Ensures parenthesized exponents and subscripts have curly braces: x^(2n) -> x^{2n}."""
        t = text
        t = re.sub(r'([a-zA-Z0-9\)\]\}])\^\(([^)]+)\)', lambda m: f"{m.group(1)}^{{{m.group(2)}}}", t)
        t = re.sub(r'([a-zA-Z0-9\)\]\}])_\(([^)]+)\)', lambda m: f"{m.group(1)}_{{{m.group(2)}}}", t)
        # Variable notation with trailing single digit: R1 -> R_1, R2 -> R_2 in math expressions
        t = re.sub(r'(?<![a-zA-Z0-9_])([A-Z])([1-9])(?![a-zA-Z0-9_])', r'\1_\2', t)
        return t


class MathDocumentParser:
    """
    Parses full question sentences and text paragraphs, extracts embedded
    mathematical constructs into structured MathExpressionRecord objects,
    and returns text formatted with valid KaTeX $...$ delimiters.
    """

    @classmethod
    def process_text_and_extract_expressions(
        cls,
        text: str,
        page_number: int = 1,
        method: str = ExtractionMethod.DIGITAL_TEXT.value,
    ) -> Tuple[str, List[MathExpressionRecord]]:
        """
        Scans a text paragraph or question statement, recognizes mathematical
        expressions, generates valid KaTeX LaTeX with '$' delimiters, and
        stores structured records for every extracted expression.
        """
        if not text:
            return "", []

        # If text is already delimited by $...$ or $$...$$, validate those expressions directly
        if "$" in text or "\\[" in text:
            return cls._process_already_delimited_text(text, page_number, method)

        extracted_records: List[MathExpressionRecord] = []
        expr_counter = 1

        # Join lines where an equation was broken across a line break after an operator
        text_joined = re.sub(r'([=><≤≥≠\+\-\*\/])\s*\n\s*([a-zA-Z0-9\(\)\{\}\\])', r'\1 \2', text)
        lines = text_joined.split("\n")
        processed_lines = []

        for line in lines:
            line_str = line.strip()
            if not line_str:
                processed_lines.append("")
                continue

            # Check if entire line is an equation (e.g. 'x^2 + 5x + 6 = 0')
            if cls._is_pure_equation_line(line_str):
                transformed = LatexTransformer.transform_expression(line_str)
                category = CategoryRecognizer.identify_category(transformed)
                val_res = LatexValidator.validate(transformed)

                rec = MathExpressionRecord(
                    expression_id=f"expr-p{page_number}-{expr_counter}",
                    original_text=line_str,
                    latex=transformed,
                    category=category,
                    page_number=page_number,
                    method=method,
                    confidence=0.95 if val_res.is_valid else 0.50,
                    is_valid_latex=val_res.is_valid,
                    validation_errors=val_res.errors,
                    review_warnings=val_res.warnings,
                )
                extracted_records.append(rec)
                expr_counter += 1
                processed_lines.append(transformed)
                continue

            # Process inline mathematical phrases
            processed_line = line_str

            # 1. Transform explicit vulgar fractions
            for vf, (num, den) in VULGAR_FRACTIONS.items():
                if vf in processed_line:
                    latex_frac = f"\\frac{{{num}}}{{{den}}}"
                    rec = MathExpressionRecord(
                        expression_id=f"expr-p{page_number}-{expr_counter}",
                        original_text=vf,
                        latex=latex_frac,
                        category=MathCategory.FRACTIONS.value,
                        page_number=page_number,
                        method=method,
                        confidence=1.0,
                        is_valid_latex=True,
                    )
                    extracted_records.append(rec)
                    expr_counter += 1
                    processed_line = processed_line.replace(vf, latex_frac)

            # 2. Check for coordinate points: P(-6, 8)
            coord_matches = list(re.finditer(r'(?<![$\w])([A-Z]\s*\(\s*-?\d+\s*,\s*-?\d+\s*\))(?![$\w])', processed_line))
            for cm in coord_matches:
                c_text = cm.group(1).strip()
                transformed = LatexTransformer.transform_expression(c_text)
                val_res = LatexValidator.validate(transformed)
                rec = MathExpressionRecord(
                    expression_id=f"expr-p{page_number}-{expr_counter}",
                    original_text=c_text,
                    latex=transformed,
                    category=MathCategory.COORDINATE_GEOMETRY.value,
                    page_number=page_number,
                    method=method,
                    confidence=0.95 if val_res.is_valid else 0.50,
                    is_valid_latex=val_res.is_valid,
                    validation_errors=val_res.errors,
                    review_warnings=val_res.warnings,
                )
                extracted_records.append(rec)
                expr_counter += 1
                processed_line = processed_line.replace(c_text, transformed, 1)

            # 3. Check for chained radical equations: \sqrt{(-6)^2 + 8^2} = \sqrt{36 + 64} = \sqrt{100} = 10
            rad_chain = re.search(r'(\\sqrt\{[^{}]+\}\s*=\s*\\sqrt\{[^{}]+\}(?:\s*=\s*\\sqrt\{[^{}]+\})*\s*=\s*\d+)', processed_line)
            if rad_chain:
                rc_text = rad_chain.group(1).strip()
                transformed = LatexTransformer.transform_expression(rc_text)
                val_res = LatexValidator.validate(transformed)
                rec = MathExpressionRecord(
                    expression_id=f"expr-p{page_number}-{expr_counter}",
                    original_text=rc_text,
                    latex=transformed,
                    category=CategoryRecognizer.identify_category(transformed),
                    page_number=page_number,
                    method=method,
                    confidence=0.95 if val_res.is_valid else 0.50,
                    is_valid_latex=val_res.is_valid,
                    validation_errors=val_res.errors,
                    review_warnings=val_res.warnings,
                )
                extracted_records.append(rec)
                expr_counter += 1
                processed_line = processed_line.replace(rc_text, transformed, 1)

            # 4. Extract clean mathematical equations and relations
            norm_line = processed_line.replace("−", "-").replace("–", "-")
            STOP_PATTERN = r'(?:;|\band\b|\bor\b|\bsuch\s+that\b|\bwhere\b|\bif\b|\bthen\b|\bwith\b|\bhave\b|\bfor\s+some\b|\bfind\b|\bwhen\b|\bgiven\b)'
            clauses = re.split(STOP_PATTERN, norm_line, flags=re.IGNORECASE)

            MATH_FUNCS = {"sin", "cos", "tan", "sec", "csc", "cot", "log", "ln", "lim", "det", "exp", "vec", "sqrt"}
            GREEK_WORDS = {"alpha", "beta", "gamma", "theta", "lambda", "pi", "sigma", "omega", "phi", "delta"}

            for clause in clauses:
                clause_str = clause.strip(" ,.:\"'\t\n")
                if not clause_str or not re.search(r'[=><≤≥≠]', clause_str):
                    continue
                tokens = clause_str.split()
                op_idx = -1
                for idx, tok in enumerate(tokens):
                    if any(op in tok for op in ["=", ">", "<", "≤", "≥", "≠"]):
                        op_idx = idx
                        break
                if op_idx == -1:
                    continue

                lhs_tokens = tokens[:op_idx]
                rhs_tokens = tokens[op_idx+1:]
                op_token = tokens[op_idx]

                clean_lhs_tokens = []
                for tok in reversed(lhs_tokens):
                    w_lower = re.sub(r'[^a-zA-Z]', '', tok).lower()
                    has_math_char = any(c in tok for c in "0123456789()[]{}^_\\°θλαβπ+-*/∠∆√=")
                    is_var = len(w_lower) == 1
                    is_math_word = w_lower in MATH_FUNCS or w_lower in GREEK_WORDS
                    if has_math_char or is_var or is_math_word:
                        clean_lhs_tokens.append(tok)
                    else:
                        break
                clean_lhs_tokens.reverse()

                clean_rhs_tokens = []
                for tok in rhs_tokens:
                    tok_clean = tok.rstrip(".,;?!:")
                    w_lower = re.sub(r'[^a-zA-Z]', '', tok_clean).lower()
                    has_math_char = any(c in tok_clean for c in "0123456789()[]{}^_\\°θλαβπ+-*/∠∆√=<>≤≥≠")
                    is_var = len(w_lower) == 1
                    is_math_word = w_lower in MATH_FUNCS or w_lower in GREEK_WORDS
                    if has_math_char or is_var or is_math_word:
                        clean_rhs_tokens.append(tok_clean)
                    else:
                        break

                final_lhs = " ".join(clean_lhs_tokens).strip()
                final_rhs = " ".join(clean_rhs_tokens).strip()

                cand_expr = ""
                if op_token in ["=", ">", "<", "≤", "≥", "≠"]:
                    if final_lhs and final_rhs:
                        cand_expr = f"{final_lhs} {op_token} {final_rhs}"
                else:
                    full_expr = " ".join(clean_lhs_tokens + [op_token] + clean_rhs_tokens).strip()
                    if full_expr:
                        cand_expr = full_expr

                if cand_expr and not CategoryRecognizer.is_plain_english_phrase(cand_expr):
                    transformed = LatexTransformer.transform_expression(cand_expr)
                    val_res = LatexValidator.validate(transformed)
                    cat = CategoryRecognizer.identify_category(transformed)
                    if cat != "NON_MATH_TEXT":
                        rec = MathExpressionRecord(
                            expression_id=f"expr-p{page_number}-{expr_counter}",
                            original_text=cand_expr,
                            latex=transformed,
                            category=cat,
                            page_number=page_number,
                            method=method,
                            confidence=0.90 if val_res.is_valid else 0.50,
                            is_valid_latex=val_res.is_valid,
                            validation_errors=val_res.errors,
                            review_warnings=val_res.warnings,
                        )
                        extracted_records.append(rec)
                        expr_counter += 1
                        processed_line = processed_line.replace(cand_expr, transformed, 1)

            processed_lines.append(processed_line)

        formatted_text = "\n".join(processed_lines)
        return formatted_text, extracted_records

    @classmethod
    def _is_pure_equation_line(cls, line: str) -> bool:
        """Determines if a line is almost entirely a mathematical equation."""
        if not re.search(r'[=><≤≥≠]', line):
            return False
        words = re.findall(r'\b[a-zA-Z]{3,}\b', line)
        math_words = {"sin", "cos", "tan", "sec", "csc", "cot", "log", "lim", "det", "vec", "max", "min"}
        non_math_words = [w for w in words if w.lower() not in math_words]
        return len(non_math_words) <= 2

    @classmethod
    def _process_already_delimited_text(
        cls,
        text: str,
        page_number: int,
        method: str,
    ) -> Tuple[str, List[MathExpressionRecord]]:
        """Processes text that already has $...$ or $$...$$ delimiters."""
        records: List[MathExpressionRecord] = []
        counter = 1

        matches = re.finditer(r'(\$\$[\s\S]+?\$\$|\$[^$\n]+\$|\\\\\[[\s\S]+?\\\\\])', text)
        for m in matches:
            raw_block = m.group(1)
            inner = raw_block.strip("$[]\\ \n")
            val_res = LatexValidator.validate(inner)
            rec = MathExpressionRecord(
                expression_id=f"expr-p{page_number}-{counter}",
                original_text=raw_block,
                latex=inner,
                category=CategoryRecognizer.identify_category(inner),
                page_number=page_number,
                method=method,
                confidence=0.95 if val_res.is_valid else 0.40,
                is_valid_latex=val_res.is_valid,
                validation_errors=val_res.errors,
                review_warnings=val_res.warnings,
            )
            records.append(rec)
            counter += 1

        return text, records
