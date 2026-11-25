#!/usr/bin/env python3
"""
Task 3: Non-destructive comparison of Batch 0811532e-91bb-46e0-96fd-e4341a0539dc
Compares old extraction (real_test_output_v3.json) against current V2 extraction.
"""

import os
import sys
import json

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from scripts.ingestion.pdf_extractor import process_pdf_document

# Load old extraction
with open("scripts/ingestion/real_test_output_v3.json", "r", encoding="utf-8") as f:
    old_data = json.load(f)
old_candidates = old_data.get("candidates", [])

# Run V2 extraction on the exact local PDF
pdf_path = os.path.join(PROJECT_ROOT, "scripts", "ingestion", "test_source.pdf")
v2_data = process_pdf_document(pdf_path)
v2_candidates = v2_data.get("candidates", [])

print(f"Old Candidates Count: {len(old_candidates)}")
print(f"V2 Candidates Count:  {len(v2_candidates)}")

comparison_results = []
diff_stems_count = 0
diff_options_count = 0
diff_warnings_count = 0
diff_conf_count = 0
total_math_exprs_old = 0
total_math_exprs_v2 = 0

for i in range(min(len(old_candidates), len(v2_candidates))):
    old_c = old_candidates[i]
    v2_c = v2_candidates[i]
    q_label = old_c.get("detected_question_label", f"Q{i+1}")
    
    old_stem = old_c.get("candidate_question_text", "")
    v2_stem = v2_c.get("candidate_question_text", "")
    stem_changed = (old_stem != v2_stem)
    if stem_changed:
        diff_stems_count += 1
        
    old_opts = old_c.get("detected_options", [])
    v2_opts = v2_c.get("detected_options", [])
    opts_changed = (old_opts != v2_opts)
    if opts_changed:
        diff_options_count += 1
        
    old_math = old_c.get("detected_math_expressions") or []
    v2_math = v2_c.get("detected_math_expressions") or []
    total_math_exprs_old += len(old_math)
    total_math_exprs_v2 += len(v2_math)
    
    old_warn = old_c.get("extraction_warnings", [])
    v2_warn = v2_c.get("extraction_warnings", [])
    warn_changed = (set(old_warn) != set(v2_warn))
    if warn_changed:
        diff_warnings_count += 1
        
    old_conf = old_c.get("extraction_confidence", 1.0)
    v2_conf = v2_c.get("extraction_confidence", 1.0)
    conf_changed = (old_conf != v2_conf)
    if conf_changed:
        diff_conf_count += 1

    comparison_results.append({
        "index": i + 1,
        "label": q_label,
        "page": old_c.get("source_page_number"),
        "stem_changed": stem_changed,
        "opts_changed": opts_changed,
        "warn_changed": warn_changed,
        "conf_changed": conf_changed,
        "old_math_count": len(old_math),
        "v2_math_count": len(v2_math),
        "old_conf": old_conf,
        "v2_conf": v2_conf,
        "v2_status": v2_c.get("review_status_recommendation", "UNKNOWN"),
        "old_warnings": old_warn,
        "v2_warnings": v2_warn,
        "sample_v2_math": [m.get("latex") for m in v2_math[:2]],
    })

print("\n" + "=" * 70)
print(f"BATCH 0811532e-91bb-46e0-96fd-e4341a0539dc: V1 vs V2 COMPARISON SUMMARY")
print("=" * 70)
print(f"Total Questions Evaluated:         {len(comparison_results)}")
print(f"Questions with Stem Formatting Changes: {diff_stems_count} / 38")
print(f"Questions with Option Changes:          {diff_options_count} / 38")
print(f"Questions with Warning Updates:         {diff_warnings_count} / 38")
print(f"Questions with Confidence Adjustments:  {diff_conf_count} / 38")
print(f"Total Mathematical Expressions Old:     {total_math_exprs_old}")
print(f"Total Mathematical Expressions V2:      {total_math_exprs_v2}")

print("\n--- Key Changes Highlights ---")
for r in comparison_results:
    if r["v2_math_count"] > 0 or r["opts_changed"] or r["warn_changed"]:
        print(f"\n[Page {r['page']}] {r['label']} (Old Conf: {r['old_conf']} -> V2 Conf: {r['v2_conf']} | Status: {r['v2_status']})")
        if r["sample_v2_math"]:
            print(f"   V2 Math Added: {r['sample_v2_math']}")
        new_warns = [w for w in r["v2_warnings"] if w not in r["old_warnings"]]
        if new_warns:
            print(f"   New Warnings: {new_warns}")

with open("scripts/ingestion/batch_v1_v2_comparison.json", "w") as f:
    json.dump({
        "summary": {
            "batch_id": "0811532e-91bb-46e0-96fd-e4341a0539dc",
            "total_questions": len(comparison_results),
            "stem_changes": diff_stems_count,
            "option_changes": diff_options_count,
            "warning_changes": diff_warnings_count,
            "confidence_changes": diff_conf_count,
            "total_math_v1": total_math_exprs_old,
            "total_math_v2": total_math_exprs_v2,
        },
        "questions": comparison_results
    }, f, indent=2)

print("\n[OK] Comparison saved to scripts/ingestion/batch_v1_v2_comparison.json")
