#!/usr/bin/env python3
"""
AuraMentor - Digital Mathematics PDF Extraction Engine (Phase 2A - v2)
High-accuracy deterministic extraction of mathematics questions, options, subparts,
solutions, and formulas from digital PDFs. Features 2D spatial layout reconstruction,
multi-column reading order, faux-bold deduplication, instruction separation,
and mathematical notation preservation.
"""

import sys
import os
import re
import json
import subprocess
import unicodedata
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple

try:
    from scripts.ingestion.diagram_extractor import (
        detect_pdf_diagram_boxes,
        render_diagram_assets,
        associate_diagrams_with_candidates,
        generate_diagram_contact_sheet,
    )
    from scripts.ingestion.math_engine import (
        UniversalMathEngine,
        DocumentClassifier,
        MathCategory,
        QualityStatus,
    )
except ImportError:
    from diagram_extractor import (
        detect_pdf_diagram_boxes,
        render_diagram_assets,
        associate_diagrams_with_candidates,
        generate_diagram_contact_sheet,
    )
    from math_engine import (
        UniversalMathEngine,
        DocumentClassifier,
        MathCategory,
        QualityStatus,
    )


# ============================================================================
# 1. 2D Layout-Aware Multi-Backend Page Text Extractor
# ============================================================================

class TextItem:
    def __init__(self, text: str, x: float, y: float, w: float, h: float):
        self.text = text
        self.x = x
        self.y = y
        self.w = w
        self.h = h


class PageContent:
    def __init__(self, page_number: int, text: str, width: float = 612.0, height: float = 792.0):
        self.page_number = page_number
        self.text = text
        self.width = width
        self.height = height
        self.char_count = len(text.strip())
        self.is_digital = self.char_count >= 20
        self.warnings: List[str] = []
        if not self.is_digital:
            self.warnings.append("SCANNED_OR_EMPTY_PAGE: Page contains fewer than 20 characters of extractable digital text.")


def deduplicate_and_sort_items(items: List[TextItem]) -> List[str]:
    """
    Deduplicates faux-bold shadow prints and groups text items into reading order lines.
    Handles exact duplicates, spatial shifts, and substrings on the same baseline.
    """
    if not items:
        return []

    # 1. Deduplicate shadow redraws and substring overlaps on the same baseline
    deduped: List[TextItem] = []
    for item in items:
        replaced = False
        is_dup = False
        for i, prev in enumerate(deduped):
            if abs(item.y - prev.y) <= 2.0:
                # Exact duplicate or tiny shift
                if item.text == prev.text and abs(item.x - prev.x) <= 4.0:
                    is_dup = True
                    break
                # item is substring of prev (e.g. earlier item was the full line)
                if item.text in prev.text:
                    is_dup = True
                    break
                # prev is substring of item (e.g. earlier item was an incomplete fragment) -> replace prev with item!
                if prev.text in item.text:
                    deduped[i] = item
                    replaced = True
                    break
        if not is_dup and not replaced:
            deduped.append(item)

    # 2. Sort by Y descending (top to bottom), X ascending (left to right)
    deduped.sort(key=lambda it: (-it.y, it.x))

    # 3. Group fragments into visual lines
    lines: List[str] = []
    current_band: List[TextItem] = []
    current_y: Optional[float] = None

    for item in deduped:
        if current_y is None or abs(item.y - current_y) > 3.0:
            if current_band:
                current_band.sort(key=lambda b: b.x)
                lines.append(" ".join(b.text for b in current_band))
            current_band = [item]
            current_y = item.y
        else:
            current_band.append(item)

    if current_band:
        current_band.sort(key=lambda b: b.x)
        lines.append(" ".join(b.text for b in current_band))

    return lines


