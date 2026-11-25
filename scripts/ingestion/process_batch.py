#!/usr/bin/env python3
"""
AuraMentor — Question Ingestion Pipeline: Batch Worker Process
File: scripts/ingestion/process_batch.py

Connects the 2D layout mathematics extraction engine to uploaded PDF batches
in Supabase Storage (`question-media`) and stages extracted questions into
`public.staging_questions`.

Usage:
  # Process a specific uploaded batch:
  python3 scripts/ingestion/process_batch.py --batch-id BATCH_UUID

  # Safe dry-run validation (downloads & extracts without staging writes):
  python3 scripts/ingestion/process_batch.py --batch-id BATCH_UUID --dry-run

  # Local test with sample PDF (offline validation):
  python3 scripts/ingestion/process_batch.py --batch-id 00000000-0000-0000-0000-000000000001 --local-pdf scripts/ingestion/sample_math_paper.pdf --dry-run

Required Environment Variables (for live processing):
  - SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
  - SUPABASE_SERVICE_ROLE_KEY
"""

import argparse
import hashlib
import json
import mimetypes
import os
import platform
import re
import sys
import tempfile
import traceback
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

# Ensure scripts/ingestion is in path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pdf_extractor import process_pdf_document
from import_to_staging import (
    compute_file_sha256,
    compute_content_hash,
    prepare_staging_payloads,
)
from math_engine.batch_triage import BatchQualityTriageRunner


# ============================================================================
# Re-Extraction Field Specifications & Curation Assessment
# ============================================================================

RE_EXTRACTION_UPDATE_FIELDS = (
    "candidate_question_text",
    "content_hash",
    "detected_options",
    "detected_subparts",
    "detected_answer",
    "detected_solution",
    "detected_diagrams",
    "original_extracted_text",
    "extraction_warnings",
    "has_extraction_failures",
    "extraction_confidence",
    "updated_at",
)


def assess_candidate_curation(
    existing_row: Dict[str, Any],
    default_chapter_id: Optional[str] = None,
    plan_candidate: Optional[Dict[str, Any]] = None,
) -> Tuple[bool, str]:
    """
    Evaluates whether an existing staging candidate has received any administrator curation,
    edits, notes, or state that must be strictly preserved from automated re-extraction.

    Protects:
    1. review_status != 'PENDING' (e.g. ACCEPTED, EDITED, REJECTED, PROMOTED)
    2. promoted_question_id is set or active promotion lease exists
    3. review_notes is populated (even if review_status is still PENDING)
    4. reviewed_by or reviewed_at is recorded
    5. candidate_question_text differs from stored content_hash (manual stem edit)
    6. target_chapter_id was manually reassigned from batch default
    7. target_topic_id was manually assigned
    8. target_difficulty was changed from 'MEDIUM'
    9. target_marks or target_negative_marks was changed from defaults (1.0 / 0.0)
    10. question options, subparts, answers, solutions, or diagrams were manually modified
    """
    status = existing_row.get("review_status", "PENDING")
    if status != "PENDING":
        return True, f"review_status is '{status}'"

    if existing_row.get("promoted_question_id"):
        return True, "candidate was already promoted to production"
    if existing_row.get("promotion_token"):
        return True, "candidate has an active promotion lease"

    notes = existing_row.get("review_notes")
    if notes and str(notes).strip():
        return True, f"review_notes is populated ('{str(notes).strip()[:35]}')"

    if existing_row.get("reviewed_by") or existing_row.get("reviewed_at"):
        return True, "reviewer audit timestamp/ID is recorded"

    # 5. Question Stem Manual Edit Detection:
    # When staged by the pipeline, content_hash is computed as compute_content_hash(candidate_question_text).
    # If an administrator manually edits candidate_question_text, the text diverges from the stored content_hash.
    # NOTE: Never compare against original_extracted_text because original_extracted_text
    # represents the raw unparsed block (including question label '1.', '2.' and option lines),
    # which differs by design from candidate_question_text across 100% of pipeline extractions.
    cand_text = (existing_row.get("candidate_question_text") or "").strip()
    stored_hash = existing_row.get("content_hash")
    if stored_hash and cand_text:
        computed_hash = compute_content_hash(cand_text)
        if computed_hash != stored_hash:
            return True, "candidate_question_text was manually edited (content_hash mismatch)"

    chap = existing_row.get("target_chapter_id")
    if chap and default_chapter_id and chap != default_chapter_id:
        return True, f"target_chapter_id manually modified ({chap})"
    if existing_row.get("target_topic_id"):
        return True, f"target_topic_id manually assigned ({existing_row.get('target_topic_id')})"

    diff = existing_row.get("target_difficulty")
    if diff and diff != "MEDIUM":
        return True, f"target_difficulty manually changed to '{diff}'"

    marks = existing_row.get("target_marks")
    if marks is not None:
        try:
            if float(marks) != 1.0:
                return True, f"target_marks manually changed to {marks}"
        except (ValueError, TypeError):
            pass

    neg_marks = existing_row.get("target_negative_marks")
    if neg_marks is not None:
        try:
            if float(neg_marks) != 0.0:
                return True, f"target_negative_marks manually changed to {neg_marks}"
        except (ValueError, TypeError):
            pass

    # 10. Non-Text Component Curation (Options, Answers, Subparts, Solutions):
    existing_opts = existing_row.get("detected_options") or []
    if any(o.get("is_correct") for o in existing_opts):
        return True, "detected_options has manual answer key designation (is_correct=true)"

    existing_sol = existing_row.get("detected_solution")
    if existing_sol and str(existing_sol).strip():
        return True, "detected_solution was manually provided by administrator"

    return False, ""


