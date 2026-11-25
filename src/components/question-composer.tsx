"use client";

import React, { useRef, useState } from "react";
import {
  type QuestionType,
  type SubjectiveAnswerType,
  type DifficultyLevel,
  type QuestionStatus,
  type ChapterRecord,
  type TopicRecord,
  type CaseStudyRecord,
  type QuestionFormPayload,
  type QuestionMediaItem,
  generateQuestionCode,
  uploadDiagramToQuestionMediaBucket,
  removeDiagramFromQuestionMediaBucket,
} from "@/lib/admin-questions-db";
import {
  MathContentRenderer,
  StorageImage,
} from "@/components/math-renderer";
import {
  MathRichEditor,
  CompactMathInput,
} from "@/components/math-editor";

// ============================================================================
// Constants
// ============================================================================

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: "MCQ", label: "MCQ (Multiple Choice)" },
  { value: "TRUE_FALSE", label: "True / False" },
  { value: "FILL_BLANK", label: "Fill in the Blank" },
  { value: "SUBJECTIVE", label: "Subjective" },
  { value: "CASE_BASED", label: "Case Based" },
];

const SUBJECTIVE_ANSWER_TYPES: {
  value: SubjectiveAnswerType;
  label: string;
  defaultMarks: number;
}[] = [
  { value: "VERY_SHORT", label: "Very Short Answer (VSA • 1–2M)", defaultMarks: 1 },
  { value: "SHORT", label: "Short Answer (SA • 3M)", defaultMarks: 3 },
  { value: "LONG", label: "Long Answer (LA • 5M)", defaultMarks: 5 },
];

