"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { useAuth } from "@/components/auth-provider";
import {
  MathContentRenderer,
  StorageImage,
} from "@/components/math-renderer";
import {
  type IngestionBatchRecord,
  type StagingQuestionRecord,
  type StagingReviewStatus,
  type DuplicateMatchResult,
  fetchIngestionBatchById,
  fetchStagingQuestions,
  updateStagingQuestionCuration,
  rejectStagingQuestion,
  promoteStagingQuestion,
  detectProductionDuplicateMatches,
  getSourcePdfSignedUrl,
} from "@/lib/admin-staging-db";
import {
  type ChapterRecord,
  type TopicRecord,
  type QuestionType,
  type DifficultyLevel,
  fetchChapters,
  fetchTopics,
} from "@/lib/admin-questions-db";

// ============================================================================
// Badges and Helpers
// ============================================================================

function ReviewStatusBadge({ status }: { status: StagingReviewStatus | string }) {
  switch (status) {
    case "PROMOTED":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Promoted to Draft
        </span>
      );
    case "ACCEPTED":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          Accepted
        </span>
      );
    case "EDITED":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
          Edited
        </span>
      );
    case "REJECTED":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
          Rejected
        </span>
      );
    case "PENDING":
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          Pending Review
        </span>
      );
  }
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);
  if (confidence >= 0.85) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
        {percent}% High Confidence
      </span>
    );
  }
  if (confidence >= 0.7) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
        {percent}% Review Required
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
      {percent}% Structural Defect
    </span>
  );
}

// ============================================================================
// Main Batch Curation Workspace Page
// ============================================================================

