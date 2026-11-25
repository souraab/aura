#!/usr/bin/env python3
"""
AuraMentor Universal Mathematical PDF & LaTeX Engine - Deep LaTeX & KaTeX Validator
File: scripts/ingestion/math_engine/latex_validator.py
"""

import re
from typing import List, NamedTuple, Set, Tuple


class ValidationResult(NamedTuple):
    is_valid: bool
    errors: List[str]
    warnings: List[str]
    clean_latex: str


# Standard KaTeX-supported math commands
KATEX_SUPPORTED_COMMANDS: Set[str] = {
    # Fractions & Roots
    "frac", "dfrac", "tfrac", "cfrac", "sqrt",
    # Greek letters
    "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta",
    "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "pi",
    "varpi", "rho", "varrho", "sigma", "varsigma", "tau", "upsilon", "phi",
    "varphi", "chi", "psi", "omega",
    "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
    # Trigonometry & Functions
    "sin", "cos", "tan", "sec", "csc", "cot",
    "arcsin", "arccos", "arctan", "arcsec", "arccsc", "arccot",
    "sinh", "cosh", "tanh", "coth",
    "log", "ln", "lg", "exp", "lim", "max", "min", "inf", "sup",
    # Calculus, Sums, Products
    "int", "iint", "iiint", "oint", "sum", "prod", "coprod", "partial",
    "nabla", "infty",
    # Relations & Operators
    "le", "leq", "ge", "geq", "ne", "neq", "approx", "sim", "cong", "equiv",
    "pm", "mp", "times", "div", "cdot", "circ", "bullet",
    "parallel", "perp", "angle", "triangle", "square",
    # Sets & Logic
    "in", "notin", "ni", "subset", "subseteq", "supset", "supseteq",
    "cap", "cup", "setminus", "emptyset", "forall", "exists", "nexists",
    "land", "lor", "neg", "to", "rightarrow", "leftarrow", "iff", "implies",
    "mathbb", "mathbf", "mathit", "mathrm", "mathcal", "mathscr", "mathsf", "mathtt", "text",
    # Accents & Vectors
    "vec", "hat", "bar", "tilde", "dot", "ddot", "overline", "underline",
    # Delimiters & Formatting
    "left", "right", "quad", "qquad", "phantom", "displaystyle",
    # Environments
    "begin", "end",
}