def extract_pages_pdfkit_mac(pdf_path: str) -> Optional[List[PageContent]]:
    """
    Uses macOS built-in PDFKit via JavaScript for Automation (JXA).
    Extracts 2D positioned line bounding boxes and reconstructs 2-column or 1-column layout.
    """
    abs_path = os.path.abspath(pdf_path)
    jxa_script = f"""
    ObjC.import('PDFKit');
    ObjC.import('Foundation');

    var url = $.NSURL.fileURLWithPath('{abs_path}');
    var pdfDoc = $.PDFDocument.alloc.initWithURL(url);
    if (!pdfDoc || pdfDoc.isNil()) {{
        JSON.stringify({{ error: "Failed to open PDF" }});
    }} else {{
        var count = pdfDoc.pageCount;
        var pages = [];
        for (var p = 0; p < count; p++) {{
            var page = pdfDoc.pageAtIndex(p);
            var bounds = page.boundsForBox($.kPDFDisplayBoxMediaBox);
            var w = bounds.size.width;
            var h = bounds.size.height;
            var sel = page.selectionForRect(bounds);
            var lineSelections = sel.selectionsByLine;
            var items = [];
            for (var i = 0; i < lineSelections.count; i++) {{
                var l = lineSelections.objectAtIndex(i);
                var b = l.boundsForPage(page);
                var t = l.string.js.trim();
                if (t.length > 0) {{
                    items.push({{
                        text: t,
                        x: b.origin.x,
                        y: b.origin.y,
                        w: b.size.width,
                        h: b.size.height
                    }});
                }}
            }}
            pages.push({{
                page_number: p + 1,
                width: w,
                height: h,
                items: items
            }});
        }}
        JSON.stringify({{ pages: pages }});
    }}
    """
    try:
        proc = subprocess.run(
            ["osascript", "-l", "JavaScript", "-e", jxa_script],
            capture_output=True,
            text=True,
            timeout=30,
            check=True
        )
        data = json.loads(proc.stdout.strip())
        if "pages" not in data:
            return None

        result_pages: List[PageContent] = []
        for pdata in data["pages"]:
            pnum = pdata["page_number"]
            pw = pdata.get("width", 612.0)
            ph = pdata.get("height", 792.0)
            items = [TextItem(it["text"], it["x"], it["y"], it["w"], it["h"]) for it in pdata["items"]]

            # Check if this page has a 2-column layout:
            # Detect whether there is substantial text on both left (x < 0.48 * pw) and right (x > 0.48 * pw)
            split_x = pw * 0.48
            left_items = [it for it in items if it.x < split_x]
            right_items = [it for it in items if it.x >= split_x]

            # If both columns have significant content (e.g. > 4 items), process column-by-column
            is_two_column = len(left_items) >= 4 and len(right_items) >= 4

            if is_two_column:
                left_lines = deduplicate_and_sort_items(left_items)
                right_lines = deduplicate_and_sort_items(right_items)
                page_lines = left_lines + right_lines
            else:
                page_lines = deduplicate_and_sort_items(items)

            page_text = "\n".join(page_lines)
            # Apply Unicode NFKC normalization
            norm_text = unicodedata.normalize("NFKC", page_text)
            result_pages.append(PageContent(page_number=pnum, text=norm_text, width=pw, height=ph))

        return result_pages
    except Exception:
        return None


def extract_pages_pymupdf(pdf_path: str) -> Optional[List[PageContent]]:
    """Tries extraction using PyMuPDF (fitz) with block coordinate ordering if installed."""
    try:
        import fitz  # type: ignore
        doc = fitz.open(pdf_path)
        pages: List[PageContent] = []
        for i, page in enumerate(doc):
            rect = page.rect
            pw, ph = rect.width, rect.height
            blocks = page.get_text("blocks")  # (x0, y0, x1, y1, text, block_no, block_type)
            text_blocks = [b for b in blocks if b[6] == 0 and b[4].strip()]

            split_x = pw * 0.48
            left_blocks = [b for b in text_blocks if b[0] < split_x]
            right_blocks = [b for b in text_blocks if b[0] >= split_x]
            is_two_column = len(left_blocks) >= 2 and len(right_blocks) >= 2

            lines = []
            if is_two_column:
                left_blocks.sort(key=lambda b: (b[1], b[0]))
                right_blocks.sort(key=lambda b: (b[1], b[0]))
                for b in left_blocks + right_blocks:
                    for l in b[4].split("\n"):
                        if l.strip():
                            lines.append(l.strip())
            else:
                text_blocks.sort(key=lambda b: (b[1], b[0]))
                for b in text_blocks:
                    for l in b[4].split("\n"):
                        if l.strip():
                            lines.append(l.strip())

            page_text = unicodedata.normalize("NFKC", "\n".join(lines))
            pages.append(PageContent(page_number=i + 1, text=page_text, width=pw, height=ph))
        doc.close()
        return pages
    except Exception:
        return None


def extract_pages_stream_fallback(pdf_path: str) -> List[PageContent]:
    """Pure Python fallback for basic text streams."""
    with open(pdf_path, "rb") as f:
        data = f.read()

    streams = re.findall(rb'stream[\r\n]+(.*?)[\r\n]+endstream', data, re.DOTALL)
    pages = []
    page_idx = 1
    for s in streams:
        tj_matches = re.findall(rb'\((.*?)\)\s*Tj', s)
        if tj_matches:
            lines = []
            for b in tj_matches:
                try:
                    lines.append(b.decode('latin1'))
                except Exception:
                    pass
            page_text = unicodedata.normalize("NFKC", "\n".join(lines))
            pages.append(PageContent(page_number=page_idx, text=page_text))
            page_idx += 1

    if not pages:
        pages.append(PageContent(page_number=1, text=""))
    return pages


def extract_pdf_pages(pdf_path: str) -> Tuple[List[PageContent], str]:
    """Executes the best available 2D extraction backend."""
    # 1. Try macOS PDFKit with 2D bounds reconstruction
    res = extract_pages_pdfkit_mac(pdf_path)
    if res is not None:
        return res, "MacPDFKit2D"

    # 2. Try PyMuPDF with block coordinate sorting
    res = extract_pages_pymupdf(pdf_path)
    if res is not None:
        return res, "PyMuPDF2D"

    # 3. Fallback
    return extract_pages_stream_fallback(pdf_path), "PdfStreamFallback"


# ============================================================================
# 2. Question Boundary, Instruction Separator & Segmenter
# ============================================================================

