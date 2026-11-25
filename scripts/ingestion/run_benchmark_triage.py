#!/usr/bin/env python3
"""
Benchmark Evaluation Runner for AuraMentor Milestone 1: Decoupled Quality Scorer
Batch ID: 0811532e-91bb-46e0-96fd-e4341a0539dc
Source PDF: Class 10 Math final HP-1.pdf (test_source.pdf)

Evaluates all 38 questions across the 7 deterministic validation checks:
  1. TEXT_COMPLETENESS
  2. MATHEMATICAL_INTEGRITY
  3. QUESTION_STRUCTURE
  4. MCQ_OPTION_COMPLETENESS
  5. DIAGRAM_ASSOCIATION
  6. TABLE_AND_SUBPARTS
  7. DUPLICATE_DETECTION

Outputs a structured, human-readable summary table and breakdown.
"""

import sys
import json
from pathlib import Path

# Add ingestion path to sys.path
CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from mineru_adapter import process_mineru_pdf

def run_benchmark():
    pdf_path = "scripts/ingestion/test_source.pdf"
    res = process_mineru_pdf(pdf_path)
    candidates = res["candidates"]
    summary = res["summary"]

    print("=" * 80)
    print("AURAMENTOR MILESTONE 1: 38-CANDIDATE BENCHMARK TRIAGE REPORT")
    print("Batch ID: 0811532e-91bb-46e0-96fd-e4341a0539dc | Source: Class 10 Math final HP-1.pdf")
    print("=" * 80)
    print(f"Total Candidates: {summary['total_candidates']}")
    print(f"Category A (Eligible for Batch Approval / Zero Warnings): {summary['category_a_count']} ({summary['category_a_count']/38:.1%})")
    print(f"Category B (Targeted Human Inspection Required):          {summary['category_b_count']} ({summary['category_b_count']/38:.1%})")
    print(f"Category C (Critical Gate Failures / Defective):          {summary['category_c_count']} ({summary['category_c_count']/38:.1%})")
    print("=" * 80)
    print("")

    # Print Table
    header = f"| Q# | Sec | Type | Text | Math | Struct | MCQ | Diag | Table | Dup | Cat | Inspection Targets / Reasons |"
    sep = f"|:--:|:---:|:----:|:----:|:----:|:------:|:---:|:----:|:-----:|:---:|:---:|:-----------------------------|"
    print(header)
    print(sep)

    status_icon = {
        "PASS": "PASS",
        "WARNING": "WARN",
        "FAIL": "FAIL",
        "NOT_APPLICABLE": "N/A"
    }

    for c in candidates:
        q_label = c["detected_question_label"].replace(".", "")
        sec = c["section"].replace("Section ", "")
        q_type = c["inferred_type"]
        checks = c["checks"]
        cat = c["review_category"].replace("CATEGORY_", "Cat ")

        t_stat = status_icon.get(checks["TEXT_COMPLETENESS"]["status"], "N/A")
        m_stat = status_icon.get(checks["MATHEMATICAL_INTEGRITY"]["status"], "N/A")
        s_stat = status_icon.get(checks["QUESTION_STRUCTURE"]["status"], "N/A")
        o_stat = status_icon.get(checks["MCQ_OPTION_COMPLETENESS"]["status"], "N/A")
        d_stat = status_icon.get(checks["DIAGRAM_ASSOCIATION"]["status"], "N/A")
        tb_stat = status_icon.get(checks["TABLE_AND_SUBPARTS"]["status"], "N/A")
        dp_stat = status_icon.get(checks["DUPLICATE_DETECTION"]["status"], "N/A")

        if cat == "Cat A":
            reason_str = "Zero defects/warnings (Deterministic Pass)"
        elif cat == "Cat B":
            targets = c.get("inspection_targets", [])
            target_names = [t.split(":")[0] for t in targets]
            reason_str = f"Inspect: {', '.join(target_names)}"
        else:
            gate_fails = c.get("gate_failures", [])
            fail_names = [f.split(":")[0] for f in gate_fails]
            reason_str = f"Critical: {', '.join(fail_names)}"

        row = f"| Q{q_label} | {sec} | {q_type[:7]} | {t_stat} | {m_stat} | {s_stat} | {o_stat} | {d_stat} | {tb_stat} | {dp_stat} | **{cat}** | {reason_str} |"
        print(row)

    print("")
    print("=" * 80)
    print("CATEGORY B INSPECTION TARGET DETAIL:")
    print("=" * 80)
    for c in candidates:
        if c["review_category"] == "CATEGORY_B":
            q_label = c["detected_question_label"]
            print(f"\n--- Question {q_label} (Section {c['section']}, {c['inferred_type']}) ---")
            print(f"Stem preview: {c['candidate_question_text'][:80]}...")
            print(f"Inspection Targets:")
            for t in c["inspection_targets"]:
                print(f"  - {t}")
            print(f"Category Reasons:")
            for r in c["category_reasons"]:
                print(f"  - {r}")

if __name__ == "__main__":
    run_benchmark()

