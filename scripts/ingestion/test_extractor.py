#!/usr/bin/env python3
"""
Unit test suite for AuraMentor Digital Mathematics PDF Extraction Engine (Phase 2A).
Validates digital text detection, boundary detection, math preservation, option parsing,
subparts, warnings, confidence scoring, and source-page attribution.
"""

import unittest
import os
import sys
import json

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from scripts.ingestion.pdf_extractor import (
    process_pdf_document,
    PageContent,
    segment_text_into_question_blocks,
    parse_question_block,
    RawQuestionBlock,
)
from scripts.ingestion.generate_sample_math_pdf import create_sample_cbse_math_pdf


class TestDigitalPdfExtractor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_pdf = "scripts/ingestion/sample_math_paper.pdf"
        if not os.path.exists(cls.test_pdf):
            create_sample_cbse_math_pdf(cls.test_pdf)
        cls.extraction_result = process_pdf_document(cls.test_pdf)

    def test_digital_text_detection(self):
        """Verifies digital text detection on all pages."""
        summary = self.extraction_result["summary"]
        self.assertTrue(summary["is_digitally_extractable"])
        self.assertEqual(summary["total_pages"], 3)
        self.assertEqual(summary["pages_with_digital_text"], 3)

        # Test empty page flagging
        empty_page = PageContent(page_number=4, text="    \n  ")
        self.assertFalse(empty_page.is_digital)
        self.assertIn("SCANNED_OR_EMPTY_PAGE", empty_page.warnings[0])

    def test_source_page_attribution(self):
        """Every extracted candidate must have a valid 1-indexed source-page number."""
        candidates = self.extraction_result["candidates"]
        self.assertGreater(len(candidates), 0)
        for c in candidates:
            self.assertIn("source_page_number", c)
            self.assertIn(c["source_page_number"], [1, 2, 3])
            self.assertTrue(c["source_filename"].endswith(".pdf"))

    def test_vertical_and_horizontal_mcq_options(self):
        """Verifies parsing of both multi-line and single-line 4-option MCQs."""
        candidates = self.extraction_result["candidates"]
        q1 = next((c for c in candidates if c["detected_question_label"] == "Q. 1"), None)
        self.assertIsNotNone(q1)
        self.assertEqual(q1["inferred_type"], "MCQ")
        self.assertEqual(len(q1["detected_options"]), 4)
        self.assertEqual([o["key"] for o in q1["detected_options"]], ["A", "B", "C", "D"])
        self.assertEqual(q1["detected_options"][1]["text"], "4")
        self.assertEqual(q1["detected_answer"], "(B) 4")

        # Q2 is a single-line horizontal MCQ: (A) 6 (B) 12 (C) -6 (D) 4
        q2 = next((c for c in candidates if c["detected_question_label"] == "Q. 2"), None)
        self.assertIsNotNone(q2)
        self.assertEqual(q2["inferred_type"], "MCQ")
        self.assertEqual(len(q2["detected_options"]), 4)
        self.assertEqual([o["key"] for o in q2["detected_options"]], ["A", "B", "C", "D"])
        self.assertEqual(q2["detected_options"][0]["text"], "6")
        self.assertEqual(q2["detected_options"][2]["text"], "-6")
        self.assertEqual(q2["detected_answer"], "(A)")

    def test_mathematical_notation_preservation(self):
        """Mathematical expressions (radicals, exponents, fractions) must be preserved verbatim."""
        candidates = self.extraction_result["candidates"]
        q5 = next((c for c in candidates if c["detected_question_label"] == "Q. 5"), None)
        self.assertIsNotNone(q5)
        self.assertIn(r"\sqrt{5}", q5["candidate_question_text"])
        self.assertIsNotNone(q5["detected_solution"])
        self.assertIn(r"\sqrt{5}", q5["detected_solution"])
        self.assertIn("5b^2 = a^2", q5["detected_solution"])

        # Q4 radical and exponent preservation
        q4 = next((c for c in candidates if c["detected_question_label"] == "Q. 4"), None)
        self.assertIsNotNone(q4)
        self.assertEqual(q4["detected_options"][1]["text"], r"2\sqrt{7}")
        self.assertIn(r"\sqrt{(-6)^2 + 8^2}", q4["detected_solution"])

    def test_subpart_extraction_and_prose_distinction(self):
        """Verifies Roman subparts are extracted without falsely parsing prose variables like (a) or (d) as options."""
        candidates = self.extraction_result["candidates"]
        q6 = next((c for c in candidates if c["detected_question_label"] == "Q. 6"), None)
        self.assertIsNotNone(q6)
        self.assertEqual(q6["inferred_type"], "SUBJECTIVE")
        self.assertEqual(len(q6["detected_options"]), 0)  # Must NOT extract (a) and (d) as MCQ options
        self.assertEqual(len(q6["detected_subparts"]), 3)
        self.assertEqual(q6["detected_subparts"][0]["label"], "(i)")
        self.assertIn("first term (a) and common difference (d)", q6["detected_subparts"][0]["text"])
        self.assertEqual(q6["detected_subparts"][1]["label"], "(ii)")
        self.assertEqual(q6["detected_subparts"][2]["label"], "(iii)")

    def test_case_based_question_extraction(self):
        """Verifies Case Study parsing with passage statement, subparts, and stepwise solution."""
        candidates = self.extraction_result["candidates"]
        case1 = next((c for c in candidates if "Case Study" in c["detected_question_label"]), None)
        self.assertIsNotNone(case1)
        self.assertEqual(case1["inferred_type"], "CASE_BASED")
        self.assertEqual(case1["question_heading"], "Solar Power Project")
        self.assertIn("solar panels on its roof", case1["candidate_question_text"])
        self.assertEqual(len(case1["detected_subparts"]), 3)
        self.assertIsNotNone(case1["detected_solution"])
        self.assertIn("Common difference d = 5 - 3 = 2", case1["detected_solution"])
        self.assertEqual(case1["extraction_confidence"], 1.0)

    def test_uncertainty_flagging_and_warnings(self):
        """Uncertain boundaries or missing answer keys must produce explicit warning flags without inventing data."""
        candidates = self.extraction_result["candidates"]
        
        # Q3 has no answer key in text
        q3 = next((c for c in candidates if c["detected_question_label"] == "Q. 3"), None)
        self.assertIsNotNone(q3)
        self.assertIsNone(q3["detected_answer"])
        self.assertTrue(any("MISSING_ANSWER_KEY" in w for w in q3["extraction_warnings"]))
        self.assertLess(q3["extraction_confidence"], 1.0)

        # Malformed block test
        raw_block = RawQuestionBlock(
            page_number=9,
            label="9.",
            raw_lines=["9. Incomplete ("]
        )
        malformed = parse_question_block(raw_block, "test.pdf", 8)
        self.assertTrue(any("UNBALANCED_BRACKETS_OR_DELIMITERS" in w for w in malformed["extraction_warnings"]))
        self.assertTrue(any("AMBIGUOUS_QUESTION_BOUNDARY" in w for w in malformed["extraction_warnings"]))
        self.assertLess(malformed["extraction_confidence"], 0.7)

    def test_json_schema_compatibility(self):
        """Output JSON must conform to the expected ingestion candidate schema."""
        res = self.extraction_result
        self.assertIn("metadata", res)
        self.assertIn("summary", res)
        self.assertIn("pages", res)
        self.assertIn("candidates", res)

        for c in res["candidates"]:
            for field in [
                "candidate_id",
                "source_filename",
                "source_page_number",
                "detected_question_label",
                "candidate_question_text",
                "inferred_type",
                "detected_options",
                "detected_subparts",
                "detected_answer",
                "detected_solution",
                "original_extracted_text",
                "extraction_warnings",
                "extraction_confidence",
            ]:
                self.assertIn(field, c)

    def test_instructions_separation_and_candidate_count(self):
        """Verifies general instructions are separated into metadata and not emitted as questions."""
        real_pdf = "scripts/ingestion/test_source.pdf"
        if not os.path.exists(real_pdf):
            self.skipTest(f"{real_pdf} not found")

        result = process_pdf_document(real_pdf)
        # Must extract exactly 38 questions (CBSE standard paper)
        self.assertEqual(len(result["candidates"]), 38)
        # Must have filtered instructions into metadata
        self.assertGreater(result["metadata"]["paper_instructions_count"], 0)
        self.assertTrue(any("38 questions" in line for line in result["metadata"]["paper_instructions"]))

        # None of the candidates should have instruction labels or texts
        for c in result["candidates"]:
            label = c["detected_question_label"]
            text = c["candidate_question_text"]
            self.assertNotIn("This question paper contains 38 questions", text)
            self.assertNotIn("Draw neat and clean figures", text)
            self.assertNotIn("Use of calculators is not allowed", text)

    def test_section_distribution_on_real_paper(self):
        """Verifies correct section mapping (A: 20, B: 5, C: 6, D: 4, E: 3)."""
        real_pdf = "scripts/ingestion/test_source.pdf"
        if not os.path.exists(real_pdf):
            self.skipTest(f"{real_pdf} not found")

        result = process_pdf_document(real_pdf)
        section_counts = {}
        for c in result["candidates"]:
            sec = c["section"]
            section_counts[sec] = section_counts.get(sec, 0) + 1

        self.assertEqual(section_counts.get("SECTION A"), 20)
        self.assertEqual(section_counts.get("SECTION B"), 5)
        self.assertEqual(section_counts.get("SECTION C"), 6)
        self.assertEqual(section_counts.get("SECTION D"), 4)
        self.assertEqual(section_counts.get("SECTION E"), 3)

    def test_horizontal_option_deduplication(self):
        """Verifies faux-bold duplicate option keys like (c) 30° (c) 30° are deduplicated into 4 clean options."""
        real_pdf = "scripts/ingestion/test_source.pdf"
        if not os.path.exists(real_pdf):
            self.skipTest(f"{real_pdf} not found")

        result = process_pdf_document(real_pdf)
        q3 = next((c for c in result["candidates"] if c["detected_question_label"] == "3."), None)
        self.assertIsNotNone(q3)
        self.assertEqual(q3["inferred_type"], "MCQ")
        self.assertEqual(len(q3["detected_options"]), 4)
        self.assertEqual([o["key"] for o in q3["detected_options"]], ["A", "B", "C", "D"])
        self.assertEqual(q3["detected_options"][2]["text"], "30°")

    def test_consecutive_questions_page_2_multi_column(self):
        """Verifies 2-column layout correctly extracts Q10 through Q22 in consecutive sequence."""
        real_pdf = "scripts/ingestion/test_source.pdf"
        if not os.path.exists(real_pdf):
            self.skipTest(f"{real_pdf} not found")

        result = process_pdf_document(real_pdf)
        p2_candidates = [c for c in result["candidates"] if c["source_page_number"] == 2]
        p2_labels = [c["detected_question_label"] for c in p2_candidates]
        expected_p2 = [f"{n}." for n in range(10, 23)]
        self.assertEqual(p2_labels, expected_p2)

    def test_confidence_penalties_for_missing_content(self):
        """Verifies confidence drops appropriately when equations or options are missing."""
        real_pdf = "scripts/ingestion/test_source.pdf"
        if not os.path.exists(real_pdf):
            self.skipTest(f"{real_pdf} not found")

        result = process_pdf_document(real_pdf)
        # Q9 has missing fraction "tanθ = , then cos θ is"
        q9 = next((c for c in result["candidates"] if c["detected_question_label"] == "9."), None)
        self.assertIsNotNone(q9)
        self.assertLess(q9["extraction_confidence"], 0.40)
        self.assertTrue(any("MISSING_MATHEMATICAL_CONTENT" in w for w in q9["extraction_warnings"]))

        # Q4 has missing options
        q4 = next((c for c in result["candidates"] if c["detected_question_label"] == "4."), None)
        self.assertIsNotNone(q4)
        self.assertLess(q4["extraction_confidence"], 0.60)
        self.assertTrue(any("NO_OPTIONS_DETECTED" in w for w in q4["extraction_warnings"]))


    def test_diagram_detection_and_association_test_source(self):
        """Verifies diagram extraction on test_source.pdf (9 valid diagrams, 5 filtered logos/banners)."""
        real_pdf = "scripts/ingestion/test_source.pdf"
        if not os.path.exists(real_pdf):
            self.skipTest(f"{real_pdf} not found")

        result = process_pdf_document(real_pdf)
        diag_summary = result["summary"].get("diagram_summary", {})
        self.assertEqual(diag_summary.get("total_diagrams_extracted"), 9)
        self.assertEqual(diag_summary.get("total_diagrams_associated"), 9)
        self.assertEqual(diag_summary.get("unassociated_diagrams"), 5)

        # Question 25 has internal choice with 2 separate diagrams (main quad and OR quadrant)
        q25 = next((c for c in result["candidates"] if c["detected_question_label"] == "25."), None)
        self.assertIsNotNone(q25)
        self.assertEqual(len(q25["detected_diagrams"]), 2)
        for d in q25["detected_diagrams"]:
            self.assertTrue(os.path.exists(d["image_path"]))
            self.assertGreater(d["bounding_box"]["width"], 50)
            self.assertGreater(d["bounding_box"]["height"], 50)

        # Question 31 circumscribed figure on Page 4
        q31 = next((c for c in result["candidates"] if c["detected_question_label"] == "31."), None)
        self.assertIsNotNone(q31)
        self.assertEqual(len(q31["detected_diagrams"]), 1)
        self.assertTrue(os.path.exists(q31["detected_diagrams"][0]["image_path"]))

        # Case Studies: Q36 (Varun logo), Q37 (100m sprint), Q38 (Playing cards)
        q36 = next((c for c in result["candidates"] if c["detected_question_label"] == "36."), None)
        self.assertIsNotNone(q36)
        self.assertEqual(len(q36["detected_diagrams"]), 1)
        self.assertEqual(q36["detected_diagrams"][0]["diagram_id"], "diag-p4-7")

        q37 = next((c for c in result["candidates"] if c["detected_question_label"] == "37."), None)
        self.assertIsNotNone(q37)
        self.assertEqual(len(q37["detected_diagrams"]), 1)
        self.assertEqual(q37["detected_diagrams"][0]["diagram_id"], "diag-p5-8")

        q38 = next((c for c in result["candidates"] if c["detected_question_label"] == "38."), None)
        self.assertIsNotNone(q38)
        self.assertEqual(len(q38["detected_diagrams"]), 1)
        self.assertEqual(q38["detected_diagrams"][0]["diagram_id"], "diag-p5-9")

    def test_diagram_detection_and_association_second_test(self):
        """Verifies diagram extraction and cross-page continuation on second_test.pdf (11 geometry figures)."""
        circle_pdf = "scripts/ingestion/second_test.pdf"
        if not os.path.exists(circle_pdf):
            self.skipTest(f"{circle_pdf} not found")

        result = process_pdf_document(circle_pdf)
        diag_summary = result["summary"].get("diagram_summary", {})
        self.assertEqual(diag_summary.get("total_diagrams_extracted"), 11)
        self.assertEqual(diag_summary.get("total_diagrams_associated"), 11)
        self.assertEqual(diag_summary.get("unassociated_diagrams"), 2)

        # Verify Q3 has the cross-page continuation diagram from page 2
        q3 = next((c for c in result["candidates"] if c["detected_question_label"] == "3."), None)
        self.assertIsNotNone(q3)
        self.assertEqual(len(q3["detected_diagrams"]), 1)
        diag3 = q3["detected_diagrams"][0]
        self.assertEqual(diag3["source_page_number"], 2)
        self.assertTrue(os.path.exists(diag3["image_path"]))

        # Check Q1, Q2, Q6, Q7, Q12, Q16, Q17, Q18, Q19, Q20 each have 1 diagram
        for label in ["1.", "2.", "6.", "7.", "12.", "16.", "17.", "18.", "19.", "20."]:
            qc = next((c for c in result["candidates"] if c["detected_question_label"] == label), None)
            self.assertIsNotNone(qc, f"Candidate {label} missing")
            self.assertEqual(len(qc["detected_diagrams"]), 1, f"Candidate {label} should have 1 diagram")
            self.assertTrue(os.path.exists(qc["detected_diagrams"][0]["image_path"]))

    def test_visual_contact_sheet_exists(self):
        """Verifies that the generated visual contact sheet exists and contains cards."""
        contact_sheet = "scripts/ingestion/assets/diagram_contact_sheet.html"
        self.assertTrue(os.path.exists(contact_sheet))
        with open(contact_sheet, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("Mathematical Diagram Extraction", content)
        self.assertIn("diag-p1-1.png", content)
        self.assertIn("20 Extracted", content)


    def test_q7_q8_assertion_reason_association(self):
        """Verifies Q7 has only 4 options (no instruction bleed), and Q8/Q9 are Assertion-Reason MCQs."""
        circle_pdf = "scripts/ingestion/second_test.pdf"
        if not os.path.exists(circle_pdf):
            self.skipTest(f"{circle_pdf} not found")

        result = process_pdf_document(circle_pdf)
        cands = {c["detected_question_label"]: c for c in result["candidates"]}

        # Q7 must have exactly 4 options (NOT 12)
        q7 = cands.get("7.")
        self.assertIsNotNone(q7)
        self.assertEqual(len(q7["detected_options"]), 4)
        self.assertEqual(q7["detected_options"][0]["text"], "40°")
        self.assertEqual(q7["detected_options"][3]["text"], "100°")
        self.assertEqual(len(q7["detected_diagrams"]), 1)
        self.assertFalse(q7["has_extraction_failures"])

        # Q8 must be Assertion-Reason MCQ with 4 shared options
        q8 = cands.get("8.")
        self.assertIsNotNone(q8)
        self.assertEqual(q8["inferred_type"], "MCQ")
        self.assertEqual(q8["question_heading"], "Assertion - Reason")
        self.assertEqual(len(q8["detected_options"]), 4)
        self.assertIn("Both Assertion (A) and Reason (R) are true", q8["detected_options"][0]["text"])

        # Q9 must also be Assertion-Reason MCQ
        q9 = cands.get("9.")
        self.assertIsNotNone(q9)
        self.assertEqual(q9["inferred_type"], "MCQ")
        self.assertEqual(q9["question_heading"], "Assertion - Reason")
        self.assertEqual(len(q9["detected_options"]), 4)

    def test_inline_subparts_detection(self):
        """Verifies inline subparts (a) and (b) are extracted for Q18, Q19, and Q20."""
        circle_pdf = "scripts/ingestion/second_test.pdf"
        if not os.path.exists(circle_pdf):
            self.skipTest(f"{circle_pdf} not found")

        result = process_pdf_document(circle_pdf)
        cands = {c["detected_question_label"]: c for c in result["candidates"]}

        for label in ["18.", "19.", "20."]:
            c = cands.get(label)
            self.assertIsNotNone(c, f"Candidate {label} missing")
            self.assertEqual(c["inferred_type"], "SUBJECTIVE")
            self.assertEqual(len(c["detected_subparts"]), 2, f"Candidate {label} should have 2 subparts")
            self.assertEqual(c["detected_subparts"][0]["label"], "(a)")
            self.assertEqual(c["detected_subparts"][1]["label"], "(b)")
            # Diagram must still be attached
            self.assertEqual(len(c["detected_diagrams"]), 1)

    def test_question_heading_separation(self):
        """Verifies question headings are separated from question stems."""
        real_pdf = "scripts/ingestion/test_source.pdf"
        if not os.path.exists(real_pdf):
            self.skipTest(f"{real_pdf} not found")

        result = process_pdf_document(real_pdf)
        cands = {c["detected_question_label"]: c for c in result["candidates"]}

        # Q37 Case Study heading
        q37 = cands.get("37.")
        self.assertIsNotNone(q37)
        self.assertEqual(q37["question_heading"], "100 Metres Race")
        self.assertTrue(q37["candidate_question_text"].startswith("The 100 metres is a sprint race"))
        self.assertNotIn("100 Metres Race :", q37["candidate_question_text"])


if __name__ == "__main__":
    unittest.main()

