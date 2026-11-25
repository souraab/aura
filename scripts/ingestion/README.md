# AuraMentor — Digital Mathematics PDF Extraction Engine (Phase 2A)

A deterministic, offline extraction engine designed to parse Class 10 mathematics examination papers and textbook question banks from digital PDFs into structured JSON candidates.

---

## 1. Features

- **Multi-Backend Text Extraction**:
  - Automatically uses **PyMuPDF (`fitz`)** if available in the environment.
  - Seamlessly falls back to **macOS Native PDFKit** (`osascript -l JavaScript`) with zero third-party dependencies.
  - Fallback to pure Python text stream extraction for uncompressed documents.
- **Digital Text & Page Detection**:
  - Detects extractable digital text per page.
  - Automatically flags scanned, image-only, or empty pages (`SCANNED_OR_EMPTY_PAGE`).
- **Configurable Question Boundary Detection**:
  - Recognizes standard Indian CBSE formats: `Q. 1`, `Q1.`, `Question 1.`, `1.`, `Exercise 1.2 Q. 3`, and `Case Study 1:`.
  - Tracks sections (`SECTION A`, `SECTION B`, `SECTION E`) to assist type inference.
- **Structural Component Extraction**:
  - **MCQ Options**: Handles vertical multi-line options, single-line horizontal options, and shared Assertion-Reason option blocks without option bleed.
  - **Question Headings**: Cleanly separates question headings (`Assertion - Reason`, Case Study titles like `100 Metres Race`, `Solar Power Project`) from the problem stem.
  - **Subparts**: Extracts both line-start Roman subparts `(i), (ii)` and inline alphabetic subparts `(a), (b)` (in multi-part subjective problems like Q18-Q20) without falsely treating mathematical variables in prose (such as `term (a)` and `common difference (d)`) as MCQ options.
  - **Answers & Solutions**: Parses `Ans:`, `Answer:`, `Solution:`, and `Explanation:`.
- **Mathematical Notation Preservation**:
  - Preserves mathematical expressions verbatim (`\sqrt{5}`, `x^2 - 5x + k`, `a/b`, `S_n`).
  - Does not silently alter or perform lossy substitutions on mathematical notation.
- **Mathematical Diagram Extraction & Association (Phase 2A.4)**:
  - Tracks PDF **Current Transformation Matrix (CTM)** across `q`, `Q`, `cm`, and `Do` operators to compute exact bounding boxes in PDF points.
  - Renders high-resolution cropped PNG assets at **retina 2.0x scale (144 DPI)** with calibrated safety margin (`pad = 0.5 pt`).
  - Automatically isolates and excludes Amrita header logos and horizontal formula banners (`HEADER_LOGO`, `FORMULA_OR_BANNER_STRIP`).
  - Natively supports multi-diagram internal choices (e.g. Q25 with circumscribed quadrilateral and circle quadrant).
  - Handles cross-page continuation diagrams (diagram appearing at top of next page before question options).
  - Generates interactive visual contact sheets (`assets/diagram_contact_sheet.html`).
- **Quality Warnings & Failure Categorization (Phase 2A.5)**:
  - Distinguishes **actual structural extraction failures** (`NO_OPTIONS_DETECTED`, `INCOMPLETE_MCQ_OPTIONS_COUNT`, `INCORRECT_OPTIONS_ASSOCIATION`, `SUSPECTED_MERGED_QUESTIONS`, `MISSING_MATHEMATICAL_CONTENT`) from **optional omission of answer keys** in exam question papers (`MISSING_ANSWER_KEY`).
  - Flags `has_extraction_failures: true` only on actionable extraction defects.
  - Calibrates confidence scores (`0.10` to `1.00`).
  - Scores every question candidate from `0.10` to `1.00`.
  - Assigns explicit warning codes (`MISSING_ANSWER_KEY`, `INCOMPLETE_MCQ_OPTIONS_COUNT`, `AMBIGUOUS_QUESTION_BOUNDARY`, `UNBALANCED_BRACKETS_OR_DELIMITERS`).

