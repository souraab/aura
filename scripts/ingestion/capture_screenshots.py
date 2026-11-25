#!/usr/bin/env python3
"""
AuraMentor — Screenshot Capture Utility for Student Examination Preview
Captures desktop and mobile previews of key examination views using headless Chrome.
"""

import os
import sys
import time
import subprocess
from pathlib import Path

CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE_URL = "http://localhost:3000/preview/batch/0811532e-91bb-46e0-96fd-e4341a0539dc"
OUTPUT_DIR = Path(__file__).resolve().parent / "preview_screenshots"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


SHOTS = [
    # Desktop Viewports (1280x950)
    {
        "name": "01_desktop_q1_trigonometry.png",
        "url": f"{BASE_URL}?q=1",
        "width": 1280,
        "height": 950,
        "label": "Desktop Q1 (Trigonometry MCQ with Math Expression)",
    },
    {
        "name": "02_desktop_q5_geometry_diagram.png",
        "url": f"{BASE_URL}?q=5",
        "width": 1280,
        "height": 950,
        "label": "Desktop Q5 (Geometry with Inscribed Circle Figure)",
    },
    {
        "name": "03_desktop_q12_table_question.png",
        "url": f"{BASE_URL}?q=12",
        "width": 1280,
        "height": 950,
        "label": "Desktop Q12 (Frequency Distribution Table)",
    },
    {
        "name": "04_desktop_q25_subjective_both_diagrams.png",
        "url": f"{BASE_URL}?q=25",
        "width": 1280,
        "height": 1100,
        "label": "Desktop Q25 (Subjective Geometry with Both OR Figures)",
    },
    {
        "name": "05_desktop_q36_case_study.png",
        "url": f"{BASE_URL}?q=36",
        "width": 1280,
        "height": 1050,
        "label": "Desktop Q36 (Case Study with Context Diagram & Subparts)",
    },
    {
        "name": "06_desktop_q37_case_study_table_and_diagram.png",
        "url": f"{BASE_URL}?q=37",
        "width": 1280,
        "height": 1100,
        "label": "Desktop Q37 (Case Study with Runner Diagram & Time Table)",
    },
    {
        "name": "07_desktop_instructions_modal.png",
        "url": f"{BASE_URL}?modal=instructions",
        "width": 1280,
        "height": 950,
        "label": "Desktop Examination Instructions Modal",
    },
    {
        "name": "08_desktop_submit_summary_modal.png",
        "url": f"{BASE_URL}?modal=submit",
        "width": 1280,
        "height": 950,
        "label": "Desktop Examination Submission Summary Modal",
    },

    # Mobile Viewports (390x844 - iPhone style)
    {
        "name": "09_mobile_q1_preview.png",
        "url": f"{BASE_URL}?q=1",
        "width": 390,
        "height": 844,
        "label": "Mobile Q1 (Responsive Layout & Option Cards)",
    },
    {
        "name": "10_mobile_q5_diagram_preview.png",
        "url": f"{BASE_URL}?q=5",
        "width": 390,
        "height": 844,
        "label": "Mobile Q5 (Responsive Geometry Figure)",
    },
    {
        "name": "11_mobile_palette_drawer.png",
        "url": f"{BASE_URL}?drawer=palette",
        "width": 390,
        "height": 844,
        "label": "Mobile Slide-Over Question Palette Drawer",
    },
]


def capture_all():
    print(f"[INFO] Capturing {len(SHOTS)} student preview screenshots...")
    temp_profile = "/tmp/chrome_preview_user_data"

    for idx, s in enumerate(SHOTS, 1):
        out_path = OUTPUT_DIR / s["name"]
        cmd = [
            CHROME_BIN,
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--disable-extensions",
            f"--user-data-dir={temp_profile}",
            f"--window-size={s['width']},{s['height']}",
            f"--screenshot={out_path}",
            "--virtual-time-budget=2000",
            s["url"],
        ]

        try:
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            size_kb = out_path.stat().st_size / 1024
            print(f"  [{idx}/{len(SHOTS)}] Captured {s['name']} ({size_kb:.1f} KB) - {s['label']}")
        except Exception as e:
            print(f"  [ERROR] Failed to capture {s['name']}: {e}", file=sys.stderr)

    print(f"\n[SUCCESS] All screenshots saved to: {OUTPUT_DIR}")


if __name__ == "__main__":
    capture_all()

