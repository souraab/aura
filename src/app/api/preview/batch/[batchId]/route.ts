import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

interface StagingQuestionRow {
  id: string;
  batch_id: string;
  candidate_id: string;
  source_page_number: number;
  detected_question_label: string;
  question_heading: string | null;
  section: string | null;
  inferred_type: string;
  candidate_question_text: string;
  detected_options: Array<{ key: string; text: string; is_correct?: boolean }> | null;
  detected_subparts: Array<{ label: string; text: string }> | null;
  detected_diagrams: Array<{
    diagram_id: string;
    storage_path?: string;
    storage_url?: string;
    caption?: string;
    source_page?: number;
  }> | null;
}

const SECTION_MAP: Record<
  string,
  { id: string; name: string; marks: number; desc: string }
> = {
  A: {
    id: "A",
    name: "Section A",
    marks: 1,
    desc: "Multiple Choice Questions (1 Mark each)",
  },
  B: {
    id: "B",
    name: "Section B",
    marks: 2,
    desc: "Very Short Answer Type (2 Marks each)",
  },
  C: {
    id: "C",
    name: "Section C",
    marks: 3,
    desc: "Short Answer Type (3 Marks each)",
  },
  D: {
    id: "D",
    name: "Section D",
    marks: 5,
    desc: "Long Answer Type (5 Marks each)",
  },
  E: {
    id: "E",
    name: "Section E",
    marks: 4,
    desc: "Case-Based Integrated Assessment (4 Marks each)",
  },
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await context.params;

    if (!batchId || !/^[0-9a-fA-F-]{36}$/.test(batchId)) {
      return NextResponse.json(
        { error: "Invalid batch ID format. UUID required." },
        { status: 400 }
      );
    }

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Server credentials missing. Ingestion storage key required." },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Fetch batch metadata
    const { data: batch, error: batchErr } = await supabase
      .from("ingestion_batches")
      .select("id, pdf_filename, status, total_questions, extractor_backend")
      .eq("id", batchId)
      .single();

    if (batchErr || !batch) {
      return NextResponse.json(
        { error: `Batch '${batchId}' not found.` },
        { status: 404 }
      );
    }

    // 2. Fetch all staging questions for this batch
    const { data: rawQuestions, error: qErr } = await supabase
      .from("staging_questions")
      .select(
        "id, batch_id, candidate_id, source_page_number, detected_question_label, question_heading, section, inferred_type, candidate_question_text, detected_options, detected_subparts, detected_diagrams"
      )
      .eq("batch_id", batchId);

    if (qErr || !rawQuestions || rawQuestions.length === 0) {
      return NextResponse.json(
        { error: `No staging questions found for batch '${batchId}'.` },
        { status: 404 }
      );
    }

    // Sort questions by authentic question number (1 to 38)
    const questions = (rawQuestions as StagingQuestionRow[]).sort((a, b) => {
      const numA = parseInt(
        a.detected_question_label?.replace(/\D/g, "") ||
          a.candidate_id?.replace(/\D/g, "") ||
          "0",
        10
      );
      const numB = parseInt(
        b.detected_question_label?.replace(/\D/g, "") ||
          b.candidate_id?.replace(/\D/g, "") ||
          "0",
        10
      );
      return numA - numB;
    });

    // 3. Resolve private diagram storage paths to signed URLs (2 hours expiry)
    // Gather all unique storage paths
    const storagePathsToSign = new Set<string>();

    questions.forEach((q) => {
      // From detected_diagrams
      (q.detected_diagrams || []).forEach((d) => {
        if (d.storage_path) {
          storagePathsToSign.add(d.storage_path);
        } else if (d.storage_url) {
          const match = d.storage_url.match(/question-media\/(.+)$/);
          if (match) storagePathsToSign.add(match[1]);
        }
      });

      // From markdown inline storage URIs
      const inlineMatches =
        q.candidate_question_text.matchAll(
          /storage:\/\/question-media\/([^)]+)/g
        );
      for (const m of inlineMatches) {
        if (m[1]) storagePathsToSign.add(m[1]);
      }
    });

    // Create signed URLs
    const signedUrlMap: Record<string, string> = {};
    for (const path of Array.from(storagePathsToSign)) {
      try {
        const { data: signData, error: signErr } = await supabase.storage
          .from("question-media")
          .createSignedUrl(path, 7200);

        if (!signErr && signData?.signedUrl) {
          signedUrlMap[path] = signData.signedUrl;
        }
      } catch (err) {
        console.error(`Error signing storage path ${path}:`, err);
      }
    }

    // 4. Format and sanitize each question for student consumption
    const formattedQuestions = questions.map((q, index) => {
      const qNum = index + 1;

      // Determine Section & Marks
      let sectionKey = "A";
      if (qNum <= 20) sectionKey = "A";
      else if (qNum <= 25) sectionKey = "B";
      else if (qNum <= 31) sectionKey = "C";
      else if (qNum <= 35) sectionKey = "D";
      else sectionKey = "E";

      const sectionMeta = SECTION_MAP[sectionKey];

      // Replace storage://question-media/... with signed URL in text
      let text = q.candidate_question_text || "";

      // Clean OCR end markers (e.g. from Question 38)
      text = text.replace(/[*]+\s*ALL\s+THE\s+BEST\s*[*]+/gi, "").trim();

      // Normalize markdown tables: insert line breaks before and after tables if collapsed
      text = text.replace(/([^\n])\s*(\|(?:\s*[^|\n]+\s*\|)+)/g, "$1\n\n$2");
      text = text.replace(/(\|(?:\s*[^|\n]+\s*\|)+)\s*([^\n|])/g, "$1\n\n$2");

      // Replace private storage URLs with signed URLs
      for (const [path, signedUrl] of Object.entries(signedUrlMap)) {
        text = text.replace(
          new RegExp(`storage:\\/\\/question-media\\/${path.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}`, "g"),
          signedUrl
        );
        text = text.replace(
          new RegExp(`question-media\\/${path.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}`, "g"),
          signedUrl
        );
      }

      // Check for OR alternative split
      const orPattern = /\s*(?:##\s*OR\b|\*\*OR\*\*\b|(?<=\s)OR(?=\s))\s*/i;
      const orParts = text.split(orPattern);
      const hasAlternative = orParts.length > 1;

      // Sanitize options (strip is_correct, never reveal answer keys)
      const options = (q.detected_options || []).map((opt) => ({
        key: opt.key.toUpperCase(),
        text: opt.text,
      }));

      // Resolved diagrams
      const diagrams = (q.detected_diagrams || []).map((d) => {
        const rawPath = d.storage_path || d.storage_url?.replace(/^.*question-media\//, "") || "";
        const resolvedUrl = signedUrlMap[rawPath] || d.storage_url || "";
        return {
          diagram_id: d.diagram_id,
          caption: d.caption || `Figure for Question ${qNum}`,
          url: resolvedUrl,
          source_page: d.source_page || q.source_page_number,
        };
      });

      // Subparts
      const subparts = (q.detected_subparts || []).map((s) => ({
        label: s.label,
        text: s.text,
      }));

      return {
        id: q.id,
        candidate_id: q.candidate_id,
        question_number: qNum,
        label: `${qNum}.`,
        section: sectionMeta.name,
        section_id: sectionMeta.id,
        marks: sectionMeta.marks,
        type: qNum <= 18 ? "MCQ" : qNum <= 20 ? "ASSERTION_REASON" : qNum <= 35 ? "SUBJECTIVE" : "CASE_BASED",
        stem: text,
        has_alternative: hasAlternative,
        alternative_parts: hasAlternative ? orParts.map((p) => p.trim()) : null,
        options,
        subparts,
        diagrams,
        source_page_number: q.source_page_number,
      };
    });

    return NextResponse.json({
      success: true,
      paper: {
        batch_id: batch.id,
        title: "CBSE Class X — Mathematics (Standard)",
        subtitle: "High Priority Practice Examination 2026",
        source_filename: batch.pdf_filename,
        total_questions: formattedQuestions.length,
        total_marks: 80,
        time_allowed_minutes: 180,
        general_instructions: [
          "This question paper contains 38 questions divided into 5 Sections: A, B, C, D, and E.",
          "Section A comprises 20 Multiple Choice Questions (Q1 to Q20) of 1 mark each.",
          "Section B comprises 5 Short Answer Type-I questions (Q21 to Q25) of 2 marks each.",
          "Section C comprises 6 Short Answer Type-II questions (Q26 to Q31) of 3 marks each.",
          "Section D comprises 4 Long Answer Type questions (Q32 to Q35) of 5 marks each.",
          "Section E comprises 3 Case-Based integrated units of assessment (Q36 to Q38) of 4 marks each with subparts.",
          "All Questions are compulsory. However, internal choice is provided in 2 questions of Section B, 2 questions of Section C, 2 questions of Section D, and in subparts of 2 questions of Section E.",
          "Use of calculators is strictly prohibited.",
        ],
        sections: Object.values(SECTION_MAP).map((s) => ({
          ...s,
          question_count: formattedQuestions.filter((q) => q.section_id === s.id).length,
        })),
        questions: formattedQuestions,
      },
    });
  } catch (error: any) {
    console.error("Failed to generate student preview payload:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