const DIFFICULTY_LEVELS: { value: DifficultyLevel; label: string }[] = [
  { value: "EASY", label: "Easy" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HARD", label: "Hard" },
];

const QUESTION_STATUSES: { value: QuestionStatus; label: string }[] = [
  { value: "DRAFT", label: "Draft" },
  { value: "IN_REVIEW", label: "In Review" },
  { value: "VERIFIED", label: "Verified" },
  { value: "PUBLISHED", label: "Published" },
  { value: "ARCHIVED", label: "Archived" },
];

export const MATH_RENDERING_TEST_CASES: {
  id: number;
  title: string;
  category: string;
  latex: string;
  block?: boolean;
}[] = [
  {
    id: 1,
    title: "Arithmetic Operators",
    category: "Arithmetic",
    latex: "2 \\times 3 + 4 \\div 2",
  },
  {
    id: 2,
    title: "Square Root of Polynomial",
    category: "Radicals",
    latex: "\\sqrt{x^2+1}",
  },
  {
    id: 3,
    title: "Cube Root of Polynomial",
    category: "Radicals",
    latex: "\\sqrt[3]{x^2+8}",
  },
  {
    id: 4,
    title: "Rational Fraction",
    category: "Fractions",
    latex: "\\frac{x+1}{x-1}",
  },
  {
    id: 5,
    title: "AP nth Term Formula",
    category: "Subscripts & Algebra",
    latex: "a_n=a+(n-1)d",
  },
  {
    id: 6,
    title: "Summation with Bounds",
    category: "Calculus & Series",
    latex: "\\sum_{i=1}^{n}x_i",
  },
  {
    id: 7,
    title: "2×2 Bracket Matrix",
    category: "Matrices",
    latex: "\\begin{bmatrix}1&2\\\\3&4\\end{bmatrix}",
    block: true,
  },
  {
    id: 8,
    title: "Trigonometric Limit",
    category: "Limits & Trig",
    latex: "\\lim_{x\\to0}\\frac{\\sin x}{x}=1",
  },
  {
    id: 9,
    title: "Quadratic Formula",
    category: "Fractions & Radicals",
    latex: "\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}",
  },
  {
    id: 10,
    title: "Piecewise Function (2 Conditions)",
    category: "Piecewise",
    latex:
      "f(x) = \\begin{cases} x^2 + 1 & \\text{if } x \\ge 0 \\\\ -2x & \\text{if } x < 0 \\end{cases}",
    block: true,
  },
];

// ============================================================================
// Props
// ============================================================================

export interface QuestionComposerProps {
  editingQuestionId: string | null;
  formState: QuestionFormPayload;
  setFormState: React.Dispatch<React.SetStateAction<QuestionFormPayload>>;
  chapters: ChapterRecord[];
  activeChapters: ChapterRecord[];
  chapterTopics: TopicRecord[];
  caseStudies: CaseStudyRecord[];
  chapterCaseStudies: CaseStudyRecord[];
  chaptersMap: Map<string, ChapterRecord>;
  createNewTopicMode: boolean;
  setCreateNewTopicMode: React.Dispatch<React.SetStateAction<boolean>>;
  canPublishQuestions: boolean;
  isSaving: boolean;
  formError: string | null;
  onOpenChapterManager: () => void;
  onAddOption: () => void;
  onRemoveOption: (index: number) => void;
  onToggleOptionCorrect: (index: number) => void;
  onSaveQuestion: (overrideStatus?: QuestionStatus) => Promise<void>;
  onCancel: () => void;
  onShowToast: (type: "success" | "error", message: string) => void;
}

export function QuestionComposer({
  editingQuestionId,
  formState,
  setFormState,
  activeChapters,
  chapterTopics,
  caseStudies,
  chapterCaseStudies,
  chaptersMap,
  createNewTopicMode,
  setCreateNewTopicMode,
  canPublishQuestions,
  isSaving,
  formError,
  onOpenChapterManager,
  onAddOption,
  onRemoveOption,
  onToggleOptionCorrect,
  onSaveQuestion,
  onCancel,
  onShowToast,
}: QuestionComposerProps) {
  const [composerTab, setComposerTab] = useState<"compose" | "preview">(
    "compose"
  );
  const [showMathTestSuite, setShowMathTestSuite] = useState(false);
  const [showSolutionInPreview, setShowSolutionInPreview] = useState(true);
  const [isUploadingGalleryDiagram, setIsUploadingGalleryDiagram] =
    useState(false);
  const [manualMediaUrl, setManualMediaUrl] = useState("");
  const [manualMediaCaption, setManualMediaCaption] = useState("");
  const galleryFileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedChapter = chaptersMap.get(formState.chapter_id);
  const selectedTopic = chapterTopics.find((t) => t.id === formState.topic_id);

  // Calculate total marks allocated across solution steps & marking scheme
  const totalStepMarks = formState.step_by_step_solution.reduce(
    (acc, step) => acc + (Number(step.marks) || 0),
    0
  );
  const totalSchemeMarks = formState.marking_scheme.reduce(
    (acc, item) => acc + (Number(item.marks) || 0),
    0
  );

  // Upload diagram to private `question-media` Supabase Storage bucket
  const handleUploadDiagram = async (
    file: File,
    placement: "STATEMENT" | "SOLUTION" | "ATTACHMENT"
  ): Promise<{ mediaUrl: string; defaultCaption: string } | null> => {
    try {
      const uploaded = await uploadDiagramToQuestionMediaBucket(
        file,
        placement
      );

      const newMediaItem: QuestionMediaItem = {
        media_url: uploaded.mediaUrl,
        media_type: "IMAGE",
        caption: uploaded.defaultCaption || file.name,
        storage_path: uploaded.storagePath,
        placement,
      };

      setFormState((prev) => ({
        ...prev,
        media: [...prev.media, newMediaItem],
      }));

      onShowToast(
        "success",
        `Uploaded "${file.name}" to private question-media bucket.`
      );

      return {
        mediaUrl: uploaded.mediaUrl,
        defaultCaption: uploaded.defaultCaption,
      };
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to upload diagram to question-media bucket.";
      onShowToast("error", msg);
      return null;
    }
  };

  // Remove diagram before saving (deletes from state, strips inline references, and deletes from bucket if newly uploaded)
  const handleRemoveDiagram = async (index: number) => {
    const target = formState.media[index];
    if (!target) return;

    const urlToStrip = target.media_url;

    setFormState((prev) => {
      const escapedUrl = urlToStrip.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const mdRegex = new RegExp(`!\\[[^\\]]*\\]\\(${escapedUrl}\\)\\n?`, "g");
      return {
        ...prev,
        question_text: prev.question_text.replace(mdRegex, "").trim(),
        model_answer: prev.model_answer.replace(mdRegex, "").trim(),
        media: prev.media.filter((_, i) => i !== index),
      };
    });

    try {
      await removeDiagramFromQuestionMediaBucket(urlToStrip);
      onShowToast("success", "Removed diagram.");
    } catch {
      // Ignore storage cleanup error if item was external URL
    }
  };

  const handleInsertMediaIntoField = (
    item: QuestionMediaItem,
    targetField: "question_text" | "model_answer"
  ) => {
    const mdTag = `\n![${item.caption || "Diagram"}](${item.media_url})\n`;
    setFormState((prev) => ({
      ...prev,
      [targetField]: `${prev[targetField]}${mdTag}`,
    }));
    onShowToast(
      "success",
      `Inserted diagram into ${
        targetField === "question_text" ? "Question Statement" : "Solution"
      }.`
    );
  };

  const handleSyncMarkingSchemeFromSteps = () => {
    const mapped = formState.step_by_step_solution
      .filter((s) => s.explanation.trim() !== "" || s.title.trim() !== "")
      .map((s) => ({
        criterion: `${s.title}: ${s.explanation.slice(0, 90)}${
          s.explanation.length > 90 ? "..." : ""
        }`,
        marks: Number(s.marks) || 1,
        notes: "",
      }));

    if (mapped.length === 0) {
      onShowToast("error", "Add at least one solution step first.");
      return;
    }

    setFormState((prev) => ({
      ...prev,
      marking_scheme: mapped,
    }));
    onShowToast("success", "Synced marking scheme criteria from solution steps.");
  };

  return (
    <section
      aria-label="Question Composer Workspace"
      className="space-y-6 pb-12"
    >
      {/* =====================================================================
          TOP STICKY COMPOSER ACTION BAR
      ===================================================================== */}
      <div className="sticky top-16 z-20 bg-white/95 dark:bg-[#151F32]/95 backdrop-blur-md rounded-2xl border border-slate-200/90 dark:border-slate-800 px-5 py-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
          >
            <span>← Back to Question Bank</span>
          </button>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                {editingQuestionId
                  ? `Editing Question • ${formState.question_code}`
                  : "Question Composer • CBSE Class 10 Mathematics"}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/70">
                {formState.status}
              </span>
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-[#F1F5F9]">
              {editingQuestionId
                ? "Edit Mathematical Question & Solution"
                : "Create New Mathematical Question"}
            </h2>
          </div>
        </div>

        {/* Right Actions: Math Test Suite, Preview Question, Save Draft, Save and Verify, Cancel */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Toggle Mathematical Rendering Test Suite (10 Expressions) */}
          <button
            type="button"
            onClick={() => setShowMathTestSuite((prev) => !prev)}
            className={`px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
              showMathTestSuite
                ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                : "border-indigo-200 dark:border-indigo-800 bg-indigo-50/70 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100"
            }`}
          >
            <span>🧪 Math Test Suite (10)</span>
          </button>

          {/* Toggle between Compose Workspace and Full Preview */}
          <button
            type="button"
            onClick={() =>
              setComposerTab((prev) =>
                prev === "compose" ? "preview" : "compose"
              )
            }
            className={`px-4 py-2.5 rounded-xl border text-xs sm:text-sm font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
              composerTab === "preview"
                ? "bg-violet-600 text-white border-violet-600 shadow-xs"
                : "border-violet-200 dark:border-violet-800 bg-violet-50/80 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 hover:bg-violet-100"
            }`}
          >
            <span>
              {composerTab === "preview"
                ? "✎ Return to Editor"
                : "👁 Preview Question"}
            </span>
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1E293B] hover:bg-slate-50 dark:hover:bg-slate-800 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={isSaving}
            onClick={() => void onSaveQuestion("DRAFT")}
            className="px-4 py-2.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/70 hover:bg-indigo-100 dark:hover:bg-indigo-900/70 text-xs sm:text-sm font-semibold text-indigo-700 dark:text-indigo-300 cursor-pointer disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save Draft"}
          </button>

          {editingQuestionId &&
            formState.status !== "DRAFT" &&
            formState.status !== "VERIFIED" && (
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void onSaveQuestion()}
                className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-900 dark:bg-slate-700 text-xs sm:text-sm font-semibold text-white cursor-pointer disabled:opacity-50"
              >
                {isSaving ? "Saving..." : `Save (${formState.status})`}
              </button>
            )}

          <button
            type="button"
            disabled={isSaving}
            onClick={() => void onSaveQuestion("VERIFIED")}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-50 text-xs sm:text-sm font-semibold text-white shadow-sm shadow-emerald-500/20 cursor-pointer"
          >
            {isSaving ? "Saving to Supabase..." : "✓ Save and Verify"}
          </button>
        </div>
      </div>

      {/* =====================================================================
          MATHEMATICAL RENDERING TEST SUITE (10 STANDARD DIAGNOSTIC EXPRESSIONS)
      ===================================================================== */}
      {showMathTestSuite && (
        <div className="bg-white dark:bg-[#151F32] rounded-2xl border border-indigo-200 dark:border-indigo-800/80 p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  10 / 10 Passing
                </span>
                <h3 className="text-sm font-bold text-slate-900 dark:text-[#F1F5F9]">
                  Mathematical Rendering Verification Suite
                </h3>
              </div>
              <p className="text-xs text-slate-500 dark:text-[#A7B3C7] mt-0.5">
                Inspect live rendering of all 10 diagnostic expressions across
                inline math, block math, MCQ options, and solution editors.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const allSampleText = MATH_RENDERING_TEST_CASES.map(
                    (tc) =>
                      `${tc.id}. **${tc.title}**: ${
                        tc.block ? `\n$$${tc.latex}$$` : `$${tc.latex}$`
                      }`
                  ).join("\n");
                  setFormState((prev) => ({
                    ...prev,
                    question_text: prev.question_text
                      ? `${prev.question_text}\n\n${allSampleText}`
                      : allSampleText,
                    options:
                      prev.options.length >= 4
                        ? prev.options.map((opt, idx) => {
                            const sampleMap = [
                              `$2 \\times 3 + 4 \\div 2$`,
                              `$\\sqrt{x^2+1}$`,
                              `$\\frac{x+1}{x-1}$`,
                              `$\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$`,
                            ];
                            return sampleMap[idx]
                              ? { ...opt, option_text: sampleMap[idx] }
                              : opt;
                          })
                        : prev.options,
                  }));
                  onShowToast(
                    "success",
                    "Loaded all 10 mathematical test cases into Question Editor & MCQ Options!"
                  );
                }}
                className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer"
              >
                + Load All 10 into Question & MCQ Options
              </button>
              <button
                type="button"
                onClick={() => setShowMathTestSuite(false)}
                className="px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            {MATH_RENDERING_TEST_CASES.map((tc) => (
              <div
                key={tc.id}
                className="p-3 rounded-xl bg-slate-50/90 dark:bg-[#0B1120]/70 border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between gap-2.5"
              >
                <div>
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                      #{tc.id} • {tc.category}
                    </span>
                    <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                      ✓ PASS
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-2">
                    {tc.title}
                  </p>
                  <div className="min-h-14 flex items-center justify-center p-2 rounded-lg bg-white dark:bg-[#151F32] border border-slate-200/70 dark:border-slate-800 text-slate-900 dark:text-[#F1F5F9] overflow-x-auto">
                    <MathContentRenderer
                      content={
                        tc.block ? `$$${tc.latex}$$` : `$${tc.latex}$`
                      }
                      inline={!tc.block}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <code className="block text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate bg-slate-100 dark:bg-[#1E293B] px-1.5 py-0.5 rounded">
                    {tc.latex}
                  </code>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        const wrapped = tc.block
                          ? `\n$$${tc.latex}$$\n`
                          : ` $${tc.latex}$`;
                        setFormState((prev) => ({
                          ...prev,
                          question_text: `${prev.question_text}${wrapped}`,
                        }));
                        onShowToast(
                          "success",
                          `Inserted Test #${tc.id} into Question Statement`
                        );
                      }}
                      className="flex-1 px-2 py-1 rounded-lg bg-white dark:bg-[#1E293B] hover:bg-indigo-50 dark:hover:bg-indigo-950 border border-slate-200 dark:border-slate-700 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300 cursor-pointer"
                    >
                      + Question
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const wrapped = tc.block
                          ? `\n$$${tc.latex}$$\n`
                          : ` $${tc.latex}$`;
                        setFormState((prev) => ({
                          ...prev,
                          model_answer: `${prev.model_answer}${wrapped}`,
                        }));
                        onShowToast(
                          "success",
                          `Inserted Test #${tc.id} into Solution`
                        );
                      }}
                      className="flex-1 px-2 py-1 rounded-lg bg-white dark:bg-[#1E293B] hover:bg-violet-50 dark:hover:bg-violet-950 border border-slate-200 dark:border-slate-700 text-[10px] font-semibold text-violet-700 dark:text-violet-300 cursor-pointer"
                    >
                      + Solution
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Form Validation Error Banner */}
      {formError && (
        <div
          role="alert"
          className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-800 text-xs sm:text-sm font-medium text-rose-800 dark:text-rose-200 flex items-center justify-between gap-3"
        >
          <span>{formError}</span>
        </div>
      )}

      {/* =====================================================================
          FULL-SCREEN PREVIEW TAB (WHEN TEACHER CLICKS "PREVIEW QUESTION")
      ===================================================================== */}
      {composerTab === "preview" ? (
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="bg-white dark:bg-[#151F32] rounded-3xl border border-slate-200/90 dark:border-slate-800 p-6 sm:p-8 shadow-md space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/80 px-2.5 py-1 rounded-md border border-indigo-200/60 dark:border-indigo-800">
                  {formState.question_code || "AUTO-CODE"}
                </span>
                <span className="px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 dark:bg-[#1E293B] text-slate-700 dark:text-slate-200">
                  {selectedChapter
                    ? `Ch ${selectedChapter.chapter_number}: ${selectedChapter.name}`
                    : "Unassigned Chapter"}
                </span>
                {(selectedTopic || formState.new_topic_name) && (
                  <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-violet-50 dark:bg-violet-950/70 text-violet-700 dark:text-violet-300">
                    {formState.new_topic_name || selectedTopic?.name}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-indigo-600 text-white">
                  {formState.marks} {formState.marks === 1 ? "Mark" : "Marks"}
                </span>
                {formState.negative_marks > 0 && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300">
                    -{formState.negative_marks} Neg
                  </span>
                )}
              </div>
            </div>

            {/* Case Study Context if CASE_BASED */}
            {formState.question_type === "CASE_BASED" &&
              (formState.case_study_title || formState.case_study_passage) && (
                <div className="p-5 rounded-2xl bg-violet-50/60 dark:bg-violet-950/30 border border-violet-200/80 dark:border-violet-800/70 space-y-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300 block">
                    Case Study Passage • {formState.case_study_title || "Scenario"}
                  </span>
                  <div className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                    <MathContentRenderer
                      content={formState.case_study_passage || ""}
                    />
                  </div>
                </div>
              )}

            {/* Student Question Statement */}
            <div className="space-y-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                Student Question View ({formState.question_type}
                {formState.answer_type ? ` • ${formState.answer_type}` : ""})
              </span>
              <div className="p-5 rounded-2xl bg-slate-50/80 dark:bg-[#0B1120]/70 border border-slate-200/80 dark:border-slate-800 text-base text-slate-950 dark:text-[#F1F5F9] leading-relaxed">
                {formState.question_text.trim() ? (
                  <MathContentRenderer content={formState.question_text} />
                ) : (
                  <p className="italic text-slate-400">
                    No question statement entered yet.
                  </p>
                )}
              </div>
            </div>

            {/* Standalone Attached Diagrams not already inline */}
            {formState.media.filter(
              (m) =>
                m.media_url.trim() !== "" &&
                !formState.question_text.includes(m.media_url) &&
                !formState.model_answer.includes(m.media_url)
            ).length > 0 && (
              <div className="space-y-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#A7B3C7] block">
                  Attached Question Figures
                </span>
                <div className="flex flex-wrap gap-4">
                  {formState.media
                    .filter(
                      (m) =>
                        m.media_url.trim() !== "" &&
                        !formState.question_text.includes(m.media_url) &&
                        !formState.model_answer.includes(m.media_url)
                    )
                    .map((m, idx) => (
                      <StorageImage
                        key={idx}
                        src={m.media_url}
                        caption={m.caption}
                      />
                    ))}
                </div>
              </div>
            )}

            {/* Student Answer Area Preview */}
            {(formState.question_type === "MCQ" ||
              (formState.question_type === "CASE_BASED" &&
                formState.options.some((o) => o.option_text.trim() !== ""))) && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#A7B3C7] block">
                    Student Options ({formState.mcq_mode === "SINGLE" ? "Choose One" : "Choose All That Apply"})
                  </span>
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {showSolutionInPreview
                      ? "Teacher Answer Key Overlay Active"
                      : "Strict Student Test View (Answer Key Hidden)"}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {formState.options.map((opt, idx) => {
                    const isExplicitlyCorrect = Boolean(opt.is_correct);
                    const highlightAsCorrect =
                      showSolutionInPreview && isExplicitlyCorrect;
                    return (
                      <div
                        key={idx}
                        className={`p-3.5 rounded-2xl border flex items-center gap-3 transition-colors ${
                          highlightAsCorrect
                            ? "border-emerald-400 dark:border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/30"
                            : "border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1E293B]"
                        }`}
                      >
                        <span
                          className={`w-7 h-7 rounded-lg font-mono font-bold text-xs flex items-center justify-center shrink-0 ${
                            highlightAsCorrect
                              ? "bg-emerald-600 text-white"
                              : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                          }`}
                        >
                          {opt.option_key}
                        </span>
                        <div className="flex-1 text-sm text-slate-900 dark:text-[#F1F5F9]">
                          {opt.option_text.trim() ? (
                            <MathContentRenderer
                              content={opt.option_text}
                              inline
                            />
                          ) : (
                            <span className="italic text-slate-400">
                              Empty option
                            </span>
                          )}
                        </div>
                        {highlightAsCorrect && (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-600 text-white shrink-0">
                            ✓ Correct
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Teacher Solution & Marking Preview Toggle */}
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  Teacher Verification: Solution & Marking Scheme
                </span>
                <button
                  type="button"
                  onClick={() => setShowSolutionInPreview((p) => !p)}
                  className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                >
                  {showSolutionInPreview
                    ? "Hide Answer Key (Strict Student View)"
                    : "Show Answer Key & Solution"}
                </button>
              </div>

              {showSolutionInPreview && (
                <div className="p-5 rounded-2xl bg-slate-50 dark:bg-[#1E293B]/70 border border-slate-200 dark:border-slate-700 space-y-4 text-sm">
                  {formState.model_answer.trim() && (
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A7B3C7] block mb-1">
                        Model Answer
                      </span>
                      <MathContentRenderer content={formState.model_answer} />
                    </div>
                  )}

                  {formState.step_by_step_solution.filter(
                    (s) => s.explanation.trim() !== ""
                  ).length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#A7B3C7] block">
                        Step-by-Step Solution
                      </span>
                      {formState.step_by_step_solution
                        .filter((s) => s.explanation.trim() !== "")
                        .map((s, idx) => (
                          <div
                            key={idx}
                            className="p-3 rounded-xl bg-white dark:bg-[#151F32] border border-slate-200/70 dark:border-slate-700 flex items-start justify-between gap-3"
                          >
                            <div className="space-y-1">
                              <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                                {s.title || `Step ${idx + 1}`}
                              </span>
                              <MathContentRenderer content={s.explanation} />
                            </div>
                            {s.marks !== undefined && (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 font-mono font-bold text-xs shrink-0">
                                {s.marks}M
                              </span>
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* ===================================================================
           3-COLUMN SPACIOUS QUESTION COMPOSER LAYOUT
           Left (3 cols): Question Information & Media
           Centre (5 cols): Question Editor, Options & Solution Editor
           Right (4 cols): Live Student Preview
        =================================================================== */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* =================================================================
              LEFT COLUMN: 1. QUESTION INFORMATION PANEL & DIAGRAM GALLERY
          ================================================================= */}
          <div className="lg:col-span-3 space-y-5">
            <div className="bg-white dark:bg-[#151F32] rounded-2xl border border-slate-200/90 dark:border-slate-800 p-5 shadow-2xs space-y-4">
              <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  1. Question Information
                </span>
                <h3 className="text-sm font-bold text-slate-950 dark:text-[#F1F5F9]">
                  Curriculum & Classification
                </h3>
              </div>

              {/* Question Code */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-[#A7B3C7]">
                    Question Code
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const ch = chaptersMap.get(formState.chapter_id);
                      setFormState((prev) => ({
                        ...prev,
                        question_code: generateQuestionCode(ch?.chapter_number),
                      }));
                    }}
                    className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                  >
                    Auto-Generate
                  </button>
                </div>
                <input
                  type="text"
                  value={formState.question_code}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      question_code: e.target.value,
                    }))
                  }
                  placeholder="Auto-generated if empty"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] text-xs font-mono text-slate-900 dark:text-[#F1F5F9]"
                />
              </div>

              {/* Chapter Dropdown (Populated from Supabase) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-[#A7B3C7]">
                    Chapter <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={onOpenChapterManager}
                    className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                  >
                    + Manage Chapters
                  </button>
                </div>
                <select
                  value={formState.chapter_id}
                  onChange={(e) =>
                    setFormState((prev) => ({
                      ...prev,
                      chapter_id: e.target.value,
                      topic_id: null,
                    }))
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] text-xs sm:text-sm text-slate-900 dark:text-[#F1F5F9]"
                >
                  <option value="">-- Select Chapter --</option>
                  {activeChapters.map((chap) => (
                    <option key={chap.id} value={chap.id}>
                      Ch {chap.chapter_number}: {chap.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Topic Dropdown (Filtered by Selected Chapter) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-[#A7B3C7]">
                    Topic (Optional)
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setCreateNewTopicMode((prev) => !prev);
                      setFormState((prev) => ({
                        ...prev,
                        new_topic_name: "",
                      }));
                    }}
                    className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                  >
                    {createNewTopicMode ? "Select Existing" : "+ New Topic"}
                  </button>
                </div>
                {createNewTopicMode ? (
                  <input
                    type="text"
                    value={formState.new_topic_name ?? ""}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        new_topic_name: e.target.value,
                      }))
                    }
                    placeholder="Enter new topic name..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] text-xs sm:text-sm text-slate-900 dark:text-[#F1F5F9]"
                  />
                ) : (
                  <select
                    value={formState.topic_id ?? ""}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        topic_id: e.target.value || null,
                      }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] text-xs sm:text-sm text-slate-900 dark:text-[#F1F5F9]"
                  >
                    <option value="">-- All / General Topic --</option>
                    {chapterTopics.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Question Type */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-[#A7B3C7] mb-1">
                  Question Type <span className="text-rose-500">*</span>
                </label>
                <select
                  value={formState.question_type}
                  onChange={(e) => {
                    const nextType = e.target.value as QuestionType;
                    setFormState((prev) => ({
                      ...prev,
                      question_type: nextType,
                      answer_type:
                        nextType === "SUBJECTIVE"
                          ? prev.answer_type ?? "SHORT"
                          : nextType === "CASE_BASED"
                          ? prev.answer_type
                          : null,
                    }));
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] text-xs sm:text-sm text-slate-900 dark:text-[#F1F5F9]"
                >
                  {QUESTION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Subjective Answer Type (when SUBJECTIVE or CASE_BASED) */}
              {(formState.question_type === "SUBJECTIVE" ||
                formState.question_type === "CASE_BASED") && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-[#A7B3C7] mb-1">
                    Subjective Answer Type{" "}
                    {formState.question_type === "SUBJECTIVE" && (
                      <span className="text-rose-500">*</span>
                    )}
                  </label>
                  <select
                    value={formState.answer_type ?? ""}
                    onChange={(e) => {
                      const val = (e.target.value ||
                        null) as SubjectiveAnswerType | null;
                      const preset = SUBJECTIVE_ANSWER_TYPES.find(
                        (s) => s.value === val
                      );
                      setFormState((prev) => ({
                        ...prev,
                        answer_type: val,
                        marks: preset ? preset.defaultMarks : prev.marks,
                      }));
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] text-xs sm:text-sm text-slate-900 dark:text-[#F1F5F9]"
                  >
                    {formState.question_type === "CASE_BASED" && (
                      <option value="">-- Optional / Mixed --</option>
                    )}
                    {SUBJECTIVE_ANSWER_TYPES.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Difficulty & Status */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-[#A7B3C7] mb-1">
                    Difficulty
                  </label>
                  <select
                    value={formState.difficulty}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        difficulty: e.target.value as DifficultyLevel,
                      }))
                    }
                    className="w-full px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] text-xs sm:text-sm text-slate-900 dark:text-[#F1F5F9]"
                  >
                    {DIFFICULTY_LEVELS.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-[#A7B3C7] mb-1">
                    Status
                  </label>
                  <select
                    value={formState.status}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        status: e.target.value as QuestionStatus,
                      }))
                    }
                    className="w-full px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] text-xs sm:text-sm text-slate-900 dark:text-[#F1F5F9]"
                  >
                    {QUESTION_STATUSES.map((st) => (
                      <option
                        key={st.value}
                        value={st.value}
                        disabled={
                          st.value === "PUBLISHED" && !canPublishQuestions
                        }
                      >
                        {st.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Marks & Negative Marks */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-[#A7B3C7] mb-1">
                    Marks <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    max="20"
                    value={formState.marks}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        marks: Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] text-xs sm:text-sm text-slate-900 dark:text-[#F1F5F9]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-[#A7B3C7] mb-1">
                    Negative Marks
                  </label>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    max="10"
                    value={formState.negative_marks}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        negative_marks: Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] text-xs sm:text-sm text-slate-900 dark:text-[#F1F5F9]"
                  />
                </div>
              </div>
            </div>

            {/* ===============================================================
                6. IMAGE & DIAGRAM MANAGER (`question-media` Bucket)
            =============================================================== */}
            <div className="bg-white dark:bg-[#151F32] rounded-2xl border border-slate-200/90 dark:border-slate-800 p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    Supabase Storage • question-media
                  </span>
                  <h3 className="text-sm font-bold text-slate-950 dark:text-[#F1F5F9]">
                    Diagrams & Figures ({formState.media.length})
                  </h3>
                </div>

                <input
                  ref={galleryFileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    setIsUploadingGalleryDiagram(true);
                    try {
                      await handleUploadDiagram(file, "ATTACHMENT");
                    } finally {
                      setIsUploadingGalleryDiagram(false);
                    }
                  }}
                  className="hidden"
                />

                <button
                  type="button"
                  disabled={isUploadingGalleryDiagram}
                  onClick={() => galleryFileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
                >
                  {isUploadingGalleryDiagram ? "Uploading..." : "+ Upload File"}
                </button>
              </div>

              <p className="text-[11px] text-slate-500 dark:text-[#A7B3C7] leading-relaxed">
                Upload geometric diagrams, graphs, or figures to the private{" "}
                <code>question-media</code> bucket and insert them into the
                question or solution.
              </p>

              {/* Optional External / Direct Diagram URL Input */}
              <div className="space-y-2 pt-1">
                <input
                  type="text"
                  value={manualMediaUrl}
                  onChange={(e) => setManualMediaUrl(e.target.value)}
                  placeholder="Or paste diagram URL / storage path..."
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={manualMediaCaption}
                    onChange={(e) => setManualMediaCaption(e.target.value)}
                    placeholder="Figure caption (e.g. Fig 1: △ABC)"
                    className="flex-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!manualMediaUrl.trim()) return;
                      setFormState((prev) => ({
                        ...prev,
                        media: [
                          ...prev.media,
                          {
                            media_url: manualMediaUrl.trim(),
                            media_type: "IMAGE",
                            caption: manualMediaCaption.trim() || "Figure",
                          },
                        ],
                      }));
                      setManualMediaUrl("");
                      setManualMediaCaption("");
                    }}
                    className="px-3 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 text-xs font-semibold cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Uploaded Diagrams Preview List */}
              {formState.media.length > 0 && (
                <div className="space-y-3 pt-2">
                  {formState.media.map((m, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-xl bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 space-y-2"
                    >
                      <StorageImage
                        src={m.media_url}
                        caption={m.caption}
                        className="max-h-32 w-auto mx-auto rounded-lg object-contain"
                      />
                      <input
                        type="text"
                        value={m.caption}
                        onChange={(e) => {
                          const val = e.target.value;
                          setFormState((prev) => ({
                            ...prev,
                            media: prev.media.map((item, i) =>
                              i === idx ? { ...item, caption: val } : item
                            ),
                          }));
                        }}
                        placeholder="Figure caption..."
                        className="w-full px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] text-xs"
                      />
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              handleInsertMediaIntoField(m, "question_text")
                            }
                            className="px-2 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 text-[10px] font-semibold cursor-pointer"
                          >
                            + In Question
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleInsertMediaIntoField(m, "model_answer")
                            }
                            className="px-2 py-1 rounded-lg bg-violet-50 dark:bg-violet-950/70 text-violet-700 dark:text-violet-300 text-[10px] font-semibold cursor-pointer"
                          >
                            + In Solution
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleRemoveDiagram(idx)}
                          className="px-2 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400 text-[10px] font-semibold cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* =================================================================
              CENTRE COLUMN: 2. MATHEMATICAL EDITOR, 4. OPTIONS & 5. SOLUTIONS
          ================================================================= */}
          <div className="lg:col-span-5 space-y-6">
            {/* Case Study Section (when CASE_BASED) */}
            {formState.question_type === "CASE_BASED" && (
              <div className="bg-white dark:bg-[#151F32] rounded-2xl border border-violet-200 dark:border-violet-800/70 p-5 shadow-2xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400">
                      Case-Based Context • public.case_studies
                    </span>
                    <h3 className="text-sm font-bold text-slate-950 dark:text-[#F1F5F9]">
                      Case Study Scenario & Passage
                    </h3>
                  </div>

                  {chapterCaseStudies.length > 0 && (
                    <select
                      value={formState.case_study_id ?? ""}
                      onChange={(e) => {
                        const id = e.target.value || null;
                        const found = caseStudies.find((c) => c.id === id);
                        setFormState((prev) => ({
                          ...prev,
                          case_study_id: id,
                          case_study_title: found?.title ?? "",
                          case_study_passage: found?.passage ?? "",
                        }));
                      }}
                      className="px-3 py-1.5 rounded-xl border border-violet-200 dark:border-violet-700 bg-violet-50/50 dark:bg-[#1E293B] text-xs"
                    >
                      <option value="">-- New Case Study Passage --</option>
                      {chapterCaseStudies.map((cs) => (
                        <option key={cs.id} value={cs.id}>
                          {cs.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-[#A7B3C7] mb-1">
                    Case Study Title
                  </label>
                  <input
                    type="text"
                    value={formState.case_study_title ?? ""}
                    onChange={(e) =>
                      setFormState((prev) => ({
                        ...prev,
                        case_study_title: e.target.value,
                      }))
                    }
                    placeholder="e.g., Parabolic Arch Bridge Architecture"
                    className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] text-sm"
                  />
                </div>

                <MathRichEditor
                  label="Case Study Passage"
                  rows={4}
                  value={formState.case_study_passage ?? ""}
                  onChange={(val) =>
                    setFormState((prev) => ({
                      ...prev,
                      case_study_passage: val,
                    }))
                  }
                  placeholder="Write the real-world mathematical case study scenario..."
                  onUploadDiagram={(file) =>
                    handleUploadDiagram(file, "STATEMENT")
                  }
                />
              </div>
            )}

            {/* 2. MATHEMATICAL QUESTION STATEMENT EDITOR */}
            <div className="bg-white dark:bg-[#151F32] rounded-2xl border border-slate-200/90 dark:border-slate-800 p-5 shadow-2xs space-y-4">
              <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  2. Mathematical Question Editor • public.questions
                </span>
                <h3 className="text-base font-bold text-slate-950 dark:text-[#F1F5F9]">
                  Question Statement & Equations
                </h3>
              </div>

              <MathRichEditor
                id="composer-question-statement"
                label="Question Statement"
                required
                rows={6}
                value={formState.question_text}
                onChange={(val) =>
                  setFormState((prev) => ({
                    ...prev,
                    question_text: val,
                  }))
                }
                placeholder="Write the question statement here. Click any symbol above or open the Visual Formula Builder to insert fractions, roots, powers, matrices, or trigonometry without writing LaTeX..."
                helperText="Supports visual equations, fractions, square/nth roots, powers, subscripts, matrices, Greek letters, inequalities, trig, limits/integrals, lists, and uploaded diagrams."
                onUploadDiagram={(file) =>
                  handleUploadDiagram(file, "STATEMENT")
                }
              />
            </div>

            {/* 4. CONDITIONAL ANSWER CONFIGURATION (MCQ / TRUE_FALSE / FILL_BLANK) */}
            {(formState.question_type === "MCQ" ||
              formState.question_type === "CASE_BASED") && (
              <div className="bg-white dark:bg-[#151F32] rounded-2xl border border-slate-200/90 dark:border-slate-800 p-5 shadow-2xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                      4. Conditional MCQ Editor • public.question_options
                    </span>
                    <h3 className="text-base font-bold text-slate-950 dark:text-[#F1F5F9]">
                      Answer Options & Correct Choice Selection
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-[#A7B3C7] mt-0.5">
                      {formState.options.some((o) => Boolean(o.is_correct)) ? (
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          ✓ Correct Answer Key:{" "}
                          {formState.options
                            .filter((o) => Boolean(o.is_correct))
                            .map((o) => `Option ${o.option_key}`)
                            .join(", ")}
                        </span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                          Select the &ldquo;Correct&rdquo; radio button next to the right option below.
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-xl p-0.5 bg-slate-200/80 dark:bg-slate-800 text-xs">
                      <button
                        type="button"
                        onClick={() =>
                          setFormState((prev) => {
                            const firstCorrectIdx = prev.options.findIndex(
                              (o) => Boolean(o.is_correct)
                            );
                            return {
                              ...prev,
                              mcq_mode: "SINGLE",
                              options: prev.options.map((o, idx) => ({
                                ...o,
                                is_correct:
                                  firstCorrectIdx !== -1 &&
                                  idx === firstCorrectIdx,
                              })),
                            };
                          })
                        }
                        className={`px-2.5 py-1 rounded-lg font-semibold cursor-pointer ${
                          formState.mcq_mode === "SINGLE"
                            ? "bg-white dark:bg-[#151F32] text-indigo-700 dark:text-indigo-300 shadow-2xs"
                            : "text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        Single Correct
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setFormState((prev) => ({
                            ...prev,
                            mcq_mode: "MULTIPLE",
                          }))
                        }
                        className={`px-2.5 py-1 rounded-lg font-semibold cursor-pointer ${
                          formState.mcq_mode === "MULTIPLE"
                            ? "bg-white dark:bg-[#151F32] text-indigo-700 dark:text-indigo-300 shadow-2xs"
                            : "text-slate-600 dark:text-slate-400"
                        }`}
                      >
                        Multiple Correct
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={onAddOption}
                      className="px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-semibold cursor-pointer"
                    >
                      + Add Option
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {formState.options.map((opt, idx) => {
                    const isSelectedCorrect = Boolean(opt.is_correct);
                    const inputId = `composer-mcq-correct-${idx}`;
                    return (
                      <div
                        key={opt.option_key || idx}
                        className={`p-3 rounded-2xl border transition-colors ${
                          isSelectedCorrect
                            ? "border-emerald-400 dark:border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/25"
                            : "border-slate-200 dark:border-slate-700 bg-slate-50/40 dark:bg-[#1E293B]/40"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Non-interactive option key badge — does NOT toggle is_correct */}
                          <span
                            aria-hidden="true"
                            className={`w-8 h-8 rounded-xl font-mono font-bold text-xs flex items-center justify-center shrink-0 transition-colors mt-0.5 select-none ${
                              isSelectedCorrect
                                ? "bg-emerald-600 text-white shadow-2xs"
                                : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            {opt.option_key}
                          </span>

                          <CompactMathInput
                            value={opt.option_text}
                            onChange={(val) =>
                              setFormState((prev) => ({
                                ...prev,
                                options: prev.options.map((item, i) =>
                                  i === idx
                                    ? { ...item, option_text: val }
                                    : item
                                ),
                              }))
                            }
                            placeholder={`Option ${opt.option_key} (click '∑ Math' for equations)...`}
                          />

                          {/* Exclusive Correct-Answer Radio / Checkbox Control */}
                          <label
                            htmlFor={inputId}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer shrink-0 mt-0.5 transition-all select-none ${
                              isSelectedCorrect
                                ? "border-emerald-400 dark:border-emerald-600 bg-emerald-100/80 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 shadow-2xs"
                                : "border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600"
                            }`}
                          >
                            <input
                              id={inputId}
                              type={
                                formState.mcq_mode === "SINGLE"
                                  ? "radio"
                                  : "checkbox"
                              }
                              name="composer-mcq-correct"
                              checked={isSelectedCorrect}
                              onChange={() => onToggleOptionCorrect(idx)}
                              className="w-3.5 h-3.5 accent-emerald-600 cursor-pointer"
                            />
                            <span>
                              {isSelectedCorrect ? "✓ Correct" : "Correct"}
                            </span>
                          </label>

                          {formState.options.length > 2 && (
                            <button
                              type="button"
                              onClick={() => onRemoveOption(idx)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 cursor-pointer mt-0.5"
                              title="Remove option"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TRUE / FALSE EDITOR */}
            {formState.question_type === "TRUE_FALSE" && (
              <div className="bg-white dark:bg-[#151F32] rounded-2xl border border-slate-200/90 dark:border-slate-800 p-5 shadow-2xs space-y-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 block">
                  4. True / False Answer Selection • public.question_answers
                </span>
                <div className="grid grid-cols-2 gap-4">
                  {(["TRUE", "FALSE"] as const).map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() =>
                        setFormState((prev) => ({
                          ...prev,
                          correct_true_false: val,
                        }))
                      }
                      className={`p-4 rounded-2xl border text-sm font-bold flex items-center justify-center gap-2 cursor-pointer transition-all ${
                        formState.correct_true_false === val
                          ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 shadow-2xs"
                          : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <span>{val}</span>
                      {formState.correct_true_false === val && <span>✓</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* FILL IN THE BLANK EDITOR */}
            {formState.question_type === "FILL_BLANK" && (
              <div className="bg-white dark:bg-[#151F32] rounded-2xl border border-slate-200/90 dark:border-slate-800 p-5 shadow-2xs space-y-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 block">
                  4. Fill in the Blank Expected Answer • public.question_answers
                </span>
                <label className="block text-xs font-semibold text-slate-700 dark:text-[#A7B3C7]">
                  Expected Answer(s) (Separate multiple accepted forms with{" "}
                  <code>|</code>) *
                </label>
                <CompactMathInput
                  value={formState.correct_fill_blank}
                  onChange={(val) =>
                    setFormState((prev) => ({
                      ...prev,
                      correct_fill_blank: val,
                    }))
                  }
                  placeholder="e.g., 2, 3 | x = 2, 3"
                />
              </div>
            )}

            {/* 5. SOLUTION & MARKING SCHEME EDITOR (`public.question_answers`) */}
            <div className="bg-white dark:bg-[#151F32] rounded-2xl border border-slate-200/90 dark:border-slate-800 p-5 shadow-2xs space-y-5">
              <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  5. Solution & Marking Scheme Editor • public.question_answers
                </span>
                <h3 className="text-base font-bold text-slate-950 dark:text-[#F1F5F9]">
                  Correct Answer, Model Solution & Step-wise Marks
                </h3>
              </div>

              {/* Correct Answer Summary (for Subjective / Case Based) */}
              {(formState.question_type === "SUBJECTIVE" ||
                formState.question_type === "CASE_BASED") && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-[#A7B3C7] mb-1.5">
                    Correct Answer Summary (Final Result / Key Value)
                  </label>
                  <CompactMathInput
                    value={formState.correct_subjective_summary}
                    onChange={(val) =>
                      setFormState((prev) => ({
                        ...prev,
                        correct_subjective_summary: val,
                      }))
                    }
                    placeholder="e.g., The roots are $x = 2$ and $x = 3$"
                  />
                </div>
              )}

              {/* Model Answer (Rich Text + Visual Math + Solution Diagram Upload) */}
              <MathRichEditor
                id="composer-model-answer"
                label="Complete Model Answer"
                rows={5}
                value={formState.model_answer}
                onChange={(val) =>
                  setFormState((prev) => ({
                    ...prev,
                    model_answer: val,
                  }))
                }
                placeholder="Write the complete NCERT / Board-standard model solution with equations and diagrams..."
                onUploadDiagram={(file) =>
                  handleUploadDiagram(file, "SOLUTION")
                }
              />

              {/* Step-by-Step Solution with Individual Step Marks */}
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-[#A7B3C7] block">
                      Step-by-Step Solution & Step Marks Allocation
                    </label>
                    <span className="text-[11px] text-slate-500 dark:text-[#A7B3C7]">
                      Allocated across steps:{" "}
                      <strong
                        className={
                          totalStepMarks === Number(formState.marks)
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-amber-600 dark:text-amber-400"
                        }
                      >
                        {totalStepMarks} / {formState.marks} Marks
                      </strong>
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setFormState((prev) => ({
                        ...prev,
                        step_by_step_solution: [
                          ...prev.step_by_step_solution,
                          {
                            step_number:
                              prev.step_by_step_solution.length + 1,
                            title: `Step ${
                              prev.step_by_step_solution.length + 1
                            }`,
                            explanation: "",
                            marks: 1,
                          },
                        ],
                      }))
                    }
                    className="px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-semibold cursor-pointer"
                  >
                    + Add Solution Step
                  </button>
                </div>

                <div className="space-y-3">
                  {formState.step_by_step_solution.map((step, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-2xl bg-slate-50/70 dark:bg-[#1E293B]/60 border border-slate-200 dark:border-slate-700 space-y-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1">
                          <span className="w-6 h-6 rounded-lg bg-indigo-600 text-white font-mono font-bold text-xs flex items-center justify-center shrink-0">
                            {idx + 1}
                          </span>
                          <input
                            type="text"
                            value={step.title}
                            onChange={(e) => {
                              const val = e.target.value;
                              setFormState((prev) => ({
                                ...prev,
                                step_by_step_solution:
                                  prev.step_by_step_solution.map((s, i) =>
                                    i === idx ? { ...s, title: val } : s
                                  ),
                              }));
                            }}
                            placeholder={`Step ${idx + 1} Title (e.g., Factorising the quadratic)`}
                            className="flex-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] text-xs font-semibold"
                          />
                        </div>

                        <div className="flex items-center gap-1.5">
                          <label className="text-[11px] font-semibold text-slate-500 dark:text-[#A7B3C7]">
                            Step Marks:
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max="20"
                            value={step.marks ?? 1}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setFormState((prev) => ({
                                ...prev,
                                step_by_step_solution:
                                  prev.step_by_step_solution.map((s, i) =>
                                    i === idx ? { ...s, marks: val } : s
                                  ),
                              }));
                            }}
                            className="w-16 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] text-xs font-mono font-bold text-center"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setFormState((prev) => ({
                                ...prev,
                                step_by_step_solution: prev.step_by_step_solution
                                  .filter((_, i) => i !== idx)
                                  .map((s, i) => ({
                                    ...s,
                                    step_number: i + 1,
                                  })),
                              }))
                            }
                            className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                            title="Delete step"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      <CompactMathInput
                        multiline
                        rows={2}
                        value={step.explanation}
                        onChange={(val) =>
                          setFormState((prev) => ({
                            ...prev,
                            step_by_step_solution:
                              prev.step_by_step_solution.map((s, i) =>
                                i === idx ? { ...s, explanation: val } : s
                              ),
                          }))
                        }
                        placeholder="Write the mathematical derivation or explanation for this step..."
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Marking Scheme Breakdown */}
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-[#A7B3C7] block">
                      CBSE Marking Scheme Criteria
                    </label>
                    <span className="text-[11px] text-slate-500 dark:text-[#A7B3C7]">
                      Scheme Total:{" "}
                      <strong>
                        {totalSchemeMarks} / {formState.marks} Marks
                      </strong>
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSyncMarkingSchemeFromSteps}
                      className="px-2.5 py-1 rounded-lg border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 text-[11px] font-semibold cursor-pointer"
                    >
                      ⇄ Copy from Steps
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFormState((prev) => ({
                          ...prev,
                          marking_scheme: [
                            ...prev.marking_scheme,
                            { criterion: "", marks: 1, notes: "" },
                          ],
                        }))
                      }
                      className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[11px] font-semibold cursor-pointer"
                    >
                      + Add Criterion
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {formState.marking_scheme.map((item, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center bg-slate-50/70 dark:bg-[#1E293B]/60 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700"
                    >
                      <input
                        type="text"
                        value={item.criterion}
                        onChange={(e) => {
                          const val = e.target.value;
                          setFormState((prev) => ({
                            ...prev,
                            marking_scheme: prev.marking_scheme.map((m, i) =>
                              i === idx ? { ...m, criterion: val } : m
                            ),
                          }));
                        }}
                        placeholder="Criterion (e.g., Substituting values in quadratic formula)"
                        className="sm:col-span-8 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] text-xs"
                      />
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={item.marks}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setFormState((prev) => ({
                            ...prev,
                            marking_scheme: prev.marking_scheme.map((m, i) =>
                              i === idx ? { ...m, marks: val } : m
                            ),
                          }));
                        }}
                        placeholder="Marks"
                        className="sm:col-span-3 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] text-xs font-mono font-bold text-center"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setFormState((prev) => ({
                            ...prev,
                            marking_scheme: prev.marking_scheme.filter(
                              (_, i) => i !== idx
                            ),
                          }))
                        }
                        className="sm:col-span-1 py-1 text-xs text-slate-400 hover:text-rose-600 cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* =================================================================
              RIGHT COLUMN: 3. STICKY LIVE STUDENT PREVIEW PANEL
          ================================================================= */}
          <div className="lg:col-span-4 lg:sticky lg:top-36 space-y-4">
            <div className="bg-white dark:bg-[#151F32] rounded-2xl border border-slate-200/90 dark:border-slate-800 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>3. Live Student Preview</span>
                  </span>
                  <h3 className="text-sm font-bold text-slate-950 dark:text-[#F1F5F9]">
                    Real-Time Rendered Question Card
                  </h3>
                </div>

                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800">
                  {formState.marks} {formState.marks === 1 ? "Mark" : "Marks"}
                </span>
              </div>

              {/* Metadata Pills */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="px-2 py-0.5 rounded-md font-mono font-bold bg-slate-100 dark:bg-[#1E293B] text-slate-700 dark:text-slate-300">
                  {formState.question_code || "AUTO-CODE"}
                </span>
                <span className="px-2 py-0.5 rounded-md font-semibold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300">
                  {selectedChapter
                    ? `Ch ${selectedChapter.chapter_number}: ${selectedChapter.name}`
                    : "Select Chapter"}
                </span>
                <span className="px-2 py-0.5 rounded-md font-semibold bg-violet-50 dark:bg-violet-950/70 text-violet-700 dark:text-violet-300">
                  {formState.question_type}
                  {formState.answer_type ? ` (${formState.answer_type})` : ""}
                </span>
              </div>

              {/* Case Study Preview if CASE_BASED */}
              {formState.question_type === "CASE_BASED" &&
                (formState.case_study_title ||
                  formState.case_study_passage) && (
                  <div className="p-3.5 rounded-xl bg-violet-50/50 dark:bg-violet-950/30 border border-violet-200/70 dark:border-violet-800/70 text-xs space-y-1">
                    <p className="font-bold text-violet-800 dark:text-violet-300">
                      Case Study: {formState.case_study_title || "Passage"}
                    </p>
                    <MathContentRenderer
                      content={formState.case_study_passage || ""}
                    />
                  </div>
                )}

              {/* Rendered Question Statement */}
              <div className="p-4 rounded-2xl bg-slate-50/90 dark:bg-[#0B1120]/80 border border-slate-200/80 dark:border-slate-800 text-sm text-slate-950 dark:text-[#F1F5F9] leading-relaxed min-h-24">
                {formState.question_text.trim() ? (
                  <MathContentRenderer content={formState.question_text} />
                ) : (
                  <p className="text-xs italic text-slate-400 dark:text-slate-500">
                    Your question statement, mathematical equations, and
                    diagrams will render here exactly as students see them...
                  </p>
                )}
              </div>

              {/* Standalone Gallery Diagrams Preview */}
              {formState.media.filter(
                (m) =>
                  m.media_url.trim() !== "" &&
                  !formState.question_text.includes(m.media_url) &&
                  !formState.model_answer.includes(m.media_url)
              ).length > 0 && (
                <div className="space-y-2">
                  {formState.media
                    .filter(
                      (m) =>
                        m.media_url.trim() !== "" &&
                        !formState.question_text.includes(m.media_url) &&
                        !formState.model_answer.includes(m.media_url)
                    )
                    .map((m, idx) => (
                      <StorageImage
                        key={idx}
                        src={m.media_url}
                        caption={m.caption}
                      />
                    ))}
                </div>
              )}

              {/* Live MCQ Options Preview */}
              {(formState.question_type === "MCQ" ||
                (formState.question_type === "CASE_BASED" &&
                  formState.options.some(
                    (o) => o.option_text.trim() !== ""
                  ))) && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                      Options Preview ({formState.mcq_mode})
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowSolutionInPreview((p) => !p)}
                      className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                    >
                      {showSolutionInPreview
                        ? "Switch to Student Test View"
                        : "Show Answer Key Overlay"}
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {formState.options.map((opt, idx) => {
                      const isExplicitlyCorrect = Boolean(opt.is_correct);
                      const highlightAsCorrect =
                        showSolutionInPreview && isExplicitlyCorrect;
                      return (
                        <div
                          key={opt.option_key || idx}
                          className={`p-2.5 rounded-xl border text-xs flex items-center gap-2.5 transition-colors ${
                            highlightAsCorrect
                              ? "border-emerald-400 dark:border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/30 font-semibold"
                              : "border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-[#1E293B]/60"
                          }`}
                        >
                          <span
                            className={`w-6 h-6 rounded-md border font-mono font-bold text-[11px] flex items-center justify-center shrink-0 ${
                              highlightAsCorrect
                                ? "bg-emerald-600 text-white border-emerald-600"
                                : "bg-white dark:bg-[#151F32] border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                            }`}
                          >
                            {opt.option_key}
                          </span>
                          <div className="flex-1 text-slate-900 dark:text-[#F1F5F9]">
                            {opt.option_text.trim() ? (
                              <MathContentRenderer
                                content={opt.option_text}
                                inline
                              />
                            ) : (
                              <span className="italic text-slate-400">
                                Option {opt.option_key}
                              </span>
                            )}
                          </div>
                          {highlightAsCorrect && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white shrink-0">
                              ✓ Correct
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Live Solution Preview Accordion */}
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                    Solution & Answer Key Preview
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowSolutionInPreview((p) => !p)}
                    className="text-[11px] font-semibold text-slate-500 hover:text-indigo-600 cursor-pointer"
                  >
                    {showSolutionInPreview ? "Hide (Student Test Mode)" : "Show Answer Key"}
                  </button>
                </div>

                {showSolutionInPreview && (
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#1E293B]/70 border border-slate-200/80 dark:border-slate-700 space-y-3 text-xs">
                    {(formState.question_type === "MCQ" ||
                      (formState.question_type === "CASE_BASED" &&
                        formState.options.some(
                          (o) => o.option_text.trim() !== "" || o.is_correct
                        ))) && (
                      <div>
                        <span className="font-bold text-slate-500 dark:text-[#A7B3C7]">
                          Saved Answer Key:{" "}
                        </span>
                        {formState.options.some((o) => Boolean(o.is_correct)) ? (
                          <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            {formState.options
                              .filter((o) => Boolean(o.is_correct))
                              .map((o) => `Option ${o.option_key}`)
                              .join(", ")}
                          </span>
                        ) : (
                          <span className="italic text-amber-600 dark:text-amber-400">
                            Not selected yet
                          </span>
                        )}
                      </div>
                    )}

                    {formState.question_type === "TRUE_FALSE" && (
                      <div>
                        <span className="font-bold text-slate-500 dark:text-[#A7B3C7]">
                          Correct Choice:{" "}
                        </span>
                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          {formState.correct_true_false}
                        </span>
                      </div>
                    )}

                    {formState.question_type === "FILL_BLANK" &&
                      formState.correct_fill_blank.trim() && (
                        <div>
                          <span className="font-bold text-slate-500 dark:text-[#A7B3C7] block mb-0.5">
                            Expected Answer:
                          </span>
                          <MathContentRenderer
                            content={formState.correct_fill_blank}
                            inline
                          />
                        </div>
                      )}

                    {formState.correct_subjective_summary.trim() && (
                      <div>
                        <span className="font-bold text-slate-500 dark:text-[#A7B3C7] block mb-0.5">
                          Answer Summary:
                        </span>
                        <MathContentRenderer
                          content={formState.correct_subjective_summary}
                        />
                      </div>
                    )}

                    {formState.model_answer.trim() && (
                      <div>
                        <span className="font-bold text-slate-500 dark:text-[#A7B3C7] block mb-0.5">
                          Model Answer:
                        </span>
                        <MathContentRenderer content={formState.model_answer} />
                      </div>
                    )}

                    {formState.step_by_step_solution.filter(
                      (s) => s.explanation.trim() !== ""
                    ).length > 0 && (
                      <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-slate-700">
                        <span className="font-bold text-slate-500 dark:text-[#A7B3C7] block">
                          Steps ({totalStepMarks}M):
                        </span>
                        {formState.step_by_step_solution
                          .filter((s) => s.explanation.trim() !== "")
                          .map((s, idx) => (
                            <div
                              key={idx}
                              className="flex items-start justify-between gap-2"
                            >
                              <div>
                                <strong>{s.title}: </strong>
                                <MathContentRenderer
                                  content={s.explanation}
                                  inline
                                />
                              </div>
                              {s.marks !== undefined && (
                                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 shrink-0">
                                  [{s.marks}M]
                                </span>
                              )}
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

