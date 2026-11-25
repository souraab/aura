"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { useAuth } from "@/components/auth-provider";
import { QuestionComposer } from "@/components/question-composer";
import {
  MathContentRenderer,
  StorageImage,
} from "@/components/math-renderer";
import {
  type QuestionType,
  type SubjectiveAnswerType,
  type DifficultyLevel,
  type QuestionStatus,
  type ChapterRecord,
  type TopicRecord,
  type CaseStudyRecord,
  type QuestionOptionInput,
  type QuestionRecord,
  type QuestionDetailRecord,
  type QuestionFormPayload,
  type QuestionStatsSummary,
  fetchChapters,
  createChapter,
  updateChapter,
  fetchTopics,
  fetchCaseStudies,
  fetchQuestionStatistics,
  fetchPaginatedQuestions,
  fetchQuestionDetails,
  saveQuestionToDatabase,
  updateQuestionWorkflowStatus,
  deleteQuestionFromDatabase,
  generateQuestionCode,
} from "@/lib/admin-questions-db";

// ============================================================================
// Constants & Label Helpers
// ============================================================================

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: "MCQ", label: "MCQ (Multiple Choice)" },
  { value: "TRUE_FALSE", label: "True / False" },
  { value: "FILL_BLANK", label: "Fill in the Blank" },
  { value: "SUBJECTIVE", label: "Subjective" },
  { value: "CASE_BASED", label: "Case Based" },
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

const DEFAULT_MCQ_OPTIONS: QuestionOptionInput[] = [
  { option_key: "A", option_text: "", display_order: 1, is_correct: false },
  { option_key: "B", option_text: "", display_order: 2, is_correct: false },
  { option_key: "C", option_text: "", display_order: 3, is_correct: false },
  { option_key: "D", option_text: "", display_order: 4, is_correct: false },
];

// ============================================================================
// UI Badges
// ============================================================================

function StatusBadge({ status }: { status: QuestionStatus }) {
  switch (status) {
    case "PUBLISHED":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/70">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400" />
          Published
        </span>
      );
    case "VERIFIED":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/70">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
          Verified
        </span>
      );
    case "IN_REVIEW":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/70">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400" />
          In Review
        </span>
      );
    case "ARCHIVED":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200/80 dark:border-rose-800/70">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 dark:bg-rose-400" />
          Archived
        </span>
      );
    case "DRAFT":
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
          Draft
        </span>
      );
  }
}

function DifficultyBadge({ difficulty }: { difficulty: DifficultyLevel }) {
  switch (difficulty) {
    case "EASY":
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-indigo-50/80 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/70">
          Easy
        </span>
      );
    case "MEDIUM":
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-violet-50 dark:bg-violet-950/70 text-violet-700 dark:text-violet-300 border border-violet-200/70 dark:border-violet-800/70">
          Medium
        </span>
      );
    case "HARD":
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-200/70 dark:border-rose-800/70">
          Hard
        </span>
      );
  }
}

function TypeBadge({
  type,
  answerType,
}: {
  type: QuestionType;
  answerType?: SubjectiveAnswerType | null;
}) {
  const labels: Record<QuestionType, string> = {
    MCQ: "MCQ",
    TRUE_FALSE: "True / False",
    FILL_BLANK: "Fill Blank",
    SUBJECTIVE: "Subjective",
    CASE_BASED: "Case Based",
  };
  return (
    <div className="inline-flex flex-wrap items-center gap-1">
      <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100/90 dark:bg-[#1E293B] text-slate-700 dark:text-slate-200 border border-slate-200/70 dark:border-slate-700">
        {labels[type] ?? type}
      </span>
      {answerType && (
        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-violet-50 dark:bg-violet-950/70 text-violet-700 dark:text-violet-300 border border-violet-200/60 dark:border-violet-800/70">
          {answerType.replace("_", " ")}
        </span>
      )}
    </div>
  );
}

function formatDateShort(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return isoString;
  }
}

// ============================================================================
// Main Admin Question Bank Page Component
// ============================================================================

