"use client";

import React, { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { MathContentRenderer } from "@/components/math-renderer";

interface OptionItem {
  key: string;
  text: string;
}

interface DiagramItem {
  diagram_id: string;
  caption: string;
  url: string;
  source_page?: number;
}

interface SubpartItem {
  label: string;
  text: string;
}

interface QuestionItem {
  id: string;
  candidate_id: string;
  question_number: number;
  label: string;
  section: string;
  section_id: string;
  marks: number;
  type: "MCQ" | "ASSERTION_REASON" | "SUBJECTIVE" | "CASE_BASED";
  stem: string;
  has_alternative: boolean;
  alternative_parts: string[] | null;
  options: OptionItem[];
  subparts: SubpartItem[];
  diagrams: DiagramItem[];
  source_page_number: number;
}

interface PaperData {
  batch_id: string;
  title: string;
  subtitle: string;
  source_filename: string;
  total_questions: number;
  total_marks: number;
  time_allowed_minutes: number;
  general_instructions: string[];
  sections: Array<{
    id: string;
    name: string;
    marks: number;
    desc: string;
    question_count: number;
  }>;
  questions: QuestionItem[];
}

type QuestionStatus = "NOT_VISITED" | "NOT_ANSWERED" | "ANSWERED" | "MARKED_FOR_REVIEW";

function StudentPreviewContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const batchId = params.batchId as string;
  const qParam = searchParams.get("q");
  const modalParam = searchParams.get("modal");
  const drawerParam = searchParams.get("drawer");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paper, setPaper] = useState<PaperData | null>(null);

  // Active question index (0 to 37)
  const [currentIndex, setCurrentIndex] = useState(0);

  // Client-side local student responses
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [subjectiveAnswers, setSubjectiveAnswers] = useState<Record<number, string>>({});
  const [subpartAnswers, setSubpartAnswers] = useState<Record<string, string>>({});
  const [markedForReview, setMarkedForReview] = useState<Record<number, boolean>>({});
  const [visited, setVisited] = useState<Record<number, boolean>>({ 0: true });

  // Timer: 180 minutes countdown
  const [timeLeft, setTimeLeft] = useState(180 * 60);
  const [isTimerRunning, setIsTimerRunning] = useState(true);

  // Modals & Panels
  const [showInstructions, setShowInstructions] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showMobilePalette, setShowMobilePalette] = useState(false);
  const [selectedSectionFilter, setSelectedSectionFilter] = useState<string>("ALL");
  const [zoomDiagramUrl, setZoomDiagramUrl] = useState<string | null>(null);

  // Fetch paper data
  useEffect(() => {
    let active = true;

    async function loadPaper() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/preview/batch/${batchId}`);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${res.status}: Failed to load paper.`);
        }
        const data = await res.json();
        if (!data.success || !data.paper) {
          throw new Error("Invalid paper payload received from server.");
        }
        if (active) {
          setPaper(data.paper);
        }
      } catch (err: any) {
        if (active) {
          setError(err?.message || "Failed to load examination paper.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    if (batchId) {
      loadPaper();
    }

    return () => {
      active = false;
    };
  }, [batchId]);

  // Handle URL query parameters (?q=5, ?modal=instructions, ?drawer=palette)
  useEffect(() => {
    if (!paper) return;
    if (qParam) {
      const targetQ = parseInt(qParam, 10);
      if (!isNaN(targetQ) && targetQ >= 1 && targetQ <= paper.questions.length) {
        setCurrentIndex(targetQ - 1);
        setVisited((prev) => ({ ...prev, [targetQ - 1]: true }));
      }
    }
    if (modalParam === "instructions") setShowInstructions(true);
    if (modalParam === "submit") setShowSubmitModal(true);
    if (drawerParam === "palette") setShowMobilePalette(true);
  }, [paper, qParam, modalParam, drawerParam]);

  // Load responses from localStorage if present
  useEffect(() => {
    if (!batchId) return;
    try {
      const stored = localStorage.getItem(`auramentor_preview_${batchId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.answers) setAnswers(parsed.answers);
        if (parsed.subjectiveAnswers) setSubjectiveAnswers(parsed.subjectiveAnswers);
        if (parsed.subpartAnswers) setSubpartAnswers(parsed.subpartAnswers);
        if (parsed.markedForReview) setMarkedForReview(parsed.markedForReview);
        if (parsed.visited) setVisited(parsed.visited);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [batchId]);

  // Save responses to localStorage
  const saveToLocal = useCallback(
    (
      newAns: Record<number, string>,
      newSubj: Record<number, string>,
      newSubp: Record<string, string>,
      newMarked: Record<number, boolean>,
      newVis: Record<number, boolean>
    ) => {
      if (!batchId) return;
      try {
        localStorage.setItem(
          `auramentor_preview_${batchId}`,
          JSON.stringify({
            answers: newAns,
            subjectiveAnswers: newSubj,
            subpartAnswers: newSubp,
            markedForReview: newMarked,
            visited: newVis,
          })
        );
      } catch {
        // Ignore quota errors
      }
    },
    [batchId]
  );

  // Timer countdown
  useEffect(() => {
    if (!isTimerRunning) return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [isTimerRunning]);

  const formattedTime = useMemo(() => {
    const hours = Math.floor(timeLeft / 3600);
    const minutes = Math.floor((timeLeft % 3600) / 60);
    const seconds = timeLeft % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }, [timeLeft]);

  const currentQuestion = paper?.questions[currentIndex];

  // Helper to mark visited
  const selectQuestion = useCallback(
    (index: number) => {
      if (!paper || index < 0 || index >= paper.questions.length) return;
      setCurrentIndex(index);
      setVisited((prev) => {
        const next = { ...prev, [index]: true };
        saveToLocal(answers, subjectiveAnswers, subpartAnswers, markedForReview, next);
        return next;
      });
      setShowMobilePalette(false);
      // Scroll to question top
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [paper, answers, subjectiveAnswers, subpartAnswers, markedForReview, saveToLocal]
  );

  // Option selection
  const handleSelectOption = useCallback(
    (key: string) => {
      setAnswers((prev) => {
        const next = { ...prev, [currentIndex]: key };
        saveToLocal(next, subjectiveAnswers, subpartAnswers, markedForReview, visited);
        return next;
      });
    },
    [currentIndex, subjectiveAnswers, subpartAnswers, markedForReview, visited, saveToLocal]
  );

  // Clear answer
  const handleClearResponse = useCallback(() => {
    setAnswers((prev) => {
      const next = { ...prev };
      delete next[currentIndex];
      saveToLocal(next, subjectiveAnswers, subpartAnswers, markedForReview, visited);
      return next;
    });
    setSubjectiveAnswers((prev) => {
      const next = { ...prev };
      delete next[currentIndex];
      saveToLocal(answers, next, subpartAnswers, markedForReview, visited);
      return next;
    });
  }, [currentIndex, answers, subpartAnswers, markedForReview, visited, saveToLocal]);

  // Toggle mark for review
  const handleToggleMark = useCallback(() => {
    setMarkedForReview((prev) => {
      const next = { ...prev, [currentIndex]: !prev[currentIndex] };
      saveToLocal(answers, subjectiveAnswers, subpartAnswers, next, visited);
      return next;
    });
  }, [currentIndex, answers, subjectiveAnswers, subpartAnswers, visited, saveToLocal]);

  // Next / Previous
  const handleNext = useCallback(() => {
    if (!paper) return;
    if (currentIndex < paper.questions.length - 1) {
      selectQuestion(currentIndex + 1);
    }
  }, [currentIndex, paper, selectQuestion]);

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      selectQuestion(currentIndex - 1);
    }
  }, [currentIndex, selectQuestion]);

  // Status calculator for palette
  const getQuestionStatus = useCallback(
    (idx: number): QuestionStatus => {
      const isMarked = !!markedForReview[idx];
      const hasAns =
        !!answers[idx] ||
        !!subjectiveAnswers[idx] ||
        Object.keys(subpartAnswers).some((k) => k.startsWith(`${idx}-`));

      if (isMarked) return "MARKED_FOR_REVIEW";
      if (hasAns) return "ANSWERED";
      if (visited[idx]) return "NOT_ANSWERED";
      return "NOT_VISITED";
    },
    [markedForReview, answers, subjectiveAnswers, subpartAnswers, visited]
  );

  // Overall Statistics
  const stats = useMemo(() => {
    if (!paper)
      return { answered: 0, notAnswered: 0, marked: 0, notVisited: 0, total: 0 };
    let answered = 0;
    let notAnswered = 0;
    let marked = 0;
    let notVisited = 0;

    paper.questions.forEach((_, idx) => {
      const st = getQuestionStatus(idx);
      if (st === "ANSWERED") answered++;
      else if (st === "MARKED_FOR_REVIEW") marked++;
      else if (st === "NOT_ANSWERED") notAnswered++;
      else notVisited++;
    });

    return {
      answered,
      notAnswered,
      marked,
      notVisited,
      total: paper.questions.length,
    };
  }, [paper, getQuestionStatus]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#0B1120] flex flex-col items-center justify-center p-6 text-slate-800 dark:text-slate-100">
        <div className="w-16 h-16 rounded-2xl bg-indigo-600/10 dark:bg-indigo-500/20 flex items-center justify-center border border-indigo-200 dark:border-indigo-800 mb-4 animate-pulse">
          <span className="text-3xl">📐</span>
        </div>
        <h2 className="text-xl font-bold mb-2">Preparing Student Examination Canvas</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md text-center">
          Loading 38 questions, KaTeX formulas, tables, and authentic diagram assets from private storage...
        </p>
      </div>
    );
  }

  // Error state
  if (error || !paper) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-[#0B1120] flex flex-col items-center justify-center p-6 text-slate-800 dark:text-slate-100">
        <div className="w-16 h-16 rounded-2xl bg-rose-50 dark:bg-rose-950/60 flex items-center justify-center border border-rose-200 dark:border-rose-800 mb-4 text-3xl">
          ⚠️
        </div>
        <h2 className="text-xl font-bold mb-2 text-rose-600 dark:text-rose-400">
          Unable to Load Student Preview
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md text-center mb-6">
          {error || "The requested examination paper could not be found or loaded."}
        </p>
        <Link
          href={`/admin/ingestion/${batchId}`}
          className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-sm font-semibold hover:bg-slate-300 dark:hover:bg-slate-700 transition"
        >
          Return to Admin Workspace
        </Link>
      </div>
    );
  }

  // Filtered questions for palette
  const filteredPaletteQuestions = paper.questions.filter((q) => {
    if (selectedSectionFilter === "ALL") return true;
    return q.section_id === selectedSectionFilter;
  });

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-[#0B1120] text-slate-800 dark:text-slate-100 font-sans antialiased flex flex-col">
      {/* ==================================================================== */}
      {/* 1. Header Bar: Exam Info, Timer, Controls                             */}
      {/* ==================================================================== */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-[#111927]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Left: Branding & Paper Info */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-linear-to-br from-indigo-500 to-indigo-700 flex items-center justify-center text-white font-black text-lg shadow-sm shrink-0">
              A
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white truncate">
                  {paper.title}
                </h1>
                <span className="hidden md:inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 shrink-0">
                  STUDENT PREVIEW
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate hidden sm:block">
                {paper.subtitle} • {paper.total_marks} Marks • {paper.total_questions} Questions
              </p>
            </div>
          </div>

          {/* Center: Examination Timer */}
          <div className="flex items-center gap-2 bg-slate-50 dark:bg-[#0B1120] px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 hidden sm:inline">
              Time Left:
            </span>
            <span className="font-mono text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100 tracking-wider">
              {formattedTime}
            </span>
          </div>

          {/* Right: Actions, Theme, Palette Drawer (Mobile) */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowInstructions(true)}
              className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
            >
              <span>📋</span> Instructions
            </button>

            <ThemeSwitcher />

            <button
              onClick={() => setShowSubmitModal(true)}
              className="px-3.5 py-1.5 rounded-xl text-xs sm:text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs transition"
            >
              Submit Paper
            </button>

            {/* Mobile Palette Toggle */}
            <button
              onClick={() => setShowMobilePalette(!showMobilePalette)}
              className="lg:hidden p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200"
              aria-label="Toggle Question Palette"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Section Navigation Tabs */}
        <div className="bg-slate-50/90 dark:bg-[#151F32]/90 border-t border-slate-200/70 dark:border-slate-800 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto flex items-center justify-between overflow-x-auto py-2 gap-2 scrollbar-none">
            <div className="flex items-center gap-1.5 sm:gap-2">
              {paper.sections.map((sec) => {
                const isActiveSection = currentQuestion?.section_id === sec.id;
                // Count answered in section
                const qIndexes = paper.questions
                  .map((q, idx) => (q.section_id === sec.id ? idx : -1))
                  .filter((i) => i !== -1);
                const answeredInSec = qIndexes.filter((i) => getQuestionStatus(i) === "ANSWERED").length;

                return (
                  <button
                    key={sec.id}
                    onClick={() => {
                      const firstQIndex = paper.questions.findIndex((q) => q.section_id === sec.id);
                      if (firstQIndex !== -1) selectQuestion(firstQIndex);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center gap-2 ${
                      isActiveSection
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "bg-white dark:bg-[#1E293B] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700/60 hover:bg-slate-100 dark:hover:bg-slate-700/50"
                    }`}
                  >
                    <span>{sec.name}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                        isActiveSection
                          ? "bg-indigo-700/60 text-indigo-100"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400"
                      }`}
                    >
                      {answeredInSec}/{sec.question_count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Quick Summary Pill on Header */}
            <div className="hidden md:flex items-center gap-3 text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>{stats.answered} Answered</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-purple-500" />
                <span>{stats.marked} Review</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span>{stats.notAnswered} Pending</span>
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* ==================================================================== */}
      {/* 2. Main Two-Column Examination Layout                                 */}
      {/* ==================================================================== */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 w-full flex-1 flex flex-col lg:flex-row gap-6 items-start">
        {/* Left Column: Active Question Workspace (70% width) */}
        <main className="w-full lg:w-[70%] flex flex-col gap-4">
          {currentQuestion && (
            <div className="bg-white dark:bg-[#111927] rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col">
              {/* Question Header Card */}
              <div className="p-4 sm:p-6 border-b border-slate-100 dark:border-slate-800/80 flex items-center justify-between flex-wrap gap-3 bg-slate-50/50 dark:bg-[#151F32]/40">
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-indigo-600 text-white font-bold text-sm shadow-xs">
                    {currentQuestion.question_number}
                  </span>
                  <div>
                    <h2 className="font-bold text-base sm:text-lg text-slate-900 dark:text-white">
                      Question {currentQuestion.question_number}
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {currentQuestion.section} • Page {currentQuestion.source_page_number} of PDF
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-xl text-xs font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                    +{currentQuestion.marks}.0 {currentQuestion.marks === 1 ? "Mark" : "Marks"}
                  </span>
                  <span className="px-2.5 py-1 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                    {currentQuestion.type === "MCQ"
                      ? "Multiple Choice"
                      : currentQuestion.type === "ASSERTION_REASON"
                      ? "Assertion & Reason"
                      : currentQuestion.type === "CASE_BASED"
                      ? "Case-Based Study"
                      : "Subjective"}
                  </span>
                </div>
              </div>

              {/* Question Stem Content */}
              <div className="p-5 sm:p-7 space-y-6">
                {/* If Question has an OR alternative, render both clearly */}
                {currentQuestion.has_alternative && currentQuestion.alternative_parts ? (
                  <div className="space-y-6">
                    {/* Primary Problem */}
                    <div className="space-y-3">
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        Problem Option 1
                      </div>
                      <div className="text-base sm:text-lg text-slate-800 dark:text-slate-100 leading-relaxed">
                        <MathContentRenderer content={currentQuestion.alternative_parts[0]} />
                      </div>
                    </div>

                    {/* OR Divider */}
                    <div className="my-6 relative flex items-center justify-center">
                      <div className="border-t border-slate-200 dark:border-slate-700/80 w-full" />
                      <span className="absolute bg-amber-50 dark:bg-amber-950/90 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-800 px-4 py-1 rounded-full text-xs font-bold tracking-wider uppercase shadow-xs">
                        OR — Alternative Choice
                      </span>
                    </div>

                    {/* Alternative Problem */}
                    <div className="space-y-3">
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        Problem Option 2
                      </div>
                      <div className="text-base sm:text-lg text-slate-800 dark:text-slate-100 leading-relaxed">
                        <MathContentRenderer content={currentQuestion.alternative_parts[1]} />
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Standard Question Stem */
                  <div className="text-base sm:text-lg text-slate-800 dark:text-slate-100 leading-relaxed">
                    <MathContentRenderer content={currentQuestion.stem} />
                  </div>
                )}

                {/* Question Diagrams (Standalone figures gallery if any) */}
                {currentQuestion.diagrams.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80">
                    <div className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-3">
                      Question Figures & Diagrams ({currentQuestion.diagrams.length})
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {currentQuestion.diagrams.map((diag, dIdx) => (
                        <div
                          key={diag.diagram_id || dIdx}
                          className="bg-slate-50 dark:bg-[#0B1120] rounded-2xl border border-slate-200 dark:border-slate-800 p-3 flex flex-col items-center group relative"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={diag.url}
                            alt={diag.caption}
                            className="max-h-56 w-auto object-contain rounded-lg transition-transform group-hover:scale-[1.02]"
                          />
                          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 font-medium text-center">
                            {diag.caption}
                          </p>
                          <button
                            onClick={() => setZoomDiagramUrl(diag.url)}
                            className="absolute top-2 right-2 p-1.5 rounded-lg bg-white/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 opacity-0 group-hover:opacity-100 transition shadow-xs"
                            title="Zoom figure"
                          >
                            🔍
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Subparts (e.g. for Case-Based Questions Q36, Q37, Q38) */}
                {currentQuestion.subparts.length > 0 && (
                  <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80 space-y-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                      Subparts & Questions ({currentQuestion.subparts.length})
                    </h3>
                    <div className="space-y-4">
                      {currentQuestion.subparts.map((sub, sIdx) => {
                        const subKey = `${currentIndex}-${sIdx}`;
                        return (
                          <div
                            key={sIdx}
                            className="bg-slate-50/80 dark:bg-[#151F32]/50 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-2.5"
                          >
                            <div className="flex items-start gap-2.5">
                              <span className="font-bold text-sm text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 shrink-0">
                                ({sub.label || sIdx + 1})
                              </span>
                              <div className="text-sm sm:text-base text-slate-800 dark:text-slate-200 flex-1 leading-relaxed">
                                <MathContentRenderer content={sub.text} />
                              </div>
                            </div>

                            {/* Subpart Answer Input */}
                            <div className="pt-2 pl-9">
                              <textarea
                                value={subpartAnswers[subKey] || ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setSubpartAnswers((prev) => {
                                    const next = { ...prev, [subKey]: val };
                                    saveToLocal(answers, subjectiveAnswers, next, markedForReview, visited);
                                    return next;
                                  });
                                }}
                                rows={2}
                                placeholder={`Write answer/working for subpart (${sub.label || sIdx + 1})...`}
                                className="w-full text-sm p-3 rounded-xl bg-white dark:bg-[#0B1120] border border-slate-200 dark:border-slate-700/80 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden transition text-slate-800 dark:text-slate-100 resize-y"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* MCQ Options (for Section A questions Q1 to Q20) */}
                {currentQuestion.options.length > 0 && (
                  <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        Select One Option
                      </h3>
                      {answers[currentIndex] && (
                        <button
                          onClick={handleClearResponse}
                          className="text-xs font-semibold text-rose-600 hover:text-rose-500 transition"
                        >
                          Clear Selection
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      {currentQuestion.options.map((opt) => {
                        const isSelected = answers[currentIndex] === opt.key;
                        return (
                          <button
                            key={opt.key}
                            onClick={() => handleSelectOption(opt.key)}
                            className={`p-4 rounded-2xl border text-left flex items-start gap-3.5 transition group ${
                              isSelected
                                ? "bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-600 dark:border-indigo-500 ring-2 ring-indigo-500/20 shadow-xs"
                                : "bg-white dark:bg-[#151F32]/50 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-[#1E293B]/60"
                            }`}
                          >
                            <span
                              className={`w-7 h-7 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 transition ${
                                isSelected
                                  ? "bg-indigo-600 text-white"
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 group-hover:bg-slate-200 dark:group-hover:bg-slate-700"
                              }`}
                            >
                              {opt.key}
                            </span>
                            <div className="text-sm sm:text-base text-slate-800 dark:text-slate-100 flex-1 leading-relaxed pt-0.5">
                              <MathContentRenderer content={opt.text} />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Subjective Working Area (for Questions without options or with subparts) */}
                {currentQuestion.options.length === 0 && currentQuestion.subparts.length === 0 && (
                  <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        Student Working / Solution Area
                      </h3>
                      {subjectiveAnswers[currentIndex] && (
                        <button
                          onClick={handleClearResponse}
                          className="text-xs font-semibold text-rose-600 hover:text-rose-500 transition"
                        >
                          Clear Working
                        </button>
                      )}
                    </div>
                    <textarea
                      value={subjectiveAnswers[currentIndex] || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSubjectiveAnswers((prev) => {
                          const next = { ...prev, [currentIndex]: val };
                          saveToLocal(answers, next, subpartAnswers, markedForReview, visited);
                          return next;
                        });
                      }}
                      rows={5}
                      placeholder="Type your step-by-step mathematical working or final solution here..."
                      className="w-full text-sm p-4 rounded-2xl bg-slate-50 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-hidden transition text-slate-800 dark:text-slate-100 resize-y"
                    />
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">
                      💡 Tip: You can write math formulas in KaTeX format, e.g., $x = \frac{`{-b \\pm \\sqrt{b^2-4ac}}{2a}`}$
                    </p>
                  </div>
                )}
              </div>

              {/* Action Bar: Previous, Mark for Review, Clear, Save & Next */}
              <div className="p-4 sm:p-6 bg-slate-50 dark:bg-[#151F32]/60 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={handlePrevious}
                    disabled={currentIndex === 0}
                    className="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-white dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ← Previous
                  </button>
                  <button
                    onClick={handleToggleMark}
                    className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold border transition ${
                      markedForReview[currentIndex]
                        ? "bg-purple-600 text-white border-purple-600"
                        : "bg-white dark:bg-[#1E293B] border-slate-200 dark:border-slate-700 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/40"
                    }`}
                  >
                    {markedForReview[currentIndex] ? "★ Marked for Review" : "☆ Mark for Review"}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleNext}
                    disabled={currentIndex === paper.questions.length - 1}
                    className="px-5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Save & Next →
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Right Column: Question Palette Sidebar (30% width on Desktop) */}
        <aside className="hidden lg:flex w-[30%] flex-col gap-4 sticky top-28">
          <div className="bg-white dark:bg-[#111927] rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 space-y-4">
            {/* Palette Header */}
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                Question Palette
              </h3>
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {stats.answered} / {stats.total} Answered
              </span>
            </div>

            {/* Section Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              <button
                onClick={() => setSelectedSectionFilter("ALL")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition ${
                  selectedSectionFilter === "ALL"
                    ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                All (38)
              </button>
              {paper.sections.map((sec) => (
                <button
                  key={sec.id}
                  onClick={() => setSelectedSectionFilter(sec.id)}
                  className={`px-2 py-1 rounded-lg text-xs font-bold transition ${
                    selectedSectionFilter === sec.id
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                  }`}
                >
                  Sec {sec.id}
                </button>
              ))}
            </div>

            {/* Palette Grid (1 to 38) */}
            <div className="grid grid-cols-5 gap-2 max-h-[340px] overflow-y-auto pr-1">
              {filteredPaletteQuestions.map((q) => {
                const idx = q.question_number - 1;
                const status = getQuestionStatus(idx);
                const isCurrent = idx === currentIndex;

                let bgClass = "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400";
                if (status === "ANSWERED") {
                  bgClass = "bg-emerald-500 text-white font-bold";
                } else if (status === "MARKED_FOR_REVIEW") {
                  bgClass = "bg-purple-600 text-white font-bold";
                } else if (status === "NOT_ANSWERED") {
                  bgClass = "bg-amber-500 text-white font-bold";
                }

                return (
                  <button
                    key={q.id}
                    onClick={() => selectQuestion(idx)}
                    className={`h-10 rounded-xl text-xs font-bold transition relative flex items-center justify-center ${bgClass} ${
                      isCurrent
                        ? "ring-2 ring-indigo-500 ring-offset-2 dark:ring-offset-[#111927] scale-105 z-10 shadow-sm"
                        : "hover:opacity-90"
                    }`}
                  >
                    {q.question_number}
                    {q.diagrams.length > 0 && (
                      <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-cyan-300" title="Contains diagram" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Palette Legend */}
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 grid grid-cols-2 gap-2 text-[11px] font-medium text-slate-600 dark:text-slate-400">
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded-md bg-emerald-500 inline-block shrink-0" />
                <span>Answered ({stats.answered})</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded-md bg-purple-600 inline-block shrink-0" />
                <span>Review ({stats.marked})</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded-md bg-amber-500 inline-block shrink-0" />
                <span>Unanswered ({stats.notAnswered})</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 rounded-md bg-slate-200 dark:bg-slate-700 inline-block shrink-0" />
                <span>Not Visited ({stats.notVisited})</span>
              </span>
            </div>

            {/* Quick Submit Test CTA */}
            <div className="pt-2">
              <button
                onClick={() => setShowSubmitModal(true)}
                className="w-full py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-xs transition"
              >
                Submit Examination
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* ==================================================================== */}
      {/* 3. Mobile Slide-Over Palette Drawer                                   */}
      {/* ==================================================================== */}
      {showMobilePalette && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            onClick={() => setShowMobilePalette(false)}
          />
          <div className="relative ml-auto w-80 max-w-[85vw] bg-white dark:bg-[#111927] h-full shadow-2xl p-5 flex flex-col justify-between overflow-y-auto">
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                  Question Palette
                </h3>
                <button
                  onClick={() => setShowMobilePalette(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  ✕
                </button>
              </div>

              {/* Section Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                <button
                  onClick={() => setSelectedSectionFilter("ALL")}
                  className={`px-2 py-1 rounded-lg text-xs font-bold transition ${
                    selectedSectionFilter === "ALL"
                      ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                  }`}
                >
                  All
                </button>
                {paper.sections.map((sec) => (
                  <button
                    key={sec.id}
                    onClick={() => setSelectedSectionFilter(sec.id)}
                    className={`px-2 py-1 rounded-lg text-xs font-bold transition ${
                      selectedSectionFilter === sec.id
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    Sec {sec.id}
                  </button>
                ))}
              </div>

              {/* Mobile Palette Grid */}
              <div className="grid grid-cols-4 gap-2">
                {filteredPaletteQuestions.map((q) => {
                  const idx = q.question_number - 1;
                  const status = getQuestionStatus(idx);
                  const isCurrent = idx === currentIndex;

                  let bgClass = "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400";
                  if (status === "ANSWERED") {
                    bgClass = "bg-emerald-500 text-white font-bold";
                  } else if (status === "MARKED_FOR_REVIEW") {
                    bgClass = "bg-purple-600 text-white font-bold";
                  } else if (status === "NOT_ANSWERED") {
                    bgClass = "bg-amber-500 text-white font-bold";
                  }

                  return (
                    <button
                      key={q.id}
                      onClick={() => selectQuestion(idx)}
                      className={`h-11 rounded-xl text-xs font-bold transition ${bgClass} ${
                        isCurrent
                          ? "ring-2 ring-indigo-500 ring-offset-2 dark:ring-offset-[#111927] scale-105"
                          : ""
                      }`}
                    >
                      {q.question_number}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <button
                onClick={() => {
                  setShowMobilePalette(false);
                  setShowSubmitModal(true);
                }}
                className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold"
              >
                Submit Paper
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 4. General Instructions Modal                                         */}
      {/* ==================================================================== */}
      {showInstructions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#111927] rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                  Examination Instructions
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  CBSE Class X Mathematics (Standard)
                </p>
              </div>
              <button
                onClick={() => setShowInstructions(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <div className="py-4 space-y-3 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
              <ol className="list-decimal list-inside space-y-2.5">
                {paper.general_instructions.map((inst, iIdx) => (
                  <li key={iIdx} className="pl-1">
                    {inst}
                  </li>
                ))}
              </ol>

              <div className="mt-4 p-4 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 space-y-2">
                <h4 className="font-bold text-xs uppercase text-indigo-700 dark:text-indigo-300">
                  Section Scheme & Marks Distribution
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {paper.sections.map((s) => (
                    <div key={s.id} className="flex items-center justify-between p-2 rounded-lg bg-white/60 dark:bg-slate-900/60">
                      <span className="font-semibold">{s.name} ({s.question_count} Qs)</span>
                      <span className="font-mono text-indigo-600 dark:text-indigo-400 font-bold">
                        {s.marks}M each
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <button
                onClick={() => setShowInstructions(false)}
                className="px-5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-500 transition"
              >
                Close Instructions
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 5. Submit Summary Modal                                               */}
      {/* ==================================================================== */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#111927] rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-200 dark:border-slate-800">
            <div className="text-center space-y-2 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto text-2xl font-bold border border-emerald-200 dark:border-emerald-800">
                ✓
              </div>
              <h3 className="font-bold text-xl text-slate-900 dark:text-white">
                Submit Examination Paper
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Review your progress summary before final submission.
              </p>
            </div>

            {/* Progress Overview Grid */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
                <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                  {stats.answered}
                </span>
                <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                  Answered Questions
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-center">
                <span className="text-2xl font-black text-amber-600 dark:text-amber-400">
                  {stats.notAnswered + stats.notVisited}
                </span>
                <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                  Unanswered Questions
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-center">
                <span className="text-2xl font-black text-purple-600 dark:text-purple-400">
                  {stats.marked}
                </span>
                <p className="text-xs font-semibold text-purple-800 dark:text-purple-300">
                  Marked for Review
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center">
                <span className="text-2xl font-black text-slate-700 dark:text-slate-300">
                  {stats.total}
                </span>
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                  Total Questions
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowSubmitModal(false)}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 font-semibold text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
              >
                Return to Paper
              </button>
              <button
                onClick={() => {
                  alert(
                    "Student Preview Completed!\n\nThis preview was executed safely in read-only mode. No student answers were stored to production tables."
                  );
                  setShowSubmitModal(false);
                }}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-xs transition"
              >
                Confirm Submission
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 6. Diagram Zoom Modal                                                 */}
      {/* ==================================================================== */}
      {zoomDiagramUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm cursor-zoom-out"
          onClick={() => setZoomDiagramUrl(null)}
        >
          <div className="max-w-4xl max-h-[90vh] bg-white dark:bg-[#111927] p-4 rounded-3xl border border-slate-700 shadow-2xl flex flex-col items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={zoomDiagramUrl}
              alt="Enlarged Diagram"
              className="max-h-[80vh] w-auto object-contain rounded-xl"
            />
            <p className="mt-3 text-xs text-slate-400 font-medium">
              Click anywhere to close zoom preview
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function StudentPreviewPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 dark:bg-[#0B1120] flex items-center justify-center p-6 text-slate-800 dark:text-slate-100">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 dark:bg-indigo-500/20 flex items-center justify-center border border-indigo-200 dark:border-indigo-800 animate-pulse text-2xl">
            📐
          </div>
        </div>
      }
    >
      <StudentPreviewContent />
    </Suspense>
  );
}
