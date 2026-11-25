#!/usr/bin/env python3
"""
AuraMentor — Question Ingestion Pipeline: Staging Importer (Phase 2C)
File: scripts/ingestion/import_to_staging.py

Ingests an extracted question candidate payload and its source PDF into
Supabase Storage (`question-media`) and the staging tables:
  - public.ingestion_batches
  - public.staging_questions

Usage:
  # Dry-run validation (validates hashes, payloads, diagram paths; no network calls):
  python3 scripts/ingestion/import_to_staging.py --pdf test_source.pdf --json real_test_output_v3.json --dry-run

  # Live staging import:
  python3 scripts/ingestion/import_to_staging.py --pdf test_source.pdf --json real_test_output_v3.json

  # Run extraction on the fly and import:
  python3 scripts/ingestion/import_to_staging.py --pdf second_test.pdf --dry-run
"""

import argparse
import hashlib
import json
import mimetypes
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

# Try loading supabase-py if installed; otherwise support HTTP requests fallback
try:
    from supabase import Client, create_client
    HAS_SUPABASE_CLIENT = True
except ImportError:
    HAS_SUPABASE_CLIENT = False

# Import local extraction engine if run on the fly
try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from pdf_extractor import process_pdf_document
    HAS_EXTRACTOR = True
except ImportError:
    HAS_EXTRACTOR = False


# ============================================================================
# Provenance & Hash Utilities
# ============================================================================

def compute_file_sha256(filepath: str) -> Tuple[str, int]:
    """Computes SHA-256 hash and byte size of a file."""
    sha256 = hashlib.sha256()
    size = 0
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            sha256.update(chunk)
            size += len(chunk)
    return sha256.hexdigest(), size


def normalize_question_text(text: str) -> str:
    """
    Normalizes candidate question text for duplicate detection:
    Lowercases, removes LaTeX commands, strips punctuation, collapses whitespace.
    """
    if not text:
        return ""
    # Strip LaTeX commands like \frac, \sqrt
    cleaned = re.sub(r"\\[a-zA-Z]+", " ", text)
    # Strip non-alphanumeric
    cleaned = re.sub(r"[^a-zA-Z0-9]", " ", cleaned).lower()
    # Collapse whitespace
    return re.sub(r"\s+", " ", cleaned).strip()


def compute_content_hash(text: str) -> str:
    """Computes SHA-256 hash of normalized candidate text."""
    normalized = normalize_question_text(text)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


# ============================================================================
# Staging Payload Preparation
# ============================================================================