QUESTION_START_PATTERN = re.compile(
    r'^(?:Q(?:uestion)?\.?\s*\d+[a-z]?\b[:.\-]?|\d+\.(?!\d)\s*)',
    re.IGNORECASE
)
CASE_STUDY_PATTERN = re.compile(
    r'^(?:Case\s+Study|Case\s+Based\s+Question)\s*(\d+)?[:.\-]?',
    re.IGNORECASE
)
SECTION_PATTERN = re.compile(
    r'^\s*(?:Section\s+)*(?:Section\s*(?:–|-)?\s*)([A-E])\b(?:\s*(?:&|and)\s*[A-E]\b)?(?:\s*[:–\-\(\[]|\s*$|\s+(?:Multiple|Very|Short|Long|Case|Subjective|\d+\s*marks))',
    re.IGNORECASE
)
SECTION_BOILERPLATE_PATTERN = re.compile(
    r'^(?:This\s+section\s+has|\d+\s*[xX]\s*\d+\s*=|\bAll\s+Questions\s+are\s+compulsory|\d+\s*marks?\s*each|carrying\s+\d+\s*marks?\s*each|each\.\s*\d+\s*[xX]\s*\d+)',
    re.IGNORECASE
)

# MCQ Option Patterns (handles A/B/C/D, a/b/c/d, with paren or period)
OPTION_LINE_START_PATTERN = re.compile(
    r'^\s*(?:\(([a-d])\)|([a-d])[\.)])\s+(.+)$',
    re.IGNORECASE
)
OPTION_HORIZONTAL_PATTERN = re.compile(
    r'(?:\(([a-d])\)|([a-d])[\.)])\s*([^(\n]*?)(?=(?:\([a-d]\)|[a-d][\.)])|$)',
    re.IGNORECASE
)

# Subparts Patterns
SUBPART_LINE_PATTERN = re.compile(
    r'^\s*\((i|ii|iii|iv|v|vi|vii|viii|ix|x)\)\s+(.+)$',
    re.IGNORECASE
)
SUBPART_ALPHA_PATTERN = re.compile(
    r'^\s*(?:\(([a-d])\)|([a-d])\))\s*(.+)$',
    re.IGNORECASE
)

# Answer & Solution Patterns
ANSWER_START_PATTERN = re.compile(r'^(?:Ans(?:wer)?\.?|Correct\s+Option)\b\s*[:.\-]?\s*(.*)$', re.IGNORECASE)
SOLUTION_START_PATTERN = re.compile(r'^(?:Solution|Sol|Explanation|Proof)\b\s*[:.\-]?\s*(.*)$', re.IGNORECASE)


# Assertion-Reason Directions Pattern
ASSERTION_REASON_DIRECTION_START = re.compile(
    r'^(?:Two\s+statements\s+are\s+given\b|Direction(?:s)?\s*(?:for\s+Q(?:uestions?)?|\b|:)|In\s+question\s+numbers?\s+\d+.*Assertion|Assertion\s*[-–]\s*Reason\s*(?:based\s+questions)?)',
    re.IGNORECASE
)

# Actual extraction failure codes (distinguished from missing optional answers)
ACTUAL_EXTRACTION_FAILURE_CODES = (
    "SUSPECTED_MERGED_QUESTIONS",
    "NO_OPTIONS_DETECTED",
    "INCOMPLETE_MCQ_OPTIONS_COUNT",
    "INCORRECT_OPTIONS_ASSOCIATION",
    "MISSING_MATHEMATICAL_CONTENT",
    "AMBIGUOUS_QUESTION_BOUNDARY",
    "UNBALANCED_BRACKETS_OR_DELIMITERS",
)


class RawQuestionBlock:
    def __init__(
        self,
        page_number: int,
        label: str,
        raw_lines: List[str],
        section: Optional[str] = None,
        shared_options: Optional[List[Dict[str, str]]] = None,
    ):
        self.page_number = page_number
        self.label = label
        self.raw_lines = raw_lines
        self.section = section
        self.shared_options = shared_options or []


