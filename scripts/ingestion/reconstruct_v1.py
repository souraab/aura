#!/usr/bin/env python3
"""
Reconciliation script:
Generates the exact V1 extracted expressions for all 3 PDFs and maps each to the V2 extraction.
"""

import os
import sys
import json
import re

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from scripts.ingestion.pdf_extractor import extract_pdf_pages, segment_text_into_question_blocks, parse_question_block
from scripts.ingestion.math_engine.categories import VULGAR_FRACTIONS, CategoryRecognizer
from scripts.ingestion.math_engine.latex_ast import LatexTransformer, MathDocumentParser
from scripts.ingestion.math_engine.latex_validator import LatexValidator


def extract_v1_expressions_from_text(text: str, page_num: int = 1):
    records = []
    expr_counter = 1
    lines = text.split("\n")
    for line in lines:
        line_str = line.strip()
        if not line_str:
            continue
        # Pure equation line
        if re.search(r'[=><≤≥≠]', line_str):
            words = re.findall(r'\b[a-zA-Z]{3,}\b', line_str)
            math_words = {"sin", "cos", "tan", "sec", "csc", "cot", "log", "lim", "det", "vec", "max", "min"}
            non_math_words = [w for w in words if w.lower() not in math_words]
            if len(non_math_words) <= 2:
                records.append({
                    "id": f"v1-p{page_num}-{expr_counter}",
                    "text": line_str,
                    "type": "pure_line"
                })
                expr_counter += 1
                continue

        # Vulgar fractions
        for vf in VULGAR_FRACTIONS:
            if vf in line_str:
                records.append({
                    "id": f"v1-p{page_num}-{expr_counter}",
                    "text": vf,
                    "type": "vulgar_fraction"
                })
                expr_counter += 1

        # V1 equation regex
        eq_matches = re.finditer(
            r'(?<![$\w])([a-zA-Z0-9\(\)_^\\-]+\s*[\+\-\*\/=><≤≥≠]\s*[a-zA-Z0-9\(\)\+\-\*\/=><≤≥≠^_{}\s]+)(?![$\w])',
            line_str
        )
        for m in list(eq_matches):
            match_text = m.group(1).strip()
            if any(ch in match_text for ch in "+-*/=><≤≥≠^_{}²³") or re.search(r'\b(?:sin|cos|tan|log|lim)\b', match_text):
                records.append({
                    "id": f"v1-p{page_num}-{expr_counter}",
                    "text": match_text,
                    "type": "v1_regex"
                })
                expr_counter += 1

    return records


TARGETS = [
    ("NCERT Practice Paper", "scripts/ingestion/sample_math_paper.pdf"),
    ("CBSE Board Examination Paper", "scripts/ingestion/test_source.pdf"),
    ("Coaching / IIT Foundation Paper", "scripts/ingestion/second_test.pdf"),
]

all_v1_exprs = []
for label, rel_path in TARGETS:
    full_path = os.path.join(PROJECT_ROOT, rel_path)
    pages, _ = extract_pdf_pages(full_path)
    blocks, _ = segment_text_into_question_blocks(pages)
    for b in blocks:
        block_text = "\n".join(b.raw_lines)
        v1_recs = extract_v1_expressions_from_text(block_text, b.page_number)
        for r in v1_recs:
            all_v1_exprs.append({
                "doc": label,
                "question_label": b.label,
                "page": b.page_number,
                "original_v1_text": r["text"],
            })

print(f"Total V1 expressions reconstructed: {len(all_v1_exprs)}")
with open("scripts/ingestion/v1_reconstructed_expressions.json", "w") as f:
    json.dump(all_v1_exprs, f, indent=2)
