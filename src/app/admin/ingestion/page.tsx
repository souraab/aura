"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { useAuth } from "@/components/auth-provider";
import {
  type IngestionBatchRecord,
  type IngestionBatchStatus,
  type StagingQuestionRecord,
  type IngestionBatchStatsSummary,
  fetchIngestionBatches,
  fetchIngestionBatchById,
  fetchIngestionBatchStatistics,
  fetchStagingQuestions,
  uploadSourcePdfAndCreateBatch,
  getSourcePdfSignedUrl,
} from "@/lib/admin-staging-db";
import {
  type ChapterRecord,
  fetchChapters,
} from "@/lib/admin-questions-db";

// ============================================================================
// Formatting Helpers
// ============================================================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDateShort(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoString;
  }
}

function BatchStatusBadge({ status }: { status: IngestionBatchStatus | string }) {
  const norm = String(status).toUpperCase();
  switch (norm) {
    case "PENDING":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/70">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          Uploaded — awaiting extraction
        </span>
      );
    case "IN_REVIEW":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/70">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
          In Review
        </span>
      );
    case "APPROVED":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/70">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Approved
        </span>
      );
    case "COMPLETED":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/70">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          Completed
        </span>
      );
    case "ARCHIVED":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
          Archived
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
          {status}
        </span>
      );
  }
}

// ============================================================================
// Main Admin PDF Ingestion Page
// ============================================================================

