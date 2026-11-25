#!/usr/bin/env python3
"""
Deep Ground Truth Comparison for Benchmark PDFs
Compares extracted questions and detected math expressions against the raw text of the PDFs.
"""

import os
import json
import re

with open("scripts/ingestion/benchmark_results.json", "r", encoding="utf-8") as f:
    data = json.load(f)

for doc_id, doc in data.items():
    print("\n" + "=" * 70)
    print("DOCUMENT: " + doc["name"])
    print(f"Total Candidates: {len(doc['candidates'])}")
    print("=" * 70)

    for c in doc["candidates"]:
        q_label = c.get("detected_question_label") or str(c.get("question_number"))
        page = c.get("source_page_number")
        text = c.get("candidate_question_text", "")
        options = c.get("detected_options", [])
        math_exprs = c.get("detected_math_expressions", [])
        warnings = c.get("extraction_failures", [])
        conf = c.get("extraction_confidence")

        print(f"\n[Page {page}] {q_label} (Conf: {conf}, Warnings: {len(warnings)})")
        print("  Stem: " + text.replace("\n", " ")[:130] + ("..." if len(text) > 130 else ""))
        if options:
            opt_strs = [f"{o.get('label')}: {o.get('text')}" for o in options]
            print("  Options: " + " | ".join(opt_strs)[:120])
        if math_exprs:
            print(f"  Math Exprs ({len(math_exprs)}):")
            for me in math_exprs:
                orig = me.get("original_text", "")
                ltx = me.get("latex", "")
                vld = me.get("is_valid_latex")
                cat = me.get("category")
                print(f"    * [{cat}] {repr(orig)} -> {repr(ltx)} (KaTeX valid: {vld})")
        else:
            # Check if there was math in text
            math_symbols = [s for s in ["^", "_", "√", "°", "sin", "cos", "tan", "sec", "log", "lim", "/", "=", "+", "-", "π", "θ", "∠", "triangle", "parallel"] if s in text.lower()]
            if math_symbols:
                print(f"  [UNRECOGNIZED/INLINE]: Has math tokens {math_symbols} but 0 MathExpressionRecords extracted.")