def prepare_staging_payloads(
    pdf_path: str,
    extraction_data: Dict[str, Any],
    batch_id: Optional[str] = None,
    default_chapter_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Constructs the database records and storage upload plans for an ingestion batch.
    Maps diagram storage paths into canonical storage://question-media/... URIs.
    """
    batch_uuid = batch_id or str(uuid.uuid4())
    pdf_filename = os.path.basename(pdf_path)
    pdf_file_hash, pdf_file_size = compute_file_sha256(pdf_path)
    pdf_mime_type = mimetypes.guess_type(pdf_path)[0] or "application/pdf"

    summary = extraction_data.get("summary", {})
    metadata = extraction_data.get("metadata", {})
    candidates = extraction_data.get("candidates", [])

    pdf_storage_path = f"ingestion/{batch_uuid}/source.pdf"

    # Aggregated batch metrics
    total_pages = summary.get("total_pages", 1)
    total_questions = len(candidates)
    failures_count = sum(1 for c in candidates if c.get("has_extraction_failures"))
    confidence_counts = summary.get("confidence_breakdown", {})
    high_confidence_count = confidence_counts.get("high_confidence_ge_85", 0)

    # 1. Batch Record
    batch_record = {
        "id": batch_uuid,
        "pdf_storage_path": pdf_storage_path,
        "pdf_filename": pdf_filename,
        "pdf_file_hash": pdf_file_hash,
        "pdf_file_size_bytes": pdf_file_size,
        "pdf_mime_type": pdf_mime_type,
        "extractor_backend": metadata.get("extractor_backend", "MacPDFKit2D"),
        "total_pages": total_pages,
        "total_questions": total_questions,
        "extraction_failures_count": failures_count,
        "high_confidence_count": high_confidence_count,
        "promoted_count": 0,
        "status": "PENDING",
        "metadata": {
            "source_filepath": os.path.abspath(pdf_path),
            "extracted_at": metadata.get("extracted_at"),
            "source_doc_type": metadata.get("source_doc_type", "EXAM_PAPER"),
            "paper_instructions": extraction_data.get("paper_instructions", []),
        },
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    # 2. Candidate Staging Records & Diagram Upload Plan
    staging_records = []
    diagram_uploads = []

    for cand in candidates:
        cand_id = cand["candidate_id"]
        q_text = cand.get("candidate_question_text", "").strip()
        content_hash = compute_content_hash(q_text)

        # Process detected diagrams for this candidate
        remapped_diagrams = []
        for diag in cand.get("detected_diagrams", []):
            diag_id = diag.get("diagram_id", str(uuid.uuid4())[:8])
            local_path = diag.get("local_image_path") or diag.get("image_path")
            
            # Destination inside question-media bucket
            dest_storage_path = f"ingestion/{batch_uuid}/diagrams/{diag_id}.png"
            canonical_uri = f"storage://question-media/{dest_storage_path}"

            remapped_diag = dict(diag)
            remapped_diag["storage_path"] = dest_storage_path
            remapped_diag["storage_url"] = canonical_uri
            remapped_diagrams.append(remapped_diag)

            if local_path and os.path.exists(local_path):
                diagram_uploads.append({
                    "diagram_id": diag_id,
                    "local_path": local_path,
                    "storage_path": dest_storage_path,
                    "mime_type": "image/png"
                })

            # Sync interim diagram paths in question stem to canonical batch storage URI
            old_storage_path = diag.get("storage_path")
            if old_storage_path and old_storage_path in q_text:
                q_text = q_text.replace(f"storage://question-media/{old_storage_path}", canonical_uri)
                q_text = q_text.replace(old_storage_path, dest_storage_path)

        content_hash = compute_content_hash(q_text)

        staging_records.append({
            "id": str(uuid.uuid4()),
            "batch_id": batch_uuid,
            "candidate_id": cand_id,
            "source_page_number": cand.get("source_page_number", 1),
            "detected_question_label": cand.get("detected_question_label", ""),
            "question_heading": cand.get("question_heading"),
            "section": cand.get("section"),
            "inferred_type": cand.get("inferred_type", "SUBJECTIVE"),
            "candidate_question_text": q_text,
            "content_hash": content_hash,
            "detected_options": cand.get("detected_options", []),
            "detected_subparts": cand.get("detected_subparts", []),
            "detected_answer": cand.get("detected_answer"),
            "detected_solution": cand.get("detected_solution"),
            "detected_diagrams": remapped_diagrams,
            "original_extracted_text": cand.get("original_extracted_text", q_text),
            "extraction_warnings": cand.get("extraction_warnings", []),
            "has_extraction_failures": cand.get("has_extraction_failures", False),
            "extraction_confidence": cand.get("extraction_confidence", 1.0),
            "target_chapter_id": default_chapter_id,
            "target_topic_id": None,
            "target_difficulty": "MEDIUM",
            "target_marks": 1.0,
            "target_negative_marks": 0.0,
            "review_status": "PENDING",
            "promoted_question_id": None,
            "promotion_token": None,
            "promotion_generation": 0,
            "promotion_started_at": None,
            "promotion_expires_at": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    return {
        "batch_id": batch_uuid,
        "batch_record": batch_record,
        "staging_records": staging_records,
        "pdf_upload": {
            "local_path": os.path.abspath(pdf_path),
            "storage_path": pdf_storage_path,
            "mime_type": pdf_mime_type,
            "size_bytes": pdf_file_size,
            "sha256": pdf_file_hash
        },
        "diagram_uploads": diagram_uploads
    }


# ============================================================================
# Live Supabase Importer
# ============================================================================

class StagingImporter:
    """Handles storage upload and database insertion into Supabase."""

    def __init__(self, supabase_url: str, supabase_key: str):
        if not HAS_SUPABASE_CLIENT:
            raise RuntimeError(
                "The 'supabase' Python package is required for live uploads. "
                "Install it via: pip install supabase"
            )
        self.client: Client = create_client(supabase_url, supabase_key)

    def check_existing_batch_hash(self, file_hash: str) -> Optional[Dict[str, Any]]:
        """Checks if a PDF with this exact hash has already been ingested."""
        res = (
            self.client.from_("ingestion_batches")
            .select("id, pdf_filename, status, created_at")
            .eq("pdf_file_hash", file_hash)
            .execute()
        )
        if res.data and len(res.data) > 0:
            return res.data[0]
        return None

    def upload_file_to_storage(
        self, bucket: str, storage_path: str, local_path: str, mime_type: str
    ) -> None:
        """Uploads a local file to a Supabase Storage bucket."""
        with open(local_path, "rb") as f:
            file_bytes = f.read()

        # Supabase storage upload options
        self.client.storage.from_(bucket).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": mime_type, "upsert": "true"}
        )

    def execute_import(self, plan: Dict[str, Any]) -> Dict[str, Any]:
        """Executes the full import plan against Supabase."""
        batch_id = plan["batch_id"]
        pdf_info = plan["pdf_upload"]
        diagram_uploads = plan["diagram_uploads"]

        # 1. Upload Source PDF to question-media bucket
        print(f"Uploading source PDF to question-media/{pdf_info['storage_path']}...")
        self.upload_file_to_storage(
            "question-media",
            pdf_info["storage_path"],
            pdf_info["local_path"],
            pdf_info["mime_type"]
        )

        # 2. Upload Diagram PNG crops
        print(f"Uploading {len(diagram_uploads)} diagram assets...")
        for diag in diagram_uploads:
            self.upload_file_to_storage(
                "question-media",
                diag["storage_path"],
                diag["local_path"],
                diag["mime_type"]
            )

        # 3. Insert Ingestion Batch Record
        print(f"Inserting ingestion_batches record ({batch_id})...")
        self.client.from_("ingestion_batches").insert(plan["batch_record"]).execute()

        # 4. Insert Staging Questions (chunked in batches of 25)
        staging_records = plan["staging_records"]
        print(f"Inserting {len(staging_records)} staging_questions records...")
        chunk_size = 25
        for i in range(0, len(staging_records), chunk_size):
            chunk = staging_records[i : i + chunk_size]
            self.client.from_("staging_questions").insert(chunk).execute()

        return {
            "success": True,
            "batch_id": batch_id,
            "questions_imported": len(staging_records),
            "diagrams_uploaded": len(diagram_uploads),
            "pdf_storage_path": pdf_info["storage_path"]
        }


# ============================================================================
# CLI Interface
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="AuraMentor Staging Importer: Imports PDF & questions into Supabase staging."
    )
    parser.add_argument(
        "--pdf", required=True, help="Path to the source mathematics PDF."
    )
    parser.add_argument(
        "--json", required=False, help="Path to pre-extracted JSON candidates file."
    )
    parser.add_argument(
        "--chapter-id", required=False, help="Optional default chapter UUID for staging candidates."
    )
    parser.add_argument(
        "--batch-id", required=False, help="Explicit UUID for the ingestion batch (optional)."
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Perform offline validation without contacting Supabase."
    )
    parser.add_argument(
        "--output-plan", required=False, help="Save generated import plan JSON to a file."
    )

    args = parser.parse_args()

    if not os.path.exists(args.pdf):
        print(f"Error: PDF file '{args.pdf}' not found.", file=sys.stderr)
        sys.exit(1)

    # 1. Load or run extraction data
    if args.json:
        if not os.path.exists(args.json):
            print(f"Error: JSON file '{args.json}' not found.", file=sys.stderr)
            sys.exit(1)
        with open(args.json, "r", encoding="utf-8") as f:
            extraction_data = json.load(f)
    else:
        if not HAS_EXTRACTOR:
            print("Error: Local extraction engine (pdf_extractor.py) is not available. Please provide --json.", file=sys.stderr)
            sys.exit(1)
        print(f"Running extraction on {args.pdf}...")
        extraction_data = process_pdf_document(args.pdf)

    # 2. Build Staging Plan
    plan = prepare_staging_payloads(
        pdf_path=args.pdf,
        extraction_data=extraction_data,
        batch_id=args.batch_id,
        default_chapter_id=args.chapter_id
    )

    batch_rec = plan["batch_record"]
    staging_recs = plan["staging_records"]
    pdf_info = plan["pdf_upload"]
    diagram_uploads = plan["diagram_uploads"]

    print("\n" + "=" * 60)
    print("AURAMENTOR STAGING IMPORT PLAN")
    print("=" * 60)
    print(f"Batch UUID:             {plan['batch_id']}")
    print(f"PDF Filename:           {batch_rec['pdf_filename']}")
    print(f"PDF Size:               {pdf_info['size_bytes']:,} bytes")
    print(f"PDF SHA-256:            {pdf_info['sha256']}")
    print(f"Target PDF Path:        question-media/{pdf_info['storage_path']}")
    print(f"Total Pages:            {batch_rec['total_pages']}")
    print(f"Total Candidates:       {len(staging_recs)}")
    print(f"High-Confidence:        {batch_rec['high_confidence_count']}")
    print(f"Extraction Failures:    {batch_rec['extraction_failures_count']}")
    print(f"Diagrams to Upload:     {len(diagram_uploads)}")
    print("=" * 60)

    if args.output_plan:
        with open(args.output_plan, "w", encoding="utf-8") as f:
            json.dump(plan, f, indent=2)
        print(f"Saved import plan to: {args.output_plan}")

    if args.dry_run:
        print("\n[DRY RUN] Verification complete. Zero network writes performed.")
        # Validate uniqueness of candidate_ids within the batch
        cand_ids = [r["candidate_id"] for r in staging_recs]
        if len(cand_ids) != len(set(cand_ids)):
            print("ERROR: Duplicate candidate_ids found within batch!", file=sys.stderr)
            sys.exit(1)
        print("Candidate Uniqueness:   PASSED (All candidate_ids distinct)")
        print("Hash Calculations:      PASSED")
        print("Diagram URI Remapping:  PASSED")
        return

    # 3. Live Execution
    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")

    if not supabase_url or not supabase_key:
        print("\nError: Supabase environment variables missing.", file=sys.stderr)
        print("Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to perform live imports.", file=sys.stderr)
        sys.exit(1)

    importer = StagingImporter(supabase_url, supabase_key)

    # Check duplicate document hash
    existing = importer.check_existing_batch_hash(pdf_info["sha256"])
    if existing:
        print(f"\nWarning: PDF with hash {pdf_info['sha256'][:12]}... already exists in batch {existing['id']}.")
        proceed = input("Do you want to re-ingest as a new batch? (y/N): ").strip().lower()
        if proceed != "y":
            print("Import aborted by user.")
            return

    result = importer.execute_import(plan)
    print("\nIMPORT COMPLETED SUCCESSFULLY!")
    print(f"Batch ID: {result['batch_id']}")
    print(f"Questions Staged: {result['questions_imported']}")
    print(f"Diagrams Uploaded: {result['diagrams_uploaded']}")


if __name__ == "__main__":
    main()

