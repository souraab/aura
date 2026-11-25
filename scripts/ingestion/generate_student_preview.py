#!/usr/bin/env python3
"""
AuraMentor — Student-View Preview and Screenshot Generator
Renders all 38 reconstructed question candidates into an isolated,
high-fidelity student preview and captures representative question screenshots.
"""

import os
import sys
import json
import base64
import subprocess
from pathlib import Path
from datetime import datetime, timezone

CURRENT_DIR = Path(__file__).resolve().parent
REPO_ROOT = CURRENT_DIR.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from mineru_adapter import process_mineru_pdf


def get_base64_image(image_path: Path) -> str:
    """Reads a local image and returns data URI."""
    if not image_path.exists():
        return ""
    suffix = image_path.suffix.lstrip(".").lower()
    mime = "image/png" if suffix == "png" else "image/jpeg"
    with open(image_path, "rb") as f:
        data = base64.b64encode(f.read()).decode("utf-8")
    return f"data:{mime};base64,{data}"


def build_student_preview():
    pdf_path = CURRENT_DIR / "test_source.pdf"
    res = process_mineru_pdf(str(pdf_path))
    candidates = res["candidates"]
    assert len(candidates) == 38, f"Expected 38 candidates, got {len(candidates)}"

    assets_dir = CURRENT_DIR / "assets" / "test_source"
    output_dir = CURRENT_DIR / "mineru_experiments"
    output_dir.mkdir(parents=True, exist_ok=True)
    screenshots_dir = output_dir / "screenshots"
    screenshots_dir.mkdir(parents=True, exist_ok=True)

    # HTML template with embedded KaTeX, Tailwind-like styling, and dark/light support
    html_cards = []

    for c in candidates:
        q_num = int(c["detected_question_label"].rstrip("."))
        cid = c["candidate_id"]
        sec = c["section"]
        qtype = c["inferred_type"]
        marks = c["target_marks"]
        stem = c["candidate_question_text"]
        opts = c["detected_options"]
        subparts = c["detected_subparts"]
        diags = c["detected_diagrams"]

        # Convert storage:// image links to embedded base64 data URIs for offline headless rendering
        import re
        def replace_storage_img(match):
            alt = match.group(1)
            storage_url = match.group(2)
            fname = os.path.basename(storage_url)
            local_img = assets_dir / fname
            if local_img.exists():
                b64 = get_base64_image(local_img)
                return f'<div class="my-4 flex flex-col items-center"><div class="p-2 rounded-2xl bg-white border border-slate-200 shadow-sm max-w-md"><img src="{b64}" alt="{alt}" class="max-h-60 w-auto object-contain rounded-lg mx-auto" /></div><span class="mt-1.5 text-xs text-slate-500 font-medium">{alt}</span></div>'
            return f'<div class="p-2 text-xs text-rose-500 bg-rose-50 rounded">⚠️ Image missing: {fname}</div>'

        # Parse markdown tables if any
        def format_markdown_tables(text: str) -> str:
            lines = text.split("\n")
            in_table = False
            table_lines = []
            formatted_lines = []

            for line in lines:
                if "|" in line and ("---" in line or line.strip().startswith("|")):
                    in_table = True
                    table_lines.append(line.strip())
                else:
                    if in_table:
                        # Render table
                        formatted_lines.append(render_table_html(table_lines))
                        table_lines = []
                        in_table = False
                    formatted_lines.append(line)
            if in_table:
                formatted_lines.append(render_table_html(table_lines))
            return "\n".join(formatted_lines)

        def render_table_html(tbl_lines: list) -> str:
            if len(tbl_lines) < 2:
                return "\n".join(tbl_lines)
            header_cols = [c.strip() for c in tbl_lines[0].strip("|").split("|")]
            rows = []
            for r in tbl_lines[2:]:
                if "|" in r:
                    cols = [c.strip() for c in r.strip("|").split("|")]
                    rows.append(cols)

            th_html = "".join(f'<th class="px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 text-center">{c}</th>' for c in header_cols)
            tr_html = ""
            for r in rows:
                tds = "".join(f'<td class="px-3 py-2 text-xs text-slate-600 border border-slate-200 text-center">{c}</td>' for c in r)
                tr_html += f"<tr>{tds}</tr>"

            return f'<div class="my-3 overflow-x-auto"><table class="min-w-full border-collapse border border-slate-200 rounded-lg overflow-hidden"><thead><tr>{th_html}</tr></thead><tbody>{tr_html}</tbody></table></div>'

        # Replace image markdown
        stem_formatted = re.sub(r"!\[([^\]]*)\]\((storage://question-media/[^)]+)\)", replace_storage_img, stem)
        stem_formatted = format_markdown_tables(stem_formatted)

        # Options HTML
        opts_html = ""
        if opts:
            opts_html = '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-4">'
            for o in opts:
                key = o["key"].upper()
                otext = o["text"]
                opts_html += f"""
                <div class="flex items-center gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-white transition-all text-sm font-medium text-slate-800">
                    <span class="w-6 h-6 rounded-full border border-slate-300 bg-white flex items-center justify-center text-xs font-bold text-slate-700 shrink-0 shadow-2xs">
                        {key}
                    </span>
                    <span class="math-content">{otext}</span>
                </div>
                """
            opts_html += "</div>"

        # Subparts HTML
        subparts_html = ""
        if subparts:
            subparts_html = '<div class="space-y-2 mt-3 pt-3 border-t border-slate-100">'
            for sp in subparts:
                slabel = sp.get("label", "").upper()
                stext = sp.get("text", "")
                subparts_html += f"""
                <div class="flex items-start gap-2.5 p-2 rounded-lg bg-slate-50 border border-slate-100 text-xs text-slate-700">
                    <span class="font-bold text-indigo-600">({slabel})</span>
                    <span class="math-content flex-1">{stext}</span>
                </div>
                """
            subparts_html += "</div>"

        card = f"""
        <div id="q{q_num}" class="question-card bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 mb-6 transition-all">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-3 pb-3 border-b border-slate-100">
                <div class="flex items-center gap-2">
                    <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {sec}
                    </span>
                    <span class="text-base font-extrabold text-slate-900">
                        Question {q_num}
                    </span>
                    <span class="text-xs font-mono text-slate-400">
                        ({cid})
                    </span>
                </div>
                <div class="flex items-center gap-2">
                    <span class="px-2 py-0.5 rounded-md text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                        {qtype}
                    </span>
                    <span class="px-2 py-0.5 rounded-md text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200">
                        {marks} { 'Mark' if marks == 1 else 'Marks' }
                    </span>
                </div>
            </div>

            <div class="stem-content text-slate-900 text-sm sm:text-base font-medium leading-relaxed math-content">
                {stem_formatted}
            </div>

            {opts_html}
            {subparts_html}
        </div>
        """
        html_cards.append(card)

    all_cards_html = "\n".join(html_cards)

    full_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AuraMentor — Student View Preview (38 Reconstructed Questions)</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css">
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/contrib/auto-render.min.js"
        onload="renderMathInElement(document.body, {{
            delimiters: [
                {{left: '$$', right: '$$', display: true}},
                {{left: '$', right: '$', display: false}},
                {{left: '\\\\(', right: '\\\\)', display: false}},
                {{left: '\\\\[', right: '\\\\]', display: true}}
            ],
            throwOnError: false
        }});"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body {{
            background-color: #F8FAFC;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }}
        .katex {{ font-size: 1.05em; }}
        .question-card {{ break-inside: avoid; }}
    </style>
