"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { useAuth } from "@/components/auth-provider";
import { MathContentRenderer } from "@/components/math-renderer";
import { SubjectiveAnswerEditor } from "@/components/subjective-answer-editor";
import {
  fetchChapters,
  fetchTopics,
  fetchPublishedQuestionsForStudent,
  submitStudentAnswer,
  fetchStudentResults,
  fetchStudentCompetitiveOverview,
  fetchCompetitiveLeaderboard,
  fetchVerifiedSchools,
  updateStudentCompetitivePreferences,
  type ChapterRecord,
  type TopicRecord,
  type StudentPracticeQuestion,
  type StudentEvaluationResult,
  type StudentCompetitiveOverview,
  type DailyTrendPoint,
  type CompetitiveLeaderboardResult,
  type CompetitiveLeaderboardRow,
  type VerifiedSchoolRecord,
} from "@/lib/admin-questions-db";

// --- Types ---
type NavItemKey =
  | "Dashboard"
  | "Practice Questions"
  | "Leaderboard"
  | "Chapter Tests"
  | "My Performance"
  | "Bookmarks"
  | "Profile";

type AnswerFormatMode = "mcq" | "subjective" | "handwritten";
type SubjectiveLength =
  | "Very Short (1M)"
  | "Short Answer (3M)"
  | "Long Answer (5M)";

interface NavItem {
  key: NavItemKey;
  label: string;
  badge?: string;
}

interface Chapter {
  id: string;
  number: string;
  name: string;
  formula: string;
  progress: number;
  attempted: number;
  total: number;
  accuracy: number;
  topicTag: string;
}

interface WeakArea {
  id: string;
  name: string;
  number: string;
  accuracy: number;
  recommendedQuestions: number;
  subtopic: string;
  priority: "High Priority" | "Needs Review";
}

interface ActivitySession {
  id: string;
  chapterName: string;
  sessionType: string;
  questionsAttempted: number;
  accuracy: number;
  timestamp: string;
  duration: string;
}

interface SampleQuestion {
  id: string;
  chapter: string;
  difficulty: "Medium" | "Board PYQ" | "HOTS";
  questionText: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

// --- Static Navigation Configuration ---
const NAV_ITEMS: NavItem[] = [
  { key: "Dashboard", label: "Dashboard" },
  { key: "Practice Questions", label: "Practice", badge: "CBSE" },
  { key: "Leaderboard", label: "Leaderboard", badge: "Rank" },
  { key: "My Performance", label: "My Progress" },
  { key: "Bookmarks", label: "Bookmarks" },
  { key: "Profile", label: "Profile" },
];

const CONTINUE_LEARNING_CHAPTERS: Chapter[] = [
  {
    id: "real-numbers",
    number: "Chapter 01",
    name: "Real Numbers",
    formula: "HCF(a, b) × LCM(a, b) = a × b",
    progress: 82,
    attempted: 41,
    total: 50,
    accuracy: 88,
    topicTag: "Fundamental Theorem of Arithmetic",
  },
  {
    id: "polynomials",
    number: "Chapter 02",
    name: "Polynomials",
    formula: "α + β = -b/a, αβ = c/a",
    progress: 68,
    attempted: 34,
    total: 50,
    accuracy: 81,
    topicTag: "Zeroes & Coefficients",
  },
  {
    id: "quadratic-equations",
    number: "Chapter 04",
    name: "Quadratic Equations",
    formula: "D = b² - 4ac ≥ 0",
    progress: 54,
    attempted: 27,
    total: 50,
    accuracy: 76,
    topicTag: "Nature of Roots",
  },
  {
    id: "arithmetic-progressions",
    number: "Chapter 05",
    name: "Arithmetic Progressions",
    formula: "aₙ = a + (n - 1)d",
    progress: 40,
    attempted: 20,
    total: 50,
    accuracy: 74,
    topicTag: "n-th Term & Sum of AP",
  },
];

const WEAK_AREAS: WeakArea[] = [
  {
    id: "triangles",
    number: "Chapter 06",
    name: "Triangles",
    accuracy: 58,
    recommendedQuestions: 15,
    subtopic:
      "Basic Proportionality Theorem (Thales' Theorem) & Similarity Criteria",
    priority: "High Priority",
  },
  {
    id: "trigonometry",
    number: "Chapter 08",
    name: "Trigonometry",
    accuracy: 62,
    recommendedQuestions: 20,
    subtopic:
      "Trigonometric Identities (sin²θ + cos²θ = 1) & Complementary Angles",
    priority: "High Priority",
  },
];

const RECENT_ACTIVITY: ActivitySession[] = [
  {
    id: "act-1",
    chapterName: "Quadratic Equations",
    sessionType: "Topic Drill • Discriminant & Roots",
    questionsAttempted: 20,
    accuracy: 85,
    timestamp: "Today, 7:30 AM",
    duration: "24 mins",
  },
  {
    id: "act-2",
    chapterName: "Trigonometry",
    sessionType: "Timed Practice • Identities",
    questionsAttempted: 15,
    accuracy: 60,
    timestamp: "Yesterday, 6:15 PM",
    duration: "22 mins",
  },
  {
    id: "act-3",
    chapterName: "Polynomials",
    sessionType: "Chapter Checkpoint Test",
    questionsAttempted: 25,
    accuracy: 80,
    timestamp: "2 days ago",
    duration: "31 mins",
  },
];

const SAMPLE_QUESTIONS_BY_CHAPTER: Record<string, SampleQuestion> = {
  "Real Numbers": {
    id: "q-real",
    chapter: "Real Numbers",
    difficulty: "Board PYQ",
    questionText:
      "If the HCF of 65 and 117 is expressible in the form 65m - 117, then find the value of m.",
    options: ["m = 1", "m = 2", "m = 3", "m = 4"],
    correctIndex: 1,
    explanation:
      "HCF(65, 117) = 13. Setting 65m - 117 = 13 gives 65m = 130, so m = 2.",
  },
  Polynomials: {
    id: "q-poly",
    chapter: "Polynomials",
    difficulty: "Medium",
    questionText:
      "If α and β are the zeroes of the quadratic polynomial f(x) = x² - 5x + k such that α - β = 1, what is the value of k?",
    options: ["k = 6", "k = 4", "k = 5", "k = -6"],
    correctIndex: 0,
    explanation:
      "α + β = 5 and α - β = 1. Solving gives α = 3, β = 2. Therefore, k = αβ = 3 × 2 = 6.",
  },
  "Quadratic Equations": {
    id: "q-quad",
    chapter: "Quadratic Equations",
    difficulty: "Board PYQ",
    questionText:
      "For what positive value of k does the quadratic equation 3x² - kx + 3 = 0 have real and equal roots?",
    options: ["k = 3", "k = 6", "k = 9", "k = 12"],
    correctIndex: 1,
    explanation:
      "For equal roots, Discriminant D = b² - 4ac = 0 ⇒ (-k)² - 4(3)(3) = 0 ⇒ k² = 36 ⇒ k = 6.",
  },
  "Arithmetic Progressions": {
    id: "q-ap",
    chapter: "Arithmetic Progressions",
    difficulty: "Medium",
    questionText:
      "Which term of the Arithmetic Progression 21, 18, 15, ... is -81?",
    options: ["32nd term", "34th term", "35th term", "36th term"],
    correctIndex: 2,
    explanation:
      "Here a = 21, d = -3, aₙ = -81. Using a + (n - 1)d = -81 ⇒ 21 - 3(n - 1) = -81 ⇒ -3(n - 1) = -102 ⇒ n - 1 = 34 ⇒ n = 35.",
  },
  Triangles: {
    id: "q-tri",
    chapter: "Triangles",
    difficulty: "HOTS",
    questionText:
      "In ΔABC, DE ∥ BC such that AD = 2.4 cm, AE = 3.2 cm and EC = 4.8 cm. What is the length of AB?",
    options: ["3.6 cm", "6.0 cm", "5.6 cm", "6.4 cm"],
    correctIndex: 1,
    explanation:
      "By Basic Proportionality Theorem, AD/DB = AE/EC ⇒ 2.4/DB = 3.2/4.8 = 2/3 ⇒ DB = 3.6 cm. Thus AB = AD + DB = 2.4 + 3.6 = 6.0 cm.",
  },
  Trigonometry: {
    id: "q-trig",
    chapter: "Trigonometry",
    difficulty: "Board PYQ",
    questionText:
      "If sin θ + cos θ = √2 cos θ, where θ ≠ 90°, then the value of tan θ is:",
    options: ["√2 - 1", "√2 + 1", "1 / √2", "2 - √2"],
    correctIndex: 0,
    explanation:
      "Dividing both sides by cos θ gives tan θ + 1 = √2 ⇒ tan θ = √2 - 1.",
  },
};

const MATH_SYMBOLS = ["√", "π", "θ", "α", "β", "Δ", "≤", "≥", "≠", "±", "²", "⇒"];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "ST";
}

// --- Icon Helper Components ---
function NavIcon({ item, active }: { item: NavItemKey; active: boolean }) {
  const colorClass = active
    ? "text-indigo-600 dark:text-indigo-400"
    : "text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300";

  switch (item) {
    case "Dashboard":
      return (
        <svg
          className={`w-5 h-5 ${colorClass} transition-colors`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.85}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
          />
        </svg>
      );
    case "Practice Questions":
      return (
        <svg
          className={`w-5 h-5 ${colorClass} transition-colors`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.85}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
          />
        </svg>
      );
    case "Leaderboard":
      return (
        <svg
          className={`w-5 h-5 ${colorClass} transition-colors`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.85}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.504-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.003 0V4.875c0-.621-.504-1.125-1.125-1.125h-1.5c-.621 0-1.125.504-1.125 1.125v9.375m3.75 0h-3.75"
          />
        </svg>
      );
    case "Chapter Tests":
      return (
        <svg
          className={`w-5 h-5 ${colorClass} transition-colors`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.85}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z"
          />
        </svg>
      );
    case "My Performance":
      return (
        <svg
          className={`w-5 h-5 ${colorClass} transition-colors`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.85}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
          />
        </svg>
      );
    case "Bookmarks":
      return (
        <svg
          className={`w-5 h-5 ${colorClass} transition-colors`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.85}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
          />
        </svg>
      );
    case "Profile":
      return (
        <svg
          className={`w-5 h-5 ${colorClass} transition-colors`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.85}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
          />
        </svg>
      );
  }
}

function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return "Recently";
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    if (diffMs < 0) return "Just now";
    const diffMins = Math.floor(diffMs / (60 * 1000));
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "Recently";
  }
}

function getTrendSvgPath(
  dailyTrend: DailyTrendPoint[],
  metric: "accuracy" | "attempts" | "marks"
) {
  const width = 520;
  const height = 180;
  const padLeft = 35;
  const padRight = 25;
  const padTop = 25;
  const padBottom = 30;

  const values = dailyTrend.map((d) => {
    if (metric === "accuracy") return d.accuracyPct;
    if (metric === "attempts") return d.questionsAttempted;
    return d.marksScored;
  });

  const maxVal = metric === "accuracy" ? 100 : Math.max(5, ...values);
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const points = values.map((val, idx) => {
    const x = padLeft + (idx / Math.max(1, dailyTrend.length - 1)) * chartW;
    const y = height - padBottom - (val / maxVal) * chartH;
    return { x, y, val, data: dailyTrend[idx] };
  });

  let pathD = "";
  points.forEach((p, i) => {
    if (i === 0) {
      pathD += `M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    } else {
      const prev = points[i - 1];
      const cx1 = (prev.x + (p.x - prev.x) / 3).toFixed(1);
      const cx2 = (p.x - (p.x - prev.x) / 3).toFixed(1);
      pathD += ` C ${cx1} ${prev.y.toFixed(1)}, ${cx2} ${p.y.toFixed(1)}, ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    }
  });

  const lastP = points[points.length - 1] || { x: width - padRight, y: height - padBottom };
  const firstP = points[0] || { x: padLeft, y: height - padBottom };
  const baselineY = (height - padBottom).toFixed(1);
  const areaD =
    points.length > 0
      ? `${pathD} L ${lastP.x.toFixed(1)} ${baselineY} L ${firstP.x.toFixed(1)} ${baselineY} Z`
      : "";

  return { points, pathD, areaD, maxVal, width, height, padLeft, padRight, padTop, padBottom };
}

