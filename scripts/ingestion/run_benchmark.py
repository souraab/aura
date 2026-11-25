#!/usr/bin/env python3
"""
AuraMentor - Real-World Mathematical Extraction Benchmark Runner
Evaluates:
1. NCERT Mathematics Practice Paper (scripts/ingestion/sample_math_paper.pdf)
2. CBSE Class 10 Board Examination Paper (scripts/ingestion/test_source.pdf)
3. Coaching / IIT Foundation Baseline Assessment (scripts/ingestion/second_test.pdf)
"""

import os
import sys
import json
import re
from typing import Dict, List, Any

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from scripts.ingestion.pdf_extractor import process_pdf_document, extract_pdf_pages
from scripts.ingestion.math_engine.document_classifier import DocumentClassifier
from scripts.ingestion.math_engine.latex_validator import LatexValidator


BENCHMARK_TARGETS = [
    {
        "id": "ncert_math",
        "name": "NCERT Class 10 Mathematics Practice Paper",
        "path": "scripts/ingestion/sample_math_paper.pdf",
        "curriculum": "NCERT Class 10 Standard",
    },
    {
        "id": "cbse_board",
        "name": "CBSE Class 10 Board Examination Paper (Amrita Vidyalayam)",
        "path": "scripts/ingestion/test_source.pdf",
        "curriculum": "CBSE Class 10 Board Format (80 marks, 38 questions)",
    },
    {
        "id": "coaching_jee",
        "name": "Coaching / IIT Foundation Baseline Assessment (MathIIT Class 9)",
        "path": "scripts/ingestion/second_test.pdf",
        "curriculum": "Coaching / IIT Foundation Advanced Geometry & Circles",
    },
]


def run_benchmark():
    results = {}

    for target in BENCHMARK_TARGETS:
        pdf_path = os.path.join(PROJECT_ROOT, target["path"])
        print(f"\n{'='*70}")
        print(f"BENCHMARKING: {target['name']}")
        print(f"Path: {pdf_path}")
        print(f"{'='*70}")

        if not os.path.exists(pdf_path):
            print(f"[ERROR] Target file not found: {pdf_path}")
            continue

        raw_pages, backend = extract_pdf_pages(pdf_path)
        extraction_output = process_pdf_document(pdf_path)
        candidates = extraction_output.get("candidates", [])
        summary = extraction_output.get("summary", {})
        meta = extraction_output.get("metadata", {})

        # Compute math expression stats
        total_exprs = 0
        valid_latex_exprs = 0
        categories_count = {}
        high_conf_candidates = 0
        review_required_candidates = 0
        questions_with_math = 0

        for c in candidates:
            m_exprs = c.get("detected_math_expressions", [])
            if m_exprs:
                questions_with_math += 1
            total_exprs += len(m_exprs)
            for e in m_exprs:
                if e.get("is_valid_latex"):
                    valid_latex_exprs += 1
                cat = e.get("category", "UNKNOWN")
                categories_count[cat] = categories_count.get(cat, 0) + 1

            if c.get("extraction_confidence", 0) >= 0.85 and not c.get("extraction_failures"):
                high_conf_candidates += 1
            else:
                review_required_candidates += 1

        doc_report = {
            "name": target["name"],
            "path": target["path"],
            "curriculum": target["curriculum"],
            "page_count": len(raw_pages),
            "backend": backend,
            "document_type": meta.get("document_type"),
            "pages": extraction_output.get("pages", []),
            "total_questions_extracted": len(candidates),
            "questions_with_math": questions_with_math,
            "high_confidence_candidates": high_conf_candidates,
            "review_required_candidates": review_required_candidates,
            "diagrams_extracted": summary.get("diagram_summary", {}).get("total_diagrams_extracted", 0),
            "diagrams_associated": summary.get("diagram_summary", {}).get("total_diagrams_associated", 0),
            "total_math_expressions": total_exprs,
            "valid_latex_expressions": valid_latex_exprs,
            "math_categories": categories_count,
            "candidates": candidates,
        }

        print(f"Total Pages: {len(raw_pages)}")
        print(f"Document Type: {meta.get('document_type')}")
        print(f"Total Questions Extracted: {len(candidates)}")
        print(f"Questions with Math: {questions_with_math}")
        print(f"Total Math Expressions Identified: {total_exprs}")
        print(f"Valid KaTeX Syntax: {valid_latex_exprs}")
        print(f"High Confidence: {high_conf_candidates}")
        print(f"Requiring Review: {review_required_candidates}")
        print(f"Diagrams: {summary.get('diagram_summary', {}).get('total_diagrams_extracted', 0)}")
        print(f"Math Categories: {categories_count}")

        results[target["id"]] = doc_report

    output_path = os.path.join(PROJECT_ROOT, "scripts", "ingestion", "benchmark_results.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"\n[OK] Benchmark execution finished. Output written to {output_path}")


if __name__ == "__main__":
    run_benchmark()
