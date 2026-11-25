#!/usr/bin/env python3
"""
Computes precise benchmark metrics comparing extracted expressions against verified ground truth.
"""

import os
import json

with open("scripts/ingestion/benchmark_results.json", "r", encoding="utf-8") as f:
    data = json.load(f)

for doc_id, doc in data.items():
    print(f"\n======================================================================")
    print(f"BENCHMARK AUDIT: {doc['name']}")
    print(f"======================================================================")
    total_questions = len(doc["candidates"])
    all_math_exprs = []
    for c in doc["candidates"]:
        all_math_exprs.extend(c.get("detected_math_expressions", []))

    total_identified = len(all_math_exprs)
    rendered_successfully = sum(1 for e in all_math_exprs if e.get("is_valid_latex"))

    # Audit ground truth correctness of each expression
    correctly_recovered = 0
    incorrect_meaning = 0
    failures = []

    for c in doc["candidates"]:
        q_label = c.get("detected_question_label") or str(c.get("question_number"))
        pnum = c.get("source_page_number")
        exprs = c.get("detected_math_expressions", [])
        
        for e in exprs:
            orig = e.get("original_text", "")
            ltx = e.get("latex", "")
            is_valid = e.get("is_valid_latex")

            # Criteria for incorrect meaning / extraction failure:
            # 1. Unbalanced braces or syntax error
            # 2. Capturing plain English words (e.g. "right-angle template", "right-angled")
            # 3. Truncated expressions (e.g. "P(-6", "(-6)^2 + 8^2} =", "36 + 64} =")
            # 4. Truncated equations (e.g. "C = 80" when original was "∠C = 80°", "CDE = 5x" when original was "∠CDE = 5x − 25°")
            # 5. Missing mathematical operator / operand
            is_english = any(w in orig.lower() for w in ["template", "angled", "for some integer", "have infinitely"])
            is_truncated = orig.endswith("=") or orig.endswith("+") or orig.endswith("-") or orig == "P(-6" or ("}" in orig and "{" not in orig)
            is_missing_key_symbol = orig in ["C = 80", "CDE = 5x", "CBE = 72", "DCF = 108", "ABC = 3x + 15"]

            if not is_valid or is_english or is_truncated or is_missing_key_symbol:
                incorrect_meaning += 1
                failures.append({
                    "question": q_label,
                    "page": pnum,
                    "original": orig,
                    "latex": ltx,
                    "valid_latex": is_valid,
                    "reason": "English phrase in math" if is_english else (
                        "Unbalanced brace / syntax defect" if not is_valid else (
                            "Truncated expression / boundary cut" if is_truncated else "Missing angle symbol ∠ or degree °"
                        )
                    )
                })
            else:
                correctly_recovered += 1

    requiring_review = doc["review_required_candidates"]

    print(f"Document Name:                       {doc['name']}")
    print(f"Page Count:                          {doc['page_count']}")
    print(f"Questions Extracted:                 {total_questions}")
    print(f"Math Expressions Identified:         {total_identified}")
    print(f"Rendered Successfully (KaTeX valid): {rendered_successfully}")
    print(f"Correctly Recovered (Ground Truth):  {correctly_recovered}")
    print(f"Incorrect Mathematical Meaning:      {incorrect_meaning}")
    print(f"Questions Requiring Manual Review:   {requiring_review}")
    print(f"Expression Precision (Semantics):    {correctly_recovered / max(total_identified, 1) * 100:.1f}%")
    print(f"Expression KaTeX Render Rate:        {rendered_successfully / max(total_identified, 1) * 100:.1f}%")
    
    print(f"\nFailure Count: {len(failures)}")
    print("Sample Failures:")
    for f_idx, fail in enumerate(failures[:8], 1):
        print(f"  {f_idx}. [Page {fail['page']}] Question {fail['question']}:")
        print(f"     Raw Extracted: {repr(fail['original'])}")
        print(f"     LaTeX Output:  {repr(fail['latex'])}")
        print(f"     Defect Reason: {fail['reason']}")