---

## 2. Requirements

- Python 3.8+
- Zero external package dependencies required on macOS (uses native `PDFKit`).
- Optionally: `pip install pymupdf` for Linux / cross-platform deployments.

---

## 3. Usage

### Generating the Sample Mathematics PDF
```bash
python3 scripts/ingestion/generate_sample_math_pdf.py scripts/ingestion/sample_math_paper.pdf
```

### Extracting Questions from a PDF
```bash
# Print pretty JSON to stdout with extraction summary:
python3 scripts/ingestion/pdf_extractor.py scripts/ingestion/sample_math_paper.pdf

# Save to an output file:
python3 scripts/ingestion/pdf_extractor.py path/to/document.pdf --output output.json --pretty
```

### Running the Unit Test Suite
```bash
python3 scripts/ingestion/test_extractor.py
```

---

## 4. JSON Output Schema

```json
{
  "metadata": {
    "source_filename": "sample_math_paper.pdf",
    "source_filepath": "/absolute/path/to/sample_math_paper.pdf",
    "extractor_backend": "MacPDFKit",
    "extracted_at": "2026-11-19T06:42:29Z"
  },
  "summary": {
    "total_pages": 3,
    "pages_with_digital_text": 3,
    "is_digitally_extractable": true,
    "total_candidates": 8,
    "flagged_candidates": 3,
    "confidence_breakdown": {
      "high_confidence_ge_85": 8,
      "medium_confidence_70_84": 0,
      "low_confidence_lt_70": 0
    },
    "diagram_summary": {
      "total_diagrams_detected": 14,
      "total_diagrams_extracted": 9,
      "total_diagrams_associated": 9,
      "unassociated_diagrams": 5,
      "diagrams_requiring_manual_review": 0
    }
  },
  "pages": [
    {
      "page_number": 1,
      "char_count": 671,
      "is_digital": true,
      "warnings": []
    }
  ],
  "candidates": [
    {
      "candidate_id": "cand-p1-q1",
      "source_filename": "sample_math_paper.pdf",
      "source_page_number": 1,
      "detected_question_label": "Q. 1",
      "section": "SECTION A",
      "question_heading": null,
      "inferred_type": "MCQ",
      "candidate_question_text": "The HCF of 96 and 404 is:",
      "detected_options": [
        { "key": "A", "text": "2" },
        { "key": "B", "text": "4" },
        { "key": "C", "text": "6" },
        { "key": "D", "text": "8" }
      ],
      "detected_subparts": [],
      "detected_answer": "(B) 4",
      "detected_solution": null,
      "detected_diagrams": [
        {
          "diagram_id": "diag-p1-1",
          "source_page_number": 1,
          "image_path": "assets/test_source/diag-p1-1.png",
          "bounding_box": { "x0": 629.52, "y0": 412.92, "x1": 750.0, "y1": 459.84, "width": 120.48, "height": 46.92 },
          "diagram_type": "IMAGE",
          "association_confidence": 1.0,
          "extraction_warnings": []
        }
      ],
      "original_extracted_text": "Q. 1 The HCF of 96 and 404 is:\n(A) 2\n(B) 4\n(C) 6\n(D) 8\nAns: (B) 4",
      "extraction_warnings": [],
      "has_extraction_failures": false,
      "extraction_confidence": 1.0
    }
  ]
}
```

---

## 5. Integration with AuraMentor Data Model

The extracted candidates map directly to AuraMentor's existing `QuestionDetailRecord` and `saveQuestionToDatabase` interfaces:
- `candidate_question_text` $\rightarrow$ `question_text`
- `detected_options` $\rightarrow$ `options: QuestionOptionInput[]`
- `detected_answer` & `detected_solution` $\rightarrow$ `answer: QuestionAnswerData`
- `inferred_type` $\rightarrow$ `question_type: "MCQ" | "SUBJECTIVE" | "CASE_BASED"`
- `source_page_number` & `source_filename` $\rightarrow$ stored in `staging_questions` for provenance and human review.

