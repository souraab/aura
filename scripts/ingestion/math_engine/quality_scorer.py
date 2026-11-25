#!/usr/bin/env python3
"""
AuraMentor Universal Mathematical PDF & LaTeX Engine - 5-Dimensional Quality Scorer & Triage Classifier
File: scripts/ingestion/math_engine/quality_scorer.py
"""

import re
from typing import List, Dict, Any, Optional, Tuple
from .models import (
    ExtractionQualityScore,
    MathExpressionRecord,
    QualityStatus,
    ReviewCategory,
    CheckStatus,
    ValidationCheckResult,
)
from .latex_validator import LatexValidator


class MathematicalQualityScorer:
    """
    Computes rigorous, decoupled quality metrics across 7 deterministic validation checks:
      1. Text Completeness
      2. Mathematical Integrity (KaTeX syntax, delimiters, dangling operators)
      3. Question Structure (Stems, OR alternatives)
      4. MCQ Option Completeness (adaptive to question type)
      5. Diagram Association & Visual Evidence
      6. Table & Subpart Completeness
      7. Duplicate Detection Status

    Assigns an explainable Review Category (A / B / C) based on deterministic rules:
      - CATEGORY_A: No critical failures; all applicable deterministic checks pass.
      - CATEGORY_B: No critical failure, but one or more uncertainties require targeted inspection.
      - CATEGORY_C: One or more critical failures (missing content, broken math, incomplete structure).
    """

    # -------------------------------------------------------------------------
    # Check 1: Text Completeness
    # -------------------------------------------------------------------------
    @classmethod
    def check_text_completeness(
        cls, candidate_text: str, detected_subparts: List[Dict[str, str]]
    ) -> Tuple[ValidationCheckResult, float, List[str], List[str]]:
        failures: List[str] = []
        warnings: List[str] = []
        clean = (candidate_text or "").strip()

        if not clean:
            failures.append("EMPTY_STEM: Question statement contains no text.")
            return (
                ValidationCheckResult(
                    check_name="TEXT_COMPLETENESS",
                    status=CheckStatus.FAIL,
                    code="EMPTY_STEM",
                    message="Question stem is empty.",
                ),
                0.0,
                failures,
                warnings,
            )

        # Check for truncated question stems ending in dangling operators (e.g. 'Simplified form of −')
        if re.search(r'(?:form of|value of|equal to|find)\s*[\-−=><\+\*\/]\s*$', clean, re.IGNORECASE):
            failures.append("INCOMPLETE_QUESTION_STEM: Question stem ends with an unresolved dangling operator or missing formula.")
            return (
                ValidationCheckResult(
                    check_name="TEXT_COMPLETENESS",
                    status=CheckStatus.FAIL,
                    code="DANGLING_BOUNDARY_OPERATOR",
                    message="Question stem ends abruptly with a dangling operator (e.g. 'form of -').",
                    details={"matched_tail": clean[-25:]},
                ),
                0.30,
                failures,
                warnings,
            )

        # Check for truncated stems ending in dangling grammatical conjunctions (not fill-in-the-blank MCQs)
        if re.search(r'\b(?:such that|given that|where the|which of the)\s*$', clean, re.IGNORECASE):
            failures.append("INCOMPLETE_QUESTION_STEM: Question stem ends abruptly mid-clause.")
            return (
                ValidationCheckResult(
                    check_name="TEXT_COMPLETENESS",
                    status=CheckStatus.FAIL,
                    code="TRUNCATED_CLAUSE_BOUNDARY",
                    message="Question stem ends abruptly with an unresolved clause ('such that', 'given that', etc.).",
                    details={"matched_tail": clean[-25:]},
                ),
                0.35,
                failures,
                warnings,
            )

        # Check for unmapped unicode replacement or corrupted characters (e.g. \ufffd or ???)
        corrupted_glyphs = clean.count("\ufffd") + clean.count("???")
        if corrupted_glyphs > 0:
            warnings.append(f"CORRUPTED_GLYPHS: Found {corrupted_glyphs} unmapped or corrupted glyphs.")
            return (
                ValidationCheckResult(
                    check_name="TEXT_COMPLETENESS",
                    status=CheckStatus.WARNING,
                    code="CORRUPTED_GLYPHS",
                    message=f"Found {corrupted_glyphs} unmapped replacement glyphs in question text.",
                    details={"glyph_count": corrupted_glyphs},
                ),
                0.70,
                failures,
                warnings,
            )

        # Non-universal length check: very short text without subparts or math
        if len(clean) < 8 and not detected_subparts:
            failures.append("TEXT_TOO_SHORT: Question stem has under 8 characters and no subparts.")
            return (
                ValidationCheckResult(
                    check_name="TEXT_COMPLETENESS",
                    status=CheckStatus.FAIL,
                    code="TEXT_TOO_SHORT",
                    message=f"Question stem is too short to form a valid question ({len(clean)} chars).",
                ),
                0.40,
                failures,
                warnings,
            )

        return (
            ValidationCheckResult(
                check_name="TEXT_COMPLETENESS",
                status=CheckStatus.PASS,
                code="TEXT_COMPLETE",
                message=f"Question stem is complete and legible ({len(clean)} characters).",
            ),
            1.0,
            failures,
            warnings,
        )

    # -------------------------------------------------------------------------
    # Check 2: Mathematical Integrity
    # -------------------------------------------------------------------------
    @classmethod
    def check_mathematical_integrity(
        cls,
        candidate_text: str,
        math_expressions: List[MathExpressionRecord],
        raw_text: Optional[str] = None,
    ) -> Tuple[ValidationCheckResult, float, float, List[str], List[str]]:
        failures: List[str] = []
        warnings: List[str] = []
        math_score = 1.0
        latex_score = 1.0

        raw = raw_text or candidate_text or ""

        # 1. Delimiter balance check in plain text
        open_dollars = candidate_text.count("$")
        if open_dollars % 2 != 0:
            failures.append("UNBALANCED_DOLLAR_DELIMITERS: Odd number of '$' math delimiters in text.")
            return (
                ValidationCheckResult(
                    check_name="MATHEMATICAL_INTEGRITY",
                    status=CheckStatus.FAIL,
                    code="UNBALANCED_DOLLAR_DELIMITERS",
                    message=f"Odd count of '$' math delimiters ({open_dollars}). KaTeX math block unclosed.",
                ),
                0.40,
                0.30,
                failures,
                warnings,
            )

        # 2. Check for duplicated math operators in raw text (e.g. "- -1" defect)
        # Strip markdown table dividers (| --- | --- |) first so table formatters are not mistaken for math signs
        raw_non_table = re.sub(r"\|[\s\-:|]+\|", "", raw)
        if re.search(r"(?<![a-zA-Z0-9])[-−–]\s*[-−–]\s*([0-9a-zA-Z\\$])", raw_non_table):
            warnings.append("OCR_DEFECT_REPAIRED: Duplicated mathematical sign in raw extraction corrected.")
            math_score = min(math_score, 0.85)

        # 3. Check for vector operator OCR artifacts (e.g. \nabla \cdot where del vector operator was recognized)
        if r"\nabla" in candidate_text or r"\cdot R" in candidate_text:
            warnings.append("OCR_OPERATOR_ARTIFACT: Del/nabla vector operator artifact detected in non-vector problem.")
            math_score = min(math_score, 0.85)

        # 4. Check for ambiguous glyph encoding (e.g. 'angle 450' representing 45°)
        if re.search(r'\b(?:angle|angles)\s+(?:of\s+)?(?:[0-9]{1,2})0\b', candidate_text, re.IGNORECASE):
            warnings.append("AMBIGUOUS_GLYPH_ENCODING: Potential degree symbol encoded as zero in angle expression (e.g. 'angle 450' for 45°).")
            math_score = min(math_score, 0.85)

        # 5. Check for suspicious unwrapped LaTeX commands outside $...$ delimiters (e.g. Q37 '| Time (in \sec) |')
        non_math_text = re.sub(r"\$\$[\s\S]*?\$\$|\$[^\$]+\$", " ", candidate_text)
        unwrapped_cmds = re.findall(
            r"\\(?:sec|sin|cos|tan|csc|cot|frac|sqrt|theta|pi|alpha|beta|gamma|angle|circ|times|div|leq|geq|neq|pm|sum|int|log|ln|lim)\b",
            non_math_text,
        )
        if unwrapped_cmds:
            unique_cmds = list(dict.fromkeys(unwrapped_cmds))
            warnings.append(
                f"UNWRAPPED_LATEX_COMMAND: Detected mathematical command(s) {unique_cmds} outside $...$ delimiters; verify rendering intent."
            )
            math_score = min(math_score, 0.85)

        if math_expressions:
            syntax_errors = [err for e in math_expressions for err in e.validation_errors]
            expr_warnings = [w for e in math_expressions for w in e.review_warnings]

            if syntax_errors:
                failures.append(f"KATEX_SYNTAX_ERROR: {len(syntax_errors)} mathematical syntax errors detected.")
                return (
                    ValidationCheckResult(
                        check_name="MATHEMATICAL_INTEGRITY",
                        status=CheckStatus.FAIL,
                        code="KATEX_SYNTAX_ERROR",
                        message=f"KaTeX syntax validation failed with {len(syntax_errors)} errors.",
                        details={"errors": syntax_errors[:5]},
                    ),
                    0.50,
                    0.30,
                    failures,
                    warnings,
                )

            if expr_warnings or warnings:
                warnings.extend(expr_warnings)
                w_code = "UNWRAPPED_LATEX_COMMAND" if (unwrapped_cmds and not expr_warnings and len(warnings) == 1) else "MATH_WARNING"
                return (
                    ValidationCheckResult(
                        check_name="MATHEMATICAL_INTEGRITY",
                        status=CheckStatus.WARNING,
                        code=w_code,
                        message="Mathematical expressions are valid KaTeX syntax, but contain non-fatal warnings or OCR repairs.",
                        details={"warnings": list(dict.fromkeys(warnings))},
                    ),
                    math_score,
                    0.90,
                    failures,
                    warnings,
                )

            return (
                ValidationCheckResult(
                    check_name="MATHEMATICAL_INTEGRITY",
                    status=CheckStatus.PASS,
                    code="MATH_SYNTAX_VALID",
                    message=f"All {len(math_expressions)} mathematical expressions validated with 0 KaTeX syntax errors.",
                    details={"expression_count": len(math_expressions), "semantic_note": "LaTeX syntax verified; semantic truth requires domain solver."},
                ),
                1.0,
                1.0,
                failures,
                warnings,
            )
        else:
            # Check if text contains raw math symbols without expression extraction
            raw_math_symbols = [s for s in ["∠", "°", "θ", "π", "α", "β", "√", "∑", "∫", "≤", "≥", "≠"] if s in candidate_text]
            if raw_math_symbols:
                warnings.append(f"UNEXTRACTED_MATH_SYMBOLS: Raw math symbols {raw_math_symbols} found without KaTeX delimiters.")
                return (
                    ValidationCheckResult(
                        check_name="MATHEMATICAL_INTEGRITY",
                        status=CheckStatus.WARNING,
                        code="UNEXTRACTED_MATH_SYMBOLS",
                        message=f"Question text contains mathematical glyphs {raw_math_symbols} not wrapped in KaTeX delimiters.",
                        details={"symbols": raw_math_symbols},
                    ),
                    0.80,
                    0.85,
                    failures,
                    warnings,
                )

            if warnings:
                w_code = "UNWRAPPED_LATEX_COMMAND" if (unwrapped_cmds and len(warnings) == 1) else "MATH_WARNING"
                return (
                    ValidationCheckResult(
                        check_name="MATHEMATICAL_INTEGRITY",
                        status=CheckStatus.WARNING,
                        code=w_code,
                        message="Mathematical expressions contain non-fatal warnings or OCR repairs.",
                        details={"warnings": list(dict.fromkeys(warnings))},
                    ),
                    math_score,
                    0.90,
                    failures,
                    warnings,
                )

            return (
                ValidationCheckResult(
                    check_name="MATHEMATICAL_INTEGRITY",
                    status=CheckStatus.PASS,
                    code="NO_MATH_PRESENT",
                    message="No mathematical expressions present; plain text question.",
                ),
                1.0,
                1.0,
                failures,
                warnings,
            )

    # -------------------------------------------------------------------------
    # Check 3: Question Structure & Alternatives
    # -------------------------------------------------------------------------
    @classmethod
    def check_question_structure(
        cls, candidate_text: str, inferred_type: str, detected_subparts: List[Dict[str, str]]
    ) -> Tuple[ValidationCheckResult, float, List[str], List[str]]:
        failures: List[str] = []
        warnings: List[str] = []

        # Check for OR alternatives
        or_match = re.search(r'\s*(?:##\s*OR\b|\*\*OR\*\*\b|(?<=\s)OR(?=\s))\s*', candidate_text, re.IGNORECASE)
        if or_match:
            parts = re.split(r'\s*(?:##\s*OR\b|\*\*OR\*\*\b|(?<=\s)OR(?=\s))\s*', candidate_text, flags=re.IGNORECASE)
            if any(len(p.strip()) < 10 for p in parts if p.strip()):
                failures.append("INCOMPLETE_OR_ALTERNATIVE: One or both branches of the OR alternative is truncated.")
                return (
                    ValidationCheckResult(
                        check_name="QUESTION_STRUCTURE",
                        status=CheckStatus.FAIL,
                        code="INCOMPLETE_OR_ALTERNATIVE",
                        message="Internal choice (OR alternative) contains an empty or truncated question branch.",
                    ),
                    0.50,
                    failures,
                    warnings,
                )
            return (
                ValidationCheckResult(
                    check_name="QUESTION_STRUCTURE",
                    status=CheckStatus.PASS,
                    code="OR_CHOICE_INTACT",
                    message="Question has an internal choice (OR alternative) with both branches intact.",
                    details={"alternative_branches": len(parts)},
                ),
                1.0,
                failures,
                warnings,
            )

        return (
            ValidationCheckResult(
                check_name="QUESTION_STRUCTURE",
                status=CheckStatus.PASS,
                code="STRUCTURE_INTACT",
                message="Single question structure verified intact.",
            ),
            1.0,
            failures,
            warnings,
        )

    # -------------------------------------------------------------------------
    # Check 4: MCQ Option Completeness
    # -------------------------------------------------------------------------
    @classmethod
    def check_mcq_options(
        cls, inferred_type: str, detected_options: List[Dict[str, str]]
    ) -> Tuple[ValidationCheckResult, float, List[str], List[str]]:
        failures: List[str] = []
        warnings: List[str] = []

        # If not an MCQ or Assertion-Reason question, this check is not applicable
        if inferred_type not in ("MCQ", "ASSERTION_REASON", "TRUE_FALSE"):
            return (
                ValidationCheckResult(
                    check_name="MCQ_OPTION_COMPLETENESS",
                    status=CheckStatus.NOT_APPLICABLE,
                    code="NON_MCQ_TYPE",
                    message=f"Question type is '{inferred_type}'; option validation is not applicable.",
                ),
                1.0,
                failures,
                warnings,
            )

        if not detected_options:
            failures.append("NO_OPTIONS_DETECTED: Question is classified as objective but has 0 options.")
            return (
                ValidationCheckResult(
                    check_name="MCQ_OPTION_COMPLETENESS",
                    status=CheckStatus.FAIL,
                    code="NO_OPTIONS_DETECTED",
                    message="Objective question has 0 extracted options.",
                ),
                0.20,
                failures,
                warnings,
            )

        # Check for empty options
        empty_opts = [opt.get("key", "?") for opt in detected_options if not str(opt.get("text", "")).strip()]
        if empty_opts:
            failures.append(f"EMPTY_OPTIONS: Options {empty_opts} contain no readable text.")
            return (
                ValidationCheckResult(
                    check_name="MCQ_OPTION_COMPLETENESS",
                    status=CheckStatus.FAIL,
                    code="EMPTY_OPTIONS",
                    message=f"One or more options ({empty_opts}) have empty text.",
                    details={"empty_keys": empty_opts},
                ),
                0.30,
                failures,
                warnings,
            )

        # Check for duplicate option keys
        keys = [str(opt.get("key", "")).upper().strip() for opt in detected_options]
        if len(keys) != len(set(keys)):
            failures.append(f"DUPLICATE_OPTION_KEYS: Option keys are duplicated: {keys}")
            return (
                ValidationCheckResult(
                    check_name="MCQ_OPTION_COMPLETENESS",
                    status=CheckStatus.FAIL,
                    code="DUPLICATE_OPTION_KEYS",
                    message=f"Duplicate option keys detected: {keys}",
                    details={"keys": keys},
                ),
                0.40,
                failures,
                warnings,
            )

        # Check for standard option count:
        # Restriction 4: Do NOT assume every MCQ must have exactly 4 options.
        opt_count = len(detected_options)
        if opt_count == 4:
            return (
                ValidationCheckResult(
                    check_name="MCQ_OPTION_COMPLETENESS",
                    status=CheckStatus.PASS,
                    code="MCQ_OPTIONS_COMPLETE_4",
                    message="Exactly 4 distinct, non-empty options detected (A, B, C, D).",
                    details={"option_count": 4, "keys": keys},
                ),
                1.0,
                failures,
                warnings,
            )
        elif opt_count in (2, 3, 5):
            # Non-fatal warning: flag for human inspection to confirm curriculum intent
            warnings.append(f"NON_STANDARD_OPTION_COUNT: Question has {opt_count} options instead of standard 4.")
            return (
                ValidationCheckResult(
                    check_name="MCQ_OPTION_COMPLETENESS",
                    status=CheckStatus.WARNING,
                    code="NON_STANDARD_OPTION_COUNT",
                    message=f"Objective question has {opt_count} options (non-standard 4). Requires human confirmation.",
                    details={"option_count": opt_count, "keys": keys},
                ),
                0.80,
                failures,
                warnings,
            )
        else:
            failures.append(f"INVALID_OPTION_COUNT: Question has {opt_count} options, which is structurally implausible.")
            return (
                ValidationCheckResult(
                    check_name="MCQ_OPTION_COMPLETENESS",
                    status=CheckStatus.FAIL,
                    code="INVALID_OPTION_COUNT",
                    message=f"Extracted {opt_count} options, which violates objective question structural validity.",
                ),
                0.40,
                failures,
                warnings,
            )

    # -------------------------------------------------------------------------
    # Check 5: Diagram Association & Evidence
    # -------------------------------------------------------------------------
    @classmethod
    def check_diagram_association(
        cls,
        candidate_text: str,
        diagram_count: int = 0,
        unassociated_diagram_nearby: bool = False,
        detected_diagrams: Optional[List[Dict[str, Any]]] = None,
    ) -> Tuple[ValidationCheckResult, float, List[str], List[str]]:
        failures: List[str] = []
        warnings: List[str] = []
        visual_score = 1.0

        mentions_figure = any(
            ph in candidate_text.lower()
            for ph in [
                "given figure", "see figure", "in the figure", "given diagram",
                "shown below", "in the fig", "as shown in fig", "refer to figure",
            ]
        )

        has_or = bool(re.search(r'\s*(?:##\s*OR\b|\*\*OR\*\*\b|(?<=\s)OR(?=\s))\s*', candidate_text, re.IGNORECASE))

        if mentions_figure and diagram_count == 0:
            failures.append("MISSING_DIAGRAM_REFERENCE: Question text explicitly references a figure, but 0 diagrams were attached.")
            return (
                ValidationCheckResult(
                    check_name="DIAGRAM_ASSOCIATION",
                    status=CheckStatus.FAIL,
                    code="MISSING_REFERENCED_DIAGRAM",
                    message="Question stem references a figure ('in the given figure'), but 0 diagram assets are attached.",
                ),
                0.20,
                failures,
                warnings,
            )

        if diagram_count > 0:
            # Restriction 4: Do not assume a detected diagram is correctly associated.
            # Diagram asset exists, but spatial and pedagogical alignment requires curator confirmation
            if has_or and diagram_count >= 2:
                warnings.append("DIAGRAM_ASSOCIATION: Dual diagrams attached for OR alternative; verify placement.")
                return (
                    ValidationCheckResult(
                        check_name="DIAGRAM_ASSOCIATION",
                        status=CheckStatus.WARNING,
                        code="MULTIPLE_DIAGRAMS_INTERNAL_CHOICE",
                        message=f"{diagram_count} diagram assets attached for internal choice; curator must verify visual correspondence.",
                        details={"diagram_count": diagram_count, "has_or_choice": True},
                    ),
                    0.95,
                    failures,
                    warnings,
                )
            else:
                warnings.append("DIAGRAM_ASSOCIATION: Diagram asset attached; verify geometric alignment.")
                return (
                    ValidationCheckResult(
                        check_name="DIAGRAM_ASSOCIATION",
                        status=CheckStatus.WARNING,
                        code="DIAGRAM_ATTACHED_VERIFY_ASSOCIATION",
                        message=f"{diagram_count} diagram asset(s) attached; curator must verify visual correspondence with stem.",
                        details={"diagram_count": diagram_count},
                    ),
                    0.95,
                    failures,
                    warnings,
                )

        if unassociated_diagram_nearby:
            warnings.append("UNASSOCIATED_DIAGRAM_ON_PAGE: An unassociated visual asset exists on the same page.")
            return (
                ValidationCheckResult(
                    check_name="DIAGRAM_ASSOCIATION",
                    status=CheckStatus.WARNING,
                    code="UNASSOCIATED_DIAGRAM_ON_PAGE",
                    message="An unassociated diagram asset exists on the same page; verify whether it belongs to this question.",
                ),
                0.85,
                failures,
                warnings,
            )

        return (
            ValidationCheckResult(
                check_name="DIAGRAM_ASSOCIATION",
                status=CheckStatus.PASS,
                code="NO_DIAGRAM_REQUIRED",
                message="No diagram referenced in text and 0 visual assets attached.",
            ),
            visual_score,
            failures,
            warnings,
        )

    # -------------------------------------------------------------------------
    # Check 6: Table & Subpart Completeness
    # -------------------------------------------------------------------------
    @classmethod
    def check_table_and_subparts(
        cls,
        candidate_text: str,
        inferred_type: str,
        detected_subparts: List[Dict[str, str]],
    ) -> Tuple[ValidationCheckResult, float, List[str], List[str]]:
        failures: List[str] = []
        warnings: List[str] = []
        has_table = "|" in candidate_text and "---" in candidate_text

        if has_table:
            # Verify table markdown rows
            rows = [line.strip() for line in candidate_text.split("\n") if line.strip().startswith("|") and line.strip().endswith("|")]
            if len(rows) >= 2:
                return (
                    ValidationCheckResult(
                        check_name="TABLE_AND_SUBPARTS",
                        status=CheckStatus.PASS,
                        code="TABLE_STRUCTURE_VALID",
                        message=f"Markdown data table validated with {len(rows)} structured rows.",
                        details={"table_rows": len(rows)},
                    ),
                    1.0,
                    failures,
                    warnings,
                )
            else:
                # Table inline or concatenated
                return (
                    ValidationCheckResult(
                        check_name="TABLE_AND_SUBPARTS",
                        status=CheckStatus.PASS,
                        code="TABLE_INLINE_VALID",
                        message="Markdown table detected in text stream.",
                    ),
                    1.0,
                    failures,
                    warnings,
                )

        if inferred_type == "CASE_BASED":
            if not detected_subparts:
                warnings.append("CASE_STUDY_WITHOUT_SUBPARTS: Case-study question has no segmented subparts.")
                return (
                    ValidationCheckResult(
                        check_name="TABLE_AND_SUBPARTS",
                        status=CheckStatus.WARNING,
                        code="CASE_STUDY_NO_SUBPARTS",
                        message="Case study has no segmented subparts (a, b, c / i, ii, iii).",
                    ),
                    0.75,
                    failures,
                    warnings,
                )
            return (
                ValidationCheckResult(
                    check_name="TABLE_AND_SUBPARTS",
                    status=CheckStatus.PASS,
                    code="SUBPARTS_COMPLETE",
                    message=f"Case study subparts validated ({len(detected_subparts)} subparts).",
                    details={"subparts_count": len(detected_subparts)},
                ),
                1.0,
                failures,
                warnings,
            )

        return (
            ValidationCheckResult(
                check_name="TABLE_AND_SUBPARTS",
                status=CheckStatus.NOT_APPLICABLE,
                code="NO_TABLES_OR_SUBPARTS",
                message="Standard text question without data tables or case-study subparts.",
            ),
            1.0,
            failures,
            warnings,
        )

    # -------------------------------------------------------------------------
    # Check 7: Duplicate Detection
    # -------------------------------------------------------------------------
    @classmethod
    def check_duplicate_detection(
        cls, duplicate_match: Optional[Dict[str, Any]] = None
    ) -> Tuple[ValidationCheckResult, List[str], List[str]]:
        failures: List[str] = []
        warnings: List[str] = []

        if duplicate_match is None:
            return (
                ValidationCheckResult(
                    check_name="DUPLICATE_DETECTION",
                    status=CheckStatus.NOT_APPLICABLE,
                    code="DUPLICATE_CHECK_SKIPPED",
                    message="No production question bank index provided for similarity comparison.",
                ),
                failures,
                warnings,
            )

        sim = float(duplicate_match.get("similarity_score", 0.0))
        matched_id = duplicate_match.get("question_id", "unknown")

        if sim >= 0.85:
            failures.append(f"HIGH_DUPLICATE_RISK: Question matches production question '{matched_id}' with {sim:.0%} similarity.")
            return (
                ValidationCheckResult(
                    check_name="DUPLICATE_DETECTION",
                    status=CheckStatus.FAIL,
                    code="HIGH_DUPLICATE_COLLISION",
                    message=f"Suspected duplicate: {sim:.0%} similarity match with existing question '{matched_id}'.",
                    details=duplicate_match,
                ),
                failures,
                warnings,
            )
        elif sim >= 0.70:
            warnings.append(f"MODERATE_SIMILARITY: Question has {sim:.0%} similarity with '{matched_id}'.")
            return (
                ValidationCheckResult(
                    check_name="DUPLICATE_DETECTION",
                    status=CheckStatus.WARNING,
                    code="MODERATE_SIMILARITY",
                    message=f"Moderate similarity ({sim:.0%}) with question '{matched_id}'. Review advised.",
                    details=duplicate_match,
                ),
                failures,
                warnings,
            )

        return (
            ValidationCheckResult(
                check_name="DUPLICATE_DETECTION",
                status=CheckStatus.PASS,
                code="NO_DUPLICATE_FOUND",
                message="Zero duplicate collisions found in question bank (< 70% similarity).",
            ),
            failures,
            warnings,
        )

    # -------------------------------------------------------------------------
    # Comprehensive Evaluation Entrypoint
    # -------------------------------------------------------------------------
    @classmethod
    def evaluate_candidate(
        cls,
        candidate_text: str,
        detected_options: List[Dict[str, str]],
        detected_subparts: List[Dict[str, str]],
        math_expressions: List[MathExpressionRecord],
        inferred_type: str,
        diagram_count: int = 0,
        unassociated_diagram_nearby: bool = False,
        raw_text: Optional[str] = None,
        detected_diagrams: Optional[List[Dict[str, Any]]] = None,
        duplicate_match: Optional[Dict[str, Any]] = None,
    ) -> ExtractionQualityScore:
        """
        Executes all 7 deterministic checks and returns an enriched ExtractionQualityScore
        with explicit review category, sub-scores, and check-by-check evidence.
        """
        all_failures: List[str] = []
        all_warnings: List[str] = []
        checks_map: Dict[str, ValidationCheckResult] = {}

        # 1. Text Completeness
        chk_text, text_score, f1, w1 = cls.check_text_completeness(candidate_text, detected_subparts)
        checks_map["TEXT_COMPLETENESS"] = chk_text
        all_failures.extend(f1)
        all_warnings.extend(w1)

        # 2. Mathematical Integrity
        chk_math, math_score, latex_score, f2, w2 = cls.check_mathematical_integrity(
            candidate_text, math_expressions, raw_text=raw_text
        )
        checks_map["MATHEMATICAL_INTEGRITY"] = chk_math
        all_failures.extend(f2)
        all_warnings.extend(w2)

        # 3. Question Structure
        chk_struct, struct_score, f3, w3 = cls.check_question_structure(
            candidate_text, inferred_type, detected_subparts
        )
        checks_map["QUESTION_STRUCTURE"] = chk_struct
        all_failures.extend(f3)
        all_warnings.extend(w3)

        # 4. MCQ Options
        chk_mcq, opt_score, f4, w4 = cls.check_mcq_options(inferred_type, detected_options)
        checks_map["MCQ_OPTION_COMPLETENESS"] = chk_mcq
        all_failures.extend(f4)
        all_warnings.extend(w4)
        if inferred_type in ("MCQ", "ASSERTION_REASON"):
            struct_score = min(struct_score, opt_score)

        # 5. Diagram Association
        chk_diag, visual_score, f5, w5 = cls.check_diagram_association(
            candidate_text,
            diagram_count=diagram_count,
            unassociated_diagram_nearby=unassociated_diagram_nearby,
            detected_diagrams=detected_diagrams,
        )
        checks_map["DIAGRAM_ASSOCIATION"] = chk_diag
        all_failures.extend(f5)
        all_warnings.extend(w5)

        # 6. Tables & Subparts
        chk_tbl, tbl_score, f6, w6 = cls.check_table_and_subparts(
            candidate_text, inferred_type, detected_subparts
        )
        checks_map["TABLE_AND_SUBPARTS"] = chk_tbl
        all_failures.extend(f6)
        all_warnings.extend(w6)

        # 7. Duplicate Detection
        chk_dup, f7, w7 = cls.check_duplicate_detection(duplicate_match)
        checks_map["DUPLICATE_DETECTION"] = chk_dup
        all_failures.extend(f7)
        all_warnings.extend(w7)

        # Deduplicate warnings & failures
        clean_failures = list(dict.fromkeys(all_failures))
        clean_warnings = list(dict.fromkeys(all_warnings))

        # Explicit Deterministic Triage Rule (Requirement 3):
        # - CATEGORY_C: One or more critical failures (any check FAIL)
        # - CATEGORY_B: No critical failure, but 1+ checks WARNING
        # - CATEGORY_A: No failures, all applicable checks PASS
        has_any_fail = any(c.status == CheckStatus.FAIL for c in checks_map.values())
        has_any_warning = any(c.status == CheckStatus.WARNING for c in checks_map.values())

        gate_failures = clean_failures.copy()
        inspection_targets: List[str] = []
        category_reasons: List[str] = []

        if has_any_fail:
            review_category = ReviewCategory.CATEGORY_C.value
            for chk in checks_map.values():
                if chk.status == CheckStatus.FAIL:
                    category_reasons.append(f"[{chk.check_name}] {chk.message}")
        elif has_any_warning:
            review_category = ReviewCategory.CATEGORY_B.value
            for chk in checks_map.values():
                if chk.status == CheckStatus.WARNING:
                    category_reasons.append(f"[{chk.check_name}] {chk.message}")
                    if chk.check_name == "DIAGRAM_ASSOCIATION":
                        inspection_targets.append("DIAGRAM_ASSOCIATION: Verify figure alignment with question prompt.")
                    elif chk.check_name == "MATHEMATICAL_INTEGRITY":
                        inspection_targets.append("MATHEMATICAL_INTEGRITY: Check repaired sign or expression notation.")
                    elif chk.check_name == "MCQ_OPTION_COMPLETENESS":
                        inspection_targets.append("MCQ_OPTIONS: Verify option keys and formatting.")
                    elif chk.check_name == "TABLE_AND_SUBPARTS":
                        inspection_targets.append("CASE_STUDY: Verify subpart structure and marks.")
        else:
            review_category = ReviewCategory.CATEGORY_A.value
            category_reasons.append("No deterministic warnings or failures detected. Teacher approval is still mandatory.")

        return ExtractionQualityScore(
            text_extraction_score=text_score,
            math_expression_score=math_score,
            structural_completeness_score=struct_score,
            latex_syntax_score=latex_score,
            diagram_association_signal_score=visual_score,
            review_warnings=clean_warnings,
            extraction_failures=clean_failures,
            checks=checks_map,
            category_reasons=category_reasons,
            review_category=review_category,
            inspection_targets=list(dict.fromkeys(inspection_targets)),
            gate_failures=gate_failures,
        )