</head>
<body class="p-6 md:p-12 max-w-4xl mx-auto">
    <header class="mb-8 pb-4 border-b border-slate-200">
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-black text-slate-900 tracking-tight">AuraMentor Student Question View</h1>
                <p class="text-xs text-slate-500 mt-1">Class 10 Mathematics Half Portions - 1 • 38 Reconstructed Candidates • Architecture B</p>
            </div>
            <div class="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold">
                ✓ All 38 Reconstructed Candidates
            </div>
        </div>
    </header>

    <main id="questions-container">
        {all_cards_html}
    </main>
</body>
</html>
"""

    html_file = output_dir / "student_preview.html"
    with open(html_file, "w", encoding="utf-8") as f:
        f.write(full_html)
    print(f"[SUCCESS] Generated {html_file}")

    # Capture screenshots of representative questions (Q1, Q5, Q12, Q25, Q31, Q38)
    chrome_binary = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    representative_questions = [1, 5, 12, 25, 31, 38]

    # For each representative question, create a focused snippet HTML to get clean, isolated cards
    for q_idx in representative_questions:
        cand = candidates[q_idx - 1]
        card_html = html_cards[q_idx - 1]
        snippet_html = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css">
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.js"></script>
    <script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/contrib/auto-render.min.js"
        onload="renderMathInElement(document.body, {{
            delimiters: [
                {{left: '$$', right: '$$', display: true}},
                {{left: '$', right: '$', display: false}},
                {{left: '\\\\(', right: '\\\\)', display: false}},
                {{left: '\\\\[', right: '\\\\]', display: true}}
            ],
            throwOnError: false
        }});"></script>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body {{ background-color: #F8FAFC; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }}
        .katex {{ font-size: 1.05em; }}
    </style>
</head>
<body class="max-w-2xl mx-auto">
    {card_html}
</body>
</html>"""
        snippet_file = output_dir / f"snippet_q{q_idx}.html"
        with open(snippet_file, "w", encoding="utf-8") as f:
            f.write(snippet_html)

        shot_path = screenshots_dir / f"student_view_q{q_idx}.png"
        cmd = [
            chrome_binary,
            "--headless",
            "--no-sandbox",
            "--disable-gpu",
            "--user-data-dir=/tmp/chrome_user_data",
            f"--screenshot={shot_path}",
            "--window-size=900,650",
            f"file://{snippet_file.resolve()}",
        ]
        try:
            res_code = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
            if shot_path.exists():
                print(f"[SCREENSHOT] Generated {shot_path.name} ({shot_path.stat().st_size / 1024:.1f} KB)")
            else:
                print(f"[WARN] Failed to capture screenshot for Q{q_idx}: {res_code.stderr.decode('utf-8')[:150]}")
        except Exception as e:
            print(f"[ERROR] Exception taking screenshot for Q{q_idx}: {e}")


if __name__ == "__main__":
    build_student_preview()

