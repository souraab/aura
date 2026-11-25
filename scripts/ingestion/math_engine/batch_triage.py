#!/usr/bin/env python3
"""
AuraMentor — Shadow-Mode Batch Quality Triage Runner (Milestone 2)
File: scripts/ingestion/math_engine/batch_triage.py

Integrates the deterministic quality scorer and A/B/C triage classifier into
the batch ingestion pipeline in shadow mode:
  - Evaluates every reconstructed candidate without modifying educational content.
  - Isolates per-candidate exceptions so one malformed question cannot crash a batch.
  - Never classifies an evaluation failure as Category A (routes to Category C).
  - Distinguishes extraction failures, quality-evaluation failures, and evaluated Category C.
  - Produces and saves a structured batch-level JSON triage report locally.
  - Zero Supabase writes, zero schema migrations, zero automatic approvals.
"""

import json
import re
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .latex_validator import LatexValidator
from .models import CheckStatus, MathExpressionRecord, ReviewCategory
from .quality_scorer import MathematicalQualityScorer


class BatchQualityTriageRunner:
    """
    Executes deterministic quality evaluation across a reconstructed batch
    in shadow mode and emits a traceable batch-level JSON report.
    """

    @staticmethod
    def _extract_math_records(
        candidate: Dict[str, Any],
        q_idx: int,
    ) -> List[MathExpressionRecord]:
        """Builds MathExpressionRecord objects from candidate stem and options."""
        stem_text = candidate.get("candidate_question_text") or ""
        options = candidate.get("detected_options") or []
        page_num = int(candidate.get("source_page_number") or 1)

        math_exprs: List[str] = []
        if isinstance(stem_text, str):
            math_exprs.extend(re.findall(r"\$([^\$]+)\$", stem_text))
        if isinstance(options, list):
            for opt in options:
                if isinstance(opt, dict):
                    opt_txt = opt.get("text") or ""
                    if isinstance(opt_txt, str):
                        math_exprs.extend(re.findall(r"\$([^\$]+)\$", opt_txt))

        records: List[MathExpressionRecord] = []
        for idx, expr in enumerate(math_exprs):
            val_res = LatexValidator.validate(expr)
            records.append(
                MathExpressionRecord(
                    expression_id=f"expr-b{q_idx}-{idx + 1}",
                    original_text=expr,
                    latex=expr,
                    page_number=page_num,
                    method="SHADOW_TRIAGE",
                    confidence=1.0 if val_res.is_valid else 0.5,
                    is_valid_latex=val_res.is_valid,
                    validation_errors=val_res.errors,
                    review_warnings=val_res.warnings,
                )
            )
        return records

    @classmethod
    def evaluate_batch(
        cls,
        extraction_data: Dict[str, Any],
        batch_id: str,
        engine: str = "mineru",
        report_dir: Optional[Path] = None,
        save_report: bool = True,
    ) -> Dict[str, Any]:
        """
        Runs deterministic quality evaluation across all candidates in extraction_data
        in shadow mode, attaching traceable quality results without mutating educational
        content or writing to Supabase.
        """
        t_start = time.perf_counter()
        candidates = extraction_data.get("candidates") or []

        category_counts: Dict[str, int] = {
            ReviewCategory.CATEGORY_A.value: 0,
            ReviewCategory.CATEGORY_B.value: 0,
            ReviewCategory.CATEGORY_C.value: 0,
        }
        check_status_counts: Dict[str, int] = {
            CheckStatus.PASS.value: 0,
            CheckStatus.WARNING.value: 0,
            CheckStatus.FAIL.value: 0,
            CheckStatus.NOT_APPLICABLE.value: 0,
        }
        warning_code_freq: Counter = Counter()
        inspection_target_freq: Counter = Counter()

        questions_targeted_review: List[Dict[str, Any]] = []
        questions_critical_review: List[Dict[str, Any]] = []
        errors: List[Dict[str, Any]] = []
        candidate_reports: List[Dict[str, Any]] = []

        evaluated_successfully = 0
        extraction_failures_count = 0
        quality_evaluation_failures_count = 0
        evaluated_category_c_count = 0

        for idx, cand in enumerate(candidates, 1):
            cid = f"unknown-cand-{idx}"
            q_label = f"{idx}."

            try:
                if not isinstance(cand, dict):
                    raise TypeError(f"Expected dict candidate, got {type(cand).__name__}")

                cid = cand.get("candidate_id") or cid
                q_label = cand.get("detected_question_label") or q_label

                # Track pre-existing extraction-level failure flag from upstream extractor
                upstream_extraction_failed = bool(cand.get("has_extraction_failures", False))
                raw_text = cand.get("original_extracted_text") or cand.get("candidate_question_text") or ""

                stem_text = cand.get("candidate_question_text")
                if stem_text is None:
                    stem_text = ""
                if not isinstance(stem_text, str):
                    raise TypeError(f"Expected str for candidate_question_text, got {type(stem_text).__name__}")

                options = cand.get("detected_options") or []
                subparts = cand.get("detected_subparts") or []
                diagrams = cand.get("detected_diagrams") or []
                inferred_type = cand.get("inferred_type") or "SUBJECTIVE"
                unassociated_nearby = bool(cand.get("unassociated_diagram_nearby", False))

                math_records = cls._extract_math_records(cand, idx)

                quality = MathematicalQualityScorer.evaluate_candidate(
                    candidate_text=stem_text,
                    detected_options=options,
                    detected_subparts=subparts,
                    math_expressions=math_records,
                    inferred_type=inferred_type,
                    diagram_count=len(diagrams),
                    unassociated_diagram_nearby=unassociated_nearby,
                    raw_text=raw_text if isinstance(raw_text, str) else None,
                    detected_diagrams=diagrams,
                    duplicate_match=None,
                )

                evaluated_successfully += 1
                eval_status = "EVALUATED"
                eval_error = None
                review_cat = quality.review_category
                checks_dict = {name: chk.to_dict() for name, chk in quality.checks.items()}
                warning_codes = []

                for chk in quality.checks.values():
                    st_val = chk.status.value
                    if st_val in check_status_counts:
                        check_status_counts[st_val] += 1
                    if chk.status in (CheckStatus.WARNING, CheckStatus.FAIL):
                        warning_code_freq[chk.code] += 1
                        warning_codes.append(chk.code)

                for tgt in quality.inspection_targets:
                    tgt_key = tgt.split(":")[0].strip()
                    inspection_target_freq[tgt_key] += 1

                category_counts[review_cat] = category_counts.get(review_cat, 0) + 1

                # Classify failure provenance cleanly
                is_empty_extraction = (
                    upstream_extraction_failed
                    or any(
                        chk.code in ("EMPTY_STEM",)
                        for chk in quality.checks.values()
                        if chk.status == CheckStatus.FAIL
                    )
                )
                if is_empty_extraction:
                    extraction_failures_count += 1

                if review_cat == ReviewCategory.CATEGORY_B.value:
                    questions_targeted_review.append({
                        "candidate_id": cid,
                        "detected_question_label": q_label,
                        "warning_codes": warning_codes,
                        "inspection_targets": quality.inspection_targets,
                        "category_reasons": quality.category_reasons,
                    })
                elif review_cat == ReviewCategory.CATEGORY_C.value:
                    evaluated_category_c_count += 1
                    failure_kind = "EXTRACTION_FAILED" if is_empty_extraction else "EVALUATED_CATEGORY_C"
                    questions_critical_review.append({
                        "candidate_id": cid,
                        "detected_question_label": q_label,
                        "classification_type": failure_kind,
                        "warning_codes": warning_codes,
                        "gate_failures": quality.gate_failures,
                        "category_reasons": quality.category_reasons,
                    })

                # Attach shadow-mode quality metadata without altering educational content
                shadow_payload = {
                    "evaluation_status": eval_status,
                    "evaluation_error": None,
                    "review_category": review_cat,
                    "category_reasons": quality.category_reasons,
                    "inspection_targets": quality.inspection_targets,
                    "gate_failures": quality.gate_failures,
                    "quality_breakdown": quality.quality_breakdown,
                    "checks": checks_dict,
                    "overall_confidence": quality.overall_confidence,
                    "review_warnings": quality.review_warnings,
                    "extraction_failures": quality.extraction_failures,
                }
                cand["shadow_triage"] = shadow_payload
                # Keep top-level read-only triage fields in sync for local inspection
                cand["review_category"] = review_cat
                cand["category_reasons"] = quality.category_reasons
                cand["inspection_targets"] = quality.inspection_targets
                cand["gate_failures"] = quality.gate_failures
                cand["quality_breakdown"] = quality.quality_breakdown
                cand["checks"] = checks_dict

                candidate_reports.append({
                    "candidate_id": cid,
                    "detected_question_label": q_label,
                    "source_page_number": cand.get("source_page_number"),
                    "inferred_type": inferred_type,
                    "review_status": cand.get("review_status", "PENDING"),
                    "evaluation_status": eval_status,
                    "evaluation_error": eval_error,
                    "review_category": review_cat,
                    "overall_confidence": quality.overall_confidence,
                    "quality_breakdown": quality.quality_breakdown,
                    "warning_codes": warning_codes,
                    "inspection_targets": quality.inspection_targets,
                    "gate_failures": quality.gate_failures,
                    "category_reasons": quality.category_reasons,
                    "checks": checks_dict,
                    "content_hash": cand.get("content_hash"),
                    "diagram_count": len(diagrams),
                })

            except Exception as exc:
                # Never silently classify an evaluation failure as Category A!
                quality_evaluation_failures_count += 1
                err_str = f"{type(exc).__name__}: {str(exc)}"
                gate_msg = f"QUALITY_EVALUATION_ERROR: {err_str}"
                review_cat = ReviewCategory.CATEGORY_C.value
                category_counts[review_cat] += 1

                errors.append({
                    "candidate_id": cid,
                    "detected_question_label": q_label,
                    "error_type": type(exc).__name__,
                    "error_message": str(exc),
                })
                questions_critical_review.append({
                    "candidate_id": cid,
                    "detected_question_label": q_label,
                    "classification_type": "EVALUATION_FAILED",
                    "warning_codes": ["QUALITY_EVALUATION_ERROR"],
                    "gate_failures": [gate_msg],
                    "category_reasons": [f"Quality evaluation raised an exception: {err_str}"],
                })

                shadow_payload = {
                    "evaluation_status": "EVALUATION_FAILED",
                    "evaluation_error": err_str,
                    "review_category": review_cat,
                    "category_reasons": [f"Quality evaluation failed: {err_str}. Teacher review mandatory."],
                    "inspection_targets": [],
                    "gate_failures": [gate_msg],
                    "quality_breakdown": {},
                    "checks": {},
                    "overall_confidence": 0.0,
                    "review_warnings": [],
                    "extraction_failures": [gate_msg],
                }
                if isinstance(cand, dict):
                    cand["shadow_triage"] = shadow_payload
                    cand["review_category"] = review_cat
                    cand["category_reasons"] = shadow_payload["category_reasons"]
                    cand["inspection_targets"] = []
                    cand["gate_failures"] = [gate_msg]
                    cand["checks"] = {}

                candidate_reports.append({
                    "candidate_id": cid,
                    "detected_question_label": q_label,
                    "source_page_number": cand.get("source_page_number") if isinstance(cand, dict) else None,
                    "inferred_type": cand.get("inferred_type", "UNKNOWN") if isinstance(cand, dict) else "UNKNOWN",
                    "review_status": cand.get("review_status", "PENDING") if isinstance(cand, dict) else "PENDING",
                    "evaluation_status": "EVALUATION_FAILED",
                    "evaluation_error": err_str,
                    "review_category": review_cat,
                    "overall_confidence": 0.0,
                    "quality_breakdown": {},
                    "warning_codes": ["QUALITY_EVALUATION_ERROR"],
                    "inspection_targets": [],
                    "gate_failures": [gate_msg],
                    "category_reasons": shadow_payload["category_reasons"],
                    "checks": {},
                    "content_hash": cand.get("content_hash") if isinstance(cand, dict) else None,
                    "diagram_count": len(cand.get("detected_diagrams") or []) if isinstance(cand, dict) else 0,
                })

        elapsed_ms = round((time.perf_counter() - t_start) * 1000.0, 2)

        batch_report: Dict[str, Any] = {
            "batch_id": batch_id,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "shadow_mode": True,
            "auto_approval_enabled": False,
            "engine": engine,
            "total_candidates_processed": len(candidates),
            "category_counts": category_counts,
            "check_status_counts": check_status_counts,
            "warning_code_frequency": dict(warning_code_freq),
            "inspection_target_frequency": dict(inspection_target_freq),
            "outcome_breakdown": {
                "evaluated_successfully": evaluated_successfully,
                "extraction_failures": extraction_failures_count,
                "quality_evaluation_failures": quality_evaluation_failures_count,
                "evaluated_category_c": evaluated_category_c_count,
            },
            "questions_requiring_targeted_review": questions_targeted_review,
            "questions_requiring_critical_review": questions_critical_review,
            "quality_engine_processing_time_ms": elapsed_ms,
            "errors": errors,
            "candidates": candidate_reports,
        }

        report_path_str: Optional[str] = None
        report_verified = False
        report_gen_status = "SKIPPED"
        report_gen_error: Optional[str] = None

        if save_report:
            try:
                target_dir = report_dir or (Path(__file__).resolve().parent.parent / "triage_reports")
                target_dir.mkdir(parents=True, exist_ok=True)
                safe_batch_id = re.sub(r"[^a-zA-Z0-9_-]", "_", str(batch_id))
                report_file = target_dir / f"batch_{safe_batch_id}_triage.json"
                serialized = json.dumps(batch_report, indent=2, ensure_ascii=False)
                report_file.write_text(serialized, encoding="utf-8")

                # Verify written report exists, is non-empty, and parses back cleanly
                if not report_file.exists():
                    raise FileNotFoundError(f"Triage report missing after write: {report_file}")
                raw_written = report_file.read_text(encoding="utf-8")
                if not raw_written.strip():
                    raise ValueError(f"Triage report file is empty: {report_file}")
                parsed_check = json.loads(raw_written)
                if not isinstance(parsed_check, dict) or parsed_check.get("batch_id") != batch_id:
                    raise ValueError(f"Triage report failed structural verification: {report_file}")

                report_path_str = str(report_file)
                report_verified = True
                report_gen_status = "SUCCESS"
            except Exception as save_exc:
                report_path_str = None
                report_verified = False
                report_gen_status = "FAILED"
                report_gen_error = f"{type(save_exc).__name__}: {str(save_exc)}"
                batch_report["errors"].append({
                    "candidate_id": "__batch_report__",
                    "detected_question_label": "REPORT_WRITE",
                    "error_type": type(save_exc).__name__,
                    "error_message": str(save_exc),
                })

        batch_report["report_path"] = report_path_str
        batch_report["report_verified"] = report_verified
        batch_report["report_generation_status"] = report_gen_status
        batch_report["report_generation_error"] = report_gen_error
        return batch_report