export default function StudentDashboardPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading, profileLoading, signOut } =
    useAuth();

  const [activeNav, setActiveNav] = useState<NavItemKey>("Dashboard");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Interactive practice modal / drawer state
  const [activePracticeChapter, setActivePracticeChapter] = useState<
    string | null
  >(null);
  const [answerFormatMode, setAnswerFormatMode] =
    useState<AnswerFormatMode>("mcq");
  const [subjectiveLength, setSubjectiveLength] =
    useState<SubjectiveLength>("Short Answer (3M)");
  const [subjectiveWorkText, setSubjectiveWorkText] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [answerSubmitted, setAnswerSubmitted] = useState(false);
  const [questionsAttemptedCount, setQuestionsAttemptedCount] = useState(0);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [trendMetric, setTrendMetric] =
    useState<"accuracy" | "attempts" | "marks">("accuracy");

  // Live published questions from Supabase (student-safe: no answer key loaded)
  const [liveQuestions, setLiveQuestions] = useState<StudentPracticeQuestion[]>(
    []
  );
  const [liveChapterNames, setLiveChapterNames] = useState<
    Record<string, string>
  >({});
  const [liveTopicNames, setLiveTopicNames] = useState<Record<string, string>>({});
  const [chaptersList, setChaptersList] = useState<ChapterRecord[]>([]);
  const [topicsList, setTopicsList] = useState<TopicRecord[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);

  // Student question filter states
  const [selectedChapterId, setSelectedChapterId] = useState<string>("ALL");
  const [selectedTopicId, setSelectedTopicId] = useState<string>("ALL");
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>("ALL");
  const [selectedQuestionType, setSelectedQuestionType] = useState<string>("ALL");

  const [liveLoading, setLiveLoading] = useState(true);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveReloadTick, setLiveReloadTick] = useState(0);
  const [liveSelected, setLiveSelected] = useState<Record<string, string>>({});
  const [liveResults, setLiveResults] = useState<
    Record<string, StudentEvaluationResult>
  >({});

  // Competitive Platform State (LeetCode & GFG style for CBSE Class 10)
  const [competitiveOverview, setCompetitiveOverview] =
    useState<StudentCompetitiveOverview | null>(null);
  const [compLoading, setCompLoading] = useState(true);
  const [leaderboardScope, setLeaderboardScope] = useState<
    "SCHOOL" | "CITY" | "OVERALL"
  >("SCHOOL");
  const [leaderboardData, setLeaderboardData] =
    useState<CompetitiveLeaderboardResult | null>(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [verifiedSchools, setVerifiedSchools] = useState<VerifiedSchoolRecord[]>(
    []
  );
  const [isSchoolModalOpen, setIsSchoolModalOpen] = useState(false);
  const [selectedSchoolId, setSelectedSchoolId] = useState<string>("");
  const [competitiveOptIn, setCompetitiveOptIn] = useState<boolean>(true);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferencesToast, setPreferencesToast] = useState<string | null>(null);

  // Load Student Competitive Overview (Points, Badges, Solved by Difficulty, Streak)
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    setCompLoading(true);

    fetchStudentCompetitiveOverview(user.id)
      .then((overview) => {
        if (!cancelled && overview) {
          setCompetitiveOverview(overview);
          if (overview.questionsAttempted > 0) {
            setQuestionsAttemptedCount(overview.questionsAttempted);
          }
        }
      })
      .catch((err) => console.error("Failed to load competitive overview:", err))
      .finally(() => {
        if (!cancelled) setCompLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, liveReloadTick]);

  // Load Competitive Leaderboard for active scope (SCHOOL, CITY, OVERALL)
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    setLeaderboardLoading(true);

    fetchCompetitiveLeaderboard(leaderboardScope, 50)
      .then((data) => {
        if (!cancelled && data) {
          setLeaderboardData(data);
        }
      })
      .catch((err) => console.error("Failed to load leaderboard:", err))
      .finally(() => {
        if (!cancelled) setLeaderboardLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, leaderboardScope, liveReloadTick]);

  // Load Verified Schools Directory & Student Profile School/Opt-in
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;

    fetchVerifiedSchools()
      .then((schools) => {
        if (!cancelled) setVerifiedSchools(schools);
      })
      .catch((err) => console.error("Failed to fetch verified schools:", err));

    import("@/lib/supabase").then(async ({ supabase }) => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("school_id, competitive_opt_in")
          .eq("id", user.id)
          .maybeSingle();

        if (!cancelled && data) {
          if (data.school_id) setSelectedSchoolId(data.school_id);
          if (typeof data.competitive_opt_in === "boolean") {
            setCompetitiveOptIn(data.competitive_opt_in);
          }
        }
      } catch {
        // Silently handle profile query failure
      }
    });

    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  const handleSaveCompetitivePreferences = async () => {
    setSavingPreferences(true);
    try {
      const res = await updateStudentCompetitivePreferences(
        competitiveOptIn,
        selectedSchoolId || null
      );
      if (res.success) {
        setPreferencesToast("Competitive preferences updated successfully!");
        setTimeout(() => setPreferencesToast(null), 4000);
        setIsSchoolModalOpen(false);
        setLiveReloadTick((prev) => prev + 1);
      } else {
        setPreferencesToast(res.error || "Failed to update preferences");
      }
    } catch (err) {
      setPreferencesToast(
        err instanceof Error ? err.message : "Failed to update preferences"
      );
    } finally {
      setSavingPreferences(false);
    }
  };

  const handlePractiseChapterFromCard = (chapterId: string, chapterName: string) => {
    setSelectedChapterId(chapterId);
    setSelectedTopicId("ALL");
    setActiveNav("Practice Questions");
    setStatusBanner(`Filter applied: Practising ${chapterName}`);
    setTimeout(() => {
      const el = document.getElementById("published-practice-questions");
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
      }
    }, 100);
  };

  // 1. Load active curriculum metadata (Chapters & Topics) once authenticated
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const [chapters, topics] = await Promise.all([
          fetchChapters().catch(() => []),
          fetchTopics().catch(() => []),
        ]);
        if (cancelled) return;

        const chapNames: Record<string, string> = {};
        chapters.forEach((c) => (chapNames[c.id] = c.name));
        setLiveChapterNames(chapNames);
        setChaptersList(chapters.filter((c) => c.is_active !== false));

        const topNames: Record<string, string> = {};
        topics.forEach((t) => (topNames[t.id] = t.name));
        setLiveTopicNames(topNames);
      } catch (err) {
        console.error("Failed to load curriculum metadata:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user]);

  // 2. When selected chapter changes, reset topic and load chapter-specific topics
  useEffect(() => {
    if (selectedChapterId === "ALL") {
      setTopicsList([]);
      setSelectedTopicId("ALL");
      return;
    }

    let cancelled = false;
    setTopicsLoading(true);
    setSelectedTopicId("ALL"); // Reset selected topic when chapter changes

    fetchTopics(selectedChapterId)
      .then((topics) => {
        if (!cancelled) {
          const activeTopics = topics.filter((t) => t.is_active !== false);
          setTopicsList(activeTopics);
          setLiveTopicNames((prev) => {
            const next = { ...prev };
            activeTopics.forEach((t) => (next[t.id] = t.name));
            return next;
          });
        }
      })
      .catch((err) => {
        console.error("Failed to load topics for chapter:", err);
        if (!cancelled) setTopicsList([]);
      })
      .finally(() => {
        if (!cancelled) setTopicsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedChapterId]);

  // 3. Fetch questions matching active filters
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    setLiveLoading(true);
    (async () => {
      try {
        const questions = await fetchPublishedQuestionsForStudent({
          chapterId: selectedChapterId,
          topicId: selectedTopicId,
          difficulty: selectedDifficulty,
          questionType: selectedQuestionType,
          limit: 100,
        });
        if (cancelled) return;
        setLiveQuestions(questions);

        // Restore past evaluations and submissions for persistence
        if (questions.length > 0) {
          const past = await fetchStudentResults(questions.map((q) => q.id));
          if (!cancelled && past) {
            setLiveResults((prev) => ({ ...prev, ...past.results }));
            setLiveSelected((prev) => ({ ...prev, ...past.selectedOptions }));
          }
        }

        setLiveError(null);
      } catch (err) {
        if (cancelled) return;
        setLiveError(
          err instanceof Error ? err.message : "Could not load questions."
        );
      } finally {
        if (!cancelled) setLiveLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    user,
    selectedChapterId,
    selectedTopicId,
    selectedDifficulty,
    selectedQuestionType,
    liveReloadTick,
  ]);

  const handleResetFilters = () => {
    setSelectedChapterId("ALL");
    setSelectedTopicId("ALL");
    setSelectedDifficulty("ALL");
    setSelectedQuestionType("ALL");
  };

  const isFiltered =
    selectedChapterId !== "ALL" ||
    selectedTopicId !== "ALL" ||
    selectedDifficulty !== "ALL" ||
    selectedQuestionType !== "ALL";

  const handleSubmitLiveAnswer = async (q: StudentPracticeQuestion) => {
    const pickedAnswer = liveSelected[q.id];
    if (!pickedAnswer || !pickedAnswer.trim() || liveResults[q.id]) return;
    try {
      let result: StudentEvaluationResult;
      if (q.question_type === "TRUE_FALSE") {
        result = await submitStudentAnswer({
          questionId: q.id,
          rawPayload: JSON.stringify({
            type: "TRUE_FALSE",
            value: pickedAnswer.trim(),
          }),
          imagePaths: [],
        });
      } else if (q.question_type === "FILL_BLANK") {
        result = await submitStudentAnswer({
          questionId: q.id,
          rawPayload: JSON.stringify({
            type: "FILL_BLANK",
            value: pickedAnswer.trim(),
          }),
          imagePaths: [],
        });
      } else {
        result = await submitStudentAnswer({
          questionId: q.id,
          selectedOptionId: pickedAnswer,
        });
      }
      setLiveResults((prev) => ({
        ...prev,
        [q.id]: result,
      }));
      setQuestionsAttemptedCount((n) => n + 1);
    } catch (err) {
      console.error("Evaluation submission failed:", err);
    }
  };

  const handleSubmitSubjectiveAnswer = async (
    q: StudentPracticeQuestion,
    params: { typedText: string; imagePaths: string[] }
  ) => {
    if (liveResults[q.id]) return;
    try {
      const result = await submitStudentAnswer({
        questionId: q.id,
        rawPayload: JSON.stringify({
          type: "SUBJECTIVE",
          text: params.typedText || null,
        }),
        imagePaths: params.imagePaths,
      });

      setLiveResults((prev) => ({
        ...prev,
        [q.id]: result,
      }));
      setQuestionsAttemptedCount((n) => n + 1);
    } catch (err) {
      console.error("Subjective submission failed:", err);
      throw err;
    }
  };

  const handleTryAgain = (questionId: string) => {
    setLiveSelected((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
    setLiveResults((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  };

  // Client-side guard complementing the server-side src/proxy.ts route protection
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await signOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setIsLoggingOut(false);
    }
  };

  const openPracticeSession = (chapterName: string) => {
    setActivePracticeChapter(chapterName);
    setSelectedOption(null);
    setAnswerSubmitted(false);
    setStatusBanner(`Started interactive practice session for ${chapterName}`);
  };

  const handleStartPractisingMain = () => {
    openPracticeSession("Triangles");
  };

  const handleCheckAnswer = () => {
    if (answerFormatMode === "mcq" && selectedOption === null) return;
    if (answerFormatMode === "subjective" && !subjectiveWorkText.trim()) return;
    if (answerFormatMode === "handwritten" && !uploadedFileName) return;

    if (!answerSubmitted) {
      setAnswerSubmitted(true);
      setQuestionsAttemptedCount((prev) => prev + 1);
    }
  };

  const currentQuestion: SampleQuestion | null = activePracticeChapter
    ? SAMPLE_QUESTIONS_BY_CHAPTER[activePracticeChapter] ||
      SAMPLE_QUESTIONS_BY_CHAPTER["Real Numbers"]
    : null;

  const displayName =
    profile?.full_name ||
    (user?.user_metadata?.full_name as string | undefined) ||
    "Student";
  const displayEmail = profile?.email || user?.email || "Class 10 Student";
  const displayRole = profile?.role || "";
  const avatarInitials = getInitials(displayName);

  // Loading state while verifying persisted Supabase session and public.profiles record
  if (authLoading || profileLoading || !user) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1120] text-[#0F172A] dark:text-[#F1F5F9] flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-md animate-pulse">
            <span className="font-mono font-bold text-lg">∑</span>
          </div>
          <p className="text-sm font-semibold text-slate-600 dark:text-[#A7B3C7]">
            Verifying your student session...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1120] text-[#0F172A] dark:text-[#F1F5F9] flex font-sans selection:bg-indigo-600 selection:text-white transition-colors duration-200">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-xs lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* 1. SIDEBAR */}
      <aside
        aria-label="Sidebar Navigation"
        className={`fixed inset-y-0 left-0 z-50 w-72 bg-white dark:bg-[#151F32] border-r border-slate-200/80 dark:border-slate-800 flex flex-col justify-between transition-all duration-200 ease-in-out lg:static lg:translate-x-0 ${
          mobileMenuOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        }`}
      >
        <div>
          {/* Platform Brand Header */}
          <div className="h-20 px-6 flex items-center justify-between border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-sm shadow-indigo-500/30">
                <span className="font-mono font-bold text-lg tracking-tighter">
                  ∑
                </span>
              </div>
              <div>
                <span className="text-lg font-bold tracking-tight text-slate-950 dark:text-[#F1F5F9] block leading-none">
                  MathPractice
                </span>
                <span className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 tracking-wide uppercase mt-1 block">
                  CBSE Class 10 • NCERT
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Close sidebar"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Navigation Items */}
          <div className="p-4">
            <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
              Learning Menu
            </p>
            <nav className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const isActive = activeNav === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setActiveNav(item.key);
                      setMobileMenuOpen(false);
                      setStatusBanner(`Switched view to ${item.label}`);
                      if (item.key === "Practice Questions") {
                        document
                          .getElementById("published-practice-questions")
                          ?.scrollIntoView({ behavior: "smooth" });
                      }
                    }}
                    className={`group w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 cursor-pointer ${
                      isActive
                        ? "bg-indigo-50/90 dark:bg-[#1E293B] text-indigo-700 dark:text-indigo-300 font-semibold shadow-2xs ring-1 ring-indigo-600/10 dark:ring-indigo-400/20"
                        : "text-slate-600 dark:text-[#A7B3C7] hover:bg-slate-50 dark:hover:bg-[#1E293B]/60 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <NavIcon item={item.key} active={isActive} />
                      <span>{item.label}</span>
                    </span>
                    {item.badge && (
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                          isActive
                            ? "bg-indigo-600 text-white"
                            : "bg-violet-50 dark:bg-violet-950/80 text-violet-700 dark:text-violet-300 border border-violet-200/60 dark:border-violet-800/70"
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Quick Links & Sign Out */}
            <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/80 space-y-1">
              <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
                Account & Portals
              </p>
              <Link
                href="/admin/questions"
                className="flex items-center justify-between px-3.5 py-2 rounded-xl text-xs font-medium text-slate-600 dark:text-[#A7B3C7] hover:bg-slate-50 dark:hover:bg-[#1E293B]/60 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
              >
                <span>Admin Question Bank</span>
                <span>→</span>
              </Link>
              <button
                type="button"
                disabled={isLoggingOut}
                onClick={handleLogout}
                className="w-full flex items-center justify-between px-3.5 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
              >
                <span>{isLoggingOut ? "Signing out..." : "Sign Out"}</span>
                <span>↪</span>
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar Bottom Daily Goal Card */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800">
          <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-indigo-950 to-violet-950 dark:from-[#1E293B] dark:via-indigo-950/90 dark:to-violet-950/90 border border-transparent dark:border-slate-700/80 p-4 text-white shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
                Daily Target
              </span>
              <span className="text-xs font-semibold bg-white/10 px-2 py-0.5 rounded-full text-indigo-200">
                18 / 25 Qs
              </span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed mb-3">
              Solve 7 more questions today to maintain your{" "}
              <strong className="text-white">7-day streak</strong>!
            </p>
            <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mb-3.5">
              <div className="h-full bg-gradient-to-r from-indigo-400 to-violet-400 rounded-full w-[72%]" />
            </div>
            <button
              type="button"
              onClick={handleStartPractisingMain}
              className="w-full py-2 px-3 rounded-xl bg-white text-slate-950 hover:bg-indigo-50 font-semibold text-xs transition-colors shadow-xs cursor-pointer"
            >
              Resume Daily Drill →
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 2. TOP NAVIGATION */}
        <header className="sticky top-0 z-30 bg-white/85 dark:bg-[#0B1120]/85 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800 px-4 sm:px-8 py-4 transition-colors">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1E293B]"
                aria-label="Open navigation menu"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                  />
                </svg>
              </button>
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-950 dark:text-[#F1F5F9]">
                    Good morning, {displayName}!
                  </h1>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/70">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400" />
                    Class 10 Mathematics
                  </span>
                </div>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-[#A7B3C7] mt-0.5 hidden sm:block">
                  Board Exam Readiness Track • Term II & Full Syllabus Practice
                </p>
              </div>
            </div>

            {/* Search Input (inspired by reference layout) */}
            <div className="hidden lg:flex items-center flex-1 max-w-sm mx-4">
              <div className="relative w-full">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                  </svg>
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search questions, topics, or chapters..."
                  className="w-full pl-10 pr-4 py-2 rounded-xl text-xs sm:text-sm bg-slate-50 dark:bg-[#151F32] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-[#F1F5F9] placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500 transition-all"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Right Top Bar Actions: Theme Switcher + Start Practising CTA + Avatar + Logout */}
            <div className="flex items-center gap-2.5 sm:gap-3.5">
              <ThemeSwitcher />

              <button
                type="button"
                onClick={handleStartPractisingMain}
                className="hidden sm:inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold text-sm shadow-sm shadow-indigo-500/20 transition-all cursor-pointer"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z"
                  />
                </svg>
                <span>Start Practising</span>
              </button>

              {/* Student Profile Avatar */}
              <button
                type="button"
                onClick={() => {
                  setActiveNav("Profile");
                  setStatusBanner("Viewing Student Profile & Appearance Settings");
                }}
                title="Student Profile & Settings"
                className="flex items-center gap-2.5 pl-1.5 pr-2.5 py-1.5 rounded-full border border-slate-200/90 dark:border-slate-700 bg-white dark:bg-[#151F32] hover:bg-slate-50 dark:hover:bg-[#1E293B] transition-colors cursor-pointer"
              >
                <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-500 text-white font-bold text-sm flex items-center justify-center shadow-2xs ring-2 ring-indigo-100 dark:ring-indigo-900">
                  {avatarInitials}
                </div>
                <div className="text-left hidden xl:block">
                  <p className="text-xs font-semibold text-slate-900 dark:text-[#F1F5F9] leading-none">
                    {displayName}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-[#A7B3C7] mt-0.5 leading-none">
                    {displayEmail}
                  </p>
                </div>
              </button>

              <button
                type="button"
                disabled={isLoggingOut}
                onClick={handleLogout}
                title="Sign Out"
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] hover:bg-rose-50 dark:hover:bg-rose-950/50 hover:border-rose-200 dark:hover:border-rose-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-rose-700 dark:hover:text-rose-300 transition-colors cursor-pointer"
              >
                {isLoggingOut ? "..." : "Sign Out"}
              </button>
            </div>
          </div>
        </header>

        {/* MAIN BODY */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-6 sm:py-8 space-y-8">
          {/* Interactive Status Toast / Banner when user clicks nav or practice */}
          {statusBanner && (
            <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-indigo-50/90 dark:bg-[#1E293B] border border-indigo-200/80 dark:border-indigo-500/40 text-indigo-950 dark:text-[#F1F5F9] text-sm shadow-2xs">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400 animate-pulse" />
                <span className="font-medium">{statusBanner}</span>
                {activeNav !== "Dashboard" && (
                  <span className="text-xs text-indigo-700 dark:text-indigo-300 bg-white dark:bg-[#151F32] px-2 py-0.5 rounded-md border border-indigo-200 dark:border-indigo-700">
                    Active Section: {activeNav}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setStatusBanner(null)}
                className="text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:text-indigo-900 dark:hover:text-white cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* PROFILE & APPEARANCE SETTINGS PANEL (Shown when Profile is selected in Sidebar or Header Avatar) */}
          {activeNav === "Profile" && (
            <section
              aria-label="Student Profile and Appearance Settings"
              className="rounded-2xl bg-white dark:bg-[#151F32] border border-slate-200/80 dark:border-slate-800 p-6 sm:p-8 shadow-sm space-y-6 transition-colors"
            >
              <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white font-bold text-xl flex items-center justify-center shadow-sm">
                    {avatarInitials}
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-xl font-bold text-slate-950 dark:text-[#F1F5F9]">
                        {displayName}
                      </h2>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60">
                        {displayRole}
                      </span>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-500 dark:text-[#A7B3C7] mt-0.5">
                      {displayEmail} • CBSE Class 10 Mathematics
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setActiveNav("Dashboard")}
                    className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                  >
                    Back to Overview
                  </button>
                  <button
                    type="button"
                    disabled={isLoggingOut}
                    onClick={handleLogout}
                    className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-semibold text-white transition-colors cursor-pointer"
                  >
                    {isLoggingOut ? "Signing out..." : "Sign Out"}
                  </button>
                </div>
              </div>

              {/* Appearance & Theme Switcher Section */}
              <div className="space-y-3">
                <div>
                  <h3 className="text-base font-bold text-slate-950 dark:text-[#F1F5F9]">
                    Appearance & Study Theme
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-[#A7B3C7]">
                    Choose how MathPractice looks across all chapters, mathematical editors, and tests. Your preference is saved automatically.
                  </p>
                </div>
                <ThemeSwitcher variant="expanded" />
              </div>
            </section>
          )}

          {/* SCHOOL SELECTION & COMPETITIVE PREFERENCES MODAL */}
          {isSchoolModalOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
              <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-[#151F32] border border-slate-200 dark:border-slate-800 p-6 sm:p-7 shadow-2xl space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="text-lg font-bold text-slate-950 dark:text-[#F1F5F9]">
                      Competitive Preferences & School Affiliation
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-[#A7B3C7] mt-0.5">
                      Configure your verified institution and leaderboard participation.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsSchoolModalOpen(false)}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1.5 rounded-lg cursor-pointer"
                  >
                    ✕
                  </button>
                </div>

                {preferencesToast && (
                  <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 text-xs font-semibold">
                    {preferencesToast}
                  </div>
                )}

                {/* Opt-in Toggle */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1E293B] border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-[#F1F5F9]">
                      Competitive Leaderboard Opt-In
                    </p>
                    <p className="text-xs text-slate-500 dark:text-[#A7B3C7]">
                      Participate in CBSE Class 10 school, city, and global rankings.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={competitiveOptIn}
                    onChange={(e) => setCompetitiveOptIn(e.target.checked)}
                    className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                </div>

                {/* School Dropdown */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#A7B3C7] block">
                    Select Verified CBSE School
                  </label>
                  <select
                    value={selectedSchoolId}
                    onChange={(e) => setSelectedSchoolId(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl text-sm bg-white dark:bg-[#151F32] border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                  >
                    <option value="">-- No School Affiliation (Independent Competitor) --</option>
                    {verifiedSchools.map((sch) => (
                      <option key={sch.id} value={sch.id}>
                        {sch.name} ({sch.city}, {sch.state})
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">
                    * Note: Only administrator-verified institutions appear on school leaderboards.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsSchoolModalOpen(false)}
                    className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1E293B] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={savingPreferences}
                    onClick={handleSaveCompetitivePreferences}
                    className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm transition-all cursor-pointer"
                  >
                    {savingPreferences ? "Saving..." : "Save Preferences"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SECTION A: STUDENT IDENTITY & OVERVIEW BANNER */}
          <section
            aria-label="Student Identity and Activity Overview"
            className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 dark:from-[#0F172A] dark:via-[#1E1B4B] dark:to-[#0F172A] border border-slate-800/80 text-white p-6 sm:p-7 shadow-lg"
          >
            <div className="relative z-10 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-6">
              {/* Left Identity Info */}
              <div className="flex items-start sm:items-center gap-4 sm:gap-5">
                <div className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 text-white font-bold text-2xl flex items-center justify-center shrink-0 shadow-md ring-4 ring-white/10">
                  {avatarInitials}
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                      {displayName}
                    </h2>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                      Class 10 CBSE
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsSchoolModalOpen(true)}
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer ${
                        competitiveOptIn
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30"
                          : "bg-slate-700/60 text-slate-300 border-slate-600 hover:bg-slate-700"
                      }`}
                    >
                      {competitiveOptIn ? "● Compete Active" : "○ Unranked (Opt In)"}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-slate-300">
                    <span>
                      {leaderboardData?.school_name
                        ? `🏫 ${leaderboardData.school_name}`
                        : verifiedSchools.find((s) => s.id === selectedSchoolId)?.name
                        ? `🏫 ${verifiedSchools.find((s) => s.id === selectedSchoolId)?.name}`
                        : "🏫 School not configured"}
                    </span>
                    <span>•</span>
                    <span>
                      {leaderboardData?.city
                        ? `📍 ${leaderboardData.city}`
                        : verifiedSchools.find((s) => s.id === selectedSchoolId)?.city
                        ? `📍 ${verifiedSchools.find((s) => s.id === selectedSchoolId)?.city}`
                        : "📍 City not configured"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsSchoolModalOpen(true)}
                      className="text-xs text-indigo-300 hover:text-white underline underline-offset-2 ml-1 cursor-pointer"
                    >
                      {selectedSchoolId ? "Change" : "Configure School"}
                    </button>
                  </div>
                  <p className="text-xs text-indigo-200/90 flex items-center gap-1.5 pt-0.5">
                    <span>Keep going! Small steps every day lead to big results.</span>
                    <span>🚀</span>
                  </p>
                </div>
              </div>

              {/* Middle / Right: Activity Streak & Ranks */}
              <div className="flex flex-wrap items-center gap-4 sm:gap-6 pt-3 xl:pt-0 border-t xl:border-t-0 border-white/10">
                {/* 7-Day Activity Streak Widget */}
                <div className="bg-white/5 border border-white/10 rounded-xl p-3.5 sm:px-4.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🔥</span>
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                      {competitiveOverview?.currentStreak || 0} Day Streak
                    </span>
                  </div>
                  {/* S M T W T F S Dot Grid */}
                  <div className="flex items-center gap-1.5">
                    {(competitiveOverview?.sevenDayStreak?.length
                      ? competitiveOverview.sevenDayStreak
                      : [
                          { dayLabel: "S", isActive: false },
                          { dayLabel: "M", isActive: false },
                          { dayLabel: "T", isActive: false },
                          { dayLabel: "W", isActive: false },
                          { dayLabel: "T", isActive: false },
                          { dayLabel: "F", isActive: false },
                          { dayLabel: "S", isActive: false },
                        ]
                    ).map((dot, idx) => (
                      <div key={idx} className="flex flex-col items-center gap-1">
                        <span className="text-[10px] font-semibold text-slate-400">
                          {dot.dayLabel}
                        </span>
                        <div
                          className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                            dot.isActive
                              ? "bg-emerald-500 text-white shadow-xs shadow-emerald-500/50"
                              : "bg-white/10 text-slate-400 border border-white/10"
                          }`}
                        >
                          {dot.isActive ? "✓" : "•"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Rank Badges */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs">
                    <span className="text-cyan-400">🌐</span>
                    <span className="text-slate-300">Overall Rank:</span>
                    <strong className="text-white font-bold">
                      {leaderboardData?.my_rank ? `#${leaderboardData.my_rank}` : "Unranked"}
                    </strong>
                    {leaderboardData?.total_competitors ? (
                      <span className="text-[11px] text-slate-400">
                        ({leaderboardData.total_competitors} peers)
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs">
                    <span className="text-purple-400">🏆</span>
                    <span className="text-slate-300">League Tier:</span>
                    <strong className="text-white font-bold">
                      {competitiveOverview?.leagueTier || "Pythagoras Novice"}
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Subtle formula background */}
            <div
              aria-hidden="true"
              className="pointer-events-none select-none absolute -right-6 -bottom-8 text-7xl sm:text-8xl font-mono font-bold text-white/[0.04] tracking-tighter"
            >
              HCF(a, b) × LCM = a × b
            </div>
          </section>

          {/* SECTION B: COMPACT PERFORMANCE METRIC CARDS */}
          <section aria-label="Student Performance Metrics">
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5 sm:gap-4">
              {/* Metric 1: Questions Solved */}
              <div className="bg-white dark:bg-[#151F32] rounded-2xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-800 shadow-2xs hover:shadow-sm transition-all flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Solved
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-sm">
                    ✓
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold tracking-tight text-slate-950 dark:text-[#F1F5F9]">
                    {competitiveOverview?.questionsSolved ?? 0}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-[#A7B3C7] mt-0.5 truncate">
                    of {competitiveOverview?.questionsAttempted ?? 0} attempted
                  </p>
                </div>
              </div>

              {/* Metric 2: Evaluated Accuracy */}
              <div className="bg-white dark:bg-[#151F32] rounded-2xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-800 shadow-2xs hover:shadow-sm transition-all flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Accuracy
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-950/70 text-violet-600 dark:text-violet-400 flex items-center justify-center font-bold text-xs">
                    🎯
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold tracking-tight text-slate-950 dark:text-[#F1F5F9]">
                    {competitiveOverview?.accuracyPct ?? 0}%
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-[#A7B3C7] mt-0.5 truncate">
                    {competitiveOverview?.questionsFinalized ?? 0} evaluated questions
                    {(competitiveOverview?.questionsAttempted ?? 0) >
                    (competitiveOverview?.questionsFinalized ?? 0)
                      ? ` (${
                          (competitiveOverview?.questionsAttempted ?? 0) -
                          (competitiveOverview?.questionsFinalized ?? 0)
                        } pending)`
                      : ""}
                  </p>
                </div>
              </div>

              {/* Metric 3: Chapters In Progress */}
              <div className="bg-white dark:bg-[#151F32] rounded-2xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-800 shadow-2xs hover:shadow-sm transition-all flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Chapters
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-xs">
                    📊
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold tracking-tight text-slate-950 dark:text-[#F1F5F9]">
                    {Object.keys(competitiveOverview?.solvedByChapter || {}).length} / {chaptersList.length || 14}
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full mt-1.5 overflow-hidden">
                    <div
                      className="h-full bg-indigo-600 rounded-full"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            (Object.keys(competitiveOverview?.solvedByChapter || {}).length /
                              Math.max(1, chaptersList.length || 14)) *
                              100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Metric 4: Total Marks */}
              <div className="bg-white dark:bg-[#151F32] rounded-2xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-800 shadow-2xs hover:shadow-sm transition-all flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Marks
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/70 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold text-xs">
                    ★
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold tracking-tight text-slate-950 dark:text-[#F1F5F9]">
                    {competitiveOverview?.totalMarksScored?.toLocaleString() ?? 0}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-[#A7B3C7] mt-0.5 truncate">
                    Finalized evaluation marks
                  </p>
                </div>
              </div>

              {/* Metric 5: Competitive XP */}
              <div className="bg-white dark:bg-[#151F32] rounded-2xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-800 shadow-2xs hover:shadow-sm transition-all flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Math XP
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-950/70 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold text-xs">
                    ⚡
                  </div>
                </div>
                <div>
                  {competitiveOverview?.pointsError ? (
                    <div className="text-sm font-semibold text-rose-500 dark:text-rose-400">
                      Error Loading XP
                    </div>
                  ) : (
                    <div className="text-2xl font-bold tracking-tight text-slate-950 dark:text-[#F1F5F9]">
                      {competitiveOverview?.totalPoints ?? 0}
                    </div>
                  )}
                  <p className="text-[11px] text-slate-500 dark:text-[#A7B3C7] mt-0.5 truncate">
                    {competitiveOverview?.pointsError
                      ? "Points ledger query failed"
                      : `Tier: ${competitiveOverview?.leagueTier?.split(" ")[0] || "Novice"}`}
                  </p>
                </div>
              </div>

              {/* Metric 6: Competitive Rank */}
              <div className="bg-white dark:bg-[#151F32] rounded-2xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-800 shadow-2xs hover:shadow-sm transition-all flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Overall Rank
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-950/70 text-sky-600 dark:text-sky-400 flex items-center justify-center font-bold text-xs">
                    🏆
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold tracking-tight text-slate-950 dark:text-[#F1F5F9]">
                    {leaderboardData?.my_rank ? `#${leaderboardData.my_rank}` : "Unranked"}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-[#A7B3C7] mt-0.5 truncate">
                    {leaderboardData?.total_competitors ? `${leaderboardData.total_competitors} competitors` : "Active Leaderboard"}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* TWO-COLUMN DASHBOARD GRID (Inspired by Reference Layout) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT / WIDE COLUMN (8 cols): Trend, Recent Activity, Chapter Progress */}
            <div className="lg:col-span-8 space-y-6">
              {/* SECTION C: PERFORMANCE TREND WITH ACCURACY DONUT */}
              <section
                aria-label="Student Performance Trend"
                className="bg-white dark:bg-[#151F32] rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-2xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-4 mb-5 pb-4 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="text-base sm:text-lg font-bold text-slate-950 dark:text-[#F1F5F9]">
                      Performance Trend
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-[#A7B3C7] mt-0.5">
                      Your daily learning trajectory over the last 7 calendar days
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {/* Metric Toggle Tabs */}
                    <div className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-[#1E293B] border border-slate-200/60 dark:border-slate-700/60 text-xs font-semibold">
                      <button
                        type="button"
                        onClick={() => setTrendMetric("accuracy")}
                        className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                          trendMetric === "accuracy"
                            ? "bg-indigo-600 text-white shadow-xs"
                            : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                        }`}
                      >
                        Accuracy
                      </button>
                      <button
                        type="button"
                        onClick={() => setTrendMetric("attempts")}
                        className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                          trendMetric === "attempts"
                            ? "bg-indigo-600 text-white shadow-xs"
                            : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                        }`}
                      >
                        Attempts
                      </button>
                      <button
                        type="button"
                        onClick={() => setTrendMetric("marks")}
                        className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                          trendMetric === "marks"
                            ? "bg-indigo-600 text-white shadow-xs"
                            : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                        }`}
                      >
                        Marks
                      </button>
                    </div>

                    <span className="px-3 py-1 rounded-xl bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-500 dark:text-[#A7B3C7]">
                      Last 7 Days
                    </span>
                  </div>
                </div>

                {/* Chart or Meaningful Empty State */}
                {competitiveOverview?.dailyTrend &&
                competitiveOverview.dailyTrend.some((d) => d.hasActivity) ? (
                  <div className="flex flex-col md:flex-row items-center gap-6">
                    {/* Responsive SVG Chart */}
                    <div className="flex-1 w-full min-w-0">
                      {(() => {
                        const trend = getTrendSvgPath(
                          competitiveOverview.dailyTrend,
                          trendMetric
                        );
                        return (
                          <div className="w-full h-48 sm:h-52 relative">
                            <svg
                              viewBox={`0 0 ${trend.width} ${trend.height}`}
                              className="w-full h-full overflow-visible"
                            >
                              <defs>
                                <linearGradient
                                  id="trendAreaGradient"
                                  x1="0"
                                  y1="0"
                                  x2="0"
                                  y2="1"
                                >
                                  <stop
                                    offset="0%"
                                    stopColor="#6366F1"
                                    stopOpacity="0.45"
                                  />
                                  <stop
                                    offset="100%"
                                    stopColor="#8B5CF6"
                                    stopOpacity="0.0"
                                  />
                                </linearGradient>
                              </defs>

                              {/* Horizontal Grid lines */}
                              <line
                                x1={trend.padLeft}
                                y1={trend.padTop}
                                x2={trend.width - trend.padRight}
                                y2={trend.padTop}
                                stroke="currentColor"
                                strokeDasharray="3 3"
                                className="text-slate-200 dark:text-slate-800"
                              />
                              <line
                                x1={trend.padLeft}
                                y1={(trend.padTop + trend.height - trend.padBottom) / 2}
                                x2={trend.width - trend.padRight}
                                y2={(trend.padTop + trend.height - trend.padBottom) / 2}
                                stroke="currentColor"
                                strokeDasharray="3 3"
                                className="text-slate-200 dark:text-slate-800"
                              />
                              <line
                                x1={trend.padLeft}
                                y1={trend.height - trend.padBottom}
                                x2={trend.width - trend.padRight}
                                y2={trend.height - trend.padBottom}
                                stroke="currentColor"
                                className="text-slate-300 dark:text-slate-700"
                              />

                              {/* Gradient Area Fill */}
                              {trend.areaD && (
                                <path
                                  d={trend.areaD}
                                  fill="url(#trendAreaGradient)"
                                />
                              )}

                              {/* Main Line Curve */}
                              {trend.pathD && (
                                <path
                                  d={trend.pathD}
                                  fill="none"
                                  stroke="#6366F1"
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                />
                              )}

                              {/* Interactive Data Points */}
                              {trend.points.map((pt, i) => (
                                <g key={i}>
                                  <circle
                                    cx={pt.x}
                                    cy={pt.y}
                                    r={pt.val > 0 ? "5" : "3.5"}
                                    className={`${
                                      pt.val > 0
                                        ? "fill-white stroke-indigo-600 dark:stroke-indigo-400 stroke-[2.5]"
                                        : "fill-slate-300 dark:fill-slate-700 stroke-transparent"
                                    }`}
                                  />
                                  {/* X-axis date labels */}
                                  <text
                                    x={pt.x}
                                    y={trend.height - 10}
                                    textAnchor="middle"
                                    className="text-[10px] font-semibold fill-slate-400 dark:fill-slate-500"
                                  >
                                    {pt.data.shortDate}
                                  </text>
                                </g>
                              ))}
                            </svg>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Donut Accuracy Card (Right Side of Trend Card, matching screenshot) */}
                    <div className="shrink-0 flex flex-col items-center justify-center p-4 rounded-xl bg-slate-50 dark:bg-[#1E293B] border border-slate-200/80 dark:border-slate-700/80 w-full sm:w-44">
                      <div className="relative w-24 h-24 flex items-center justify-center">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 96 96">
                          <circle
                            cx="48"
                            cy="48"
                            r="38"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="8"
                            className="text-slate-200 dark:text-slate-700"
                          />
                          <circle
                            cx="48"
                            cy="48"
                            r="38"
                            fill="none"
                            stroke="#6366F1"
                            strokeWidth="8"
                            strokeLinecap="round"
                            strokeDasharray="238.7"
                            strokeDashoffset={
                              238.7 -
                              (238.7 *
                                Math.min(
                                  100,
                                  competitiveOverview?.accuracyPct || 0
                                )) /
                                100
                            }
                            className="transition-all duration-700"
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-xl font-bold text-slate-950 dark:text-[#F1F5F9]">
                            {competitiveOverview?.accuracyPct || 0}%
                          </span>
                          <span className="text-[9px] font-semibold uppercase text-slate-400 dark:text-slate-500">
                            Accuracy
                          </span>
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-2">
                        {competitiveOverview?.questionsSolved || 0} Solved
                      </span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        Evaluated questions
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="py-10 px-4 text-center rounded-xl bg-slate-50/70 dark:bg-[#1E293B]/60 border border-dashed border-slate-200 dark:border-slate-700 space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto text-xl font-bold">
                      📈
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-[#F1F5F9]">
                        No Practice Sessions in the Last 7 Days
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-[#A7B3C7] max-w-md mx-auto mt-1">
                        Solve questions in the Practice section to generate your daily accuracy and performance trends. Real records populate this graph automatically.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveNav("Practice Questions");
                        document
                          .getElementById("published-practice-questions")
                          ?.scrollIntoView({ behavior: "smooth" });
                      }}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer"
                    >
                      Start Practising Questions →
                    </button>
                  </div>
                )}
              </section>

              {/* SECTION E: RECENT ACTIVITY / TRACK RECORD */}
              <section
                aria-label="Recent Activity and Track Record"
                className="bg-white dark:bg-[#151F32] rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-2xs space-y-4"
              >
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="text-base sm:text-lg font-bold text-slate-950 dark:text-[#F1F5F9]">
                      Recent Activity / Track Record
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-[#A7B3C7] mt-0.5">
                      Your authentic practice attempts, submissions, and evaluation marks
                    </p>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-[#1E293B] text-slate-600 dark:text-slate-300">
                    {competitiveOverview?.recentSolves?.length || 0} Recent
                  </span>
                </div>

                {competitiveOverview?.recentSolves &&
                competitiveOverview.recentSolves.length > 0 ? (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {competitiveOverview.recentSolves.map((solve, idx) => {
                      const isFinalized = solve.evaluationStatus === "FINALIZED";
                      const isPending = solve.evaluationStatus === "PENDING";
                      const isUnsubmitted =
                        solve.evaluationStatus === "NOT_SUBMITTED" ||
                        solve.evaluationStatus === "IN_PROGRESS";

                      const isFullMarks =
                        isFinalized &&
                        (solve.isCorrect === true ||
                          (typeof solve.marksAwarded === "number" &&
                            solve.marksAwarded >= solve.maxMarks &&
                            solve.maxMarks > 0));
                      const isZeroMarks =
                        isFinalized &&
                        typeof solve.marksAwarded === "number" &&
                        solve.marksAwarded === 0;
                      const isPartialMarks =
                        isFinalized &&
                        !isFullMarks &&
                        !isZeroMarks &&
                        typeof solve.marksAwarded === "number" &&
                        solve.marksAwarded > 0;

                      return (
                        <div
                          key={solve.attemptId || idx}
                          className="py-3.5 first:pt-0 last:pb-0 flex items-center justify-between gap-4"
                        >
                          <div className="flex items-center gap-3.5 min-w-0">
                            {/* Status Icon */}
                            <div
                              className={`w-9 h-9 rounded-xl shrink-0 flex items-center justify-center font-bold text-xs ${
                                isPending
                                  ? "bg-amber-50 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/70"
                                  : isUnsubmitted
                                  ? "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200/60 dark:border-slate-700/70"
                                  : isFullMarks
                                  ? "bg-emerald-50 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/70"
                                  : isPartialMarks
                                  ? "bg-amber-50 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/70"
                                  : "bg-rose-50 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400 border border-rose-200/60 dark:border-rose-800/70"
                              }`}
                            >
                              {isPending
                                ? "⏳"
                                : isUnsubmitted
                                ? "⏱"
                                : isFullMarks
                                ? "✓"
                                : isPartialMarks
                                ? "½"
                                : "✕"}
                            </div>
                            <div className="min-w-0">
                              <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-[#F1F5F9] truncate">
                                {solve.questionCode}: {solve.chapterName} · Attempt #{solve.attemptNumber}
                              </h4>
                              <p className="text-[11px] text-slate-500 dark:text-[#A7B3C7] flex items-center gap-2 mt-0.5">
                                <span>{solve.questionType}</span>
                                <span>•</span>
                                <span className="uppercase text-[10px] font-semibold px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                  {solve.difficulty}
                                </span>
                                <span>•</span>
                                <span>{formatRelativeTime(solve.submittedAt)}</span>
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            {isPending ? (
                              <div className="flex flex-col items-end">
                                <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/50">
                                  Awaiting Teacher Evaluation
                                </span>
                                <span className="text-[10px] font-medium text-slate-500 dark:text-[#A7B3C7] mt-0.5">
                                  {solve.maxMarks} {solve.maxMarks === 1 ? "Mark" : "Marks"} Max
                                </span>
                              </div>
                            ) : isUnsubmitted ? (
                              <div className="flex flex-col items-end">
                                <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                  {solve.evaluationStatus === "IN_PROGRESS"
                                    ? "In Progress"
                                    : "Not Submitted"}
                                </span>
                                <span className="text-[10px] font-medium text-slate-500 dark:text-[#A7B3C7] mt-0.5">
                                  {solve.maxMarks} {solve.maxMarks === 1 ? "Mark" : "Marks"} Max
                                </span>
                              </div>
                            ) : isFullMarks ? (
                              <div className="flex flex-col items-end">
                                <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                                  +{solve.marksAwarded} Marks
                                </span>
                                <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 mt-0.5">
                                  ✓ Correct
                                </span>
                              </div>
                            ) : isPartialMarks ? (
                              <div className="flex flex-col items-end">
                                <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
                                  {solve.marksAwarded} / {solve.maxMarks} Marks
                                </span>
                                <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400 mt-0.5">
                                  Partial Credit
                                </span>
                              </div>
                            ) : (
                              <div className="flex flex-col items-end">
                                <span className="text-xs font-bold px-2 py-0.5 rounded-lg bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">
                                  0 / {solve.maxMarks} Marks
                                </span>
                                <span className="text-[10px] font-medium text-rose-600 dark:text-rose-400 mt-0.5">
                                  ✕ Incorrect
                                </span>
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                handlePractiseChapterFromCard(
                                  solve.questionId,
                                  solve.chapterName
                                );
                              }}
                              className="px-2.5 py-1 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/50 cursor-pointer"
                            >
                              Review
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-8 text-center rounded-xl bg-slate-50/60 dark:bg-[#1E293B]/40 border border-dashed border-slate-200 dark:border-slate-800">
                    <p className="text-xs text-slate-500 dark:text-[#A7B3C7]">
                      No practice records found yet. Begin solving questions in the practice workbench below.
                    </p>
                  </div>
                )}
              </section>

              {/* SECTION F: CHAPTER PROGRESS & ACCURACY */}
              <section
                aria-label="Chapter Progress and Accuracy"
                className="bg-white dark:bg-[#151F32] rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-2xs space-y-4"
              >
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="text-base sm:text-lg font-bold text-slate-950 dark:text-[#F1F5F9]">
                      Chapter Accuracy & Coverage
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-[#A7B3C7] mt-0.5">
                      Accuracy and question counts calculated exclusively from evaluated questions per chapter
                    </p>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300">
                    {chaptersList.length || 14} Chapters
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(chaptersList.length > 0
                    ? chaptersList
                    : [
                        { id: "c1", chapter_number: 1, name: "Real Numbers" },
                        { id: "c2", chapter_number: 2, name: "Polynomials" },
                        { id: "c3", chapter_number: 3, name: "Pair of Linear Equations" },
                        { id: "c4", chapter_number: 4, name: "Quadratic Equations" },
                      ]
                  )
                    .filter((ch) =>
                      searchQuery
                        ? ch.name.toLowerCase().includes(searchQuery.toLowerCase())
                        : true
                    )
                    .slice(0, 6)
                    .map((ch) => {
                      const stat =
                        competitiveOverview?.solvedByChapter?.[ch.name] || {
                          solved: 0,
                          totalAttempted: 0,
                          totalFinalized: 0,
                          accuracyPct: 0,
                          points: 0,
                        };
                      const pendingCount = Math.max(0, stat.totalAttempted - stat.totalFinalized);

                      return (
                        <div
                          key={ch.id}
                          className="p-4 rounded-xl bg-slate-50/80 dark:bg-[#1E293B]/70 border border-slate-200/80 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-600/50 transition-all flex flex-col justify-between gap-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                                Chapter {ch.chapter_number}
                              </span>
                              <h4 className="text-sm font-bold text-slate-900 dark:text-[#F1F5F9] truncate">
                                {ch.name}
                              </h4>
                              <p className="text-[11px] text-slate-500 dark:text-[#A7B3C7] mt-0.5">
                                {stat.totalAttempted} attempted • {stat.solved} solved
                                {pendingCount > 0 ? ` (${pendingCount} pending)` : ""}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                                {stat.totalFinalized > 0 ? `${stat.accuracyPct}%` : "—"}
                              </span>
                              <span className="text-[9px] uppercase font-semibold text-slate-400 dark:text-slate-500">
                                Accuracy
                              </span>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"
                                style={{ width: `${stat.totalFinalized > 0 ? Math.max(4, stat.accuracyPct) : 0}%` }}
                              />
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-[#A7B3C7] pt-1">
                              <span>{stat.solved} Solved</span>
                              <span>{stat.points} XP Earned</span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handlePractiseChapterFromCard(ch.id, ch.name)}
                            className="w-full py-1.5 rounded-lg bg-white dark:bg-[#151F32] hover:bg-indigo-50 dark:hover:bg-indigo-950/50 border border-slate-200 dark:border-slate-700 text-indigo-600 dark:text-indigo-400 text-xs font-semibold transition-colors cursor-pointer"
                          >
                            Practise Chapter →
                          </button>
                        </div>
                      );
                    })}
                </div>
              </section>
            </div>

            {/* RIGHT COLUMN (4 cols): Leaderboard, League Tier, Deferred Comparison */}
            <div className="lg:col-span-4 space-y-6">
              {/* SECTION D: COMPETITIVE LEADERBOARD */}
              <section
                aria-label="Competitive Leaderboard"
                className="bg-white dark:bg-[#151F32] rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-2xs space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-base sm:text-lg font-bold text-slate-950 dark:text-[#F1F5F9]">
                    Leaderboard
                  </h3>
                  <button
                    type="button"
                    onClick={() => setIsSchoolModalOpen(true)}
                    className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 cursor-pointer"
                  >
                    Preferences
                  </button>
                </div>

                {/* Scope Filter Tabs */}
                <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-[#1E293B] border border-slate-200/60 dark:border-slate-700/60 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setLeaderboardScope("OVERALL")}
                    className={`py-1.5 rounded-lg transition-all text-center cursor-pointer ${
                      leaderboardScope === "OVERALL"
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    Global
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!leaderboardData?.school_configured && !selectedSchoolId) {
                        setIsSchoolModalOpen(true);
                      } else {
                        setLeaderboardScope("SCHOOL");
                      }
                    }}
                    className={`py-1.5 rounded-lg transition-all text-center cursor-pointer ${
                      leaderboardScope === "SCHOOL"
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    School
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!leaderboardData?.city_configured && !selectedSchoolId) {
                        setIsSchoolModalOpen(true);
                      } else {
                        setLeaderboardScope("CITY");
                      }
                    }}
                    className={`py-1.5 rounded-lg transition-all text-center cursor-pointer ${
                      leaderboardScope === "CITY"
                        ? "bg-indigo-600 text-white shadow-xs"
                        : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    City
                  </button>
                </div>

                {/* Student's Current Position Strip */}
                <div className="p-3.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-slate-500 dark:text-slate-400 block text-[11px]">
                      Your Standing:
                    </span>
                    <strong className="text-slate-900 dark:text-[#F1F5F9] text-sm">
                      {leaderboardData?.my_rank ? `Rank #${leaderboardData.my_rank}` : "Unranked"}
                    </strong>
                  </div>
                  <div className="text-right">
                    <span className="font-semibold text-indigo-700 dark:text-indigo-300 text-sm block">
                      {competitiveOverview?.pointsError
                        ? "XP Error"
                        : `${competitiveOverview?.totalPoints ?? leaderboardData?.my_points ?? 0} XP`}
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                      {leaderboardData?.points_to_next_rank
                        ? `+${leaderboardData.points_to_next_rank} XP to climb`
                        : "Top rank reached"}
                    </span>
                  </div>
                </div>

                {/* Opt-Out Notice if not opted in */}
                {!competitiveOptIn && (
                  <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/70 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                    <p className="font-bold">You are currently opted out</p>
                    <p className="text-[11px] leading-relaxed">
                      Opt in via Preferences to appear in school, city, and global rankings.
                    </p>
                  </div>
                )}

                {/* Leaderboard Competitors List */}
                {leaderboardLoading ? (
                  <div className="py-8 text-center text-xs text-slate-400">
                    Loading competitive rankings...
                  </div>
                ) : leaderboardData?.leaderboard &&
                  leaderboardData.leaderboard.length > 0 ? (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                    {leaderboardData.leaderboard.slice(0, 7).map((row, idx) => {
                      const isMe =
                        row.is_current_user ||
                        (leaderboardData.my_rank !== null &&
                          row.rank === leaderboardData.my_rank);

                      return (
                        <div
                          key={idx}
                          className={`py-2.5 px-2.5 rounded-xl flex items-center justify-between transition-colors ${
                            isMe
                              ? "bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200/80 dark:border-indigo-800/80 font-bold"
                              : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span
                              className={`w-5 text-center font-bold text-xs ${
                                row.rank === 1
                                  ? "text-amber-500 font-extrabold"
                                  : row.rank === 2
                                  ? "text-slate-400 font-extrabold"
                                  : row.rank === 3
                                  ? "text-amber-700 font-extrabold"
                                  : "text-slate-500"
                              }`}
                            >
                              {row.rank === 1
                                ? "🥇"
                                : row.rank === 2
                                ? "🥈"
                                : row.rank === 3
                                ? "🥉"
                                : row.rank}
                            </span>
                            <div className="min-w-0">
                              <span className="text-slate-900 dark:text-[#F1F5F9] truncate block">
                                {row.student_name}
                                {isMe && (
                                  <span className="ml-1 text-[10px] text-indigo-600 dark:text-indigo-400 font-bold">
                                    (You)
                                  </span>
                                )}
                              </span>
                              {row.school_name && (
                                <span className="text-[10px] text-slate-400 truncate block">
                                  {row.school_name}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="font-bold text-slate-900 dark:text-[#F1F5F9] block">
                              {row.total_points} XP
                            </span>
                            <span className="text-[10px] text-slate-500 dark:text-[#A7B3C7]">
                              {row.accuracy_pct}% Acc
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-8 text-center rounded-xl bg-slate-50/60 dark:bg-[#1E293B]/40 border border-dashed border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-[#A7B3C7] space-y-1">
                    <p className="font-semibold">No Competitors Ranked Yet</p>
                    <p className="text-[11px]">
                      {leaderboardScope === "SCHOOL"
                        ? "Configure a verified school to view schoolmate ranks."
                        : "Complete practice questions to earn points and appear on the leaderboard."}
                    </p>
                  </div>
                )}
              </section>

              {/* LEAGUE TIER & ACHIEVEMENTS */}
              <section
                aria-label="League Tier and Mathematical Achievements"
                className="bg-white dark:bg-[#151F32] rounded-2xl p-6 border border-slate-200/80 dark:border-slate-800 shadow-2xs space-y-4"
              >
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-slate-950 dark:text-[#F1F5F9]">
                    League Tier & Badges
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-[#A7B3C7] mt-0.5">
                    Climb through historical mathematician tiers
                  </p>
                </div>

                {/* Tier Badge Progress */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1E293B] border border-slate-200/80 dark:border-slate-700/80 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300">
                      {competitiveOverview?.leagueTier || "Pythagoras Novice"}
                    </span>
                    <span className="text-xs font-semibold text-slate-500">
                      {competitiveOverview?.pointsError
                        ? "—"
                        : `${competitiveOverview?.totalPoints ?? 0} / ${competitiveOverview?.nextTierPoints || 40} XP`}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"
                      style={{
                        width: `${competitiveOverview?.tierProgressPct || 10}%`,
                      }}
                    />
                  </div>
                </div>

                {/* Unlocked / In-Progress Badges */}
                <div className="space-y-2 pt-1">
                  {competitiveOverview?.achievements?.slice(0, 4).map((ach) => (
                    <div
                      key={ach.code}
                      className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                        ach.unlocked
                          ? "bg-purple-50/70 dark:bg-purple-950/30 border-purple-200/80 dark:border-purple-800/60"
                          : "bg-slate-50/50 dark:bg-[#1E293B]/40 border-slate-200/60 dark:border-slate-800 text-slate-400 opacity-75"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-sm shrink-0">
                          {ach.unlocked ? "🎖️" : "🔒"}
                        </span>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 dark:text-[#F1F5F9] truncate">
                            {ach.title}
                          </p>
                          <p className="text-[10px] text-slate-500 truncate">
                            {ach.description}
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 shrink-0">
                        {ach.unlocked ? "Unlocked" : `${ach.progress}/${ach.maxProgress}`}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              {/* SECTION G: COMPARE WITH CLASSMATES (DEFERRED) */}
              <section
                aria-label="Class Comparison (Deferred)"
                className="bg-white dark:bg-[#151F32] rounded-2xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-2xs space-y-2"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Compare With Classmates
                  </h4>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">
                    Cohort Reserved
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-[#A7B3C7] leading-relaxed">
                  School-level cohort analytics and classroom comparison scores will activate automatically when your school verifies class-section enrollments.
                </p>
              </section>
            </div>
          </div>

          {/* BOTTOM CALLOUT STRIP */}
          <div className="rounded-2xl bg-gradient-to-r from-indigo-900 via-indigo-950 to-purple-950 border border-indigo-800/80 p-5 sm:p-6 text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 shadow-sm">
            <div className="space-y-1">
              <h4 className="text-base font-bold">Ready to climb higher?</h4>
              <p className="text-xs sm:text-sm text-indigo-200">
                Complete more CBSE Class 10 questions, improve your accuracy and earn mastery points!
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveNav("Practice Questions");
                document
                  .getElementById("published-practice-questions")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
              className="px-5 py-2.5 rounded-xl bg-white text-indigo-950 hover:bg-indigo-50 font-bold text-xs sm:text-sm transition-all shrink-0 shadow-sm cursor-pointer"
            >
              Explore Practice Questions →
            </button>
          </div>

          {/* INTERACTIVE PRACTICE DRAWER / PANEL (Supports MCQ, Subjective Math Editor, and Handwritten Upload in Light & Dark modes) */}
          {activePracticeChapter && currentQuestion && (
            <section
              aria-label="Live Practice Question"
              className="rounded-2xl bg-white dark:bg-[#151F32] border-2 border-indigo-600/25 dark:border-indigo-500/40 shadow-lg shadow-indigo-500/5 p-6 sm:p-7 transition-colors"
            >
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 mb-5 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  <span className="px-3 py-1 rounded-lg bg-indigo-600 text-white text-xs font-bold uppercase tracking-wider">
                    Live Practice
                  </span>
                  <div>
                    <h3 className="text-base font-bold text-slate-950 dark:text-[#F1F5F9]">
                      {currentQuestion.chapter}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-[#A7B3C7]">
                      Tag: {currentQuestion.difficulty} • Step-by-step NCERT Solution included
                    </p>
                  </div>
                </div>

                {/* Chapter Switcher Pills inside Practice Mode */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {Object.keys(SAMPLE_QUESTIONS_BY_CHAPTER).map((chap) => (
                    <button
                      key={chap}
                      type="button"
                      onClick={() => openPracticeSession(chap)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        activePracticeChapter === chap
                          ? "bg-indigo-100 dark:bg-indigo-950/90 text-indigo-800 dark:text-indigo-300 font-semibold border border-indigo-200/60 dark:border-indigo-700"
                          : "bg-slate-100 dark:bg-[#1E293B] text-slate-600 dark:text-[#A7B3C7] hover:bg-slate-200/70 dark:hover:bg-slate-700"
                      }`}
                    >
                      {chap}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setActivePracticeChapter(null)}
                    className="ml-2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    aria-label="Close practice panel"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* Answer Format Switcher: MCQ | Mathematical Answer Editor | Handwritten Upload */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <div
                  role="tablist"
                  aria-label="Question Answer Mode"
                  className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-[#1E293B] border border-slate-200/70 dark:border-slate-700/80"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={answerFormatMode === "mcq"}
                    onClick={() => {
                      setAnswerFormatMode("mcq");
                      setAnswerSubmitted(false);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      answerFormatMode === "mcq"
                        ? "bg-white dark:bg-[#151F32] text-indigo-600 dark:text-indigo-400 shadow-2xs"
                        : "text-slate-600 dark:text-[#A7B3C7] hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    MCQ Mode
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={answerFormatMode === "subjective"}
                    onClick={() => {
                      setAnswerFormatMode("subjective");
                      setAnswerSubmitted(false);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      answerFormatMode === "subjective"
                        ? "bg-white dark:bg-[#151F32] text-indigo-600 dark:text-indigo-400 shadow-2xs"
                        : "text-slate-600 dark:text-[#A7B3C7] hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    Math Answer Editor (VSA / SA / LA)
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={answerFormatMode === "handwritten"}
                    onClick={() => {
                      setAnswerFormatMode("handwritten");
                      setAnswerSubmitted(false);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      answerFormatMode === "handwritten"
                        ? "bg-white dark:bg-[#151F32] text-indigo-600 dark:text-indigo-400 shadow-2xs"
                        : "text-slate-600 dark:text-[#A7B3C7] hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    Handwritten Upload
                  </button>
                </div>

                {answerFormatMode === "subjective" && (
                  <div className="flex items-center gap-1.5">
                    {(
                      [
                        "Very Short (1M)",
                        "Short Answer (3M)",
                        "Long Answer (5M)",
                      ] as SubjectiveLength[]
                    ).map((len) => (
                      <button
                        key={len}
                        type="button"
                        onClick={() => setSubjectiveLength(len)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer ${
                          subjectiveLength === len
                            ? "bg-violet-50 dark:bg-violet-950/80 text-violet-700 dark:text-violet-300 border-violet-300 dark:border-violet-700"
                            : "bg-transparent text-slate-500 dark:text-[#A7B3C7] border-slate-200 dark:border-slate-700"
                        }`}
                      >
                        {len}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-5">
                <p className="text-base sm:text-lg font-semibold text-slate-900 dark:text-[#F1F5F9] leading-relaxed math-expression">
                  Q. {currentQuestion.questionText}
                </p>

                {/* MODE 1: MCQ OPTIONS */}
                {answerFormatMode === "mcq" && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {currentQuestion.options.map((option, idx) => {
                      const isSelected = selectedOption === idx;
                      const isCorrect = idx === currentQuestion.correctIndex;

                      let optionStyle =
                        "border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] hover:bg-white dark:hover:bg-slate-800 hover:border-indigo-300 dark:hover:border-indigo-500 text-slate-800 dark:text-[#F1F5F9]";
                      if (answerSubmitted) {
                        if (isCorrect) {
                          optionStyle =
                            "border-emerald-500 dark:border-emerald-500 bg-emerald-50/90 dark:bg-emerald-950/60 text-emerald-950 dark:text-emerald-100 font-semibold";
                        } else if (isSelected && !isCorrect) {
                          optionStyle =
                            "border-rose-400 dark:border-rose-500 bg-rose-50/90 dark:bg-rose-950/60 text-rose-900 dark:text-rose-100";
                        }
                      } else if (isSelected) {
                        optionStyle =
                          "border-indigo-600 dark:border-indigo-400 bg-indigo-50/80 dark:bg-indigo-950/70 text-indigo-950 dark:text-white font-semibold ring-2 ring-indigo-600/15 dark:ring-indigo-400/25";
                      }

                      return (
                        <button
                          key={option}
                          type="button"
                          disabled={answerSubmitted}
                          onClick={() => setSelectedOption(idx)}
                          className={`flex items-center justify-between p-4 rounded-xl border text-left text-sm transition-all cursor-pointer ${optionStyle}`}
                        >
                          <span className="flex items-center gap-3">
                            <span className="w-6 h-6 rounded-full border border-current/30 flex items-center justify-center text-xs font-bold">
                              {String.fromCharCode(65 + idx)}
                            </span>
                            <span className="math-expression">{option}</span>
                          </span>
                          {answerSubmitted && isCorrect && (
                            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/80 px-2 py-0.5 rounded-md">
                              Correct
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* MODE 2: SUBJECTIVE MATHEMATICAL ANSWER EDITOR */}
                {answerFormatMode === "subjective" && (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] overflow-hidden">
                    <div className="px-3.5 py-2 border-b border-slate-200/80 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-[#151F32]">
                      <span className="text-xs font-semibold text-slate-600 dark:text-[#A7B3C7]">
                        Insert Math Symbol ({subjectiveLength}):
                      </span>
                      <div className="flex flex-wrap items-center gap-1">
                        {MATH_SYMBOLS.map((sym) => (
                          <button
                            key={sym}
                            type="button"
                            onClick={() =>
                              setSubjectiveWorkText((prev) => `${prev}${sym}`)
                            }
                            className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-[#1E293B] hover:bg-indigo-50 dark:hover:bg-indigo-950/80 text-slate-800 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 font-mono text-xs font-bold border border-slate-200/80 dark:border-slate-700 transition-colors cursor-pointer"
                          >
                            {sym}
                          </button>
                        ))}
                      </div>
                    </div>
                    <textarea
                      rows={4}
                      value={subjectiveWorkText}
                      onChange={(e) => setSubjectiveWorkText(e.target.value)}
                      placeholder="Write your step-by-step mathematical derivation here (e.g., Given D = b² - 4ac = 0 ⇒ k = 6)..."
                      className="w-full p-4 bg-transparent text-sm font-mono text-slate-900 dark:text-[#F1F5F9] placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none"
                    />
                  </div>
                )}

                {/* MODE 3: HANDWRITTEN IMAGE UPLOAD INTERFACE */}
                {answerFormatMode === "handwritten" && (
                  <div className="rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-[#1E293B]/70 p-6 text-center space-y-3">
                    <div className="w-11 h-11 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto">
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                        />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-[#F1F5F9]">
                        {uploadedFileName
                          ? `Attached Notebook Scan: ${uploadedFileName}`
                          : "Upload a photo of your handwritten Class 10 notebook solution"}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-[#A7B3C7] mt-0.5">
                        Supports JPG, PNG or PDF up to 10 MB • Step-marking AI evaluation ready
                      </p>
                    </div>
                    <div className="flex items-center justify-center gap-2.5">
                      <label className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer transition-colors">
                        <span>Choose Image</span>
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          className="sr-only"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              setUploadedFileName(file.name);
                            }
                          }}
                        />
                      </label>
                      {!uploadedFileName && (
                        <button
                          type="button"
                          onClick={() =>
                            setUploadedFileName(
                              "triangles_bpt_solution_page1.jpg"
                            )
                          }
                          className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          Use Sample Notebook Scan
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {answerSubmitted && (
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#1E293B] border border-slate-200/80 dark:border-slate-700 text-sm text-slate-700 dark:text-slate-200 space-y-1">
                    <p className="font-bold text-slate-900 dark:text-white">
                      {answerFormatMode === "mcq" &&
                      selectedOption === currentQuestion.correctIndex
                        ? "🎉 Spot on! Great mathematical reasoning."
                        : "💡 Official NCERT Step-by-Step Solution:"}
                    </p>
                    <p className="math-expression">
                      {currentQuestion.explanation}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <span className="text-xs text-slate-500 dark:text-[#A7B3C7]">
                    {answerFormatMode === "mcq"
                      ? "Select an option above to verify your answer immediately."
                      : "Submit your response to compare with the NCERT marking scheme."}
                  </span>
                  <div className="flex items-center gap-3">
                    {answerSubmitted ? (
                      <button
                        type="button"
                        onClick={() => {
                          const keys = Object.keys(SAMPLE_QUESTIONS_BY_CHAPTER);
                          const nextIdx =
                            (keys.indexOf(activePracticeChapter) + 1) %
                            keys.length;
                          openPracticeSession(keys[nextIdx]);
                        }}
                        className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs sm:text-sm cursor-pointer"
                      >
                        Next Chapter Question →
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={
                          (answerFormatMode === "mcq" &&
                            selectedOption === null) ||
                          (answerFormatMode === "subjective" &&
                            !subjectiveWorkText.trim()) ||
                          (answerFormatMode === "handwritten" &&
                            !uploadedFileName)
                        }
                        onClick={handleCheckAnswer}
                        className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 dark:disabled:text-slate-500 text-white font-semibold text-xs sm:text-sm transition-colors cursor-pointer"
                      >
                        Check Answer
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* PUBLISHED QUESTIONS FROM SUPABASE */}
          <section
            id="published-practice-questions"
            aria-label="Published Practice Questions"
            className="space-y-5"
          >
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
              <div>
                <h2 className="text-lg sm:text-xl font-bold tracking-tight text-slate-950 dark:text-[#F1F5F9]">
                  Published Practice Questions
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-[#A7B3C7]">
                  Curated Class 10 curriculum questions released by your teachers
                </p>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-auto">
                {isFiltered && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/40 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors cursor-pointer"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                    <span>Reset Filters</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setLiveLoading(true);
                    setLiveReloadTick((t) => t + 1);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] hover:bg-slate-50 dark:hover:bg-[#1E293B] text-xs font-semibold text-indigo-600 dark:text-indigo-400 transition-colors cursor-pointer"
                >
                  <svg
                    className={`w-3.5 h-3.5 ${liveLoading ? "animate-spin" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                    />
                  </svg>
                  <span>Refresh</span>
                </button>
              </div>
            </div>

            {/* Curriculum & Attributes Filtering Toolbar */}
            <div className="rounded-2xl bg-white dark:bg-[#151F32] border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shadow-2xs space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                {/* 1. Chapter Filter */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="student-filter-chapter"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Chapter
                  </label>
                  <select
                    id="student-filter-chapter"
                    value={selectedChapterId}
                    onChange={(e) => {
                      setSelectedChapterId(e.target.value);
                      setSelectedTopicId("ALL");
                    }}
                    className="w-full px-3 py-2 rounded-xl text-xs sm:text-sm border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-slate-900 dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all cursor-pointer"
                  >
                    <option value="ALL">All Chapters</option>
                    {chaptersList.map((chap) => (
                      <option key={chap.id} value={chap.id}>
                        {chap.chapter_number
                          ? `Ch. ${chap.chapter_number}: `
                          : ""}
                        {chap.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 2. Topic Filter */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="student-filter-topic"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Topic
                  </label>
                  <select
                    id="student-filter-topic"
                    value={selectedTopicId}
                    disabled={selectedChapterId === "ALL" || topicsLoading}
                    onChange={(e) => setSelectedTopicId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-xs sm:text-sm border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-slate-900 dark:text-[#F1F5F9] disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all cursor-pointer"
                  >
                    <option value="ALL">
                      {selectedChapterId === "ALL"
                        ? "All Topics (Select Chapter)"
                        : topicsLoading
                        ? "Loading topics..."
                        : topicsList.length === 0
                        ? "No topics in chapter"
                        : "All Topics"}
                    </option>
                    {topicsList.map((top) => (
                      <option key={top.id} value={top.id}>
                        {top.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 3. Difficulty Filter */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="student-filter-difficulty"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Difficulty
                  </label>
                  <select
                    id="student-filter-difficulty"
                    value={selectedDifficulty}
                    onChange={(e) => setSelectedDifficulty(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-xs sm:text-sm border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-slate-900 dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all cursor-pointer"
                  >
                    <option value="ALL">All Difficulties</option>
                    <option value="EASY">Easy</option>
                    <option value="MEDIUM">Moderate</option>
                    <option value="HARD">Difficult</option>
                  </select>
                </div>

                {/* 4. Question Type Filter */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="student-filter-question-type"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Question Type
                  </label>
                  <select
                    id="student-filter-question-type"
                    value={selectedQuestionType}
                    onChange={(e) => setSelectedQuestionType(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-xs sm:text-sm border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-slate-900 dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all cursor-pointer"
                  >
                    <option value="ALL">All Types</option>
                    <option value="MCQ">MCQ</option>
                    <option value="SUBJECTIVE">Subjective</option>
                    <option value="TRUE_FALSE">True/False</option>
                    <option value="FILL_BLANK">Fill in the Blank</option>
                  </select>
                </div>
              </div>

              {/* Status and Active Filter Indicators */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-[#A7B3C7]">
                <div className="flex flex-wrap items-center gap-2">
                  <span>
                    Showing{" "}
                    <strong className="text-slate-900 dark:text-white font-semibold">
                      {liveQuestions.length}
                    </strong>{" "}
                    published {liveQuestions.length === 1 ? "question" : "questions"}
                  </span>
                  {isFiltered && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 font-semibold text-[11px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 dark:bg-indigo-400" />
                      Filters Active
                    </span>
                  )}
                </div>

                {isFiltered && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 cursor-pointer"
                  >
                    Clear all filters
                  </button>
                )}
              </div>
            </div>

            {liveLoading ? (
              <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#151F32] p-10 text-center space-y-3">
                <div className="inline-block w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                <p className="text-sm text-slate-500 dark:text-[#A7B3C7]">
                  Loading published questions...
                </p>
              </div>
            ) : liveError ? (
              <div
                role="alert"
                className="rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 p-5 text-sm text-rose-800 dark:text-rose-200 space-y-2"
              >
                <div className="font-semibold">Unable to load questions</div>
                <p className="text-xs text-rose-700 dark:text-rose-300">{liveError}</p>
                <button
                  type="button"
                  onClick={() => setLiveReloadTick((t) => t + 1)}
                  className="text-xs font-semibold underline hover:no-underline cursor-pointer"
                >
                  Retry Loading
                </button>
              </div>
            ) : liveQuestions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-[#151F32] p-8 text-center space-y-3">
                <div className="w-10 h-10 mx-auto rounded-full bg-slate-100 dark:bg-[#1E293B] flex items-center justify-center text-slate-400">
                  <svg
                    className="w-5 h-5"
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
                </div>
                <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {isFiltered
                    ? "No published questions match your selected filters"
                    : "No published questions available yet"}
                </div>
                <p className="text-xs text-slate-500 dark:text-[#A7B3C7] max-w-md mx-auto">
                  {isFiltered
                    ? "Try choosing a different chapter, topic, difficulty, or question type."
                    : "Your teachers have not released any practice questions yet. Please check back soon."}
                </p>
                {isFiltered && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer"
                  >
                    Reset All Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                {liveQuestions.map((q) => {
                  const picked = liveSelected[q.id];
                  const result = liveResults[q.id];
                  return (
                    <div
                      key={q.id}
                      className="rounded-2xl bg-white dark:bg-[#151F32] border border-slate-200/80 dark:border-slate-800 p-5 shadow-2xs space-y-4"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                        <span className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300">
                          {liveChapterNames[q.chapter_id] || "Class 10"}
                        </span>
                        {q.topic_id && liveTopicNames[q.topic_id] && (
                          <span className="px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/70 text-sky-700 dark:text-sky-300 border border-sky-200/50 dark:border-sky-800/50">
                            {liveTopicNames[q.topic_id]}
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-[#1E293B] text-slate-600 dark:text-slate-300">
                          {q.question_type}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-md border ${
                            q.difficulty === "HARD" ||
                            q.difficulty === "DIFFICULT"
                              ? "bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border-rose-200/60 dark:border-rose-800/60"
                              : q.difficulty === "MEDIUM" ||
                                q.difficulty === "MODERATE"
                              ? "bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-800/60"
                              : "bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-800/60"
                          }`}
                        >
                          {q.difficulty === "HARD" ||
                          q.difficulty === "DIFFICULT"
                            ? "Difficult"
                            : q.difficulty === "MEDIUM" ||
                              q.difficulty === "MODERATE"
                            ? "Moderate"
                            : "Easy"}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-violet-50 dark:bg-violet-950/70 text-violet-700 dark:text-violet-300">
                          {q.marks} {q.marks === 1 ? "Mark" : "Marks"}
                        </span>
                      </div>

                      <div className="text-sm sm:text-base font-semibold text-slate-900 dark:text-[#F1F5F9]">
                        <MathContentRenderer content={q.question_text} />
                      </div>

                      {q.question_type === "FILL_BLANK" ? (
                        <div className="space-y-2 max-w-md">
                          <div className="relative">
                            <input
                              type="text"
                              disabled={!!result}
                              value={picked ?? ""}
                              placeholder="Type your answer here..."
                              onChange={(e) => {
                                const val = e.target.value;
                                setLiveSelected((prev) => ({
                                  ...prev,
                                  [q.id]: val,
                                }));
                              }}
                              onKeyDown={(e) => {
                                if (
                                  e.key === "Enter" &&
                                  !result &&
                                  picked &&
                                  picked.trim()
                                ) {
                                  void handleSubmitLiveAnswer(q);
                                }
                              }}
                              className={`w-full px-4 py-3 rounded-xl border text-sm font-medium transition-all outline-none ${
                                result
                                  ? result.is_correct
                                    ? "border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-100 ring-1 ring-emerald-500/30"
                                    : "border-rose-400 bg-rose-50/60 dark:bg-rose-950/40 text-rose-950 dark:text-rose-100 ring-1 ring-rose-400/30"
                                  : "border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] text-slate-900 dark:text-[#F1F5F9] focus:border-indigo-600 dark:focus:border-indigo-400 focus:ring-2 focus:ring-indigo-600/15"
                              }`}
                            />
                          </div>
                          {result && Boolean(result.reveal) && !result.is_correct && (
                            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                              Correct Answer:{" "}
                              {result.correct_answer_text ||
                                (result.accepted_answers &&
                                  result.accepted_answers[0]) ||
                                "N/A"}
                            </p>
                          )}
                        </div>
                      ) : q.question_type === "TRUE_FALSE" ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {(["TRUE", "FALSE"] as const).map((val) => {
                            const isPicked = picked === val;
                            const isKey =
                              !!result &&
                              Boolean(result.reveal) &&
                              result.correct_answer_text?.toUpperCase() === val;
                            let style =
                              "border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] text-slate-800 dark:text-[#F1F5F9]";
                            if (result) {
                              if (isKey)
                                style =
                                  "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-950 dark:text-emerald-100 font-medium ring-1 ring-emerald-500/30";
                              else if (isPicked && result.is_correct === false)
                                style =
                                  "border-rose-400 bg-rose-50 dark:bg-rose-950/60 text-rose-900 dark:text-rose-100 font-medium ring-1 ring-rose-400/30";
                              else if (isPicked && result.is_correct === true)
                                style =
                                  "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-950 dark:text-emerald-100 font-medium ring-1 ring-emerald-500/30";
                              else if (isPicked)
                                style =
                                  "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/70";
                            } else if (isPicked) {
                              style =
                                "border-indigo-600 dark:border-indigo-400 bg-indigo-50/80 dark:bg-indigo-950/70 font-semibold ring-2 ring-indigo-600/15";
                            }
                            return (
                              <button
                                key={val}
                                type="button"
                                disabled={!!result}
                                onClick={() =>
                                  setLiveSelected((prev) => ({
                                    ...prev,
                                    [q.id]: val,
                                  }))
                                }
                                className={`flex items-center gap-3 p-3.5 rounded-xl border text-left text-sm transition-all cursor-pointer ${style}`}
                              >
                                <span className="w-6 h-6 rounded-full border border-current/30 flex items-center justify-center text-xs font-bold shrink-0">
                                  {val === "TRUE" ? "T" : "F"}
                                </span>
                                <span className="font-semibold text-sm">
                                  {val === "TRUE" ? "True" : "False"}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : q.options.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {q.options.map((opt) => {
                            const isPicked = picked === opt.id;
                            const isKey =
                              !!result &&
                              Boolean(result.reveal) &&
                              ((result.correct_option_ids &&
                                result.correct_option_ids.includes(opt.id)) ||
                                (result.correct_keys &&
                                  result.correct_keys.includes(
                                    opt.option_key
                                  )) ||
                                result.correct_option_label === opt.option_key);
                            let style =
                              "border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] text-slate-800 dark:text-[#F1F5F9]";
                            if (result) {
                              if (isKey)
                                style =
                                  "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-950 dark:text-emerald-100 font-medium ring-1 ring-emerald-500/30";
                              else if (isPicked && result.is_correct === false)
                                style =
                                  "border-rose-400 bg-rose-50 dark:bg-rose-950/60 text-rose-900 dark:text-rose-100 font-medium ring-1 ring-rose-400/30";
                              else if (isPicked && result.is_correct === true)
                                style =
                                  "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-950 dark:text-emerald-100 font-medium ring-1 ring-emerald-500/30";
                              else if (isPicked)
                                style =
                                  "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/70";
                            } else if (isPicked) {
                              style =
                                "border-indigo-600 dark:border-indigo-400 bg-indigo-50/80 dark:bg-indigo-950/70 font-semibold ring-2 ring-indigo-600/15";
                            }
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                disabled={!!result}
                                onClick={() =>
                                  setLiveSelected((prev) => ({
                                    ...prev,
                                    [q.id]: opt.id,
                                  }))
                                }
                                className={`flex items-center gap-3 p-3.5 rounded-xl border text-left text-sm transition-all cursor-pointer ${style}`}
                              >
                                <span className="w-6 h-6 rounded-full border border-current/30 flex items-center justify-center text-xs font-bold shrink-0">
                                  {opt.option_key}
                                </span>
                                <span className="math-expression">
                                  <MathContentRenderer
                                    content={opt.option_text}
                                    inline
                                  />
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : q.question_type === "SUBJECTIVE" ? (
                        <SubjectiveAnswerEditor
                          questionId={q.id}
                          marks={q.marks}
                          submittedResult={result}
                          onSubmit={(data) => handleSubmitSubjectiveAnswer(q, data)}
                          onTryAgain={() => handleTryAgain(q.id)}
                        />
                      ) : (
                        <p className="text-xs italic text-slate-400">
                          Options are not available for this question.
                        </p>
                      )}

                      {result && q.question_type !== "SUBJECTIVE" && (
                        <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                            <span className="font-medium">
                              Attempt #{result.attempt_number ?? 1}
                              {result.total_attempts && result.total_attempts > 1
                                ? ` (${result.total_attempts} total)`
                                : ""}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setLiveSelected((prev) => {
                                  const next = { ...prev };
                                  delete next[q.id];
                                  return next;
                                });
                                setLiveResults((prev) => {
                                  const next = { ...prev };
                                  delete next[q.id];
                                  return next;
                                });
                              }}
                              className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                            >
                              Try Again ↺
                            </button>
                          </div>

                          {result.evaluation_status === "PENDING" ? (
                            <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs sm:text-sm font-medium">
                              <svg
                                className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                              </svg>
                              <span>
                                Awaiting Teacher Evaluation — your answer has been
                                safely submitted.
                              </span>
                            </div>
                          ) : result.is_correct ? (
                            <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-950 dark:text-emerald-100 text-xs sm:text-sm font-semibold">
                              <div className="flex items-center gap-2">
                                <span>🎉 Correct Answer!</span>
                              </div>
                              <span className="px-2 py-0.5 rounded-md bg-emerald-200/60 dark:bg-emerald-900/80 text-emerald-900 dark:text-emerald-200 font-bold text-xs">
                                +{result.final_marks ?? q.marks} / {q.marks}{" "}
                                {q.marks === 1 ? "Mark" : "Marks"}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-950 dark:text-rose-100 text-xs sm:text-sm font-semibold">
                              <div className="flex items-center gap-2">
                                <span>
                                  {q.question_type === "TRUE_FALSE"
                                    ? "❌ Incorrect Answer. The correct answer is highlighted."
                                    : q.question_type === "FILL_BLANK"
                                    ? result.reveal && result.correct_answer_text
                                      ? `❌ Incorrect Answer. Correct Answer: ${result.correct_answer_text}`
                                      : "❌ Incorrect Answer."
                                    : "❌ Incorrect Answer. The correct option is highlighted."}
                                </span>
                              </div>
                              <span className="px-2 py-0.5 rounded-md bg-rose-200/60 dark:bg-rose-900/80 text-rose-900 dark:text-rose-200 font-bold text-xs">
                                {result.final_marks ?? 0} / {q.marks}{" "}
                                {q.marks === 1 ? "Mark" : "Marks"}
                              </span>
                            </div>
                          )}

                          {Boolean(
                            result.reveal &&
                              (result.model_answer || result.solution_steps)
                          ) && (
                              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#1E293B]/70 border border-slate-200/80 dark:border-slate-800 space-y-2">
                                <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                  Explanation & Solution
                                </p>
                                {result.model_answer && (
                                  <div className="text-xs sm:text-sm text-slate-700 dark:text-slate-200">
                                    <MathContentRenderer
                                      content={result.model_answer}
                                    />
                                  </div>
                                )}
                              </div>
                            )}
                        </div>
                      )}

                      {!result &&
                        (q.options.length > 0 ||
                          q.question_type === "TRUE_FALSE" ||
                          q.question_type === "FILL_BLANK") && (
                          <button
                            type="button"
                            disabled={!picked || !picked.trim()}
                            onClick={() => void handleSubmitLiveAnswer(q)}
                            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 text-white font-semibold text-xs sm:text-sm cursor-pointer transition-colors"
                          >
                            Submit Answer
                          </button>
                        )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