def segment_text_into_question_blocks(pages: List[PageContent]) -> Tuple[List[RawQuestionBlock], List[str]]:
    """
    Separates general instructions from real questions and segments consecutive numbered questions.
    Isolates section directions (e.g. Assertion-Reason instructions) to prevent option bleed into prior questions.
    """
    blocks: List[RawQuestionBlock] = []
    instructions: List[str] = []

    in_instructions = False
    in_questions = True
    current_section: Optional[str] = None

    current_label: Optional[str] = None
    current_lines: List[str] = []
    current_page = 1
    current_block_section: Optional[str] = None

    in_direction_block = False
    direction_lines: List[str] = []
    active_shared_options: List[Dict[str, str]] = []

    for page in pages:
        lines = page.text.split("\n")

        for line in lines:
            trimmed = line.strip()
            if not trimmed:
                continue

            # Check for General Instructions header
            if re.match(r'^General\s+Instructions\b', trimmed, re.IGNORECASE):
                in_instructions = True
                in_questions = False
                continue

            # Check for Section header (e.g. Section A, Section – B)
            sec_match = SECTION_PATTERN.match(trimmed)
            if sec_match:
                in_instructions = False
                in_questions = True
                current_section = f"SECTION {sec_match.group(1).upper()}"
                continue

            # If inside general instructions block, capture instructions and DO NOT create questions
            if in_instructions:
                instructions.append(trimmed)
                continue

            # Filter out section boilerplate lines (e.g. "This section has 20 MCQs...", "20 X 1 = 20", "5 marks each.")
            if SECTION_BOILERPLATE_PATTERN.match(trimmed):
                continue

            # Check for Assertion-Reason direction block start (e.g. "Two statements are given...")
            if ASSERTION_REASON_DIRECTION_START.match(trimmed):
                if current_label and current_lines:
                    blocks.append(RawQuestionBlock(
                        page_number=current_page,
                        label=current_label,
                        raw_lines=current_lines,
                        section=current_block_section,
                        shared_options=active_shared_options
                    ))
                    current_label = None
                    current_lines = []
                in_direction_block = True
                direction_lines = [trimmed]
                continue

            # Check for question boundary
            is_start = False
            matched_label = ""

            m_q = QUESTION_START_PATTERN.match(trimmed)
            m_case = CASE_STUDY_PATTERN.match(trimmed)

            if in_direction_block and (m_q or m_case):
                # Parse shared options from direction lines
                opts: List[Dict[str, str]] = []
                for dl in direction_lines:
                    mo = OPTION_LINE_START_PATTERN.match(dl.strip())
                    if mo:
                        k = (mo.group(1) or mo.group(2)).upper()
                        t = mo.group(3).strip()
                        opts.append({"key": k, "text": t})
                if opts:
                    active_shared_options = opts
                instructions.extend(direction_lines)
                in_direction_block = False
                direction_lines = []

            if in_direction_block:
                direction_lines.append(trimmed)
                continue

            if m_q and in_questions:
                matched_label = m_q.group(0).strip()
                if matched_label.endswith(":") or matched_label.endswith("-"):
                    matched_label = matched_label.rstrip(":- ").strip()
                is_start = True
            elif m_case:
                matched_label = m_case.group(0).strip()
                is_start = True

            if is_start:
                if current_label and current_lines:
                    blocks.append(RawQuestionBlock(
                        page_number=current_page,
                        label=current_label,
                        raw_lines=current_lines,
                        section=current_block_section,
                        shared_options=active_shared_options
                    ))
                current_label = matched_label
                current_lines = [line]
                current_page = page.page_number
                current_block_section = current_section
            else:
                if current_label is not None:
                    current_lines.append(line)

    if in_direction_block and direction_lines:
        instructions.extend(direction_lines)

    if current_label and current_lines:
        blocks.append(RawQuestionBlock(
            page_number=current_page,
            label=current_label,
            raw_lines=current_lines,
            section=current_block_section,
            shared_options=active_shared_options
        ))

    return blocks, instructions


# ============================================================================
# 3. Question Candidate Parser & Mathematical Preserver
# ============================================================================

def extract_inline_subparts(text: str) -> Tuple[str, List[Dict[str, str]]]:
    """
    Extracts inline subparts (a) ... (b) ... or (i) ... (ii) ... embedded within a paragraph,
    returning (stem, subparts).
    Guarantees that isolated prose variables like 'first term (a) and common difference (d)'
    are not falsely extracted as subparts by requiring sequential labels starting from (a) or (i).
    """
    # 1. Check alphabetic subparts (a) ... (b) ...
    pattern_alpha = re.compile(r'(?:^|[\.\?\!\n;]\s*|\s+)\(([a-d])\)\s+', re.IGNORECASE)
    matches_a = list(pattern_alpha.finditer(text))
    if len(matches_a) >= 2 and [m.group(1).lower() for m in matches_a] == [chr(ord('a') + i) for i in range(len(matches_a))]:
        stem = text[:matches_a[0].start()].strip()
        subparts = []
        for i, m in enumerate(matches_a):
            lbl = f"({m.group(1).lower()})"
            start_idx = m.end()
            end_idx = matches_a[i + 1].start() if i + 1 < len(matches_a) else len(text)
            subparts.append({"label": lbl, "text": text[start_idx:end_idx].strip()})
        return stem, subparts

    # 2. Check Roman subparts (i) ... (ii) ...
    pattern_roman = re.compile(r'(?:^|[\.\?\!\n;]\s*|\s+)\((i|ii|iii|iv|v|vi)\)\s+', re.IGNORECASE)
    matches_r = list(pattern_roman.finditer(text))
    expected_romans = ["i", "ii", "iii", "iv", "v", "vi"]
    if len(matches_r) >= 2 and [m.group(1).lower() for m in matches_r] == expected_romans[:len(matches_r)]:
        stem = text[:matches_r[0].start()].strip()
        subparts = []
        for i, m in enumerate(matches_r):
            lbl = f"({m.group(1).lower()})"
            start_idx = m.end()
            end_idx = matches_r[i + 1].start() if i + 1 < len(matches_r) else len(text)
            subparts.append({"label": lbl, "text": text[start_idx:end_idx].strip()})
        return stem, subparts

    return text, []