export default function AdminQuestionsPage() {
  const router = useRouter();
  const {
    user,
    profile,
    loading: authLoading,
    profileLoading,
    profileError,
    refreshProfile,
    signOut,
  } = useAuth();

  // Authoritative Role & Authorization Checks (sourced strictly from public.profiles.role)
  const normalizedRole = (profile?.role ?? "").trim().toUpperCase();
  const isRoleLoading = authLoading || profileLoading;
  const isAuthorizedAdminOrTeacher =
    normalizedRole === "ADMIN" || normalizedRole === "TEACHER";
  const canPublishQuestions =
    normalizedRole === "ADMIN" || normalizedRole === "TEACHER";

  // Data States
  const [chapters, setChapters] = useState<ChapterRecord[]>([]);
  const [topics, setTopics] = useState<TopicRecord[]>([]);
  const [caseStudies, setCaseStudies] = useState<CaseStudyRecord[]>([]);
  const [questions, setQuestions] = useState<QuestionRecord[]>([]);
  const [stats, setStats] = useState<QuestionStatsSummary>({
    total: 0,
    verified: 0,
    published: 0,
    inReview: 0,
    drafts: 0,
    archived: 0,
  });

  // Loading & Notification States
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Filter, Search & Pagination States
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [chapterFilter, setChapterFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [difficultyFilter, setDifficultyFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);

  // Chapter Management Modal State
  const [isChapterModalOpen, setIsChapterModalOpen] = useState(false);
  const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
  const [chapterForm, setChapterForm] = useState({
    chapter_number: 1,
    name: "",
    description: "",
    is_active: true,
  });
  const [chapterFormError, setChapterFormError] = useState<string | null>(null);
  const [isSavingChapter, setIsSavingChapter] = useState(false);

  // Question Add / Edit Modal State
  const [isQuestionModalOpen, setIsQuestionModalOpen] = useState(false);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(
    null
  );
  const [createNewTopicMode, setCreateNewTopicMode] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [formState, setFormState] = useState<QuestionFormPayload>({
    question_code: "",
    chapter_id: "",
    topic_id: null,
    new_topic_name: "",
    case_study_id: null,
    case_study_title: "",
    case_study_passage: "",
    question_text: "",
    question_type: "MCQ",
    answer_type: null,
    mcq_mode: "SINGLE",
    difficulty: "EASY",
    marks: 1,
    negative_marks: 0,
    status: "DRAFT",
    options: DEFAULT_MCQ_OPTIONS.map((o) => ({ ...o })),
    correct_true_false: "TRUE",
    correct_fill_blank: "",
    correct_subjective_summary: "",
    model_answer: "",
    step_by_step_solution: [
      { step_number: 1, title: "Step 1", explanation: "", marks: 1 },
    ],
    marking_scheme: [{ criterion: "", marks: 1, notes: "" }],
    media: [],
  });

  // View Question Modal State
  const [viewingQuestion, setViewingQuestion] =
    useState<QuestionDetailRecord | null>(null);

  // Delete Confirmation Modal State
  const [deletingQuestion, setDeletingQuestion] =
    useState<QuestionRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Redirect unauthenticated users to /login
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login?redirectTo=/admin/questions");
    }
  }, [authLoading, user, router]);

  // Lookup map for chapters
  const chaptersMap = useMemo(() => {
    const map = new Map<string, ChapterRecord>();
    chapters.forEach((c) => map.set(c.id, c));
    return map;
  }, [chapters]);

  // Active chapters for question creation/editing
  const activeChapters = useMemo(
    () =>
      chapters.filter(
        (c) => c.is_active || c.id === formState.chapter_id
      ),
    [chapters, formState.chapter_id]
  );

  // Topics filtered by currently selected chapter in the Question Form
  const chapterTopics = useMemo(
    () => topics.filter((t) => t.chapter_id === formState.chapter_id),
    [topics, formState.chapter_id]
  );

  // Case studies filtered by currently selected chapter
  const chapterCaseStudies = useMemo(
    () =>
      caseStudies.filter(
        (cs) => !cs.chapter_id || cs.chapter_id === formState.chapter_id
      ),
    [caseStudies, formState.chapter_id]
  );

  const [refreshTick, setRefreshTick] = useState(0);
  const refreshAdminData = useCallback(() => {
    setIsLoadingData(true);
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (authLoading || !user || !isAuthorizedAdminOrTeacher) return;

    let cancelled = false;

    async function fetchAdminRecords() {
      try {
        const [fetchedChapters, fetchedTopics, fetchedCases, fetchedStats] =
          await Promise.all([
            fetchChapters(),
            fetchTopics(),
            fetchCaseStudies(),
            fetchQuestionStatistics(),
          ]);

        const cMap = new Map<string, ChapterRecord>();
        fetchedChapters.forEach((c) => cMap.set(c.id, c));

        const tMap = new Map<string, TopicRecord>();
        fetchedTopics.forEach((t) => tMap.set(t.id, t));

        const paginated = await fetchPaginatedQuestions(
          {
            page,
            pageSize,
            search: debouncedSearch,
            chapterId: chapterFilter,
            questionType: typeFilter,
            difficulty: difficultyFilter,
            status: statusFilter,
          },
          cMap,
          tMap
        );

        if (cancelled) return;

        setChapters(fetchedChapters);
        setTopics(fetchedTopics);
        setCaseStudies(fetchedCases);
        setStats(fetchedStats);
        setQuestions(paginated.questions);
        setTotalCount(paginated.totalCount);
        setTotalPages(paginated.totalPages);
        setPageError(null);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error
            ? err.message
            : "An unexpected error occurred while loading questions from Supabase.";
        setPageError(message);
      } finally {
        if (!cancelled) {
          setIsLoadingData(false);
        }
      }
    }

    void fetchAdminRecords();

    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    user,
    isAuthorizedAdminOrTeacher,
    page,
    pageSize,
    debouncedSearch,
    chapterFilter,
    typeFilter,
    difficultyFilter,
    statusFilter,
    refreshTick,
  ]);

  const showToast = (type: "success" | "error", message: string) => {
    setNotification({ type, message });
  };

  // ============================================================================
  // Chapter Management Handlers
  // ============================================================================

  const openChapterManager = () => {
    const nextNumber =
      chapters.length > 0
        ? Math.max(...chapters.map((c) => c.chapter_number)) + 1
        : 1;
    setEditingChapterId(null);
    setChapterForm({
      chapter_number: nextNumber,
      name: "",
      description: "",
      is_active: true,
    });
    setChapterFormError(null);
    setIsChapterModalOpen(true);
  };

  const startEditChapter = (chap: ChapterRecord) => {
    setEditingChapterId(chap.id);
    setChapterForm({
      chapter_number: chap.chapter_number,
      name: chap.name,
      description: chap.description ?? "",
      is_active: chap.is_active,
    });
    setChapterFormError(null);
  };

  const handleSaveChapter = async (e: React.FormEvent) => {
    e.preventDefault();
    setChapterFormError(null);

    if (!chapterForm.name.trim()) {
      setChapterFormError("Chapter name is required.");
      return;
    }

    setIsSavingChapter(true);
    try {
      if (editingChapterId) {
        const updated = await updateChapter(editingChapterId, {
          chapter_number: Number(chapterForm.chapter_number) || 1,
          name: chapterForm.name.trim(),
          description: chapterForm.description.trim() || null,
          is_active: chapterForm.is_active,
        });
        setChapters((prev) =>
          prev
            .map((c) => (c.id === updated.id ? updated : c))
            .sort((a, b) => a.chapter_number - b.chapter_number)
        );
        showToast("success", `Updated chapter "${updated.name}".`);
      } else {
        const created = await createChapter({
          chapter_number: Number(chapterForm.chapter_number) || 1,
          name: chapterForm.name.trim(),
          description: chapterForm.description.trim() || undefined,
          is_active: chapterForm.is_active,
        });
        setChapters((prev) =>
          [...prev, created].sort((a, b) => a.chapter_number - b.chapter_number)
        );
        if (!formState.chapter_id) {
          setFormState((prev) => ({ ...prev, chapter_id: created.id }));
        }
        showToast("success", `Created chapter "${created.name}".`);
      }

      const nextNumber =
        chapters.length > 0
          ? Math.max(...chapters.map((c) => c.chapter_number)) + 2
          : 2;
      setEditingChapterId(null);
      setChapterForm({
        chapter_number: nextNumber,
        name: "",
        description: "",
        is_active: true,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to save chapter.";
      setChapterFormError(msg);
      showToast("error", msg);
    } finally {
      setIsSavingChapter(false);
    }
  };

  const handleToggleChapterActive = async (chap: ChapterRecord) => {
    try {
      const updated = await updateChapter(chap.id, {
        is_active: !chap.is_active,
      });
      setChapters((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      );
      showToast(
        "success",
        `Chapter "${updated.name}" is now ${
          updated.is_active ? "Active" : "Inactive"
        }.`
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to toggle chapter status.";
      showToast("error", msg);
    }
  };

  // ============================================================================
  // Question Add / Edit / View / Delete Handlers
  // ============================================================================

  const openAddQuestionModal = () => {
    const defaultChapter = chapters.find((c) => c.is_active) ?? chapters[0];
    setEditingQuestionId(null);
    setCreateNewTopicMode(false);
    setFormError(null);
    setFormState({
      question_code: generateQuestionCode(defaultChapter?.chapter_number),
      chapter_id: defaultChapter?.id ?? "",
      topic_id: null,
      new_topic_name: "",
      case_study_id: null,
      case_study_title: "",
      case_study_passage: "",
      question_text: "",
      question_type: "MCQ",
      answer_type: null,
      mcq_mode: "SINGLE",
      difficulty: "EASY",
      marks: 1,
      negative_marks: 0,
      status: "DRAFT",
      options: DEFAULT_MCQ_OPTIONS.map((o) => ({ ...o })),
      correct_true_false: "TRUE",
      correct_fill_blank: "",
      correct_subjective_summary: "",
      model_answer: "",
      step_by_step_solution: [
        { step_number: 1, title: "Step 1", explanation: "", marks: 1 },
      ],
      marking_scheme: [{ criterion: "", marks: 1, notes: "" }],
      media: [],
    });
    setIsQuestionModalOpen(true);
  };

  const openEditQuestionModal = async (record: QuestionRecord) => {
    setIsLoadingDetails(true);
    setFormError(null);
    setCreateNewTopicMode(false);

    try {
      const details = await fetchQuestionDetails(record);
      setEditingQuestionId(details.id);

      const rawAns = details.answer.correct_answer;
      let tfVal: "TRUE" | "FALSE" = "TRUE";
      let fillVal = "";
      let subjVal = "";

      if (typeof rawAns === "object" && rawAns !== null) {
        const obj = rawAns as Record<string, unknown>;
        if (String(obj.value ?? "").toUpperCase() === "FALSE") {
          tfVal = "FALSE";
        }
        if (typeof obj.value === "string") {
          fillVal = obj.value;
          subjVal = obj.value;
        } else if (Array.isArray(obj.accepted_answers)) {
          fillVal = obj.accepted_answers.join(" | ");
        }
      } else if (typeof rawAns === "string") {
        if (rawAns.toUpperCase() === "FALSE") tfVal = "FALSE";
        fillVal = rawAns;
        subjVal = rawAns;
      }

      setFormState({
        question_code: details.question_code,
        chapter_id: details.chapter_id,
        topic_id: details.topic_id,
        new_topic_name: "",
        case_study_id: details.case_study_id,
        case_study_title: details.case_study_title ?? "",
        case_study_passage: details.case_study_passage ?? "",
        question_text: details.question_text,
        question_type: details.question_type,
        answer_type:
          details.answer_type ??
          (details.question_type === "SUBJECTIVE" ? "SHORT" : null),
        mcq_mode: details.mcq_mode,
        difficulty: details.difficulty,
        marks: details.marks,
        negative_marks: details.negative_marks,
        status: details.status,
        options:
          details.options.length >= 2
            ? details.options
            : DEFAULT_MCQ_OPTIONS.map((o) => ({ ...o })),
        correct_true_false: tfVal,
        correct_fill_blank: fillVal,
        correct_subjective_summary: subjVal,
        model_answer: details.answer.model_answer,
        step_by_step_solution:
          details.answer.step_by_step_solution.length > 0
            ? details.answer.step_by_step_solution
            : [{ step_number: 1, title: "Step 1", explanation: "", marks: 1 }],
        marking_scheme:
          details.answer.marking_scheme.length > 0
            ? details.answer.marking_scheme
            : [{ criterion: "", marks: details.marks, notes: "" }],
        media: details.media,
      });

      setIsQuestionModalOpen(true);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to load question details for editing.";
      showToast("error", msg);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const openViewQuestionModal = async (record: QuestionRecord) => {
    setIsLoadingDetails(true);
    try {
      const details = await fetchQuestionDetails(record);
      setViewingQuestion(details);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to load question details.";
      showToast("error", msg);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  // Option Helpers inside Question Form
  const handleAddOption = () => {
    setFormState((prev) => {
      const nextIndex = prev.options.length;
      const nextKey = String.fromCharCode(65 + nextIndex);
      return {
        ...prev,
        options: [
          ...prev.options,
          {
            option_key: nextKey,
            option_text: "",
            display_order: nextIndex + 1,
            is_correct: false,
          },
        ],
      };
    });
  };

  const handleRemoveOption = (index: number) => {
    setFormState((prev) => {
      if (prev.options.length <= 2) return prev;
      const filtered = prev.options
        .filter((_, idx) => idx !== index)
        .map((opt, idx) => ({
          ...opt,
          option_key: String.fromCharCode(65 + idx),
          display_order: idx + 1,
        }));
      return { ...prev, options: filtered };
    });
  };

  const handleToggleOptionCorrect = (index: number) => {
    setFormState((prev) => {
      if (prev.mcq_mode === "SINGLE") {
        return {
          ...prev,
          options: prev.options.map((opt, idx) => ({
            ...opt,
            is_correct: idx === index,
          })),
        };
      } else {
        return {
          ...prev,
          options: prev.options.map((opt, idx) =>
            idx === index ? { ...opt, is_correct: !opt.is_correct } : opt
          ),
        };
      }
    });
  };

  const validateQuestionForm = (
    overrideStatus?: QuestionStatus
  ): string | null => {
    if (!formState.chapter_id) {
      return "Please select a chapter. Questions cannot be created without a chapter.";
    }
    if (!formState.question_text.trim()) {
      return "Question text is required.";
    }
    if (Number(formState.marks) <= 0) {
      return "Marks must be greater than 0.";
    }
    if (Number(formState.negative_marks) < 0) {
      return "Negative marks cannot be less than 0.";
    }

    const targetStatus = overrideStatus ?? formState.status;
    if (targetStatus === "PUBLISHED" && !canPublishQuestions) {
      return "Only administrators and authorized teachers are allowed to publish questions.";
    }

    if (
      formState.question_type === "SUBJECTIVE" &&
      !formState.answer_type
    ) {
      return "Please select an Answer Type (VERY_SHORT, SHORT, or LONG) for subjective questions.";
    }

    if (formState.question_type === "MCQ") {
      const nonEmptyOptions = formState.options.filter(
        (o) => o.option_text.trim() !== ""
      );
      if (nonEmptyOptions.length < 2) {
        return "MCQ questions require at least 2 non-empty options.";
      }
      const correctOptions = formState.options.filter((o) => Boolean(o.is_correct));
      if (correctOptions.length === 0) {
        return "Please select the correct answer option by clicking its 'Correct' radio button.";
      }
      if (formState.mcq_mode === "SINGLE" && correctOptions.length !== 1) {
        return "Exactly one option must be marked as correct for a single-answer MCQ.";
      }
      if (correctOptions.some((o) => o.option_text.trim() === "")) {
        return "The option marked as correct must have option text.";
      }
    }

    if (
      formState.question_type === "FILL_BLANK" &&
      !formState.correct_fill_blank.trim() &&
      !formState.model_answer.trim()
    ) {
      return "Please provide the correct answer for the Fill in the Blank question.";
    }

    return null;
  };

  const handleSaveQuestion = async (overrideStatus?: QuestionStatus) => {
    setFormError(null);
    const validationErr = validateQuestionForm(overrideStatus);
    if (validationErr) {
      setFormError(validationErr);
      return;
    }

    const effectiveStatus = overrideStatus ?? formState.status;
    const selectedChapter = chaptersMap.get(formState.chapter_id);

    setIsSaving(true);
    try {
      const payloadToSave: QuestionFormPayload = {
        ...formState,
        status: effectiveStatus,
      };

      await saveQuestionToDatabase(
        payloadToSave,
        editingQuestionId,
        selectedChapter?.chapter_number
      );

      setIsQuestionModalOpen(false);
      setEditingQuestionId(null);
      showToast(
        "success",
        editingQuestionId
          ? `Question updated (${effectiveStatus}) in Supabase.`
          : `Question created (${effectiveStatus}) in Supabase.`
      );
      refreshAdminData();
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to save question to Supabase.";
      setFormError(msg);
      showToast("error", msg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleWorkflowStatusChange = async (
    record: QuestionRecord,
    nextStatus: QuestionStatus
  ) => {
    if (nextStatus === "PUBLISHED" && !canPublishQuestions) {
      showToast(
        "error",
        "Only administrators and authorized teachers can publish questions."
      );
      return;
    }

    try {
      await updateQuestionWorkflowStatus(record.id, nextStatus);
      showToast(
        "success",
        `Updated ${record.question_code} status to ${nextStatus}.`
      );
      if (viewingQuestion && viewingQuestion.id === record.id) {
        setViewingQuestion({ ...viewingQuestion, status: nextStatus });
      }
      refreshAdminData();
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Failed to update question workflow status.";
      showToast("error", msg);
    }
  };

  const handleConfirmDeleteQuestion = async () => {
    if (!deletingQuestion) return;

    setIsDeleting(true);
    try {
      await deleteQuestionFromDatabase(deletingQuestion.id);
      const deletedCode = deletingQuestion.question_code;
      setDeletingQuestion(null);
      if (viewingQuestion?.id === deletingQuestion.id) {
        setViewingQuestion(null);
      }
      showToast(
        "success",
        `Deleted question ${deletedCode} and its options/answers from Supabase.`
      );
      refreshAdminData();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to delete question.";
      showToast("error", msg);
    } finally {
      setIsDeleting(false);
    }
  };

  const resetFilters = () => {
    setSearchInput("");
    setDebouncedSearch("");
    setChapterFilter("ALL");
    setTypeFilter("ALL");
    setDifficultyFilter("ALL");
    setStatusFilter("ALL");
    setPage(1);
  };

  const hasActiveFilters =
    searchInput.trim() !== "" ||
    chapterFilter !== "ALL" ||
    typeFilter !== "ALL" ||
    difficultyFilter !== "ALL" ||
    statusFilter !== "ALL";

  // ============================================================================
  // Auth & Role Guard Screens
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

  if (!user) {
    return null;
  }

  if (!isAuthorizedAdminOrTeacher) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1120] text-[#0F172A] dark:text-[#F1F5F9] flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-white dark:bg-[#151F32] rounded-3xl border border-rose-200 dark:border-rose-900/60 p-8 text-center shadow-xl space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto font-bold text-xl">
            !
          </div>
          <h1 className="text-xl font-bold text-slate-950 dark:text-[#F1F5F9]">
            {profileError || !normalizedRole
              ? "Unable to Verify Role from Database"
              : "Administrator Access Required"}
          </h1>
          {profileError || !normalizedRole ? (
            <p className="text-sm text-slate-600 dark:text-[#A7B3C7]">
              Could not verify the role in <code>public.profiles</code> for{" "}
              <strong>{user.email}</strong>
              {profileError ? ` (${profileError})` : ""}. Please retry role
              verification.
            </p>
          ) : (
            <p className="text-sm text-slate-600 dark:text-[#A7B3C7]">
              Your account (<strong>{user.email}</strong>) has the{" "}
              <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                {normalizedRole}
              </span>{" "}
              role in <code>public.profiles</code>. Student accounts are not
              permitted to access the Question Bank Management console.
            </p>
          )}
          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void refreshProfile()}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              Retry Role Verification
            </button>
            <Link
              href="/"
              className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Return to Student Dashboard
            </Link>
            <button
              type="button"
              onClick={async () => {
                await signOut();
                router.replace("/login");
              }}
              className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // Main Render
  // ============================================================================

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1120] text-[#0F172A] dark:text-[#F1F5F9] flex flex-col font-sans selection:bg-indigo-600 selection:text-white transition-colors duration-200">
      {/* Top Admin Header Bar */}
      <header className="sticky top-0 z-30 bg-white/90 dark:bg-[#0B1120]/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 px-4 sm:px-8 py-3.5 transition-colors">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-xs shadow-indigo-500/20">
                <span className="font-mono font-bold text-base">∑</span>
              </div>
              <span className="font-bold text-base tracking-tight text-slate-950 dark:text-[#F1F5F9]">
                MathPractice
              </span>
            </Link>
            <span className="text-slate-300 dark:text-slate-700">/</span>
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-[#151F32] border border-slate-200/80 dark:border-slate-800 text-xs">
              <span className="px-3 py-1 rounded-lg font-semibold bg-white dark:bg-indigo-600 text-indigo-700 dark:text-white shadow-xs">
                Question Bank
              </span>
              <Link
                href="/admin/ingestion"
                className="px-3 py-1 rounded-lg text-slate-600 dark:text-[#A7B3C7] hover:text-slate-950 dark:hover:text-white transition-colors"
              >
                PDF Ingestion
              </Link>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ThemeSwitcher />

            {/* Live Supabase Status Pill */}
            <div className="hidden md:inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/90 dark:border-emerald-800/70 text-emerald-900 dark:text-emerald-200 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>Supabase Connected • {normalizedRole}</span>
            </div>

            <div className="hidden sm:flex items-center gap-2.5 pl-2 border-l border-slate-200 dark:border-slate-800">
              <div className="w-8 h-8 rounded-full bg-slate-900 dark:bg-indigo-600 text-white text-xs font-bold flex items-center justify-center">
                {(profile?.full_name ?? user.email ?? "AD")
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
              <div className="text-left">
                <p className="text-xs font-semibold text-slate-900 dark:text-[#F1F5F9] leading-none">
                  {profile?.full_name || "Administrator"}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-[#A7B3C7] mt-0.5 leading-none">
                  {user.email}
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  router.replace("/login");
                }}
                className="ml-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-rose-50 dark:hover:bg-rose-950/50 hover:text-rose-600 dark:hover:text-rose-300 transition-colors cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-6 sm:py-8 space-y-7">
        {/* Notification Toast / Alert Banner */}
        {notification && (
          <div
            role="status"
            className={`flex items-center justify-between gap-4 px-4 py-3 rounded-xl border text-xs sm:text-sm shadow-sm ${
              notification.type === "error"
                ? "bg-rose-50 dark:bg-rose-950/70 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200"
                : "bg-slate-900 dark:bg-[#1E293B] border-transparent dark:border-slate-700 text-white"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  notification.type === "error"
                    ? "bg-rose-500"
                    : "bg-emerald-400"
                }`}
              />
              <span>{notification.message}</span>
            </div>
            <button
              type="button"
              onClick={() => setNotification(null)}
              className="text-xs font-semibold opacity-80 hover:opacity-100 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Database Error Banner */}
        {pageError && (
          <div
            role="alert"
            className="rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs sm:text-sm text-rose-900 dark:text-rose-200"
          >
            <div>
              <p className="font-bold">Database Error</p>
              <p className="mt-0.5">{pageError}</p>
            </div>
            <button
              type="button"
              onClick={refreshAdminData}
              className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs shrink-0 cursor-pointer"
            >
              Retry Connection
            </button>
          </div>
        )}

        {isQuestionModalOpen ? (
          <QuestionComposer
            editingQuestionId={editingQuestionId}
            formState={formState}
            setFormState={setFormState}
            chapters={chapters}
            activeChapters={activeChapters}
            chapterTopics={chapterTopics}
            caseStudies={caseStudies}
            chapterCaseStudies={chapterCaseStudies}
            chaptersMap={chaptersMap}
            createNewTopicMode={createNewTopicMode}
            setCreateNewTopicMode={setCreateNewTopicMode}
            canPublishQuestions={canPublishQuestions}
            isSaving={isSaving}
            formError={formError}
            onOpenChapterManager={openChapterManager}
            onAddOption={handleAddOption}
            onRemoveOption={handleRemoveOption}
            onToggleOptionCorrect={handleToggleOptionCorrect}
            onSaveQuestion={handleSaveQuestion}
            onCancel={() => {
              setIsQuestionModalOpen(false);
              setEditingQuestionId(null);
              setFormError(null);
            }}
            onShowToast={showToast}
          />
        ) : (
          <>
        {/* PAGE HEADER */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-[#F1F5F9]">
                Question Bank
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-violet-50 dark:bg-violet-950/70 text-violet-700 dark:text-violet-300 border border-violet-200/70 dark:border-violet-800/70">
                CBSE Class 10
              </span>
            </div>
            <p className="text-sm sm:text-base text-slate-600 dark:text-[#A7B3C7] mt-1">
              Manage, organise and verify your Class 10 Mathematics questions in
              Supabase.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={openChapterManager}
              className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] hover:bg-slate-50 dark:hover:bg-[#1E293B] text-slate-800 dark:text-slate-200 font-semibold text-sm shadow-2xs transition-all cursor-pointer"
            >
              <span>Manage Chapters ({chapters.length})</span>
            </button>

            <button
              type="button"
              onClick={openAddQuestionModal}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold text-sm shadow-sm shadow-indigo-500/20 transition-all cursor-pointer shrink-0"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
              <span>Add New Question</span>
            </button>
          </div>
        </div>

        {/* STATISTICS CARDS */}
        <section aria-label="Question Bank Statistics">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Total Questions */}
            <div className="bg-white dark:bg-[#151F32] rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-2xs hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#A7B3C7]">
                  Total Questions
                </span>
                <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.9}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z"
                    />
                  </svg>
                </div>
              </div>
              <div className="flex items-baseline gap-2.5">
                <span className="text-3xl font-bold tracking-tight text-slate-950 dark:text-[#F1F5F9]">
                  {stats.total.toLocaleString("en-US")}
                </span>
                <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/70 px-2 py-0.5 rounded-full">
                  {chapters.filter((c) => c.is_active).length} Active Chapters
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-[#A7B3C7] mt-2">
                {stats.published} Published • {stats.archived} Archived
              </p>
            </div>

            {/* Verified & Published */}
            <div className="bg-white dark:bg-[#151F32] rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-2xs hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#A7B3C7]">
                  Verified & Published
                </span>
                <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.9}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
              </div>
              <div className="flex items-baseline gap-2.5">
                <span className="text-3xl font-bold tracking-tight text-slate-950 dark:text-[#F1F5F9]">
                  {(stats.verified + stats.published).toLocaleString("en-US")}
                </span>
                <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/70 px-2 py-0.5 rounded-full">
                  {stats.verified} Verified • {stats.published} Live
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-[#A7B3C7] mt-2">
                Approved by subject matter experts
              </p>
            </div>

            {/* In Review */}
            <div className="bg-white dark:bg-[#151F32] rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-2xs hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#A7B3C7]">
                  In Review
                </span>
                <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.9}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
              </div>
              <div className="flex items-baseline gap-2.5">
                <span className="text-3xl font-bold tracking-tight text-slate-950 dark:text-[#F1F5F9]">
                  {stats.inReview.toLocaleString("en-US")}
                </span>
                <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/70 px-2 py-0.5 rounded-full">
                  Needs QA
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-[#A7B3C7] mt-2">
                Awaiting solution & marking scheme check
              </p>
            </div>

            {/* Drafts */}
            <div className="bg-white dark:bg-[#151F32] rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-2xs hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#A7B3C7]">
                  Drafts
                </span>
                <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-950/80 text-violet-600 dark:text-violet-400 flex items-center justify-center">
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.9}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"
                    />
                  </svg>
                </div>
              </div>
              <div className="flex items-baseline gap-2.5">
                <span className="text-3xl font-bold tracking-tight text-slate-950 dark:text-[#F1F5F9]">
                  {stats.drafts.toLocaleString("en-US")}
                </span>
                <span className="text-xs font-semibold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/70 px-2 py-0.5 rounded-full">
                  In Progress
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-[#A7B3C7] mt-2">
                Saved in Supabase as work-in-progress
              </p>
            </div>
          </div>
        </section>

        {/* SEARCH & FILTERS TOOLBAR */}
        <section
          aria-label="Search and Filter Questions"
          className="bg-white dark:bg-[#151F32] rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-2xs space-y-4 transition-colors"
        >
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5">
            {/* Search Input */}
            <div className="md:col-span-4 relative">
              <label htmlFor="question-search" className="sr-only">
                Search questions by code or text
              </label>
              <svg
                className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
                />
              </svg>
              <input
                id="question-search"
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search by Question Code or text..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-[#1E293B] focus:bg-white dark:focus:bg-[#1E293B] text-sm text-slate-900 dark:text-[#F1F5F9] placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 dark:focus:ring-indigo-500/30 focus:border-indigo-600 dark:focus:border-indigo-400 transition-all"
              />
            </div>

            {/* Chapter Filter */}
            <div className="md:col-span-3">
              <label htmlFor="chapter-filter" className="sr-only">
                Filter by Chapter
              </label>
              <select
                id="chapter-filter"
                value={chapterFilter}
                onChange={(e) => {
                  setChapterFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-[#1E293B] hover:bg-white dark:hover:bg-[#1E293B] text-sm text-slate-800 dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-indigo-600/20 cursor-pointer"
              >
                <option value="ALL">All Chapters</option>
                {chapters.map((chap) => (
                  <option key={chap.id} value={chap.id}>
                    Ch {chap.chapter_number}: {chap.name}
                    {!chap.is_active ? " (Inactive)" : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Question Type Filter */}
            <div className="md:col-span-2">
              <label htmlFor="type-filter" className="sr-only">
                Filter by Question Type
              </label>
              <select
                id="type-filter"
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-[#1E293B] hover:bg-white dark:hover:bg-[#1E293B] text-sm text-slate-800 dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-indigo-600/20 cursor-pointer"
              >
                <option value="ALL">All Types</option>
                {QUESTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Difficulty Filter */}
            <div className="md:col-span-1">
              <label htmlFor="difficulty-filter" className="sr-only">
                Filter by Difficulty
              </label>
              <select
                id="difficulty-filter"
                value={difficultyFilter}
                onChange={(e) => {
                  setDifficultyFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full px-2.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-[#1E293B] hover:bg-white dark:hover:bg-[#1E293B] text-sm text-slate-800 dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-indigo-600/20 cursor-pointer"
              >
                <option value="ALL">Difficulty</option>
                {DIFFICULTY_LEVELS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div className="md:col-span-2">
              <label htmlFor="status-filter" className="sr-only">
                Filter by Status
              </label>
              <select
                id="status-filter"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-[#1E293B] hover:bg-white dark:hover:bg-[#1E293B] text-sm text-slate-800 dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-indigo-600/20 cursor-pointer"
              >
                <option value="ALL">All Statuses</option>
                {QUESTION_STATUSES.map((st) => (
                  <option key={st.value} value={st.value}>
                    {st.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Active filter summary & Page size bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-slate-500 dark:text-[#A7B3C7]">
            <div className="flex items-center gap-3">
              <span>
                Showing{" "}
                <strong className="text-slate-900 dark:text-[#F1F5F9]">
                  {questions.length}
                </strong>{" "}
                of{" "}
                <strong className="text-slate-900 dark:text-[#F1F5F9]">
                  {totalCount}
                </strong>{" "}
                matching database records
              </span>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 cursor-pointer"
                >
                  Clear All Filters
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="page-size-select">Rows per page:</label>
              <select
                id="page-size-select"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
                className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-slate-800 dark:text-slate-200 text-xs font-semibold"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
          </div>
        </section>

        {/* QUESTION MANAGEMENT TABLE */}
        <section
          aria-label="Question Management Table"
          className="bg-white dark:bg-[#151F32] rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-2xs overflow-hidden transition-colors"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-[#1E293B]/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-[#A7B3C7]">
                  <th className="py-3.5 pl-6 pr-3">Question Code</th>
                  <th className="py-3.5 px-3 min-w-[260px]">Question Text</th>
                  <th className="py-3.5 px-3">Chapter</th>
                  <th className="py-3.5 px-3">Question Type</th>
                  <th className="py-3.5 px-3">Difficulty</th>
                  <th className="py-3.5 px-3">Marks</th>
                  <th className="py-3.5 px-3">Status</th>
                  <th className="py-3.5 pl-3 pr-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
                {isLoadingData ? (
                  Array.from({ length: 4 }).map((_, idx) => (
                    <tr key={idx} className="animate-pulse">
                      <td colSpan={8} className="py-5 px-6">
                        <div className="h-4 bg-slate-100 dark:bg-slate-800 rounded-lg w-full" />
                      </td>
                    </tr>
                  ))
                ) : questions.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="py-14 px-6 text-center text-slate-500 dark:text-[#A7B3C7]"
                    >
                      <div className="max-w-md mx-auto space-y-3">
                        <p className="font-bold text-slate-900 dark:text-[#F1F5F9] text-base">
                          {hasActiveFilters
                            ? "No matching questions found"
                            : "No questions in the Question Bank yet"}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-[#A7B3C7] leading-relaxed">
                          {hasActiveFilters
                            ? "Try adjusting your search query or clearing the active chapter, type, difficulty, or status filters."
                            : chapters.length === 0
                            ? "Start by creating your first Class 10 Mathematics chapter in Supabase, then add questions to it."
                            : "Click 'Add New Question' to create your first MCQ, True/False, Fill in the Blank, Subjective, or Case-Based question in Supabase."}
                        </p>
                        <div className="pt-1 flex flex-wrap items-center justify-center gap-2.5">
                          {hasActiveFilters ? (
                            <button
                              type="button"
                              onClick={resetFilters}
                              className="px-4 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 font-semibold text-xs hover:bg-indigo-100 cursor-pointer"
                            >
                              Reset Filters
                            </button>
                          ) : chapters.length === 0 ? (
                            <button
                              type="button"
                              onClick={openChapterManager}
                              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs cursor-pointer"
                            >
                              Create First Chapter
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={openAddQuestionModal}
                              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs cursor-pointer"
                            >
                              + Add First Question
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  questions.map((q) => (
                    <tr
                      key={q.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-[#1E293B]/60 transition-colors group"
                    >
                      {/* Question Code */}
                      <td className="py-4 pl-6 pr-3 whitespace-nowrap">
                        <span className="font-mono text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50/90 dark:bg-indigo-950/70 px-2.5 py-1 rounded-md border border-indigo-200/60 dark:border-indigo-800/70">
                          {q.question_code}
                        </span>
                      </td>

                      {/* Question Text */}
                      <td className="py-4 px-3">
                        <div className="font-medium text-slate-900 dark:text-[#F1F5F9] line-clamp-1 math-expression">
                          <MathContentRenderer
                            content={q.question_text}
                            inline
                          />
                        </div>
                        <span className="text-[11px] text-slate-400 dark:text-slate-500">
                          {q.topic_name ? `Topic: ${q.topic_name} • ` : ""}
                          Updated {formatDateShort(q.updated_at)}
                        </span>
                      </td>

                      {/* Chapter */}
                      <td className="py-4 px-3 whitespace-nowrap">
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {q.chapter_number ? `Ch ${q.chapter_number}: ` : ""}
                          {q.chapter_name}
                        </span>
                      </td>

                      {/* Question Type */}
                      <td className="py-4 px-3 whitespace-nowrap">
                        <TypeBadge
                          type={q.question_type}
                          answerType={q.answer_type}
                        />
                      </td>

                      {/* Difficulty */}
                      <td className="py-4 px-3 whitespace-nowrap">
                        <DifficultyBadge difficulty={q.difficulty} />
                      </td>

                      {/* Marks */}
                      <td className="py-4 px-3 whitespace-nowrap">
                        <span className="font-semibold text-slate-900 dark:text-[#F1F5F9]">
                          {q.marks} {q.marks === 1 ? "Mark" : "Marks"}
                        </span>
                        {q.negative_marks > 0 && (
                          <span className="block text-[11px] text-rose-600 dark:text-rose-400">
                            -{q.negative_marks} neg
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-4 px-3 whitespace-nowrap">
                        <StatusBadge status={q.status} />
                      </td>

                      {/* Actions */}
                      <td className="py-4 pl-3 pr-6 whitespace-nowrap text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={isLoadingDetails}
                            onClick={() => openViewQuestionModal(q)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1E293B] hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                          >
                            View
                          </button>
                          <button
                            type="button"
                            disabled={isLoadingDetails}
                            onClick={() => openEditQuestionModal(q)}
                            className="px-2.5 py-1.5 rounded-lg border border-indigo-200/80 dark:border-indigo-800/80 bg-indigo-50/60 dark:bg-indigo-950/60 hover:bg-indigo-100/80 dark:hover:bg-indigo-900/60 text-xs font-semibold text-indigo-700 dark:text-indigo-300 transition-colors cursor-pointer"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingQuestion(q)}
                            className="px-2.5 py-1.5 rounded-lg border border-rose-200/80 dark:border-rose-800/70 bg-rose-50/60 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-xs font-semibold text-rose-700 dark:text-rose-300 transition-colors cursor-pointer"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="px-6 py-4 bg-slate-50/60 dark:bg-[#1E293B]/50 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600 dark:text-[#A7B3C7]">
            <div>
              Page{" "}
              <strong className="text-slate-900 dark:text-[#F1F5F9]">
                {page}
              </strong>{" "}
              of{" "}
              <strong className="text-slate-900 dark:text-[#F1F5F9]">
                {totalPages}
              </strong>{" "}
              ({totalCount} total questions)
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1 || isLoadingData}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] disabled:opacity-40 font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                ← Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages || isLoadingData}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] disabled:opacity-40 font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                Next →
              </button>
            </div>
          </div>
        </section>
          </>
        )}
      </main>

      {/* =====================================================================
          MODAL 1: CHAPTER MANAGEMENT (CREATE, EDIT, ACTIVATE/DEACTIVATE)
      ===================================================================== */}
      {isChapterModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="chapter-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
        >
          <div className="bg-white dark:bg-[#151F32] rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl max-w-3xl w-full overflow-hidden flex flex-col max-h-[88vh]">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  Curriculum Structure • public.chapters
                </span>
                <h2
                  id="chapter-modal-title"
                  className="text-lg font-bold text-slate-950 dark:text-[#F1F5F9]"
                >
                  Manage Class 10 Chapters
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsChapterModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {/* Create / Edit Chapter Form */}
              <form
                onSubmit={handleSaveChapter}
                className="p-4 rounded-2xl bg-slate-50 dark:bg-[#1E293B] border border-slate-200/80 dark:border-slate-700 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                    {editingChapterId ? "Edit Chapter" : "Create New Chapter"}
                  </h3>
                  {editingChapterId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingChapterId(null);
                        setChapterForm({
                          chapter_number: chapters.length + 1,
                          name: "",
                          description: "",
                          is_active: true,
                        });
                      }}
                      className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 cursor-pointer"
                    >
                      + Switch to Create New
                    </button>
                  )}
                </div>

                {chapterFormError && (
                  <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
                    {chapterFormError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold uppercase text-slate-500 dark:text-[#A7B3C7] mb-1">
                      Ch No. *
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={chapterForm.chapter_number}
                      onChange={(e) =>
                        setChapterForm((prev) => ({
                          ...prev,
                          chapter_number: Number(e.target.value),
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] text-sm text-slate-900 dark:text-[#F1F5F9]"
                    />
                  </div>

                  <div className="sm:col-span-5">
                    <label className="block text-[11px] font-semibold uppercase text-slate-500 dark:text-[#A7B3C7] mb-1">
                      Chapter Name *
                    </label>
                    <input
                      type="text"
                      value={chapterForm.name}
                      onChange={(e) =>
                        setChapterForm((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                      placeholder="e.g., Quadratic Equations"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] text-sm text-slate-900 dark:text-[#F1F5F9]"
                    />
                  </div>

                  <div className="sm:col-span-5">
                    <label className="block text-[11px] font-semibold uppercase text-slate-500 dark:text-[#A7B3C7] mb-1">
                      Description (Optional)
                    </label>
                    <input
                      type="text"
                      value={chapterForm.description}
                      onChange={(e) =>
                        setChapterForm((prev) => ({
                          ...prev,
                          description: e.target.value,
                        }))
                      }
                      placeholder="Roots, discriminant, nature of roots..."
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] text-sm text-slate-900 dark:text-[#F1F5F9]"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={chapterForm.is_active}
                      onChange={(e) =>
                        setChapterForm((prev) => ({
                          ...prev,
                          is_active: e.target.checked,
                        }))
                      }
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600"
                    />
                    <span>Active (available for student practice & questions)</span>
                  </label>

                  <button
                    type="submit"
                    disabled={isSavingChapter}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer"
                  >
                    {isSavingChapter
                      ? "Saving..."
                      : editingChapterId
                      ? "Save Chapter Changes"
                      : "+ Create Chapter"}
                  </button>
                </div>
              </form>

              {/* Chapters Table */}
              <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-[#1E293B] border-b border-slate-200 dark:border-slate-700 text-[11px] font-semibold uppercase text-slate-500 dark:text-[#A7B3C7]">
                      <th className="py-2.5 px-4">No.</th>
                      <th className="py-2.5 px-4">Chapter Name</th>
                      <th className="py-2.5 px-4">Status</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {chapters.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="py-6 text-center text-slate-500 text-xs"
                        >
                          No chapters created yet. Use the form above to add one.
                        </td>
                      </tr>
                    ) : (
                      chapters.map((c) => (
                        <tr key={c.id}>
                          <td className="py-3 px-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                            Ch {c.chapter_number}
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-semibold text-slate-900 dark:text-[#F1F5F9]">
                              {c.name}
                            </p>
                            {c.description && (
                              <p className="text-xs text-slate-500 dark:text-[#A7B3C7]">
                                {c.description}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                c.is_active
                                  ? "bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300"
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                              }`}
                            >
                              {c.is_active ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right space-x-2">
                            <button
                              type="button"
                              onClick={() => startEditChapter(c)}
                              className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleChapterActive(c)}
                              className="px-2.5 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800 text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 cursor-pointer"
                            >
                              {c.is_active ? "Deactivate" : "Activate"}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="px-6 py-3.5 bg-slate-50 dark:bg-[#1E293B]/60 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setIsChapterModalOpen(false)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 3: VIEW QUESTION DETAILS & PUBLISHING WORKFLOW
      ===================================================================== */}
      {viewingQuestion && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="view-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
        >
          <div className="bg-white dark:bg-[#151F32] rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[88vh]">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-xs font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/70 px-2.5 py-1 rounded-md border border-indigo-200/60 dark:border-indigo-800/70">
                  {viewingQuestion.question_code}
                </span>
                <StatusBadge status={viewingQuestion.status} />
                <DifficultyBadge difficulty={viewingQuestion.difficulty} />
              </div>
              <button
                type="button"
                onClick={() => setViewingQuestion(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto">
              {/* Case Study Passage if present */}
              {viewingQuestion.case_study_passage && (
                <div className="p-3.5 rounded-xl bg-violet-50/60 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 text-xs space-y-1">
                  <p className="font-bold text-violet-800 dark:text-violet-300">
                    Case Study: {viewingQuestion.case_study_title}
                  </p>
                  <div className="text-slate-700 dark:text-slate-300 leading-relaxed">
                    <MathContentRenderer
                      content={viewingQuestion.case_study_passage}
                    />
                  </div>
                </div>
              )}

              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Question Statement ({viewingQuestion.marks} Marks
                  {viewingQuestion.negative_marks > 0
                    ? `, -${viewingQuestion.negative_marks} Negative`
                    : ""}
                  )
                </span>
                <div
                  id="view-modal-title"
                  className="mt-1.5 text-base font-semibold text-slate-950 dark:text-[#F1F5F9] leading-relaxed bg-slate-50 dark:bg-[#1E293B] p-4 rounded-xl border border-slate-200/80 dark:border-slate-700 math-expression"
                >
                  <MathContentRenderer
                    content={viewingQuestion.question_text}
                  />
                </div>
              </div>

              {/* Standalone Attached Media Preview */}
              {viewingQuestion.media.filter(
                (m) =>
                  m.media_url.trim() !== "" &&
                  !viewingQuestion.question_text.includes(m.media_url) &&
                  !viewingQuestion.answer.model_answer.includes(m.media_url)
              ).length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                    Attached Diagrams & Figures
                  </span>
                  <div className="flex flex-wrap gap-3">
                    {viewingQuestion.media
                      .filter(
                        (m) =>
                          m.media_url.trim() !== "" &&
                          !viewingQuestion.question_text.includes(
                            m.media_url
                          ) &&
                          !viewingQuestion.answer.model_answer.includes(
                            m.media_url
                          )
                      )
                      .map((m, i) => (
                        <StorageImage
                          key={i}
                          src={m.media_url}
                          caption={m.caption}
                        />
                      ))}
                  </div>
                </div>
              )}

              {/* Options Preview */}
              {viewingQuestion.options.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 block">
                    Options ({viewingQuestion.mcq_mode} Correct)
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {viewingQuestion.options.map((o, i) => (
                      <div
                        key={i}
                        className={`p-2.5 rounded-xl border text-xs flex items-center gap-2.5 ${
                          o.is_correct
                            ? "border-emerald-300 dark:border-emerald-700 bg-emerald-50/60 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 font-semibold"
                            : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B]"
                        }`}
                      >
                        <span className="font-mono font-bold">
                          {o.option_key}.
                        </span>
                        <span className="flex-1">
                          <MathContentRenderer content={o.option_text} inline />
                        </span>
                        {o.is_correct && (
                          <span className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400">
                            ✓ Correct
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Model Answer & Step-by-Step Solution */}
              <div className="space-y-3 p-4 rounded-xl bg-slate-50 dark:bg-[#1E293B] border border-slate-200/80 dark:border-slate-700 text-xs">
                <div>
                  <span className="font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 block mb-1">
                    Model Answer
                  </span>
                  <div className="text-slate-800 dark:text-slate-200">
                    {viewingQuestion.answer.model_answer ? (
                      <MathContentRenderer
                        content={viewingQuestion.answer.model_answer}
                      />
                    ) : (
                      "No model answer recorded."
                    )}
                  </div>
                </div>

                {viewingQuestion.answer.step_by_step_solution.length > 0 && (
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1.5">
                    <span className="font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 block">
                      Step-by-Step Solution
                    </span>
                    {viewingQuestion.answer.step_by_step_solution.map(
                      (s, i) => (
                        <div
                          key={i}
                          className="flex items-start justify-between gap-2 text-slate-700 dark:text-slate-300"
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
                      )
                    )}
                  </div>
                )}

                {viewingQuestion.answer.marking_scheme.length > 0 && (
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1">
                    <span className="font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 block">
                      Marking Scheme
                    </span>
                    {viewingQuestion.answer.marking_scheme.map((m, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between text-slate-700 dark:text-slate-300"
                      >
                        <span>• {m.criterion}</span>
                        <span className="font-mono font-bold">
                          {m.marks}M
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Publishing Workflow Bar */}
              <div className="p-3.5 rounded-xl bg-slate-100/80 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#A7B3C7] block mb-2">
                  Publishing Workflow Transition
                </span>
                <div className="flex flex-wrap gap-2">
                  {QUESTION_STATUSES.map((st) => (
                    <button
                      key={st.value}
                      type="button"
                      disabled={
                        viewingQuestion.status === st.value ||
                        (st.value === "PUBLISHED" && !canPublishQuestions)
                      }
                      onClick={() =>
                        handleWorkflowStatusChange(viewingQuestion, st.value)
                      }
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                        viewingQuestion.status === st.value
                          ? "bg-indigo-600 text-white"
                          : "bg-white dark:bg-[#151F32] border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400"
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 dark:bg-[#1E293B]/70 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  const q = viewingQuestion;
                  setViewingQuestion(null);
                  setDeletingQuestion(q);
                }}
                className="px-3.5 py-2 rounded-xl border border-rose-200 dark:border-rose-800 text-xs font-semibold text-rose-600 dark:text-rose-400 cursor-pointer"
              >
                Delete Question
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const q = viewingQuestion;
                    setViewingQuestion(null);
                    openEditQuestionModal(q);
                  }}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold text-white cursor-pointer"
                >
                  Edit Question
                </button>
                <button
                  type="button"
                  onClick={() => setViewingQuestion(null)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 4: DELETE QUESTION CONFIRMATION DIALOG
      ===================================================================== */}
      {deletingQuestion && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
        >
          <div className="bg-white dark:bg-[#151F32] rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="w-11 h-11 rounded-2xl bg-rose-50 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold text-lg">
              !
            </div>
            <div>
              <h3
                id="delete-modal-title"
                className="text-lg font-bold text-slate-950 dark:text-[#F1F5F9]"
              >
                Delete Question {deletingQuestion.question_code}?
              </h3>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-[#A7B3C7] mt-1">
                This will permanently delete{" "}
                <strong>{deletingQuestion.question_code}</strong> and its
                associated options, model answers, and media from Supabase.
              </p>
              <p className="mt-2 p-3 rounded-xl bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 line-clamp-2">
                {deletingQuestion.question_text}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeletingQuestion(null)}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDeleteQuestion}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-xs font-semibold text-white cursor-pointer"
              >
                {isDeleting ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