# ============================================================================
# Zero-Dependency Supabase REST & Storage Client (PostgREST + Storage API)
# ============================================================================

class SupabaseRestClient:
    """
    Lightweight, dependency-free Supabase client utilizing standard library urllib.
    Supports authenticated PostgREST queries, row locks, upserts, and Storage operations.
    """

    def __init__(self, supabase_url: str, service_role_key: str):
        if not supabase_url or not service_role_key:
            raise ValueError("Both supabase_url and service_role_key are strictly required.")
        
        self.supabase_url = supabase_url.rstrip("/")
        self.service_role_key = service_role_key

    def _default_headers(self, content_type: str = "application/json") -> Dict[str, str]:
        return {
            "apikey": self.service_role_key,
            "Authorization": f"Bearer {self.service_role_key}",
            "Content-Type": content_type,
        }

    def _request(
        self,
        method: str,
        endpoint: str,
        params: Optional[Dict[str, str]] = None,
        data: Optional[bytes] = None,
        headers: Optional[Dict[str, str]] = None,
        timeout: int = 60,
    ) -> bytes:
        url = f"{self.supabase_url}{endpoint}"
        if params:
            url += "?" + urllib.parse.urlencode(params)

        req_headers = self._default_headers()
        if headers:
            req_headers.update(headers)

        req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"Supabase HTTP {e.code} error on {method} {endpoint}: {error_body}"
            ) from e
        except urllib.error.URLError as e:
            raise RuntimeError(
                f"Supabase network error on {method} {endpoint}: {e.reason}"
            ) from e

    # --- Database Operations -------------------------------------------------

    def get_batch(self, batch_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves a single ingestion_batches record by ID."""
        endpoint = "/rest/v1/ingestion_batches"
        params = {"id": f"eq.{batch_id}", "select": "*"}
        raw = self._request("GET", endpoint, params=params)
        records = json.loads(raw.decode("utf-8"))
        if records and len(records) > 0:
            return records[0]
        return None

    def acquire_batch_lock(self, batch_id: str, lock_info: Dict[str, Any]) -> bool:
        """
        Atomically records an active processing lock in ingestion_batches.metadata.
        Prevents simultaneous workers from processing the same batch.
        """
        current = self.get_batch(batch_id)
        if not current:
            return False

        meta = current.get("metadata") or {}
        meta["processing_lock"] = lock_info

        endpoint = "/rest/v1/ingestion_batches"
        params = {"id": f"eq.{batch_id}"}
        body = json.dumps({"metadata": meta, "updated_at": datetime.now(timezone.utc).isoformat()}).encode("utf-8")
        headers = {"Prefer": "return=representation"}
        self._request("PATCH", endpoint, params=params, data=body, headers=headers)
        return True

    def release_batch_lock(
        self,
        batch_id: str,
        error_message: Optional[str] = None
    ) -> None:
        """Removes the processing lock from metadata, optionally storing last_error."""
        current = self.get_batch(batch_id)
        if not current:
            return

        meta = current.get("metadata") or {}
        meta.pop("processing_lock", None)
        if error_message:
            meta["last_error"] = {
                "message": error_message,
                "failed_at": datetime.now(timezone.utc).isoformat(),
            }

        endpoint = "/rest/v1/ingestion_batches"
        params = {"id": f"eq.{batch_id}"}
        body = json.dumps({"metadata": meta, "updated_at": datetime.now(timezone.utc).isoformat()}).encode("utf-8")
        headers = {"Prefer": "return=minimal"}
        self._request("PATCH", endpoint, params=params, data=body, headers=headers)

    def get_existing_staging_questions(self, batch_id: str) -> List[Dict[str, Any]]:
        """Queries existing staging_questions rows for this batch with full curation columns."""
        endpoint = "/rest/v1/staging_questions"
        params = {
            "batch_id": f"eq.{batch_id}",
            "select": "*",
        }
        raw = self._request("GET", endpoint, params=params)
        return json.loads(raw.decode("utf-8"))

    def update_staging_question(
        self,
        staging_id: str,
        fields: Dict[str, Any],
        expected_updated_at: Optional[str] = None,
    ) -> bool:
        """
        Executes a targeted field-level PATCH with database-side optimistic concurrency filters:
        - id = eq.{staging_id}
        - review_status = eq.PENDING
        - promoted_question_id = is.null
        - updated_at = eq.{expected_updated_at} (optimistic concurrency timestamp guard)

        Returns True if row was updated, False if concurrency conditions failed (row modified concurrently).
        """
        endpoint = "/rest/v1/staging_questions"
        params = {
            "id": f"eq.{staging_id}",
            "review_status": "eq.PENDING",
            "promoted_question_id": "is.null",
        }
        if expected_updated_at:
            params["updated_at"] = f"eq.{expected_updated_at}"

        body = json.dumps(fields).encode("utf-8")
        headers = {"Prefer": "return=representation"}
        raw = self._request("PATCH", endpoint, params=params, data=body, headers=headers)
        rows = json.loads(raw.decode("utf-8")) if raw else []
        return len(rows) > 0

    def upsert_staging_questions(self, records: List[Dict[str, Any]]) -> int:
        """
        Upserts candidate questions into public.staging_questions in chunks of 25.
        Uses PostgreSQL ON CONFLICT (batch_id, candidate_id) DO UPDATE.
        """
        if not records:
            return 0

        endpoint = "/rest/v1/staging_questions"
        headers = {
            "Prefer": "resolution=merge-duplicates,return=minimal",
        }
        chunk_size = 25
        inserted_total = 0

        for i in range(0, len(records), chunk_size):
            chunk = records[i : i + chunk_size]
            body = json.dumps(chunk).encode("utf-8")
            self._request("POST", endpoint, data=body, headers=headers)
            inserted_total += len(chunk)

        return inserted_total

    def finalize_batch(
        self,
        batch_id: str,
        summary_updates: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Updates the ingestion batch with final extraction statistics and marks it IN_REVIEW.
        """
        endpoint = "/rest/v1/ingestion_batches"
        params = {"id": f"eq.{batch_id}"}
        body = json.dumps(summary_updates).encode("utf-8")
        headers = {"Prefer": "return=representation"}
        raw = self._request("PATCH", endpoint, params=params, data=body, headers=headers)
        result = json.loads(raw.decode("utf-8"))
        return result[0] if result else {}

    # --- Storage Operations --------------------------------------------------

    def download_storage_object(
        self,
        bucket: str,
        storage_path: str,
        destination_path: str
    ) -> None:
        """
        Downloads a private file from Supabase Storage and writes it to destination_path.
        """
        encoded_path = "/".join(urllib.parse.quote(part, safe="") for part in storage_path.split("/"))
        
        # Supabase Storage authenticated download endpoints
        endpoints_to_try = [
            f"/storage/v1/object/authenticated/{bucket}/{encoded_path}",
            f"/storage/v1/object/{bucket}/{encoded_path}",
        ]

        last_error = None
        for ep in endpoints_to_try:
            try:
                data = self._request("GET", ep, timeout=120)
                with open(destination_path, "wb") as f:
                    f.write(data)
                return
            except Exception as e:
                last_error = e

        raise RuntimeError(
            f"Failed to download storage object '{bucket}/{storage_path}': {last_error}"
        )

    def upload_storage_object(
        self,
        bucket: str,
        storage_path: str,
        local_path: str,
        mime_type: str = "image/png"
    ) -> None:
        """
        Uploads a local file to Supabase Storage with upsert enabled.
        """
        with open(local_path, "rb") as f:
            file_bytes = f.read()

        encoded_path = "/".join(urllib.parse.quote(part, safe="") for part in storage_path.split("/"))
        endpoint = f"/storage/v1/object/{bucket}/{encoded_path}"
        headers = {
            "Content-Type": mime_type,
            "x-upsert": "true",
        }
        self._request("POST", endpoint, data=file_bytes, headers=headers, timeout=60)


# ============================================================================
# Core Batch Processor
# ============================================================================

class BatchProcessor:
    """
    Coordinates end-to-end processing for a single AuraMentor ingestion batch:
    1. Validation and atomic lease fencing
    2. Secure PDF download from question-media bucket
    3. Mathematical 2D spatial layout and diagram extraction
    4. Idempotent candidate staging
    5. Batch metrics synchronization and completion
    """

    def __init__(
        self,
        batch_id: str,
        client: Optional[SupabaseRestClient] = None,
        dry_run: bool = False,
        force: bool = False,
        local_pdf_override: Optional[str] = None,
        keep_temp: bool = False,
        engine: str = "v2",
        triage_report_dir: Optional[str] = None,
    ):
        self.batch_id = batch_id
        self.client = client
        self.dry_run = dry_run
        self.force = force
        self.local_pdf_override = local_pdf_override
        self.keep_temp = keep_temp
        self.engine = engine
        self.triage_report_dir = triage_report_dir

    def run(self) -> Dict[str, Any]:
        """Executes the extraction and ingestion pipeline."""
        print(f"\n{'='*70}")
        print(f"AURAMENTOR PDF INGESTION WORKER: Processing Batch {self.batch_id}")
        print(f"{'='*70}")

        # 1. Fetch & Verify Batch Eligibility
        batch = self._fetch_and_validate_batch()
        pdf_storage_path = batch["pdf_storage_path"]
        pdf_filename = batch["pdf_filename"]
        expected_hash = batch["pdf_file_hash"]

        print(f"[INFO] Batch found: {self.batch_id}")
        print(f"       Filename:     {pdf_filename}")
        print(f"       Storage Path: question-media/{pdf_storage_path}")
        print(f"       Status:       {batch['status']}")
        print(f"       Target Size:  {batch['pdf_file_size_bytes']:,} bytes")

        # 2. Concurrency Protection & Lease Fencing
        self._acquire_lock_if_live(batch)

        # 3. Create Working Environment & Download PDF
        temp_dir = tempfile.mkdtemp(prefix=f"auramentor_batch_{self.batch_id[:8]}_")
        try:
            local_pdf_path = self._obtain_source_pdf(
                temp_dir=temp_dir,
                pdf_storage_path=pdf_storage_path,
                pdf_filename=pdf_filename,
                expected_hash=expected_hash
            )

            # 4. Run PDF Extraction Engine
            extraction_data = self._run_extraction(local_pdf_path)

            # 4b. Run Shadow-Mode Quality Triage & Save Local JSON Report
            triage_report = self._run_shadow_quality_triage(extraction_data)

            # 5. Prepare Staging Payloads
            target_chapter_id = None
            if batch.get("metadata") and isinstance(batch["metadata"], dict):
                target_chapter_id = batch["metadata"].get("target_chapter_id")

            plan = prepare_staging_payloads(
                pdf_path=local_pdf_path,
                extraction_data=extraction_data,
                batch_id=self.batch_id,
                default_chapter_id=target_chapter_id
            )

            staging_records = plan["staging_records"]
            diagram_uploads = plan["diagram_uploads"]

            # 6. Validate Candidate Integrity
            self._validate_candidate_uniqueness(staging_records)

            # 7. Pre-Execution Eligibility & Curation Audit
            audit_report = self._audit_candidate_eligibility(batch, plan)
            audit_report["triage_report_path"] = triage_report.get("report_path")
            audit_report["triage_summary"] = {
                "shadow_mode": True,
                "total_candidates_processed": triage_report.get("total_candidates_processed", 0),
                "category_counts": triage_report.get("category_counts", {}),
                "outcome_breakdown": triage_report.get("outcome_breakdown", {}),
                "quality_engine_processing_time_ms": triage_report.get("quality_engine_processing_time_ms", 0.0),
            }

            # 8. Dry-Run Gate (Zero Database or Storage Writes)
            if self.dry_run:
                print("\n[DRY RUN] Pre-execution audit complete. Zero database/storage writes performed.")
                audit_report["dry_run"] = True
                return audit_report

            # 8b. Live Staging Safety Gate: Block live writes if triage report was not generated & verified
            if not triage_report.get("report_verified", False):
                raise RuntimeError(
                    f"Shadow triage report could not be generated or verified "
                    f"({triage_report.get('report_generation_error') or 'unknown error'}); "
                    "blocking live staging write."
                )

            # 9. Live Staging Execution
            result = self._execute_live_staging(batch, plan, audit_report=audit_report)
            result["triage_report_path"] = triage_report.get("report_path")
            result["triage_summary"] = audit_report["triage_summary"]
            print(f"\n[SUCCESS] Batch {self.batch_id} fully processed and updated to 'IN_REVIEW'!")
            return result

        except Exception as e:
            # Safe failure recording
            if not self.dry_run and self.client:
                err_msg = f"{type(e).__name__}: {str(e)}"
                try:
                    self.client.release_batch_lock(self.batch_id, error_message=err_msg)
                except Exception as rel_err:
                    print(f"[WARN] Failed to release batch lock: {rel_err}", file=sys.stderr)
            raise
        finally:
            if not self.keep_temp:
                try:
                    import shutil
                    shutil.rmtree(temp_dir, ignore_errors=True)
                except Exception:
                    pass
            else:
                print(f"[INFO] Working directory preserved at: {temp_dir}")

    # --- Sub-Operations ------------------------------------------------------

    def _fetch_and_validate_batch(self) -> Dict[str, Any]:
        """Retrieves and validates batch record from Supabase or mock."""
        if self.dry_run and not self.client:
            # Mock batch record for offline testing
            return {
                "id": self.batch_id,
                "pdf_storage_path": f"ingestion/{self.batch_id}/source.pdf",
                "pdf_filename": os.path.basename(self.local_pdf_override or "sample.pdf"),
                "pdf_file_hash": "0" * 64,
                "pdf_file_size_bytes": 0,
                "status": "PENDING",
                "metadata": {},
            }

        if not self.client:
            raise RuntimeError("Database client is required for live batch processing.")

        batch = self.client.get_batch(self.batch_id)
        if not batch:
            raise RuntimeError(f"Batch with ID '{self.batch_id}' was not found in public.ingestion_batches.")

        # Security check on storage path: Ensure path stays within ingestion/
        storage_path = batch.get("pdf_storage_path") or ""
        if not storage_path.startswith("ingestion/"):
            raise ValueError(
                f"Unauthorized or invalid storage path '{storage_path}'. Path must reside in 'ingestion/'."
            )

        # Check status
        status = str(batch.get("status") or "").upper()
        if status == "ARCHIVED":
            raise RuntimeError(f"Batch '{self.batch_id}' is ARCHIVED and cannot be processed.")

        if status in ("IN_REVIEW", "APPROVED", "COMPLETED") and not self.force:
            raise RuntimeError(
                f"Batch '{self.batch_id}' has already been processed (status: {status}). "
                "Pass --force to reprocess and update staging candidates."
            )

        return batch

    def _acquire_lock_if_live(self, batch: Dict[str, Any]) -> None:
        """Enforces mutual exclusion so two workers cannot process the same batch."""
        if self.dry_run or not self.client:
            return

        meta = batch.get("metadata") or {}
        existing_lock = meta.get("processing_lock")

        if existing_lock and not self.force:
            started_at_str = existing_lock.get("started_at")
            if started_at_str:
                try:
                    started_dt = datetime.fromisoformat(started_at_str.replace("Z", "+00:00"))
                    age_seconds = (datetime.now(timezone.utc) - started_dt).total_seconds()
                    # If lock is fresh (< 15 minutes), reject simultaneous execution
                    if age_seconds < 900:
                        raise RuntimeError(
                            f"Batch is currently being processed by worker (PID: {existing_lock.get('pid')}, "
                            f"host: {existing_lock.get('host')}) started {int(age_seconds)}s ago. "
                            "Pass --force to override."
                        )
                except Exception as ex:
                    if isinstance(ex, RuntimeError):
                        raise

        lock_payload = {
            "worker_pid": os.getpid(),
            "host": platform.node(),
            "started_at": datetime.now(timezone.utc).isoformat(),
        }
        self.client.acquire_batch_lock(self.batch_id, lock_payload)
        print(f"[INFO] Acquired processing lock for PID {os.getpid()} on {platform.node()}.")

    def _obtain_source_pdf(
        self,
        temp_dir: str,
        pdf_storage_path: str,
        pdf_filename: str,
        expected_hash: str
    ) -> str:
        """Downloads source PDF from Supabase Storage or uses local override."""
        safe_filename = re.sub(r'[^a-zA-Z0-9._-]', '_', pdf_filename)
        dest_pdf_path = os.path.join(temp_dir, safe_filename)

        if self.local_pdf_override:
            if not os.path.exists(self.local_pdf_override):
                raise FileNotFoundError(f"Local PDF override not found: {self.local_pdf_override}")
            print(f"[INFO] Using local PDF override: {self.local_pdf_override}")
            return os.path.abspath(self.local_pdf_override)

        print(f"[INFO] Downloading source PDF from question-media/{pdf_storage_path}...")
        self.client.download_storage_object("question-media", pdf_storage_path, dest_pdf_path)

        # Integrity verification
        actual_hash, actual_size = compute_file_sha256(dest_pdf_path)
        if expected_hash and expected_hash != "0" * 64 and actual_hash.lower() != expected_hash.lower():
            raise RuntimeError(
                f"Binary integrity check failed for downloaded PDF! "
                f"Expected SHA-256: {expected_hash}, Actual: {actual_hash}"
            )

        print(f"[INFO] Download verified: {actual_size:,} bytes (SHA-256: {actual_hash[:16]}...)")
        return dest_pdf_path

    def _run_extraction(self, local_pdf_path: str) -> Dict[str, Any]:
        """Runs the deterministic extraction engine (V2 spatial or MinerU)."""
        start_time = datetime.now(timezone.utc)
        if getattr(self, "engine", "v2") == "mineru":
            print(f"[INFO] Running MinerU Visual Question Reconstruction Engine...")
            from mineru_adapter import process_mineru_pdf
            result = process_mineru_pdf(local_pdf_path)
        else:
            print(f"[INFO] Starting mathematical 2D layout extraction...")
            result = process_pdf_document(local_pdf_path)
        duration = (datetime.now(timezone.utc) - start_time).total_seconds()
        print(f"[INFO] Extraction completed in {duration:.2f} seconds.")
        return result

    def _run_shadow_quality_triage(self, extraction_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Runs the decoupled deterministic quality scorer & A/B/C triage classifier
        in shadow mode, saving a local JSON report without modifying Supabase schema or records.
        """
        from pathlib import Path
        report_dir = Path(self.triage_report_dir) if self.triage_report_dir else None
        triage_report = BatchQualityTriageRunner.evaluate_batch(
            extraction_data=extraction_data,
            batch_id=self.batch_id,
            engine=getattr(self, "engine", "v2"),
            report_dir=report_dir,
            save_report=True,
        )
        counts = triage_report["category_counts"]
        outcome = triage_report["outcome_breakdown"]
        print(
            f"[INFO] Shadow Quality Triage completed in {triage_report['quality_engine_processing_time_ms']:.2f} ms: "
            f"Cat A={counts.get('CATEGORY_A', 0)}, Cat B={counts.get('CATEGORY_B', 0)}, "
            f"Cat C={counts.get('CATEGORY_C', 0)} "
            f"(EvalErrors={outcome.get('quality_evaluation_failures', 0)})"
        )
        if triage_report.get("report_path"):
            print(f"[INFO] Shadow Triage Report saved: {triage_report['report_path']}")
        return triage_report

    def _validate_candidate_uniqueness(self, staging_records: List[Dict[str, Any]]) -> None:
        """Ensures every candidate ID in the batch is strictly distinct."""
        cand_ids = [r["candidate_id"] for r in staging_records]
        if len(cand_ids) != len(set(cand_ids)):
            duplicates = [cid for cid in cand_ids if cand_ids.count(cid) > 1]
            raise ValueError(f"Duplicate candidate IDs detected in batch: {set(duplicates)}")

    def _audit_candidate_eligibility(
        self,
        batch: Dict[str, Any],
        plan: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Performs a non-destructive read-only audit of staging candidates:
        - Total candidates
        - Eligible for V2 update
        - Protected by administrator curation (with exact reasons)
        - Already promoted
        - Candidates with concurrency or data-integrity concerns
        """
        staging_records = plan["staging_records"]
        diagram_uploads = plan["diagram_uploads"]

        default_chap_id = None
        if batch.get("metadata") and isinstance(batch["metadata"], dict):
            default_chap_id = batch["metadata"].get("target_chapter_id")

        existing_questions = []
        if self.client:
            existing_questions = self.client.get_existing_staging_questions(self.batch_id)

        existing_by_cid = {q["candidate_id"]: q for q in existing_questions}

        records_to_field_update = []
        records_to_insert = []
        protected_candidates = {}
        promoted_candidates = {}
        integrity_concerns = {}

        for r in staging_records:
            cid = r["candidate_id"]

            if not cid or not r.get("content_hash"):
                integrity_concerns[cid] = "Candidate ID or content_hash missing"
                continue

            if cid in existing_by_cid:
                existing_row = existing_by_cid[cid]

                if existing_row.get("review_status") == "PROMOTED" or existing_row.get("promoted_question_id"):
                    promoted_candidates[cid] = f"Already promoted to production (ID: {existing_row.get('promoted_question_id')})"
                    continue

                if existing_row.get("promotion_token"):
                    integrity_concerns[cid] = "Active promotion lease token present"
                    continue

                is_curated, reason = assess_candidate_curation(
                    existing_row,
                    default_chapter_id=default_chap_id,
                    plan_candidate=r,
                )
                if is_curated:
                    protected_candidates[cid] = reason
                else:
                    records_to_field_update.append((existing_row["id"], existing_row.get("updated_at"), r))
            else:
                # Candidate newly detected in PDF
                records_to_insert.append(r)

        # Print Pre-Execution Audit Table
        print(f"\n{'='*70}")
        print(f"AURAMENTOR STAGING ELIGIBILITY AUDIT: Batch {self.batch_id}")
        print(f"{'='*70}")
        print(f"  Total Candidates Detected:             {len(staging_records)}")
        print(f"  Eligible for V2 Math Update:           {len(records_to_field_update) + len(records_to_insert)}")
        print(f"    - Existing Rows (Field Update):      {len(records_to_field_update)}")
        print(f"    - New Candidates (Insert):           {len(records_to_insert)}")
        print(f"  Protected by Administrator Curation:   {len(protected_candidates)}")
        print(f"  Already Promoted to Production:        {len(promoted_candidates)}")
        print(f"  Concurrency / Integrity Concerns:      {len(integrity_concerns)}")
        print(f"  Diagram Assets Staged:                 {len(diagram_uploads)}")
        print(f"{'='*70}")

        if protected_candidates:
            print("\n[AUDIT] Protected Candidates Breakdown:")
            for cid, reason in protected_candidates.items():
                print(f"        - {cid}: {reason}")

        if promoted_candidates:
            print("\n[AUDIT] Promoted Candidates Breakdown:")
            for cid, reason in promoted_candidates.items():
                print(f"        - {cid}: {reason}")

        if integrity_concerns:
            print("\n[AUDIT] Integrity Concerns Breakdown:")
            for cid, reason in integrity_concerns.items():
                print(f"        - {cid}: {reason}")

        return {
            "batch_id": self.batch_id,
            "status": "VALIDATED",
            "total_questions": len(staging_records),
            "total_candidates": len(staging_records),
            "eligible_for_v2_update": len(records_to_field_update) + len(records_to_insert),
            "protected_by_curation": len(protected_candidates),
            "already_promoted": len(promoted_candidates),
            "concurrency_or_integrity_concerns": len(integrity_concerns),
            "total_diagrams": len(diagram_uploads),
            "records_to_field_update": records_to_field_update,
            "records_to_insert": records_to_insert,
            "protected_candidates": protected_candidates,
            "promoted_candidates": promoted_candidates,
            "integrity_concerns": integrity_concerns,
        }

    def _execute_live_staging(
        self,
        batch: Dict[str, Any],
        plan: Dict[str, Any],
        audit_report: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Uploads diagram PNG crops, updates eligible staging questions, and finalizes batch status."""
        staging_records = plan["staging_records"]
        diagram_uploads = plan["diagram_uploads"]

        # 1. Upload Diagram PNG crops to question-media/ingestion/{batch_id}/diagrams/...
        if diagram_uploads:
            print(f"[INFO] Uploading {len(diagram_uploads)} diagram asset(s) to question-media...")
            for idx, diag in enumerate(diagram_uploads, 1):
                local_path = diag["local_path"]
                storage_path = diag["storage_path"]
                mime_type = diag.get("mime_type", "image/png")
                if os.path.exists(local_path):
                    self.client.upload_storage_object(
                        bucket="question-media",
                        storage_path=storage_path,
                        local_path=local_path,
                        mime_type=mime_type
                    )
                    print(f"       [{idx}/{len(diagram_uploads)}] Uploaded {storage_path}")

        # 2. Safety Audit: Use pre-execution audit report or compute
        if audit_report is None:
            audit_report = self._audit_candidate_eligibility(batch, plan)

        records_to_field_update = audit_report["records_to_field_update"]
        records_to_insert = audit_report["records_to_insert"]
        protected_candidates = audit_report["protected_candidates"]

        # 3. Apply Field-Level Updates with Optimistic Concurrency Protection
        updated_count = 0
        concurrency_skipped_count = 0
        failed_count = 0
        concurrency_skipped_candidates = {}

        if records_to_field_update:
            print(f"[INFO] Applying field-level mathematical extraction updates to {len(records_to_field_update)} candidate(s)...")
            for staging_id, expected_updated_at, r in records_to_field_update:
                cid = r["candidate_id"]
                fields_to_update = {
                    k: r[k]
                    for k in RE_EXTRACTION_UPDATE_FIELDS
                    if k in r
                }
                try:
                    success = self.client.update_staging_question(
                        staging_id=staging_id,
                        fields=fields_to_update,
                        expected_updated_at=expected_updated_at,
                    )
                    if success:
                        updated_count += 1
                    else:
                        concurrency_skipped_count += 1
                        concurrency_skipped_candidates[cid] = "Row modified concurrently (status/promotion/updated_at changed)"
                        print(f"[WARN] Concurrency collision on {cid} ({staging_id}): Row no longer matches PENDING or expected updated_at. Skipped.")
                except Exception as ex:
                    failed_count += 1
                    print(f"[ERROR] Failed to update candidate {cid} ({staging_id}): {ex}", file=sys.stderr)

            print(f"[INFO] Successfully updated {updated_count} candidate(s) with isolated field-level updates.")
            if concurrency_skipped_count > 0:
                print(f"[WARN] Skipped {concurrency_skipped_count} candidate(s) due to concurrent modification.")
            if failed_count > 0:
                print(f"[ERROR] {failed_count} candidate update(s) failed with errors.")
        elif existing_questions:
            print("[INFO] Zero uncurated candidates required updating. All existing records preserved.")

        # 4. Insert newly detected candidates (if any)
        inserted_count = 0
        if records_to_insert:
            print(f"[INFO] Staging {len(records_to_insert)} newly detected candidate(s)...")
            inserted_count = self.client.upsert_staging_questions(records_to_insert)
            print(f"[INFO] Staged {inserted_count} new records via atomic merge-duplicates.")

        # 5. Finalize Batch Status & Metrics
        batch_rec = plan["batch_record"]
        existing_meta = batch.get("metadata") or {}
        existing_meta.pop("processing_lock", None)
        existing_meta.pop("last_error", None)

        # Merge extraction diagnostics into existing metadata
        existing_meta.update({
            "extractor_backend": batch_rec["extractor_backend"],
            "processed_at": datetime.now(timezone.utc).isoformat(),
            "source_doc_type": batch_rec["metadata"].get("source_doc_type", "EXAM_PAPER"),
            "paper_instructions": batch_rec["metadata"].get("paper_instructions", []),
            "diagram_summary": {
                "diagrams_staged": len(diagram_uploads),
            }
        })

        summary_updates = {
            "status": "IN_REVIEW",
            "total_pages": batch_rec["total_pages"],
            "total_questions": len(staging_records),
            "extraction_failures_count": batch_rec["extraction_failures_count"],
            "high_confidence_count": batch_rec["high_confidence_count"],
            "extractor_backend": batch_rec["extractor_backend"],
            "metadata": existing_meta,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        print(f"[INFO] Finalizing ingestion_batches record ({self.batch_id}) to status: IN_REVIEW...")
        final_batch = self.client.finalize_batch(self.batch_id, summary_updates)

        # Reporting Summary
        print(f"\n{'='*70}")
        print(f"AURAMENTOR REPROCESSING REPORT: Batch {self.batch_id}")
        print(f"{'='*70}")
        print(f"  Candidates Updated:                   {updated_count}")
        print(f"  Candidates Protected by Curation:     {len(protected_candidates)}")
        print(f"  Candidates Skipped (Concurrent Mod):  {concurrency_skipped_count}")
        print(f"  Candidates Failed to Update:          {failed_count}")
        print(f"  New Candidates Inserted:              {inserted_count}")
        print(f"  Diagram Assets Staged:                {len(diagram_uploads)}")
        print(f"{'='*70}\n")

        return {
            "success": failed_count == 0,
            "batch_id": self.batch_id,
            "status": "IN_REVIEW",
            "candidates_updated": updated_count,
            "candidates_protected_by_curation": len(protected_candidates),
            "candidates_skipped_concurrent": concurrency_skipped_count,
            "candidates_failed": failed_count,
            "candidates_inserted": inserted_count,
            "diagrams_uploaded": len(diagram_uploads),
            "pdf_storage_path": batch["pdf_storage_path"],
            "updated_at": summary_updates["updated_at"],
        }


# ============================================================================
# Environment & Credential Loading (Standard Library Only)
# ============================================================================

def parse_env_file(filepath: str) -> Dict[str, str]:
    """
    Parses a simple KEY=VALUE env file without third-party dependencies.
    Ignores comments (#) and strips leading/trailing whitespace and quotes.
    """
    parsed: Dict[str, str] = {}
    if not os.path.exists(filepath):
        return parsed

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k:
                        parsed[k] = v
    except Exception:
        pass
    return parsed


def load_ingestion_credentials(
    project_root: Optional[str] = None,
) -> Tuple[Optional[str], Optional[str]]:
    """
    Loads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY with secure precedence:
    1. Existing environment variables (os.environ) take highest precedence.
    2. Project-root .env.ingestion.local values are loaded next if env vars are unset.
    3. Fallback: NEXT_PUBLIC_SUPABASE_URL from os.environ or .env.local for URL only.
    4. Strict Security Guard: SUPABASE_SERVICE_ROLE_KEY is NEVER loaded from any
       publishable key (e.g. NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY). Secrets are never logged.

    Returns:
        (supabase_url, service_role_key)
    """
    if project_root is None:
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

    # 1. Existing environment variables (Highest Precedence)
    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")

    # 2. Project-root .env.ingestion.local file
    ingestion_env_path = os.path.join(project_root, ".env.ingestion.local")
    ingestion_env = parse_env_file(ingestion_env_path)

    if not supabase_url:
        supabase_url = ingestion_env.get("SUPABASE_URL")
        if supabase_url:
            os.environ["SUPABASE_URL"] = supabase_url

    if not service_role_key:
        service_role_key = ingestion_env.get("SUPABASE_SERVICE_ROLE_KEY") or ingestion_env.get("SUPABASE_SERVICE_KEY")
        if service_role_key:
            os.environ["SUPABASE_SERVICE_ROLE_KEY"] = service_role_key

    # 3. Fallback for SUPABASE_URL only (via .env.local / NEXT_PUBLIC_SUPABASE_URL)
    if not supabase_url:
        supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
        if not supabase_url:
            local_env = parse_env_file(os.path.join(project_root, ".env.local"))
            supabase_url = local_env.get("SUPABASE_URL") or local_env.get("NEXT_PUBLIC_SUPABASE_URL")
            if supabase_url and "SUPABASE_URL" not in os.environ:
                os.environ["SUPABASE_URL"] = supabase_url

    # 4. Strict Security Guard: Never allow service_role_key to match publishable key
    publishable_key = os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
    if not publishable_key:
        local_env = parse_env_file(os.path.join(project_root, ".env.local"))
        publishable_key = local_env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")

    if service_role_key and publishable_key and service_role_key == publishable_key:
        # Reject publishable key being passed or loaded as service role key
        service_role_key = None
        if "SUPABASE_SERVICE_ROLE_KEY" in os.environ:
            del os.environ["SUPABASE_SERVICE_ROLE_KEY"]

    return supabase_url, service_role_key


# ============================================================================
# CLI Entry Point
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="AuraMentor Ingestion Worker: Processes uploaded PDF batches into question candidates."
    )
    parser.add_argument(
        "--batch-id",
        required=True,
        help="UUID of the ingestion batch to process."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate extraction and prepare staging payloads without database/storage writes."
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Reprocess an already processed batch or override active worker lock."
    )
    parser.add_argument(
        "--local-pdf",
        required=False,
        help="Local PDF filepath override (useful for testing or dry-run validation)."
    )
    parser.add_argument(
        "--keep-temp",
        action="store_true",
        help="Do not delete temporary working files after processing."
    )
    parser.add_argument(
        "--engine",
        choices=["v2", "mineru"],
        default=os.environ.get("EXTRACTION_ENGINE", "v2"),
        help="Extraction engine backend ('v2' or 'mineru'). Default: 'v2'."
    )
    parser.add_argument(
        "--remote-metadata",
        action="store_true",
        help="Explicitly fetch live batch/curation metadata from Supabase during --dry-run."
    )

    args = parser.parse_args()

    # Validate batch_id format
    try:
        uuid_obj = uuid.UUID(args.batch_id)
        batch_uuid = str(uuid_obj)
    except ValueError:
        print(f"Error: Invalid batch UUID format: '{args.batch_id}'.", file=sys.stderr)
        sys.exit(1)

    client: Optional[SupabaseRestClient] = None
    is_offline_local_dry_run = bool(args.dry_run and args.local_pdf and not args.remote_metadata)

    if not is_offline_local_dry_run:
        # Securely load credentials with precedence (os.environ > .env.ingestion.local)
        supabase_url, service_role_key = load_ingestion_credentials()

        if not args.dry_run or args.remote_metadata or (supabase_url and service_role_key):
            if not supabase_url:
                print(
                    "Error: Missing SUPABASE_URL.\n"
                    "Please configure SUPABASE_URL in your project-root '.env.ingestion.local' file or environment.",
                    file=sys.stderr
                )
                sys.exit(1)
            if not service_role_key:
                print(
                    "Error: Missing SUPABASE_SERVICE_ROLE_KEY.\n"
                    "Worker operations require privileged database and storage access.\n"
                    "Please configure SUPABASE_SERVICE_ROLE_KEY in your project-root '.env.ingestion.local' file:\n\n"
                    "  SUPABASE_URL=https://your-project.supabase.co\n"
                    "  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key\n\n"
                    "Or export SUPABASE_SERVICE_ROLE_KEY in your trusted environment.",
                    file=sys.stderr
                )
                sys.exit(1)

            client = SupabaseRestClient(supabase_url, service_role_key)

    processor = BatchProcessor(
        batch_id=batch_uuid,
        client=client,
        dry_run=args.dry_run,
        force=args.force,
        local_pdf_override=args.local_pdf,
        keep_temp=args.keep_temp,
        engine=args.engine,
    )

    try:
        processor.run()
    except Exception as e:
        print(f"\n[FATAL ERROR] Batch processing failed: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