def extract_heading_and_stem(text: str, label: str = "") -> Tuple[Optional[str], str]:
    """
    Separates question heading/title from the actual question statement.
    Recognizes Assertion-Reason headers, colon-separated titles, and multi-line titles.
    """
    # 1. Assertion-Reason questions
    if "assertion" in text.lower() and "reason" in text.lower():
        return "Assertion - Reason", text

    # 2. Colon-separated title (e.g. '100 Metres Race : The 100 metres is...')
    m_col = re.match(r'^([A-Z0-9][A-Za-z0-9\s–\-]{2,35})\s*:\s*(.+)$', text, re.DOTALL)
    if m_col:
        potential_title = m_col.group(1).strip()
        if not re.search(r'\b(?:find|prove|solve|calculate|evaluate|show|that|if|then|where|case)\b', potential_title, re.IGNORECASE):
            return potential_title, m_col.group(2).strip()

    # 3. Two-line title in Case Study (e.g. Solar Power Project \n A school decided...)
    lines = text.split("\n")
    if len(lines) >= 2 and len(lines[0].strip()) <= 35:
        first_line = lines[0].strip()
        if re.match(r'^[A-Z][A-Za-z0-9\s–\-]+$', first_line) and not first_line.endswith((".", "?", "!", ";")):
            if not re.search(r'\b(?:find|prove|solve|calculate|evaluate|show|that|if|then|where|is|are|was|were)\b', first_line, re.IGNORECASE):
                return first_line, "\n".join(lines[1:]).strip()

    return None, text


class QuestionCandidate:
    def __init__(self):
        self.candidate_id: str = ""
        self.source_filename: str = ""
        self.source_page_number: int = 1
        self.detected_question_label: str = ""
        self.section: Optional[str] = None
        self.question_heading: Optional[str] = None
        self.inferred_type: str = "SUBJECTIVE"
        self.candidate_question_text: str = ""
        self.detected_options: List[Dict[str, str]] = []
        self.detected_subparts: List[Dict[str, str]] = []
        self.detected_answer: Optional[str] = None
        self.detected_solution: Optional[str] = None
        self.detected_diagrams: List[Dict[str, Any]] = []
        self.original_extracted_text: str = ""
        self.extraction_warnings: List[str] = []
        self.extraction_confidence: float = 1.0
        self.detected_math_expressions: List[Dict[str, Any]] = []
        self.quality_scoring: Optional[Dict[str, Any]] = None
        self.review_status_recommendation: str = "NEEDS_REVIEW"

    def has_extraction_failures(self) -> bool:
        """Distinguishes actual structural extraction defects from missing optional answers."""
        return any(any(w.startswith(code) for code in ACTUAL_EXTRACTION_FAILURE_CODES) for w in self.extraction_warnings)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "candidate_id": self.candidate_id,
            "source_filename": self.source_filename,
            "source_page_number": self.source_page_number,
            "detected_question_label": self.detected_question_label,
            "section": self.section,
            "question_heading": self.question_heading,
            "inferred_type": self.inferred_type,
            "candidate_question_text": self.candidate_question_text,
            "detected_options": self.detected_options,
            "detected_subparts": self.detected_subparts,
            "detected_answer": self.detected_answer,
            "detected_solution": self.detected_solution,
            "detected_diagrams": self.detected_diagrams,
            "original_extracted_text": self.original_extracted_text,
            "extraction_warnings": self.extraction_warnings,
            "has_extraction_failures": self.has_extraction_failures(),
            "extraction_confidence": self.extraction_confidence,
            "detected_math_expressions": self.detected_math_expressions,
            "quality_scoring": self.quality_scoring,
            "review_status_recommendation": self.review_status_recommendation,
        }

    def __getitem__(self, item: str) -> Any:
        return self.to_dict()[item]