function BatchCurationWorkspaceContent() {
  const router = useRouter();
  const urlParams = useParams();
  const batchId = (Array.isArray(urlParams.batchId)
    ? urlParams.batchId[0]
    : urlParams.batchId) as string;

  const {
    user,
    profile,
    loading: authLoading,
    profileLoading,
    profileError,
    signOut,
  } = useAuth();

  const normalizedRole = (profile?.role ?? "").trim().toUpperCase();
  const isRoleLoading = authLoading || profileLoading;
  const isAuthorizedAdmin = normalizedRole === "ADMIN";

  // Data states
  const [batch, setBatch] = useState<IngestionBatchRecord | null>(null);
  const [questions, setQuestions] = useState<StagingQuestionRecord[]>([]);
  const [chapters, setChapters] = useState<ChapterRecord[]>([]);
  const [topics, setTopics] = useState<TopicRecord[]>([]);
  const [signedPdfUrl, setSignedPdfUrl] = useState<string | null>(null);

  // Loading & notification states
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  // Active candidate selection
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [candidateFilter, setCandidateFilter] = useState<
    "ALL" | "PENDING" | "FLAGGED" | "ACCEPTED" | "REJECTED" | "PROMOTED"
  >("ALL");

  // Editable candidate form state
  const [formStem, setFormStem] = useState("");
  const [formType, setFormType] = useState<QuestionType>("MCQ");
  const [formChapterId, setFormChapterId] = useState<string>("");
  const [formTopicId, setFormTopicId] = useState<string>("");
  const [formDifficulty, setFormDifficulty] = useState<DifficultyLevel>("MEDIUM");
  const [formMarks, setFormMarks] = useState<number>(1);
  const [formNegativeMarks, setFormNegativeMarks] = useState<number>(0);
  const [formOptions, setFormOptions] = useState<
    Array<{ key: string; text: string; is_correct?: boolean }>
  >([]);
  const [formSubparts, setFormSubparts] = useState<
    Array<{ label: string; text: string }>
  >([]);
  const [formAnswer, setFormAnswer] = useState<string>("");
  const [formSolution, setFormSolution] = useState<string>("");

  // UI view toggles
  const [activeLeftTab, setActiveLeftTab] = useState<"PDF" | "DIAGRAMS">("PDF");
  const [showLivePreview, setShowLivePreview] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isPromoting, setIsPromoting] = useState<boolean>(false);
  const [promotionResult, setPromotionResult] = useState<{
    questionId: string;
    code?: string;
  } | null>(null);

  // Duplicate match state
  const [duplicateMatches, setDuplicateMatches] = useState<DuplicateMatchResult[]>([]);
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState<boolean>(false);

  // Redirect unauthenticated visitors
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace(`/login?redirectTo=/admin/ingestion/${batchId}`);
    }
  }, [authLoading, user, router, batchId]);

  // Load batch, questions, chapters, and topics
  const loadCurationData = useCallback(async () => {
    if (!batchId) return;
    setIsLoading(true);
    setPageError(null);
    try {
      const [batchRecord, stagingList, chaptersList, topicsList] = await Promise.all([
        fetchIngestionBatchById(batchId),
        fetchStagingQuestions(batchId),
        fetchChapters(),
        fetchTopics(),
      ]);

      if (!batchRecord) {
        throw new Error(`Ingestion batch ${batchId} was not found.`);
      }

      setBatch(batchRecord);
      setQuestions(stagingList);
      setChapters(chaptersList);
      setTopics(topicsList);

      // Load signed URL for source PDF
      if (batchRecord.pdf_storage_path) {
        const url = await getSourcePdfSignedUrl(batchRecord.pdf_storage_path, 7200);
        setSignedPdfUrl(url);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load curation data.";
      setPageError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    if (authLoading || !user || !isAuthorizedAdmin) return;
    loadCurationData();
  }, [authLoading, user, isAuthorizedAdmin, loadCurationData]);

  // Filtered candidate list
  const filteredQuestions = useMemo(() => {
    switch (candidateFilter) {
      case "PENDING":
        return questions.filter((q) => q.review_status === "PENDING");
      case "FLAGGED":
        return questions.filter(
          (q) => q.has_extraction_failures || q.extraction_warnings.length > 0
        );
      case "ACCEPTED":
        return questions.filter((q) => q.review_status === "ACCEPTED" || q.review_status === "EDITED");
      case "REJECTED":
        return questions.filter((q) => q.review_status === "REJECTED");
      case "PROMOTED":
        return questions.filter((q) => q.review_status === "PROMOTED");
      case "ALL":
      default:
        return questions;
    }
  }, [questions, candidateFilter]);

  // Active selected candidate
  const currentCandidate = useMemo(() => {
    if (filteredQuestions.length === 0) return null;
    const safeIndex = Math.min(selectedIndex, filteredQuestions.length - 1);
    return filteredQuestions[Math.max(0, safeIndex)] || null;
  }, [filteredQuestions, selectedIndex]);

  // Synchronize form state when active candidate changes
  useEffect(() => {
    if (!currentCandidate) return;

    setFormStem(currentCandidate.candidate_question_text || "");
    setFormType(currentCandidate.inferred_type || "MCQ");
    setFormChapterId(currentCandidate.target_chapter_id || "");
    setFormTopicId(currentCandidate.target_topic_id || "");
    setFormDifficulty(currentCandidate.target_difficulty || "MEDIUM");
    setFormMarks(Number(currentCandidate.target_marks) || 1);
    setFormNegativeMarks(Number(currentCandidate.target_negative_marks) || 0);

    const defaultOpts = (currentCandidate.detected_options || []).map((o) => ({
      key: o.key,
      text: o.text || "",
      is_correct: Boolean(o.is_correct),
    }));
    setFormOptions(defaultOpts);

    setFormSubparts(
      (currentCandidate.detected_subparts || []).map((s) => ({
        label: s.label,
        text: s.text,
      }))
    );

    setFormAnswer(currentCandidate.detected_answer || "");
    setFormSolution(currentCandidate.detected_solution || "");
    setPromotionResult(null);

    // If candidate has diagrams, automatically switch to diagram tab
    if (currentCandidate.detected_diagrams && currentCandidate.detected_diagrams.length > 0) {
      setActiveLeftTab("DIAGRAMS");
    }

    // Trigger duplicate check against production
    if (currentCandidate.candidate_question_text) {
      setIsCheckingDuplicates(true);
      detectProductionDuplicateMatches(
        currentCandidate.candidate_question_text,
        currentCandidate.target_chapter_id
      )
        .then((matches) => setDuplicateMatches(matches))
        .catch(() => setDuplicateMatches([]))
        .finally(() => setIsCheckingDuplicates(false));
    } else {
      setDuplicateMatches([]);
    }
  }, [currentCandidate]);

  // Filter topics based on selected chapter
  const availableTopics = useMemo(() => {
    if (!formChapterId) return [];
    return topics.filter((t) => t.chapter_id === formChapterId);
  }, [topics, formChapterId]);

  // Save edits handler
  const handleSaveEdits = async () => {
    if (!currentCandidate) return;
    setIsSaving(true);
    try {
      await updateStagingQuestionCuration(currentCandidate.id, {
        candidate_question_text: formStem.trim(),
        inferred_type: formType,
        target_chapter_id: formChapterId || null,
        target_topic_id: formTopicId || null,
        target_difficulty: formDifficulty,
        target_marks: formMarks,
        target_negative_marks: formNegativeMarks,
        detected_options: formOptions,
        detected_subparts: formSubparts,
        detected_answer: formAnswer.trim() || null,
        detected_solution: formSolution.trim() || null,
        review_status: "EDITED",
      });

      // Update local state
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === currentCandidate.id
            ? {
                ...q,
                candidate_question_text: formStem.trim(),
                inferred_type: formType,
                target_chapter_id: formChapterId || null,
                target_topic_id: formTopicId || null,
                target_difficulty: formDifficulty,
                target_marks: formMarks,
                target_negative_marks: formNegativeMarks,
                detected_options: formOptions,
                detected_subparts: formSubparts,
                detected_answer: formAnswer.trim() || null,
                detected_solution: formSolution.trim() || null,
                review_status: "EDITED",
              }
            : q
        )
      );

      setNotification({
        type: "success",
        message: `Saved edits for ${currentCandidate.detected_question_label} (Status: EDITED).`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save edits.";
      setNotification({ type: "error", message: msg });
    } finally {
      setIsSaving(false);
    }
  };

  // Accept candidate handler
  const handleAcceptCandidate = async () => {
    if (!currentCandidate) return;
    setIsSaving(true);
    try {
      await updateStagingQuestionCuration(currentCandidate.id, {
        review_status: "ACCEPTED",
      });

      setQuestions((prev) =>
        prev.map((q) =>
          q.id === currentCandidate.id ? { ...q, review_status: "ACCEPTED" } : q
        )
      );

      setNotification({
        type: "success",
        message: `Candidate ${currentCandidate.detected_question_label} marked as ACCEPTED. Ready for promotion.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to accept candidate.";
      setNotification({ type: "error", message: msg });
    } finally {
      setIsSaving(false);
    }
  };

  // Reject candidate handler
  const handleRejectCandidate = async () => {
    if (!currentCandidate) return;
    const reason = prompt(
      `Reject candidate ${currentCandidate.detected_question_label}? Enter optional reason:`,
      "Extraction quality insufficient"
    );
    if (reason === null) return; // User cancelled prompt

    setIsSaving(true);
    try {
      await rejectStagingQuestion(currentCandidate.id, reason);

      setQuestions((prev) =>
        prev.map((q) =>
          q.id === currentCandidate.id
            ? { ...q, review_status: "REJECTED", review_notes: reason }
            : q
        )
      );

      setNotification({
        type: "info",
        message: `Candidate ${currentCandidate.detected_question_label} marked as REJECTED.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to reject candidate.";
      setNotification({ type: "error", message: msg });
    } finally {
      setIsSaving(false);
    }
  };

  // One-click atomic promotion to production (Draft)
  const handlePromoteCandidate = async () => {
    if (!currentCandidate) return;
    if (
      currentCandidate.review_status !== "ACCEPTED" &&
      currentCandidate.review_status !== "EDITED"
    ) {
      setNotification({
        type: "error",
        message: "Candidate must be marked ACCEPTED or EDITED before promotion.",
      });
      return;
    }

    setIsPromoting(true);
    try {
      const prodQuestionId = await promoteStagingQuestion(currentCandidate.id, {
        target_chapter_id: formChapterId || undefined,
        target_topic_id: formTopicId || undefined,
        candidate_question_text: formStem.trim(),
        inferred_type: formType,
        target_difficulty: formDifficulty,
        target_marks: formMarks,
        target_negative_marks: formNegativeMarks,
        detected_options: formOptions,
      });

      // Update local state to PROMOTED
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === currentCandidate.id
            ? {
                ...q,
                review_status: "PROMOTED",
                promoted_question_id: prodQuestionId,
              }
            : q
        )
      );

      setPromotionResult({ questionId: prodQuestionId });
      setNotification({
        type: "success",
        message: `Successfully promoted ${currentCandidate.detected_question_label} to production as DRAFT (ID: ${prodQuestionId.slice(0, 8)}...).`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Promotion failed.";
      setNotification({ type: "error", message: msg });
    } finally {
      setIsPromoting(false);
    }
  };

  // ============================================================================
  // Guard & Loading Screens
  // ============================================================================

  if (isRoleLoading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1120] text-[#0F172A] dark:text-[#F1F5F9] flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-white font-mono font-bold text-lg animate-pulse">
            ∑
          </div>
          <p className="text-sm font-semibold text-slate-600 dark:text-[#A7B3C7]">
            Verifying administrator credentials...
          </p>
        </div>
      </div>
    );
  }

  if (!user || !isAuthorizedAdmin) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1120] text-[#0F172A] dark:text-[#F1F5F9] flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-white dark:bg-[#151F32] rounded-3xl border border-rose-200 dark:border-rose-900/60 p-8 text-center shadow-xl space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/80 text-rose-600 flex items-center justify-center mx-auto font-bold text-xl">
            !
          </div>
          <h1 className="text-xl font-bold text-slate-950 dark:text-[#F1F5F9]">
            Administrator Access Required
          </h1>
          <p className="text-sm text-slate-600 dark:text-[#A7B3C7]">
            Only authenticated administrators can curate and promote staged questions.
          </p>
          <div className="pt-2">
            <Link
              href="/admin/ingestion"
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold"
            >
              Back to Ingestion Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // Main Split-Screen Workspace
  // ============================================================================

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1120] text-[#0F172A] dark:text-[#F1F5F9] flex flex-col font-sans transition-colors">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-[#0B1120]/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 px-4 sm:px-6 py-2.5">
        <div className="max-w-full mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-white font-mono font-bold text-sm">
                ∑
              </div>
              <span className="font-bold text-sm tracking-tight text-slate-950 dark:text-white hidden sm:inline">
                MathPractice
              </span>
            </Link>
            <span className="text-slate-300 dark:text-slate-700">/</span>
            <Link
              href="/admin/ingestion"
              className="text-xs text-slate-600 dark:text-[#A7B3C7] hover:text-indigo-600 dark:hover:text-indigo-400 font-medium"
            >
              PDF Ingestion
            </Link>
            <span className="text-slate-300 dark:text-slate-700">/</span>
            <span className="text-xs font-semibold text-slate-900 dark:text-white truncate max-w-[200px]">
              {batch?.pdf_filename || batchId.slice(0, 8)}
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              href={`/preview/batch/${batchId}`}
              target="_blank"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition shadow-2xs"
            >
              <span>🎓</span>
              <span>Student Preview</span>
            </Link>

            <ThemeSwitcher />

            <Link
              href="/admin/questions"
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-[#A7B3C7] hover:bg-slate-100 dark:hover:bg-[#151F32]"
            >
              <span>Question Bank</span>
            </Link>

            <button
              type="button"
              onClick={async () => {
                await signOut();
                router.replace("/login");
              }}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-rose-50 dark:hover:bg-rose-950/50 hover:text-rose-600"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Workspace Banner & Notification */}
      {notification && (
        <div
          role="status"
          className={`px-4 py-2.5 text-xs sm:text-sm flex items-center justify-between border-b ${
            notification.type === "error"
              ? "bg-rose-50 dark:bg-rose-950/80 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200"
              : notification.type === "info"
              ? "bg-indigo-50 dark:bg-indigo-950/80 border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-200"
              : "bg-slate-900 dark:bg-[#1E293B] border-slate-800 text-white"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
            <span>{notification.message}</span>
            {promotionResult && (
              <Link
                href="/admin/questions"
                className="underline font-bold ml-2 text-indigo-300 hover:text-white"
              >
                View in Question Bank →
              </Link>
            )}
          </div>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="text-xs font-semibold opacity-70 hover:opacity-100"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Split-Screen Container */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden h-[calc(100vh-53px)]">
        {/* Left Pane: Source PDF Document Viewer & Diagrams (50% on desktop) */}
        <section
          aria-label="Source Document & Diagrams"
          className="w-full lg:w-1/2 flex flex-col border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-slate-800 bg-slate-100/60 dark:bg-[#0B1120]"
        >
          {/* Left Pane Header Tabs */}
          <div className="px-4 py-2.5 border-b border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-[#121A2B]/70 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveLeftTab("PDF")}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  activeLeftTab === "PDF"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-slate-600 dark:text-[#A7B3C7] hover:bg-slate-100 dark:hover:bg-[#1E293B]"
                }`}
              >
                Source Document PDF
              </button>
              <button
                type="button"
                onClick={() => setActiveLeftTab("DIAGRAMS")}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  activeLeftTab === "DIAGRAMS"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-slate-600 dark:text-[#A7B3C7] hover:bg-slate-100 dark:hover:bg-[#1E293B]"
                }`}
              >
                <span>Diagram Assets</span>
                {currentCandidate?.detected_diagrams?.length ? (
                  <span className="w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] flex items-center justify-center font-bold">
                    {currentCandidate.detected_diagrams.length}
                  </span>
                ) : null}
              </button>
            </div>

            {currentCandidate && (
              <span className="text-[11px] font-medium text-slate-500 dark:text-[#A7B3C7]">
                Page {currentCandidate.source_page_number} in PDF
              </span>
            )}
          </div>

          {/* Left Pane Content Body */}
          <div className="flex-1 overflow-hidden relative p-3">
            {activeLeftTab === "PDF" ? (
              signedPdfUrl ? (
                <iframe
                  src={`${signedPdfUrl}#page=${currentCandidate?.source_page_number || 1}`}
                  title="Source PDF Document"
                  className="w-full h-full rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white shadow-xs"
                />
              ) : (
                <div className="w-full h-full rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center p-6 text-center text-slate-400">
                  <p className="font-semibold text-sm">Source PDF preview unavailable</p>
                  <p className="text-xs mt-1">Generating signed URL or PDF is not accessible.</p>
                </div>
              )
            ) : (
              /* Diagrams Preview Tab */
              <div className="w-full h-full overflow-y-auto space-y-4 p-2">
                {currentCandidate?.detected_diagrams &&
                currentCandidate.detected_diagrams.length > 0 ? (
                  currentCandidate.detected_diagrams.map((diag, idx) => (
                    <div
                      key={diag.diagram_id || idx}
                      className="bg-white dark:bg-[#151F32] rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 shadow-xs space-y-2"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-indigo-600 dark:text-indigo-400">
                          Diagram {diag.diagram_id} (Page {diag.source_page || currentCandidate.source_page_number})
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {diag.width && diag.height
                            ? `Size: ${diag.width}×${diag.height}`
                            : diag.bbox
                            ? `BBox: [${diag.bbox.join(", ")}]`
                            : "Auto crop"}
                        </span>
                      </div>
                      <div className="bg-slate-50 dark:bg-[#0B1120] rounded-xl p-3 flex items-center justify-center border border-slate-100 dark:border-slate-800">
                        <StorageImage
                          src={diag.storage_url || diag.storage_path || ""}
                          alt={`Diagram for ${currentCandidate.detected_question_label}`}
                          className="max-h-72 object-contain"
                        />
                      </div>
                      <p className="text-[11px] text-slate-500 font-mono break-all">
                        Storage URI: {diag.storage_url || diag.storage_path}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-400">
                    <span className="text-3xl mb-2">📐</span>
                    <p className="font-semibold text-sm text-slate-600 dark:text-slate-300">
                      No diagrams associated with this candidate
                    </p>
                    <p className="text-xs text-slate-400 mt-1 max-w-xs">
                      If the question references a figure, you can upload diagrams in the Manual Question Composer after promotion.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Right Pane: Candidate Curation Form & Promotion Controls (50% on desktop) */}
        <section
          aria-label="Candidate Curation Workspace"
          className="w-full lg:w-1/2 flex flex-col bg-white dark:bg-[#151F32] overflow-hidden"
        >
          {/* Candidate Carousel & Filter Navigation Bar */}
          <div className="px-4 py-2.5 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-[#121A2B]/70 flex flex-wrap items-center justify-between gap-2 shrink-0">
            {/* Filter Tabs */}
            <div className="flex items-center gap-1 text-[11px]">
              {(["ALL", "PENDING", "FLAGGED", "ACCEPTED", "REJECTED", "PROMOTED"] as const).map(
                (filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => {
                      setCandidateFilter(filter);
                      setSelectedIndex(0);
                    }}
                    className={`px-2 py-1 rounded-md font-medium transition-colors ${
                      candidateFilter === filter
                        ? "bg-slate-900 dark:bg-white text-white dark:text-slate-950 font-bold"
                        : "text-slate-600 dark:text-[#A7B3C7] hover:bg-slate-200/60 dark:hover:bg-[#1E293B]"
                    }`}
                  >
                    {filter}
                  </button>
                )
              )}
            </div>

            {/* Candidate Index & Prev/Next Controls */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {filteredQuestions.length > 0
                  ? `${selectedIndex + 1} of ${filteredQuestions.length}`
                  : "0 candidates"}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={selectedIndex <= 0}
                  onClick={() => setSelectedIndex((i) => Math.max(0, i - 1))}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-[#1E293B]"
                  title="Previous Candidate"
                >
                  ←
                </button>
                <button
                  type="button"
                  disabled={selectedIndex >= filteredQuestions.length - 1}
                  onClick={() =>
                    setSelectedIndex((i) =>
                      Math.min(filteredQuestions.length - 1, i + 1)
                    )
                  }
                  className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-[#1E293B]"
                  title="Next Candidate"
                >
                  →
                </button>
              </div>
            </div>
          </div>

          {/* Form Scrollable Area */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
            {currentCandidate ? (
              <>
                {/* Candidate Status & Confidence Header */}
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200/70 dark:border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <span className="text-lg font-black text-indigo-600 dark:text-indigo-400">
                      {currentCandidate.detected_question_label}
                    </span>
                    <ReviewStatusBadge status={currentCandidate.review_status} />
                    <ConfidenceBadge confidence={currentCandidate.extraction_confidence} />
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowLivePreview(!showLivePreview)}
                      className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-600 dark:text-[#A7B3C7] hover:bg-slate-100 dark:hover:bg-[#1E293B]"
                    >
                      {showLivePreview ? "Hide Live KaTeX" : "Show Live KaTeX"}
                    </button>
                  </div>
                </div>

                {/* Extraction Warnings Alert Banner (if flagged) */}
                {currentCandidate.extraction_warnings &&
                  currentCandidate.extraction_warnings.length > 0 && (
                    <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 space-y-1">
                      <p className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                        ⚠️ Extraction Diagnostic Flags:
                      </p>
                      <ul className="list-disc list-inside text-xs space-y-0.5">
                        {currentCandidate.extraction_warnings.map((w, idx) => (
                          <li key={idx}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                {/* Duplicate Match Warning Banner (if similarity >= 70%) */}
                {duplicateMatches.length > 0 && (
                  <div className="p-3.5 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-200 space-y-1">
                    <p className="text-xs font-bold uppercase tracking-wider text-indigo-800 dark:text-indigo-300">
                      🔍 Potential Duplicate in Production Question Bank:
                    </p>
                    <p className="text-xs">
                      Matches existing question{" "}
                      <strong>{duplicateMatches[0].question_code}</strong> with{" "}
                      <strong>{Math.round(duplicateMatches[0].similarity_score * 100)}% similarity</strong>.
                    </p>
                  </div>
                )}

                {/* Live Math Content Preview */}
                {showLivePreview && formStem && (
                  <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#0B1120] border border-slate-200/80 dark:border-slate-800 space-y-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Live KaTeX Preview
                    </span>
                    <div className="text-sm text-slate-900 dark:text-white leading-relaxed">
                      <MathContentRenderer content={formStem} />
                    </div>
                  </div>
                )}

                {/* Question Stem Editor */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                    Question Stem (LaTeX supported via $...$ or $$...$$)
                  </label>
                  <textarea
                    rows={4}
                    value={formStem}
                    onChange={(e) => setFormStem(e.target.value)}
                    className="w-full p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-slate-900 dark:text-white text-xs sm:text-sm font-mono leading-relaxed focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Curriculum & Metadata Row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Question Type
                    </label>
                    <select
                      value={formType}
                      onChange={(e) => setFormType(e.target.value as QuestionType)}
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-xs"
                    >
                      <option value="MCQ">MCQ</option>
                      <option value="TRUE_FALSE">True / False</option>
                      <option value="FILL_BLANK">Fill Blank</option>
                      <option value="SUBJECTIVE">Subjective</option>
                      <option value="CASE_BASED">Case Based</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Difficulty
                    </label>
                    <select
                      value={formDifficulty}
                      onChange={(e) => setFormDifficulty(e.target.value as DifficultyLevel)}
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-xs"
                    >
                      <option value="EASY">Easy</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="HARD">Hard</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Marks
                    </label>
                    <input
                      type="number"
                      step={0.5}
                      value={formMarks}
                      onChange={(e) => setFormMarks(parseFloat(e.target.value) || 1)}
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Target Chapter
                    </label>
                    <select
                      value={formChapterId}
                      onChange={(e) => setFormChapterId(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-xs truncate"
                    >
                      <option value="">Select Chapter</option>
                      {chapters.map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          Ch. {ch.chapter_number}: {ch.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* MCQ Options Editor (when formType is MCQ) */}
                {formType === "MCQ" && (
                  <div className="space-y-2.5 pt-2 border-t border-slate-200/70 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        MCQ Options ({formOptions.length})
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const nextKey = String.fromCharCode(65 + formOptions.length);
                          setFormOptions([...formOptions, { key: nextKey, text: "", is_correct: false }]);
                        }}
                        className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline"
                      >
                        + Add Option
                      </button>
                    </div>

                    <div className="space-y-2">
                      {formOptions.map((opt, idx) => (
                        <div key={opt.key || idx} className="flex items-center gap-2">
                          <span className="w-6 text-center font-bold text-xs text-slate-500">
                            {opt.key})
                          </span>
                          <input
                            type="text"
                            value={opt.text}
                            onChange={(e) => {
                              const updated = [...formOptions];
                              updated[idx].text = e.target.value;
                              setFormOptions(updated);
                            }}
                            placeholder={`Option ${opt.key} text`}
                            className="flex-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-xs"
                          />
                          <label className="flex items-center gap-1 text-xs cursor-pointer">
                            <input
                              type="radio"
                              name="mcq_correct_option"
                              checked={Boolean(opt.is_correct)}
                              onChange={() => {
                                const updated = formOptions.map((o, i) => ({
                                  ...o,
                                  is_correct: i === idx,
                                }));
                                setFormOptions(updated);
                              }}
                              className="text-indigo-600"
                            />
                            <span className="text-[11px] text-slate-600 dark:text-slate-400">Correct</span>
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Subparts Editor (for Subjective / Case Based) */}
                {formSubparts.length > 0 && (
                  <div className="space-y-2.5 pt-2 border-t border-slate-200/70 dark:border-slate-800">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Detected Subparts ({formSubparts.length})
                    </span>
                    <div className="space-y-2">
                      {formSubparts.map((sp, idx) => (
                        <div key={idx} className="flex items-start gap-2">
                          <input
                            type="text"
                            value={sp.label}
                            onChange={(e) => {
                              const updated = [...formSubparts];
                              updated[idx].label = e.target.value;
                              setFormSubparts(updated);
                            }}
                            className="w-14 px-2 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-xs font-bold text-center"
                          />
                          <textarea
                            rows={2}
                            value={sp.text}
                            onChange={(e) => {
                              const updated = [...formSubparts];
                              updated[idx].text = e.target.value;
                              setFormSubparts(updated);
                            }}
                            className="flex-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-xs"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Model Answer & Solution */}
                <div className="space-y-3 pt-2 border-t border-slate-200/70 dark:border-slate-800">
                  <div>
                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                      Model Answer / Final Value (Optional)
                    </label>
                    <input
                      type="text"
                      value={formAnswer}
                      onChange={(e) => setFormAnswer(e.target.value)}
                      placeholder="e.g. x = 4, 30°"
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-xs"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                      Step-by-Step Solution / Explanation (Optional)
                    </label>
                    <textarea
                      rows={3}
                      value={formSolution}
                      onChange={(e) => setFormSolution(e.target.value)}
                      placeholder="Enter detailed mathematical proof or solution steps..."
                      className="w-full p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-xs font-mono"
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="p-12 text-center text-slate-400">
                <p>No candidates match the selected filter.</p>
              </div>
            )}
          </div>

          {/* Sticky Bottom Action Bar */}
          {currentCandidate && (
            <div className="p-4 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-[#121A2B] flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRejectCandidate}
                  disabled={isSaving || isPromoting}
                  className="px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-900/60 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdits}
                  disabled={isSaving || isPromoting}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1E293B] disabled:opacity-50"
                >
                  {isSaving ? "Saving..." : "Save Edits"}
                </button>
                <button
                  type="button"
                  onClick={handleAcceptCandidate}
                  disabled={isSaving || isPromoting}
                  className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold shadow-xs disabled:opacity-50"
                >
                  Accept Candidate
                </button>
              </div>

              {/* One-Click Atomic Promotion Button */}
              <div>
                {currentCandidate.review_status === "PROMOTED" ? (
                  <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 text-xs font-bold border border-emerald-300 dark:border-emerald-700">
                    ✓ Promoted to Draft
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handlePromoteCandidate}
                    disabled={
                      isPromoting ||
                      (currentCandidate.review_status !== "ACCEPTED" &&
                        currentCandidate.review_status !== "EDITED")
                    }
                    className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white text-xs font-bold shadow-xs shadow-indigo-600/30 transition-all disabled:cursor-not-allowed"
                    title={
                      currentCandidate.review_status !== "ACCEPTED" &&
                      currentCandidate.review_status !== "EDITED"
                        ? "Accept or edit candidate first before promotion"
                        : "Promote candidate to production questions table as DRAFT"
                    }
                  >
                    {isPromoting ? (
                      <>
                        <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <span>Promoting (Fenced Lease)...</span>
                      </>
                    ) : (
                      <>
                        <span>🚀 Promote to Production (Draft)</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default function BatchCurationWorkspacePage() {
  return (
    <React.Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 dark:bg-[#0B1120] flex items-center justify-center">
          <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400 text-sm">
            <span className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            Loading curation workspace...
          </div>
        </div>
      }
    >
      <BatchCurationWorkspaceContent />
    </React.Suspense>
  );
}

