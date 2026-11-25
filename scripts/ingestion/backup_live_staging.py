#!/usr/bin/env python3
"""
AuraMentor — Live Staging Backup Utility
Backs up all 38 staging candidates and batch metadata for batch 0811532e-91bb-46e0-96fd-e4341a0539dc
prior to Phase 4 MinerU staging update.
"""

import os
import sys
import json
from pathlib import Path
from datetime import datetime, timezone

CURRENT_DIR = Path(__file__).resolve().parent
REPO_ROOT = CURRENT_DIR.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from process_batch import load_ingestion_credentials, SupabaseRestClient


def backup_batch():
    batch_id = "0811532e-91bb-46e0-96fd-e4341a0539dc"
    url, key = load_ingestion_credentials()
    client = SupabaseRestClient(url, key)

    print(f"[INFO] Connecting to Supabase to backup batch {batch_id}...")
    batch_record = client.get_batch(batch_id)
    if not batch_record:
        raise RuntimeError(f"Batch {batch_id} not found.")

    staging_rows = client.get_existing_staging_questions(batch_id)
    print(f"[INFO] Fetched {len(staging_rows)} staging questions for batch {batch_id}.")
    assert len(staging_rows) == 38, f"Expected 38 staging rows, got {len(staging_rows)}"

    backup_dir = CURRENT_DIR / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    backup_filename = f"staging_backup_0811532e_{timestamp}.json"
    backup_path = backup_dir / backup_filename

    payload = {
        "backup_metadata": {
            "batch_id": batch_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "source_filename": batch_record.get("pdf_filename"),
            "source_storage_path": batch_record.get("pdf_storage_path"),
            "pdf_file_hash": batch_record.get("pdf_file_hash"),
            "total_candidates": len(staging_rows),
            "description": "Pre-execution backup before controlled MinerU staging update (Phase 4)",
        },
        "batch_record": batch_record,
        "staging_records": staging_rows,
    }

    with open(backup_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    print(f"[SUCCESS] Saved backup to: {backup_path}")
    print(f"Verified: {len(staging_rows)} candidates preserved.")
    return backup_path


if __name__ == "__main__":
    backup_batch()