def parse_question_block(block: RawQuestionBlock, filename: str, idx: int) -> QuestionCandidate:
    candidate = QuestionCandidate()
    candidate.candidate_id = f"cand-p{block.page_number}-q{idx + 1}"
    candidate.source_filename = filename
    candidate.source_page_number = block.page_number
    candidate.detected_question_label = block.label
    candidate.section = block.section
    candidate.original_extracted_text = "\n".join(block.raw_lines).strip()

    statement_lines: List[str] = []
    options: List[Dict[str, str]] = []
    subparts: List[Dict[str, str]] = []
    answers: List[str] = []
    solutions: List[str] = []

    mode = "STATEMENT"
    is_mcq_section = (block.section == "SECTION A")
    is_case_study = "case" in (block.label or "").lower() or (block.section and "SECTION E" in block.section)

    raw_lines = list(block.raw_lines)
    if raw_lines and block.label:
        first_line = raw_lines[0].strip()
        cleaned_first = re.sub(r'^(?:' + re.escape(block.label) + r'\s*)', '', first_line).strip()
        if cleaned_first:
            raw_lines[0] = cleaned_first
        else:
            raw_lines = raw_lines[1:]

    for line in raw_lines:
        trimmed = line.strip()
        if not trimmed:
            continue

        # Check for Answer key
        ans_match = ANSWER_START_PATTERN.match(trimmed)
        if ans_match:
            mode = "ANSWER"
            ans_val = ans_match.group(1).strip()
            if ans_val:
                answers.append(ans_val)
            continue

        # Check for Solution section
        sol_match = SOLUTION_START_PATTERN.match(trimmed)
        if sol_match:
            mode = "SOLUTION"
            sol_val = sol_match.group(1).strip()
            if sol_val:
                solutions.append(sol_val)
            continue

        if mode == "ANSWER":
            answers.append(trimmed)
            continue
        elif mode == "SOLUTION":
            solutions.append(trimmed)
            continue

        # Under STATEMENT mode:

        # 1. Roman subpart: (i) ... or (ii) ... (Always subparts in all sections)
        sub_roman_match = SUBPART_LINE_PATTERN.match(trimmed)
        if sub_roman_match:
            subparts.append({
                "label": f"({sub_roman_match.group(1).lower()})",
                "text": sub_roman_match.group(2).strip()
            })
            continue

        # 2. MCQ options (exclusive to Section A or unsectioned papers with 4-option MCQs)
        if is_mcq_section or (block.section is None and not is_case_study):
            # 2a. Horizontal options on a single line: (a) ... (b) ... (c) ... (d)
            h_matches = OPTION_HORIZONTAL_PATTERN.findall(trimmed)
            if len(h_matches) >= 2:
                raw_pairs = [((m[0] or m[1]).upper(), m[2].strip()) for m in h_matches]
                deduped = []
                for k, t in raw_pairs:
                    if deduped and deduped[-1][0] == k:
                        if len(t) > len(deduped[-1][1]):
                            deduped[-1] = (k, t)
                    else:
                        deduped.append((k, t))
                keys = [p[0] for p in deduped]
                expected_keys = [chr(ord('A') + i) for i in range(len(keys))]
                if keys == expected_keys and len(keys) >= 2:
                    for k, t in deduped:
                        options.append({
                            "key": k,
                            "text": t
                        })
                    continue

            # 2b. Line-start single MCQ option: (A) ... or a) ...
            opt_line_match = OPTION_LINE_START_PATTERN.match(trimmed)
            if opt_line_match:
                opt_key = (opt_line_match.group(1) or opt_line_match.group(2)).upper()
                opt_text = opt_line_match.group(3).strip()
                options.append({
                    "key": opt_key,
                    "text": opt_text
                })
                continue
        else:
            # 3. Alphabetic subparts: (a) ... or a) ... in Subjective / Case Study sections
            sub_alpha_match = SUBPART_ALPHA_PATTERN.match(trimmed)
            if sub_alpha_match:
                subparts.append({
                    "label": f"({(sub_alpha_match.group(1) or sub_alpha_match.group(2)).lower()})",
                    "text": sub_alpha_match.group(3).strip()
                })
                continue

        # Standard statement line
        statement_lines.append(trimmed)

    # Clean statement text
    cleaned_statement = "\n".join(statement_lines).strip()
    if block.label:
        cleaned_statement = re.sub(r'^(?:' + re.escape(block.label) + r'\s*)', '', cleaned_statement).strip()

    # Assertion-Reason detection & shared options inheritance
    is_assertion_reason = bool(
        re.search(r'\bassertion\b', cleaned_statement, re.IGNORECASE) and
        re.search(r'\breason\b', cleaned_statement, re.IGNORECASE)
    )
    if is_assertion_reason:
        candidate.question_heading = "Assertion - Reason"
        if len(options) == 0 and block.shared_options:
            options = list(block.shared_options)

    # Separate question heading from stem for titled/case-study questions
    if not candidate.question_heading:
        heading, stem = extract_heading_and_stem(cleaned_statement, block.label)
        if heading:
            candidate.question_heading = heading
            cleaned_statement = stem

    # Extract inline subparts (e.g. (a) ... (b) ...) in subjective questions
    if not options:
        stem_no_subs, inline_subs = extract_inline_subparts(cleaned_statement)
        if inline_subs:
            subparts.extend(inline_subs)
            cleaned_statement = stem_no_subs

    candidate.candidate_question_text = cleaned_statement
    candidate.detected_options = options
    candidate.detected_subparts = subparts
    candidate.detected_answer = " ".join(answers).strip() if answers else None
    candidate.detected_solution = "\n".join(solutions).strip() if solutions else None

    # Inferred Question Type
    if is_case_study:
        candidate.inferred_type = "CASE_BASED"
    elif is_assertion_reason or is_mcq_section or options:
        candidate.inferred_type = "MCQ"
    else:
        candidate.inferred_type = "SUBJECTIVE"

    # Quality Warnings and Confidence Scoring
    confidence = 1.0
    warnings = []

    # Warning 1: Suspected Merged Questions
    internal_q_matches = re.findall(r'(?:^|\n)\s*(\d{1,2})\.(?!\d)\s+', candidate.candidate_question_text)
    if internal_q_matches:
        warnings.append(f"SUSPECTED_MERGED_QUESTIONS: Contains multiple question markers: {internal_q_matches}")
        confidence -= 0.40

    # Warning 2: Incomplete, Extra, or Missing MCQ Options
    if candidate.inferred_type == "MCQ":
        if len(options) == 0:
            warnings.append("NO_OPTIONS_DETECTED: Question in MCQ section has 0 extracted options.")
            confidence -= 0.45
        elif len(options) < 4:
            warnings.append(f"INCOMPLETE_MCQ_OPTIONS_COUNT: Extracted {len(options)} options instead of standard 4 options.")
            confidence -= 0.35
        elif len(options) > 4:
            warnings.append(f"INCORRECT_OPTIONS_ASSOCIATION: Extracted {len(options)} options (expected 4). Potential merged options or instruction bleed.")
            confidence -= 0.35
        elif any(not opt["text"].strip() for opt in options):
            warnings.append("MISSING_MATHEMATICAL_CONTENT: One or more MCQ options contain empty text (missing formulas or symbols).")
            confidence -= 0.25

    # Warning 3: Missing Mathematical Content / Dangling Equations
    if re.search(r'=\s*,|[\+\-\*\/]\s*,', candidate.candidate_question_text):
        warnings.append("MISSING_MATHEMATICAL_CONTENT: Statement contains incomplete equation or dangling operator before comma.")
        confidence -= 0.30

    # Warning 4: Ambiguous Question Boundary / Extremely Short Text
    if len(candidate.candidate_question_text) < 15 and not subparts:
        warnings.append("AMBIGUOUS_QUESTION_BOUNDARY: Question statement is unusually short or malformed.")
        confidence -= 0.30

    # Warning 5: Unbalanced Brackets or Delimiters
    open_parens = candidate.candidate_question_text.count("(")
    close_parens = candidate.candidate_question_text.count(")")
    open_curls = candidate.candidate_question_text.count("{")
    close_curls = candidate.candidate_question_text.count("}")
    if open_parens != close_parens or open_curls != close_curls:
        warnings.append("UNBALANCED_BRACKETS_OR_DELIMITERS: Potential unclosed mathematical delimiter in statement.")
        confidence -= 0.15

    # Warning 6: Missing Answer Key / Solution (Optional in question papers)
    if not candidate.detected_answer and not candidate.detected_solution:
        warnings.append("MISSING_ANSWER_KEY: No answer key or model solution detected in question block.")
        confidence -= 0.05

    # Universal Mathematical Recognition & KaTeX LaTeX Normalization
    math_engine = UniversalMathEngine()
    math_results = math_engine.process_candidate_mathematics(
        candidate_data={
            "candidate_question_text": candidate.candidate_question_text,
            "detected_options": candidate.detected_options,
            "detected_subparts": candidate.detected_subparts,
            "detected_answer": candidate.detected_answer,
            "detected_solution": candidate.detected_solution,
            "inferred_type": candidate.inferred_type,
        },
        page_number=candidate.source_page_number,
    )

    candidate.candidate_question_text = math_results["formatted_question_text"]
    candidate.detected_options = math_results["formatted_options"]
    candidate.detected_subparts = math_results["formatted_subparts"]
    if math_results["formatted_answer"]:
        candidate.detected_answer = math_results["formatted_answer"]
    if math_results["formatted_solution"]:
        candidate.detected_solution = math_results["formatted_solution"]

    candidate.detected_math_expressions = math_results["detected_math_expressions"]
    candidate.quality_scoring = math_results["quality_scoring"]
    candidate.review_status_recommendation = math_results["review_status_recommendation"]

    # Merge quality score warnings into extraction_warnings
    score_warnings = math_results["quality_scoring"].get("review_warnings", [])
    for sw in score_warnings:
        if sw not in warnings:
            warnings.append(sw)

    # Use combined multi-dimensional confidence
    candidate.extraction_confidence = min(round(confidence, 2), math_results["extraction_confidence"])
    candidate.extraction_warnings = warnings

    return candidate