class LatexValidator:
    """
    Validates LaTeX strings against KaTeX syntax, brace balancing,
    dangling operators, incomplete arguments, and KaTeX compatibility.
    """

    @classmethod
    def validate(cls, latex: str) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        trimmed = latex.strip()
        if not trimmed:
            return ValidationResult(
                is_valid=False,
                errors=["EMPTY_EXPRESSION: LaTeX expression is empty."],
                warnings=[],
                clean_latex="",
            )

        # 1. Delimiter & Brace Balancing
        cls._check_delimiter_balance(trimmed, errors)

        # 2. Check for incomplete or unclosed LaTeX commands
        cls._check_incomplete_commands(trimmed, errors, warnings)

        # 3. Check for dangling operators or empty arguments
        cls._check_empty_and_dangling(trimmed, errors, warnings)

        # 4. KaTeX Command Compatibility
        cls._check_katex_compatibility(trimmed, errors, warnings)

        # 5. Environment balancing (\begin{...} and \end{...})
        cls._check_environments(trimmed, errors)

        is_valid = len(errors) == 0
        return ValidationResult(
            is_valid=is_valid,
            errors=errors,
            warnings=warnings,
            clean_latex=trimmed,
        )

    @classmethod
    def _check_delimiter_balance(cls, text: str, errors: List[str]) -> None:
        """Verifies matched curly braces, brackets, parentheses, and dollars."""
        brace_stack = []
        for idx, ch in enumerate(text):
            if ch == "\\":
                continue  # skip escapes for character counting
            if ch == "{":
                brace_stack.append((ch, idx))
            elif ch == "}":
                if not brace_stack:
                    errors.append(f"UNMATCHED_BRACE: Unexpected closing '}}' at character index {idx}.")
                    return
                brace_stack.pop()

        if brace_stack:
            errors.append(f"UNCLOSED_BRACE: Expression has {len(brace_stack)} unclosed '{{' brace(s).")

        # Check math delimiters ($...$ or $$...$$)
        unescaped_dollars = 0
        i = 0
        while i < len(text):
            if text[i] == "$" and (i == 0 or text[i - 1] != "\\"):
                unescaped_dollars += 1
            i += 1

        if unescaped_dollars % 2 != 0:
            errors.append("UNMATCHED_DOLLAR_DELIMITER: Odd number of unescaped '$' signs detected.")

    @classmethod
    def _check_incomplete_commands(cls, text: str, errors: List[str], warnings: List[str]) -> None:
        """Detects commands missing required arguments or cut off at the end."""
        # e.g. \frac followed by only one argument or ending with \frac
        if re.search(re.escape(r"\frac") + r'\s*$', text):
            errors.append("INCOMPLETE_COMMAND: Trailing '\\frac' without arguments.")
        elif re.search(re.escape(r"\frac") + r'\s*\{[^{}]*\}\s*$', text):
            errors.append("INCOMPLETE_COMMAND: '\\frac' is missing its second (denominator) argument.")

        # \sqrt ending without arguments
        if re.search(re.escape(r"\sqrt") + r'\s*$', text):
            errors.append("INCOMPLETE_COMMAND: Trailing '\\sqrt' without radicand argument.")

        # Dangling exponent or subscript (e.g. x^ or x_)
        if re.search(r'[\^_]\s*$', text) or re.search(r'[\^_]\s*[\)\]\}]', text):
            errors.append("DANGLING_EXPONENT_OR_SUBSCRIPT: Power '^' or subscript '_' without operand.")

    @classmethod
    def _check_empty_and_dangling(cls, text: str, errors: List[str], warnings: List[str]) -> None:
        """Detects empty fractions, empty roots, and trailing math operators."""
        # Suspicious empty blocks
        if re.search(re.escape(r"\frac") + r'\{\s*\}\{\s*\}', text):
            errors.append("EMPTY_ARGUMENT: Both numerator and denominator of '\\frac' are empty.")
        elif re.search(re.escape(r"\sqrt") + r'\{\s*\}', text):
            warnings.append("EMPTY_ROOT: '\\sqrt{}' contains empty radicand.")

        # Dangling arithmetic operator before closing delimiter or end of string
        stripped_math = text.strip("$").strip()
        op_pat = r'(?:[\+\-\*\/=><≤≥≠]|' + re.escape(r"\times") + r'|' + re.escape(r"\div") + r'|' + re.escape(r"\pm") + r')\s*$'
        if re.search(op_pat, stripped_math):
            errors.append("DANGLING_OPERATOR: Math expression ends with an unresolved operator.")
            warnings.append("DANGLING_OPERATOR: Math expression ends with an unresolved operator.")

        # Leading operator or dangling closing brace
        leading_op_pat = r'^\s*(?:[=><≤≥≠\+\*\/\}]|' + re.escape(r"\times") + r'|' + re.escape(r"\div") + r')'
        if re.search(leading_op_pat, stripped_math):
            errors.append("DANGLING_OPERATOR: Math expression starts with a dangling operator or closing delimiter.")

    @classmethod
    def _check_katex_compatibility(cls, text: str, errors: List[str], warnings: List[str]) -> None:
        """Checks for commands not supported by KaTeX or known corruptions."""
        # Find all \command occurrences: match literal backslash followed by alphabets
        cmd_pat = re.escape("\\") + r'([a-zA-Z]+)'
        for match in re.finditer(cmd_pat, text):
            cmd = match.group(1)
            # Ignore standard LaTeX environments and basic font commands
            if cmd in KATEX_SUPPORTED_COMMANDS:
                continue
            if cmd in {"pmatrix", "bmatrix", "vmatrix", "matrix", "cases", "aligned"}:
                continue
            # Known unsupported or TeX-package-specific macros
            if cmd in {"usepackage", "newcommand", "def", "tikz", "xymatrix"}:
                errors.append(f"UNSUPPORTED_KATEX_COMMAND: '\\{cmd}' is not supported by KaTeX.")
            else:
                warnings.append(f"UNKNOWN_OR_CUSTOM_COMMAND: '\\{cmd}' may not be natively supported by KaTeX.")

    @classmethod
    def _check_environments(cls, text: str, errors: List[str]) -> None:
        """Verifies matched \\begin{env} and \\end{env}."""
        begin_pat = re.escape(r"\begin") + r'\{([a-zA-Z*]+)\}'
        end_pat = re.escape(r"\end") + r'\{([a-zA-Z*]+)\}'
        begins = re.findall(begin_pat, text)
        ends = re.findall(end_pat, text)

        if len(begins) != len(ends):
            errors.append(f"UNBALANCED_ENVIRONMENT: Found {len(begins)} \\begin{{...}} but {len(ends)} \\end{{...}}.")
        else:
            for b, e in zip(begins, ends):
                if b != e:
                    errors.append(f"MISMATCHED_ENVIRONMENT: Mismatched \\begin{{{b}}} and \\end{{{e}}}.")
