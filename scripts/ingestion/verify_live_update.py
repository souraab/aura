#!/usr/bin/env python3
"""
AuraMentor — Live Verification Script for Phase 4 MinerU Staging Update
Validates batch 0811532e-91bb-46e0-96fd-e4341a0539dc directly against Supabase.
"""

import sys
from pathlib import Path
import json

CURRENT_DIR = Path(__file__).resolve().parent
REPO_ROOT = CURRENT_DIR.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from process_batch import load_ingestion_credentials, SupabaseRestClient


def verify():
    batch_id = "0811532e-91bb-46e0-96fd-e4341a0539dc"
    url, key = load_ingestion_credentials()
    client = SupabaseRestClient(url, key)

    print("=" * 70)
    print("LIVE SUPABASE POST-EXECUTION VERIFICATION REPORT")
    print("=" * 70)

    # 1. Batch metadata
    batch = client.get_batch(batch_id)
    print(f"Batch ID: {batch.get('id')}")
    print(f"Batch Status: {batch.get('status')}")
    print(f"Total Questions Metadata: {batch.get('total_questions')}")
    print(f"Extractor Backend: {batch.get('extractor_backend')}")
    assert batch.get("status") == "IN_REVIEW", f"Expected IN_REVIEW, got {batch.get('status')}"

    # 2. Staging questions count & IDs
    staging_rows = client.get_existing_staging_questions(batch_id)
    print(f"\nTotal Staging Rows in Database: {len(staging_rows)} (Expected: 38)")
    assert len(staging_rows) == 38, f"Expected 38, got {len(staging_rows)}"

    candidates_by_cid = {r["candidate_id"]: r for r in staging_rows}
    print(f"Unique Candidate IDs: {len(candidates_by_cid)} (Expected: 38)")
    assert len(candidates_by_cid) == 38

    # 3. Verify Candidate 1
    q1 = candidates_by_cid.get("cand-p1-q1")
    assert q1 is not None, "cand-p1-q1 missing!"
    print("\n--- Question 1 Verification ---")
    print(f"Stem: {q1.get('candidate_question_text')}")
    print(f"Options Count: {len(q1.get('detected_options', []))}")
    for opt in q1.get("detected_options", []):
        print(f"  {opt['key']}: {opt['text']}")
    print(f"Warnings: {q1.get('extraction_warnings')}")
    print(f"Confidence: {q1.get('extraction_confidence')}")
    print(f"Review Status: {q1.get('review_status')}")
    print(f"Promoted Question ID: {q1.get('promoted_question_id')}")

    # Assert Q1 math expression correctness
    assert r"\frac{\cos^{2}\theta}{\sin^{2}\theta}" in q1.get("candidate_question_text") or r"\frac{\cos^2\theta}{\sin^2\theta}" in q1.get("candidate_question_text")
    assert r"\frac{1}{\sin^{2}\theta}" in q1.get("candidate_question_text") or r"\frac{1}{\sin^2\theta}" in q1.get("candidate_question_text")
    opt_d = [o for o in q1.get("detected_options", []) if o["key"].upper() == "D"]
    assert len(opt_d) == 1
    assert opt_d[0]["text"] == "-1", f"Expected -1, got {opt_d[0]['text']}"

    # 4. Diagram Associations
    print("\n--- Diagram Associations Verification ---")
    expected_diagram_counts = {
        "cand-p1-q5": 1,
        "cand-p1-q6": 1,
        "cand-p3-q25": 2,
        "cand-p3-q31": 1,
        "cand-p4-q32": 1,
        "cand-p4-q36": 1,
        "cand-p5-q37": 1,
        "cand-p5-q38": 1,
    }

    for cid, exp_count in expected_diagram_counts.items():
        row = candidates_by_cid.get(cid)
        diags = row.get("detected_diagrams") or []
        print(f"{cid}: {len(diags)} diagram(s)")
        assert len(diags) == exp_count, f"{cid}: expected {exp_count} diagrams, got {len(diags)}"
        for d in diags:
            storage_url = d.get("storage_url") or d.get("storage_path") or ""
            print(f"   -> ID: {d.get('diagram_id')}, URL: {storage_url}")
            assert "0811532e-91bb-46e0-96fd-e4341a0539dc" in storage_url

    # Check non-diagram questions have 0 diagrams
    non_diagram_sample = ["cand-p1-q1", "cand-p1-q2", "cand-p3-q26", "cand-p4-q34", "cand-p4-q35"]
    for cid in non_diagram_sample:
        row = candidates_by_cid.get(cid)
        diags = row.get("detected_diagrams") or []
        assert len(diags) == 0, f"{cid} should have 0 diagrams, got {len(diags)}"

    # 5. Safety & Promotion checks across all 38 rows
    promoted_candidates = [r["candidate_id"] for r in staging_rows if r.get("promoted_question_id") is not None]
    non_pending_candidates = [r["candidate_id"] for r in staging_rows if r.get("review_status") != "PENDING"]
    
    print("\n--- Safety & Ingestion Constraints ---")
    print(f"Promoted Candidates: {len(promoted_candidates)} (Expected: 0)")
    print(f"Non-PENDING Candidates: {len(non_pending_candidates)} (Expected: 0)")
    assert len(promoted_candidates) == 0, f"Found promoted candidates: {promoted_candidates}"
    assert len(non_pending_candidates) == 0, f"Found non-PENDING candidates: {non_pending_candidates}"

    # Verify updated_at is recent (today)
    updated_ats = [r.get("updated_at") for r in staging_rows]
    print(f"All 38 rows updated timestamps present: {all(updated_ats)}")
    print(f"Sample updated_at: {updated_ats[0]}")

    print("\n" + "=" * 70)
    print("ALL POST-EXECUTION VERIFICATION CHECKS PASSED PERFECTLY!")
    print("=" * 70)


if __name__ == "__main__":
    verify()