export default function AdminIngestionPage() {
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

  // Authoritative Role Check (must be ADMIN)
  const normalizedRole = (profile?.role ?? "").trim().toUpperCase();
  const isRoleLoading = authLoading || profileLoading;
  const isAuthorizedAdmin = normalizedRole === "ADMIN";

  // Data States
  const [batches, setBatches] = useState<IngestionBatchRecord[]>([]);
  const [totalBatchesCount, setTotalBatchesCount] = useState(0);
  const [chapters, setChapters] = useState<ChapterRecord[]>([]);
  const [stats, setStats] = useState<IngestionBatchStatsSummary>({
    totalBatches: 0,
    pendingOrProcessing: 0,
    completedOrReview: 0,
    requiringAttention: 0,
  });

  // UI / Filter States
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  // Upload Form States
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedChapterId, setSelectedChapterId] = useState<string>("");
  const [sourceName, setSourceName] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadSectionRef = useRef<HTMLDivElement | null>(null);

  // Batch Details Modal States
  const [inspectingBatch, setInspectingBatch] = useState<IngestionBatchRecord | null>(null);
  const [inspectingPdfUrl, setInspectingPdfUrl] = useState<string | null>(null);
  const [batchCandidates, setBatchCandidates] = useState<StagingQuestionRecord[]>([]);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);

  // Redirect unauthenticated visitors
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login?redirectTo=/admin/ingestion");
    }
  }, [authLoading, user, router]);

  // Chapter lookup map
  const chaptersMap = useMemo(() => {
    const map = new Map<string, ChapterRecord>();
    chapters.forEach((c) => map.set(c.id, c));
    return map;
  }, [chapters]);

  // Fetch batches, stats, and chapters
  const loadDashboardData = useCallback(async () => {
    setIsLoadingData(true);
    setPageError(null);
    try {
      const [batchesResult, statsResult, chaptersList] = await Promise.all([
        fetchIngestionBatches(
          50,
          0,
          statusFilter !== "ALL" ? (statusFilter as IngestionBatchStatus) : undefined
        ),
        fetchIngestionBatchStatistics(),
        fetchChapters(),
      ]);

      setBatches(batchesResult.batches);
      setTotalBatchesCount(batchesResult.total);
      setStats(statsResult);
      setChapters(chaptersList);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load ingestion records.";
      setPageError(msg);
    } finally {
      setIsLoadingData(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    if (authLoading || !user || !isAuthorizedAdmin) return;
    loadDashboardData();
  }, [authLoading, user, isAuthorizedAdmin, loadDashboardData]);

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const validateAndSetFile = (file: File) => {
    setUploadError(null);
    const maxBytes = 50 * 1024 * 1024; // 50 MB
    if (file.size > maxBytes) {
      setUploadError(
        `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 50 MB limit.`
      );
      return;
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Only PDF files are supported for ingestion.");
      return;
    }
    setSelectedFile(file);
    if (!sourceName.trim()) {
      setSourceName(file.name.replace(/\.pdf$/i, "").replace(/[-_]/g, " "));
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  // Upload and batch creation submission
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setUploadError("Please select a PDF file to upload.");
      return;
    }

    setIsUploading(true);
    setUploadProgress(5);
    setUploadError(null);

    try {
      const createdBatch = await uploadSourcePdfAndCreateBatch(
        {
          file: selectedFile,
          targetChapterId: selectedChapterId || null,
          sourceName: sourceName.trim() || undefined,
          notes: notes.trim() || undefined,
        },
        (progress) => {
          setUploadProgress(progress);
        }
      );

      setNotification({
        type: "success",
        message: `Batch created for "${createdBatch.pdf_filename}". Status: Uploaded — awaiting extraction.`,
      });

      // Reset form
      setSelectedFile(null);
      setSourceName("");
      setNotes("");
      setSelectedChapterId("");
      if (fileInputRef.current) fileInputRef.current.value = "";

      // Refresh dashboard
      await loadDashboardData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to upload PDF and create batch.";
      setUploadError(msg);
      setNotification({ type: "error", message: msg });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  // Inspect batch details modal
  const handleOpenBatchDetails = async (batch: IngestionBatchRecord) => {
    setInspectingBatch(batch);
    setInspectingPdfUrl(null);
    setBatchCandidates([]);
    setIsLoadingCandidates(true);

    try {
      const [signedUrl, candidates] = await Promise.all([
        getSourcePdfSignedUrl(batch.pdf_storage_path),
        fetchStagingQuestions(batch.id),
      ]);
      setInspectingPdfUrl(signedUrl);
      setBatchCandidates(candidates);
    } catch {
      // Non-blocking; details modal will still display batch metadata
    } finally {
      setIsLoadingCandidates(false);
    }
  };

  // Filtered batch records by search query
  const filteredBatches = useMemo(() => {
    if (!searchQuery.trim()) return batches;
    const q = searchQuery.toLowerCase().trim();
    return batches.filter((b) => {
      const metaSource = (b.metadata?.source_name as string) || "";
      return (
        b.pdf_filename.toLowerCase().includes(q) ||
        b.id.toLowerCase().includes(q) ||
        metaSource.toLowerCase().includes(q)
      );
    });
  }, [batches, searchQuery]);

  // ============================================================================
  // Auth & Guard Screens
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

  if (!isAuthorizedAdmin) {
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
          <p className="text-sm text-slate-600 dark:text-[#A7B3C7]">
            {profileError || !normalizedRole
              ? "Could not retrieve your user profile from public.profiles. Please try again."
              : `Your account (${user.email}) has role "${normalizedRole || "NONE"}". Only administrators can access the PDF Ingestion module.`}
          </p>
          <div className="pt-2 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => refreshProfile()}
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
  // Main Dashboard View
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

            {/* Navigation Switcher: Question Bank vs Ingestion */}
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-[#151F32] border border-slate-200/80 dark:border-slate-800 text-xs">
              <Link
                href="/admin/questions"
                className="px-3 py-1 rounded-lg text-slate-600 dark:text-[#A7B3C7] hover:text-slate-950 dark:hover:text-white transition-colors"
              >
                Question Bank
              </Link>
              <span className="px-3 py-1 rounded-lg font-semibold bg-white dark:bg-indigo-600 text-indigo-700 dark:text-white shadow-xs">
                PDF Ingestion
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <ThemeSwitcher />

            <div className="hidden md:inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/90 dark:border-emerald-800/70 text-emerald-900 dark:text-emerald-200 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>Supabase Connected • ADMIN</span>
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

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-6 sm:py-8 space-y-7">
        {/* Notification Toast */}
        {notification && (
          <div
            role="status"
            className={`flex items-center justify-between gap-4 px-4 py-3 rounded-xl border text-xs sm:text-sm shadow-sm ${
              notification.type === "error"
                ? "bg-rose-50 dark:bg-rose-950/70 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200"
                : notification.type === "info"
                ? "bg-indigo-50 dark:bg-indigo-950/70 border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-200"
                : "bg-slate-900 dark:bg-[#1E293B] border-transparent dark:border-slate-700 text-white"
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  notification.type === "error"
                    ? "bg-rose-500"
                    : notification.type === "info"
                    ? "bg-indigo-500"
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
              onClick={loadDashboardData}
              className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs shrink-0 cursor-pointer"
            >
              Retry Connection
            </button>
          </div>
        )}

        {/* Hero Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200/80 dark:border-slate-800/80">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-950 dark:text-white">
              PDF Question Ingestion
            </h1>
            <p className="text-sm text-slate-600 dark:text-[#A7B3C7] mt-1 max-w-3xl">
              Upload mathematics examination and textbook PDFs, track extraction progress,
              and review staged candidates before promoting them to the production question bank.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                uploadSectionRef.current?.scrollIntoView({ behavior: "smooth" });
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-semibold shadow-xs shadow-indigo-600/30 transition-all cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Upload PDF
            </button>
            <button
              type="button"
              onClick={loadDashboardData}
              disabled={isLoadingData}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-medium text-slate-700 dark:text-[#A7B3C7] hover:bg-slate-100 dark:hover:bg-[#151F32] transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh Batches"
            >
              <svg className={`w-4 h-4 ${isLoadingData ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Statistics Cards */}
        <section aria-label="Ingestion Statistics" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-[#151F32] rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#A7B3C7]">
                Total Batches
              </span>
              <span className="p-2 rounded-xl bg-slate-100 dark:bg-[#1E293B] text-slate-600 dark:text-slate-300 text-xs">
                📄
              </span>
            </div>
            <p className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white mt-2">
              {stats.totalBatches}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-[#A7B3C7] mt-0.5">
              Source PDF documents
            </p>
          </div>

          <div className="bg-white dark:bg-[#151F32] rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                Awaiting / Processing
              </span>
              <span className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 text-xs">
                ⏳
              </span>
            </div>
            <p className="text-2xl sm:text-3xl font-extrabold text-amber-700 dark:text-amber-300 mt-2">
              {stats.pendingOrProcessing}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-[#A7B3C7] mt-0.5">
              Ready for extraction engine
            </p>
          </div>

          <div className="bg-white dark:bg-[#151F32] rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                Processed / In Review
              </span>
              <span className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 text-xs">
                ✅
              </span>
            </div>
            <p className="text-2xl sm:text-3xl font-extrabold text-emerald-700 dark:text-emerald-300 mt-2">
              {stats.completedOrReview}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-[#A7B3C7] mt-0.5">
              Extracted question candidates
            </p>
          </div>

          <div className="bg-white dark:bg-[#151F32] rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                Requires Attention
              </span>
              <span className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 text-xs">
                ⚠️
              </span>
            </div>
            <p className="text-2xl sm:text-3xl font-extrabold text-rose-700 dark:text-rose-300 mt-2">
              {stats.requiringAttention}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-[#A7B3C7] mt-0.5">
              Batches with warnings or failures
            </p>
          </div>
        </section>

        {/* PDF Upload Section */}
        <section
          ref={uploadSectionRef}
          aria-label="Upload Source PDF"
          className="bg-white dark:bg-[#151F32] rounded-3xl border border-slate-200/80 dark:border-slate-800 p-5 sm:p-7 shadow-xs space-y-6"
        >
          <div className="flex items-center justify-between border-b border-slate-200/70 dark:border-slate-800/80 pb-4">
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-slate-950 dark:text-white">
                Upload Mathematics PDF Document
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 dark:text-[#A7B3C7] mt-0.5">
                Upload question papers, textbooks, or sample sheets up to 50 MB.
              </p>
            </div>
            <span className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 dark:bg-[#1E293B] text-slate-600 dark:text-slate-300">
              Limit: 50 MB • Format: PDF
            </span>
          </div>

          {/* Architecture Transparency Notice */}
          <div className="rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/70 dark:border-indigo-800/50 p-4 text-xs sm:text-sm text-indigo-950 dark:text-indigo-200">
            <div className="flex items-start gap-2.5">
              <span className="text-base leading-none">ℹ️</span>
              <div className="space-y-1">
                <p className="font-semibold text-indigo-900 dark:text-indigo-100">
                  How Extraction Works
                </p>
                <p className="text-indigo-800/90 dark:text-indigo-300 text-xs leading-relaxed">
                  Uploading securely stores your original PDF in Supabase Storage (`question-media/ingestion/{`batch_id`}/source.pdf`)
                  and registers a new batch with status <strong>"Uploaded — awaiting extraction"</strong>.
                  The mathematical extraction engine (`scripts/ingestion/import_to_staging.py`) processes the PDF using native PDFKit geometry
                  and outputs candidates to the staging table for your review.
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleUploadSubmit} className="space-y-5">
            {/* Dropzone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-3 ${
                isDragging
                  ? "border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40"
                  : selectedFile
                  ? "border-emerald-500/80 bg-emerald-50/30 dark:bg-emerald-950/20"
                  : "border-slate-300 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-600 bg-slate-50/60 dark:bg-[#0B1120]/40"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={handleFileInputChange}
                className="hidden"
              />

              {selectedFile ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xl font-bold">
                    📄
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-slate-900 dark:text-white text-sm sm:text-base">
                      {selectedFile.name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-[#A7B3C7] mt-0.5">
                      {formatBytes(selectedFile.size)} • Click or drop a different file to change
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="mt-1 px-3 py-1 rounded-lg text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
                  >
                    Remove File
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-100 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      Drag and drop your Mathematics PDF here, or{" "}
                      <span className="text-indigo-600 dark:text-indigo-400 underline">browse files</span>
                    </p>
                    <p className="text-xs text-slate-500 dark:text-[#A7B3C7] mt-1">
                      Supports CBSE sample papers, NCERT chapters, and test papers up to 50 MB
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Upload Options Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Target Chapter (Optional)
                </label>
                <select
                  value={selectedChapterId}
                  onChange={(e) => setSelectedChapterId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-slate-900 dark:text-white text-xs sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">All Chapters / General (Detect Per Question)</option>
                  {chapters.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      Ch. {ch.chapter_number}: {ch.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-slate-500 dark:text-[#A7B3C7] mt-1">
                  Default chapter assigned to extracted candidates
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Source / Document Name
                </label>
                <input
                  type="text"
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  placeholder="e.g. CBSE Class 10 Math 2026 Set 1"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-slate-900 dark:text-white text-xs sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-[11px] text-slate-500 dark:text-[#A7B3C7] mt-1">
                  Helpful identifier for provenance tracking
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Admin Notes (Optional)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Includes Section A MCQs & diagrams"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-slate-900 dark:text-white text-xs sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-[11px] text-slate-500 dark:text-[#A7B3C7] mt-1">
                  Internal notes stored with batch metadata
                </p>
              </div>
            </div>

            {/* Validation Error Message */}
            {uploadError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-xs sm:text-sm text-rose-800 dark:text-rose-200">
                {uploadError}
              </div>
            )}

            {/* Upload Progress Bar */}
            {isUploading && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-semibold text-slate-600 dark:text-[#A7B3C7]">
                  <span>Uploading to private storage (`question-media`)...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Submit Action */}
            <div className="flex justify-end gap-3 pt-1">
              {selectedFile && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFile(null);
                    setUploadError(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  disabled={isUploading}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={!selectedFile || isUploading}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white text-xs sm:text-sm font-semibold shadow-xs transition-all cursor-pointer disabled:cursor-not-allowed"
              >
                {isUploading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Uploading PDF ({uploadProgress}%)...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Upload & Register Batch</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </section>

        {/* Batches Table Section */}
        <section aria-label="Ingestion Batches" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-slate-950 dark:text-white">
                Ingestion Batches
              </h2>
              <p className="text-xs text-slate-500 dark:text-[#A7B3C7]">
                Showing {filteredBatches.length} of {totalBatchesCount} total batches
              </p>
            </div>

            {/* Filter and Search Bar */}
            <div className="flex flex-wrap items-center gap-2.5">
              <input
                type="text"
                placeholder="Search by filename or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              />

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              >
                <option value="ALL">All Statuses</option>
                <option value="PENDING">Uploaded — awaiting extraction</option>
                <option value="IN_REVIEW">In Review</option>
                <option value="APPROVED">Approved</option>
                <option value="COMPLETED">Completed</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </div>
          </div>

          {/* Table Container */}
          <div className="bg-white dark:bg-[#151F32] rounded-3xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
            {isLoadingData ? (
              <div className="p-12 flex flex-col items-center justify-center gap-3">
                <svg className="w-8 h-8 text-indigo-600 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <p className="text-xs sm:text-sm font-semibold text-slate-500 dark:text-[#A7B3C7]">
                  Loading ingestion batches from Supabase...
                </p>
              </div>
            ) : filteredBatches.length === 0 ? (
              <div className="p-12 text-center flex flex-col items-center justify-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-[#1E293B] text-slate-400 flex items-center justify-center text-2xl">
                  📁
                </div>
                <div>
                  <p className="font-bold text-slate-900 dark:text-white text-base">
                    No ingestion batches found
                  </p>
                  <p className="text-xs text-slate-500 dark:text-[#A7B3C7] mt-0.5 max-w-sm mx-auto">
                    {searchQuery || statusFilter !== "ALL"
                      ? "No batches match your search filter criteria. Try clearing filters."
                      : "Upload your first mathematics PDF above to create an ingestion batch."}
                  </p>
                </div>
                {(searchQuery || statusFilter !== "ALL") && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setStatusFilter("ALL");
                    }}
                    className="mt-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-slate-50 dark:hover:bg-[#1E293B]"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/75 dark:bg-[#121A2B] text-slate-500 dark:text-[#A7B3C7] text-xs font-semibold uppercase tracking-wider">
                      <th className="py-3 px-4">Source PDF</th>
                      <th className="py-3 px-4">Target Chapter</th>
                      <th className="py-3 px-4">Upload Date</th>
                      <th className="py-3 px-4">Processing Status</th>
                      <th className="py-3 px-4 text-center">Extracted Questions</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800/60">
                    {filteredBatches.map((batch) => {
                      const metaChapterId = (batch.metadata?.target_chapter_id as string) || null;
                      const chapterObj = metaChapterId ? chaptersMap.get(metaChapterId) : null;
                      const sourceName = (batch.metadata?.source_name as string) || null;

                      return (
                        <tr
                          key={batch.id}
                          className="hover:bg-slate-50/50 dark:hover:bg-[#19243A]/50 transition-colors"
                        >
                          {/* Source PDF */}
                          <td className="py-3.5 px-4">
                            <div className="flex items-start gap-2.5">
                              <span className="text-lg leading-none mt-0.5">📄</span>
                              <div>
                                <p className="font-semibold text-slate-900 dark:text-white leading-snug">
                                  {batch.pdf_filename}
                                </p>
                                <p className="text-[11px] text-slate-500 dark:text-[#A7B3C7] mt-0.5">
                                  {formatBytes(batch.pdf_file_size_bytes)}
                                  {sourceName ? ` • ${sourceName}` : ""}
                                </p>
                              </div>
                            </div>
                          </td>

                          {/* Target Chapter */}
                          <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300">
                            {chapterObj ? (
                              <span className="inline-flex items-center gap-1 font-medium">
                                <span className="text-xs text-indigo-600 dark:text-indigo-400 font-bold">
                                  Ch. {chapterObj.chapter_number}
                                </span>
                                <span className="truncate max-w-[140px]">{chapterObj.name}</span>
                              </span>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-500 italic">
                                General / Unassigned
                              </span>
                            )}
                          </td>

                          {/* Upload Date */}
                          <td className="py-3.5 px-4 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            {formatDateShort(batch.created_at)}
                          </td>

                          {/* Processing Status */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <BatchStatusBadge status={batch.status} />
                          </td>

                          {/* Extracted Questions */}
                          <td className="py-3.5 px-4 text-center">
                            {batch.total_questions > 0 ? (
                              <div className="inline-flex flex-col items-center">
                                <span className="font-bold text-slate-900 dark:text-white">
                                  {batch.total_questions} questions
                                </span>
                                <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                                  {batch.promoted_count} promoted
                                </span>
                                {batch.extraction_failures_count > 0 && (
                                  <span className="text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                                    {batch.extraction_failures_count} warnings
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-500 text-xs">
                                Pending run
                              </span>
                            )}
                          </td>

                          {/* Actions */}
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenBatchDetails(batch)}
                                className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1E293B] transition-colors cursor-pointer"
                              >
                                View Batch
                              </button>

                              {batch.total_questions > 0 ? (
                                <Link
                                  href={`/admin/ingestion/${batch.id}`}
                                  className="px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer inline-flex items-center gap-1"
                                >
                                  <span>Review ({batch.total_questions})</span>
                                  <span>→</span>
                                </Link>
                              ) : (
                                <span
                                  className="text-[11px] text-slate-400 dark:text-slate-500 px-2"
                                  title="Run scripts/ingestion/import_to_staging.py to extract questions"
                                >
                                  Awaiting worker
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Batch Details & Candidate Review Modal */}
      {inspectingBatch && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6"
        >
          <div className="bg-white dark:bg-[#151F32] rounded-3xl border border-slate-200 dark:border-slate-800 max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-950 dark:text-white">
                  Batch Inspection: {inspectingBatch.pdf_filename}
                </h3>
                <p className="text-xs text-slate-500 dark:text-[#A7B3C7] font-mono mt-0.5">
                  ID: {inspectingBatch.id}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingBatch(null)}
                className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-[#1E293B] text-slate-500 hover:text-slate-900 dark:hover:text-white flex items-center justify-center font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-6 overflow-y-auto space-y-6 text-xs sm:text-sm">
              {/* Metadata Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 dark:bg-[#0B1120] p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">Status</span>
                  <div className="mt-1">
                    <BatchStatusBadge status={inspectingBatch.status} />
                  </div>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">File Size</span>
                  <p className="mt-1 font-semibold text-slate-900 dark:text-white">
                    {formatBytes(inspectingBatch.pdf_file_size_bytes)}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">Total Questions</span>
                  <p className="mt-1 font-semibold text-slate-900 dark:text-white">
                    {inspectingBatch.total_questions}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400">Promoted</span>
                  <p className="mt-1 font-semibold text-emerald-600 dark:text-emerald-400">
                    {inspectingBatch.promoted_count}
                  </p>
                </div>
              </div>

              {/* Source PDF Storage Path & Signed URL */}
              <div className="space-y-1.5">
                <p className="font-semibold text-slate-900 dark:text-white">
                  Storage Path (`question-media` Bucket)
                </p>
                <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-100 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 font-mono text-xs text-slate-700 dark:text-slate-300 break-all">
                  <span>{inspectingBatch.pdf_storage_path}</span>
                  {inspectingPdfUrl && (
                    <a
                      href={inspectingPdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-sans text-xs font-semibold shrink-0"
                    >
                      Open PDF
                    </a>
                  )}
                </div>
              </div>

              {/* SHA-256 Hash */}
              <div className="space-y-1">
                <p className="font-semibold text-slate-900 dark:text-white">
                  Document SHA-256 Checksum
                </p>
                <p className="p-2.5 rounded-xl bg-slate-100 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 font-mono text-[11px] text-slate-600 dark:text-[#A7B3C7] break-all">
                  {inspectingBatch.pdf_file_hash}
                </p>
              </div>

              {/* CLI Worker Extraction Instructions if Pending */}
              {inspectingBatch.total_questions === 0 && (
                <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 space-y-2">
                  <p className="font-bold text-xs uppercase tracking-wider text-amber-800 dark:text-amber-300">
                    Extraction CLI Worker Command
                  </p>
                  <p className="text-xs">
                    This document is stored in Supabase. To run the local Python 2D extraction engine against this batch, execute:
                  </p>
                  <pre className="p-3 rounded-xl bg-slate-900 text-amber-200 font-mono text-xs overflow-x-auto select-all">
                    python3 scripts/ingestion/process_batch.py --batch-id {inspectingBatch.id}
                  </pre>
                </div>
              )}

              {/* Extracted Candidates Preview (if any) */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-slate-900 dark:text-white">
                    Staged Question Candidates ({batchCandidates.length})
                  </p>
                  {isLoadingCandidates && (
                    <span className="text-xs text-slate-400 animate-pulse">Loading candidates...</span>
                  )}
                </div>

                {batchCandidates.length > 0 ? (
                  <div className="border border-slate-200 dark:border-slate-800 rounded-2xl divide-y divide-slate-200 dark:divide-slate-800 max-h-60 overflow-y-auto">
                    {batchCandidates.map((q) => (
                      <div key={q.id} className="p-3 hover:bg-slate-50 dark:hover:bg-[#1E293B]/50 transition-colors">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-indigo-600 dark:text-indigo-400">
                            {q.detected_question_label}
                          </span>
                          <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-slate-100 dark:bg-[#0B1120] text-slate-600 dark:text-slate-300">
                            {q.inferred_type} • Status: {q.review_status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-700 dark:text-slate-300 mt-1 line-clamp-2">
                          {q.candidate_question_text}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : !isLoadingCandidates ? (
                  <p className="text-xs text-slate-500 italic p-4 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                    No candidates staged yet for this batch. Run the ingestion worker to populate questions.
                  </p>
                ) : null}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
              {inspectingBatch.total_questions > 0 ? (
                <Link
                  href={`/admin/ingestion/${inspectingBatch.id}`}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs transition-colors inline-flex items-center gap-1.5"
                >
                  <span>Open Curation Workspace</span>
                  <span>→</span>
                </Link>
              ) : (
                <span className="text-[11px] text-slate-400">
                  Run extraction worker to populate candidates
                </span>
              )}
              <button
                type="button"
                onClick={() => setInspectingBatch(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#1E293B] hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