# ============================================================================
# 4. Pipeline Engine & CLI Entrypoint
# ============================================================================

def process_pdf_document(pdf_path: str) -> Dict[str, Any]:
    """Processes a single PDF document and returns the structured extraction JSON."""
    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF file not found: {pdf_path}")

    filename = os.path.basename(pdf_path)
    pages, backend = extract_pdf_pages(pdf_path)

    # Segment and parse
    blocks, instructions = segment_text_into_question_blocks(pages)
    candidates = [parse_question_block(b, filename, idx) for idx, b in enumerate(blocks)]

    # Deduplicate any duplicate question candidates (e.g. if same question label repeats with identical text)
    unique_candidates: List[QuestionCandidate] = []
    seen_signatures = set()
    for c in candidates:
        sig = (c.detected_question_label, c.candidate_question_text[:50])
        if sig not in seen_signatures:
            seen_signatures.add(sig)
            unique_candidates.append(c)

    candidates = unique_candidates

    # Diagram detection, rendering, and candidate association (Phase 2A.4)
    stem = os.path.splitext(os.path.basename(pdf_path))[0]
    asset_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", stem)
    valid_diagrams, unassociated = detect_pdf_diagram_boxes(pdf_path)
    render_diagram_assets(pdf_path, valid_diagrams, asset_dir)
    associated_count, review_count = associate_diagrams_with_candidates(candidates, valid_diagrams, pdf_path)

    # Document and Page-by-Page Multi-Strategy Classification (Phase 2)
    page_classifications = [
        DocumentClassifier.classify_page(
            page_number=p.page_number,
            text=p.text,
            vector_count=0,
            image_count=sum(
                1 for d in valid_diagrams
                if (d.get("source_page_number") if isinstance(d, dict) else getattr(d, "source_page_number", 0)) == p.page_number
            ),
        )
        for p in pages
    ]
    doc_classification = DocumentClassifier.classify_document(page_classifications)
    ocr_disclosures = UniversalMathEngine().get_system_disclosures()

    # Summary statistics
    total_pages = len(pages)
    pages_with_digital_text = sum(1 for p in pages if p.is_digital)
    extraction_failures_count = sum(1 for c in candidates if c.has_extraction_failures())
    missing_optional_answers_count = sum(1 for c in candidates if not c.detected_answer and not c.detected_solution)
    high_conf = sum(1 for c in candidates if c.extraction_confidence >= 0.85)
    med_conf = sum(1 for c in candidates if 0.70 <= c.extraction_confidence < 0.85)
    low_conf = sum(1 for c in candidates if c.extraction_confidence < 0.70)

    output = {
        "metadata": {
            "source_filename": filename,
            "source_filepath": os.path.abspath(pdf_path),
            "extractor_backend": backend,
            "extracted_at": datetime.utcnow().isoformat() + "Z",
            "paper_instructions_count": len(instructions),
            "paper_instructions": instructions[:15],
            "document_type": doc_classification["document_type"],
            "recommended_pipeline": doc_classification["recommended_pipeline"],
            "ocr_disclosures": ocr_disclosures,
        },
        "summary": {
            "total_pages": total_pages,
            "pages_with_digital_text": pages_with_digital_text,
            "is_digitally_extractable": pages_with_digital_text > 0,
            "document_type": doc_classification["document_type"],
            "total_candidates": len(candidates),
            "flagged_candidates": extraction_failures_count,
            "extraction_failures_count": extraction_failures_count,
            "missing_optional_answers_count": missing_optional_answers_count,
            "confidence_breakdown": {
                "high_confidence_ge_85": high_conf,
                "medium_confidence_70_84": med_conf,
                "low_confidence_lt_70": low_conf,
            },
            "diagram_summary": {
                "total_diagrams_detected": len(valid_diagrams) + len(unassociated),
                "total_diagrams_extracted": len(valid_diagrams),
                "total_diagrams_associated": associated_count,
                "unassociated_diagrams": len(unassociated),
                "diagrams_requiring_manual_review": review_count,
            }
        },
        "pages": [
            {
                "page_number": p.page_number,
                "char_count": p.char_count,
                "is_digital": p.is_digital,
                "warnings": p.warnings,
            }
            for p in pages
        ],
        "candidates": [c.to_dict() for c in candidates],
        "unassociated_diagrams": unassociated
    }

    return output


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 pdf_extractor.py <path-to-pdf> [--output output.json] [--pretty]")
        sys.exit(1)

    pdf_path = sys.argv[1]
    out_file = None
    if "--output" in sys.argv:
        out_idx = sys.argv.index("--output")
        if out_idx + 1 < len(sys.argv):
            out_file = sys.argv[out_idx + 1]

    pretty = "--pretty" in sys.argv or out_file is None

    try:
        result = process_pdf_document(pdf_path)
    except Exception as e:
        print(f"Extraction failed: {e}", file=sys.stderr)
        sys.exit(1)

    formatted_json = json.dumps(result, indent=2 if pretty else None, ensure_ascii=False)

    if out_file:
        os.makedirs(os.path.dirname(os.path.abspath(out_file)), exist_ok=True)
        with open(out_file, "w", encoding="utf-8") as f:
            f.write(formatted_json)
        print(f"Extraction complete! Saved to {out_file}")
    else:
        print(formatted_json)

    summary = result["summary"]
    diag_summary = summary.get("diagram_summary", {})
    print("\n--- EXTRACTION SUMMARY ---", file=sys.stderr)
    print(f"Source Document       : {result['metadata']['source_filename']}", file=sys.stderr)
    print(f"Extractor Engine      : {result['metadata']['extractor_backend']}", file=sys.stderr)
    print(f"Instructions Filtered : {result['metadata']['paper_instructions_count']}", file=sys.stderr)
    print(f"Pages (Total/Digital) : {summary['total_pages']} / {summary['pages_with_digital_text']}", file=sys.stderr)
    print(f"Candidates Extracted  : {summary['total_candidates']}", file=sys.stderr)
    print(f"Extraction Failures   : {summary.get('extraction_failures_count', 0)}", file=sys.stderr)
    print(f"Missing Optional Ans  : {summary.get('missing_optional_answers_count', 0)}", file=sys.stderr)
    print(f"High Confidence (>=85): {summary['confidence_breakdown']['high_confidence_ge_85']}", file=sys.stderr)
    print(f"Medium Conf (70-84)   : {summary['confidence_breakdown']['medium_confidence_70_84']}", file=sys.stderr)
    print(f"Low Confidence (<70)  : {summary['confidence_breakdown']['low_confidence_lt_70']}", file=sys.stderr)
    if diag_summary:
        print(f"Diagrams Detected     : {diag_summary.get('total_diagrams_detected', 0)}", file=sys.stderr)
        print(f"Diagrams Extracted    : {diag_summary.get('total_diagrams_extracted', 0)}", file=sys.stderr)
        print(f"Diagrams Associated   : {diag_summary.get('total_diagrams_associated', 0)}", file=sys.stderr)
        print(f"Unassociated Assets   : {diag_summary.get('unassociated_diagrams', 0)}", file=sys.stderr)
    print("--------------------------\n", file=sys.stderr)


if __name__ == "__main__":
    main()
