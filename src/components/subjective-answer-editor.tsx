"use client";

import React, { useState, useEffect, useRef } from "react";
import { MathRichEditor } from "@/components/math-editor";
import { MathContentRenderer } from "@/components/math-renderer";
import {
  uploadStudentSubmissionPage,
  removeStudentSubmissionPage,
  getSubmissionSignedUrls,
  ALLOWED_SUBMISSION_MIME_TYPES,
  MAX_SUBMISSION_FILE_SIZE,
  MAX_SUBMISSION_PAGES,
  type StudentEvaluationResult,
} from "@/lib/admin-questions-db";

export interface SubjectivePage {
  pageNumber: number;
  storagePath: string;
  signedUrl: string;
  fileName: string;
  fileSize?: number;
  isUploading?: boolean;
}

export interface SubjectiveAnswerEditorProps {
  questionId: string;
  marks: number;
  submittedResult?: StudentEvaluationResult | null;
  onSubmit: (params: { typedText: string; imagePaths: string[] }) => Promise<void>;
  onTryAgain?: () => void;
  disabled?: boolean;
}

export function SubjectiveAnswerEditor({
  questionId,
  marks,
  submittedResult,
  onSubmit,
  onTryAgain,
  disabled = false,
}: SubjectiveAnswerEditorProps) {
  const [activeTab, setActiveTab] = useState<"typed" | "handwritten">("typed");
  const [typedText, setTypedText] = useState<string>("");
  const [pages, setPages] = useState<SubjectivePage[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [previewModalUrl, setPreviewModalUrl] = useState<string | null>(null);
  const [previewModalTitle, setPreviewModalTitle] = useState<string>("");
  const [submittedImages, setSubmittedImages] = useState<
    { page_number: number; storage_path: string; signedUrl: string }[]
  >([]);
  const [loadingSubmittedImages, setLoadingSubmittedImages] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load draft from localStorage if not submitted
  useEffect(() => {
    if (submittedResult) return;
    try {
      const draftKey = `mathpractice_subj_draft_${questionId}`;
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.typedText) setTypedText(parsed.typedText);
        if (Array.isArray(parsed.pages)) setPages(parsed.pages);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [questionId, submittedResult]);

  // Save draft to localStorage on change
  useEffect(() => {
    if (submittedResult) return;
    try {
      const draftKey = `mathpractice_subj_draft_${questionId}`;
      if (typedText || pages.length > 0) {
        localStorage.setItem(
          draftKey,
          JSON.stringify({ typedText, pages })
        );
      } else {
        localStorage.removeItem(draftKey);
      }
    } catch {
      // Ignore localStorage errors
    }
  }, [questionId, typedText, pages, submittedResult]);

  // Load submitted images with signed URLs when result is present
  useEffect(() => {
    if (!submittedResult) {
      setSubmittedImages([]);
      return;
    }

    const imgs = submittedResult.images;
    if (imgs && imgs.length > 0) {
      let cancelled = false;
      setLoadingSubmittedImages(true);
      getSubmissionSignedUrls(imgs)
        .then((resolved) => {
          if (!cancelled) setSubmittedImages(resolved);
        })
        .catch((err) => {
          console.warn("Could not load signed URLs for submitted images:", err);
        })
        .finally(() => {
          if (!cancelled) setLoadingSubmittedImages(false);
        });
      return () => {
        cancelled = true;
      };
    } else {
      setSubmittedImages([]);
    }
  }, [submittedResult]);

  // Handle file uploads
  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || disabled) return;
    setUploadError(null);

    const remainingSlots = MAX_SUBMISSION_PAGES - pages.length;
    if (remainingSlots <= 0) {
      setUploadError(`Maximum of ${MAX_SUBMISSION_PAGES} pages reached.`);
      return;
    }

    const filesToUpload = Array.from(fileList).slice(0, remainingSlots);
    if (fileList.length > remainingSlots) {
      setUploadError(
        `Only ${remainingSlots} more ${
          remainingSlots === 1 ? "page" : "pages"
        } can be attached (max ${MAX_SUBMISSION_PAGES}).`
      );
    }

    for (let i = 0; i < filesToUpload.length; i++) {
      const file = filesToUpload[i];
      const pageIndex = pages.length + i + 1;

      // Validate size
      if (file.size > MAX_SUBMISSION_FILE_SIZE) {
        setUploadError(`"${file.name}" exceeds the 10 MB limit.`);
        continue;
      }

      // Validate MIME
      const mime = file.type?.toLowerCase() || "";
      if (!ALLOWED_SUBMISSION_MIME_TYPES.includes(mime)) {
        setUploadError(
          `"${file.name}" is not a supported file. Please upload JPG, PNG, or PDF.`
        );
        continue;
      }

      // Optimistic placeholder
      const tempId = `temp-${Date.now()}-${i}`;
      const placeholder: SubjectivePage = {
        pageNumber: pageIndex,
        storagePath: tempId,
        signedUrl: URL.createObjectURL(file),
        fileName: file.name,
        fileSize: file.size,
        isUploading: true,
      };

      setPages((prev) => [...prev, placeholder]);

      try {
        const uploaded = await uploadStudentSubmissionPage(file, pageIndex);
        setPages((prev) =>
          prev.map((p) =>
            p.storagePath === tempId
              ? {
                  ...p,
                  storagePath: uploaded.storagePath,
                  signedUrl: uploaded.signedUrl,
                  pageNumber: uploaded.pageNumber,
                  isUploading: false,
                }
              : p
          )
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setUploadError(msg);
        setPages((prev) => prev.filter((p) => p.storagePath !== tempId));
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Remove a draft page
  const handleRemovePage = async (pageIndexToRemove: number) => {
    const page = pages[pageIndexToRemove];
    if (!page || page.isUploading) return;

    try {
      await removeStudentSubmissionPage(page.storagePath);
    } catch (err) {
      console.warn("Could not delete unsubmitted draft storage object:", err);
    }

    setPages((prev) => {
      const filtered = prev.filter((_, idx) => idx !== pageIndexToRemove);
      return filtered.map((p, idx) => ({ ...p, pageNumber: idx + 1 }));
    });
  };

  // Reorder pages
  const handleMovePage = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= pages.length) return;

    setPages((prev) => {
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next.map((p, idx) => ({ ...p, pageNumber: idx + 1 }));
    });
  };

  // Submit Answer
  const handleSubmit = async () => {
    const cleanText = typedText.trim();
    const cleanImagePaths = pages
      .filter((p) => !p.isUploading)
      .map((p) => p.storagePath);

    if (!cleanText && cleanImagePaths.length === 0) {
      setUploadError(
        "Please provide a typed mathematical solution or upload handwritten work before submitting."
      );
      return;
    }

    setIsSubmitting(true);
    setUploadError(null);

    try {
      await onSubmit({
        typedText: cleanText,
        imagePaths: cleanImagePaths,
      });

      // Clear draft on successful submission
      try {
        localStorage.removeItem(`mathpractice_subj_draft_${questionId}`);
      } catch {
        // Ignore
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Submission failed";
      setUploadError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // --------------------------------------------------------------------------
  // RENDER: If already submitted, display the submitted solution & review state
  // --------------------------------------------------------------------------
  if (submittedResult) {
    // Extract submitted text from typed_answer payload if stored as JSON
    let displayTypedText = "";
    if (submittedResult.typed_answer) {
      try {
        const parsed = JSON.parse(submittedResult.typed_answer);
        displayTypedText = parsed.text || parsed.value || "";
      } catch {
        displayTypedText = submittedResult.typed_answer;
      }
    }

    return (
      <div className="space-y-4 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-[#1E293B]/40 p-4">
        {/* Header / Submission Status */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
            <span>
              Attempt #{submittedResult.attempt_number ?? 1}
              {submittedResult.total_attempts && submittedResult.total_attempts > 1
                ? ` (${submittedResult.total_attempts} total)`
                : ""}
            </span>
            <span className="text-slate-400">•</span>
            <span className="text-slate-500 dark:text-slate-400">
              {submittedResult.max_marks ?? marks}{" "}
              {(submittedResult.max_marks ?? marks) === 1 ? "Mark" : "Marks"}
            </span>
          </div>

          {onTryAgain && (
            <button
              type="button"
              onClick={onTryAgain}
              className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
            >
              Try Again ↺
            </button>
          )}
        </div>

        {/* Evaluation Status Banner */}
        {submittedResult.evaluation_status === "FINALIZED" ? (
          <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-950 dark:text-emerald-100 text-xs sm:text-sm font-semibold">
            <div className="flex items-center gap-2">
              <span>Teacher Evaluation Completed</span>
            </div>
            <span className="px-2 py-0.5 rounded-md bg-emerald-200/60 dark:bg-emerald-900/80 text-emerald-900 dark:text-emerald-200 font-bold text-xs">
              {submittedResult.final_marks ?? 0} / {submittedResult.max_marks ?? marks} Marks
            </span>
          </div>
        ) : (
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
              Awaiting Teacher Evaluation — your solution has been safely submitted.
            </span>
          </div>
        )}

        {/* Teacher Feedback if available */}
        {submittedResult.feedback && submittedResult.evaluation_status === "FINALIZED" && (
          <div className="p-3 rounded-xl bg-blue-50/60 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs text-blue-950 dark:text-blue-200 space-y-1">
            <span className="font-bold uppercase tracking-wider text-[10px]">
              Teacher Feedback:
            </span>
            <p className="text-xs font-medium">{submittedResult.feedback}</p>
          </div>
        )}

        {/* Revealed Solution & Steps */}
        {Boolean(submittedResult.reveal && (submittedResult.model_answer || submittedResult.solution_steps)) && (
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#1E293B]/70 border border-slate-200/80 dark:border-slate-800 space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Model Solution & Marking Scheme
            </p>
            {submittedResult.model_answer && (
              <div className="text-xs sm:text-sm text-slate-700 dark:text-slate-200">
                <MathContentRenderer content={submittedResult.model_answer} />
              </div>
            )}
          </div>
        )}

        {/* Submitted Typed Solution */}
        {displayTypedText ? (
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Your Typed Mathematical Solution
            </p>
            <div className="p-3.5 rounded-xl bg-white dark:bg-[#151F32] border border-slate-200 dark:border-slate-700/80 text-sm leading-relaxed text-slate-900 dark:text-[#F1F5F9]">
              <MathContentRenderer content={displayTypedText} />
            </div>
          </div>
        ) : null}

        {/* Submitted Handwritten Pages Gallery */}
        {submittedResult.images && submittedResult.images.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Attached Handwritten Work ({submittedResult.images.length}{" "}
              {submittedResult.images.length === 1 ? "Page" : "Pages"})
            </p>

            {loadingSubmittedImages ? (
              <div className="flex items-center gap-2 py-4 text-xs text-slate-500 dark:text-slate-400">
                <span className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                <span>Loading submitted pages...</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {submittedImages.map((img) => {
                  const isPdf = img.storage_path.toLowerCase().endsWith(".pdf");
                  return (
                    <div
                      key={img.storage_path}
                      onClick={() => {
                        setPreviewModalUrl(img.signedUrl);
                        setPreviewModalTitle(`Page ${img.page_number}`);
                      }}
                      className="group relative rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] overflow-hidden shadow-2xs hover:shadow-md transition-all cursor-pointer aspect-3/4 flex flex-col"
                    >
                      <div className="flex-1 bg-slate-100 dark:bg-slate-900/60 flex items-center justify-center overflow-hidden">
                        {isPdf ? (
                          <div className="text-center p-3">
                            <span className="text-3xl">📄</span>
                            <p className="mt-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                              PDF Document
                            </p>
                          </div>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={img.signedUrl}
                            alt={`Page ${img.page_number}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                        )}
                      </div>
                      <div className="p-2 bg-white/90 dark:bg-[#151F32]/90 backdrop-blur-xs flex items-center justify-between border-t border-slate-100 dark:border-slate-800 text-[11px] font-semibold">
                        <span className="text-slate-700 dark:text-slate-300">
                          Page {img.page_number}
                        </span>
                        <span className="text-indigo-600 dark:text-indigo-400 group-hover:underline">
                          View 🔍
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Modal for viewing submitted high-res image */}
        {previewModalUrl && (
          <div
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setPreviewModalUrl(null)}
          >
            <div
              className="relative max-w-4xl w-full max-h-[90vh] bg-white dark:bg-[#151F32] rounded-2xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
                <h4 className="text-sm font-bold text-slate-900 dark:text-[#F1F5F9]">
                  {previewModalTitle}
                </h4>
                <button
                  type="button"
                  onClick={() => setPreviewModalUrl(null)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 text-lg font-bold cursor-pointer"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-900/40">
                {previewModalUrl.toLowerCase().includes(".pdf") ? (
                  <iframe
                    src={previewModalUrl}
                    title={previewModalTitle}
                    className="w-full h-[75vh] rounded-lg border-0"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewModalUrl}
                    alt={previewModalTitle}
                    className="max-h-[75vh] w-auto object-contain rounded-lg shadow-md"
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // RENDER: Active Answering Editor (Typed + Handwritten Attachments)
  // --------------------------------------------------------------------------
  const hasTypedContent = Boolean(typedText.trim());
  const hasPages = pages.length > 0;
  const isAnyUploading = pages.some((p) => p.isUploading);

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#151F32] p-4 sm:p-5 shadow-2xs">
      {/* Top Method Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 dark:border-slate-800 pb-3">
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-[#1E293B]">
          <button
            type="button"
            onClick={() => setActiveTab("typed")}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "typed"
                ? "bg-white dark:bg-[#0B1329] text-indigo-600 dark:text-indigo-400 shadow-2xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-[#F1F5F9]"
            }`}
          >
            <span>📝</span>
            <span>Typed Mathematical Solution</span>
            {hasTypedContent && (
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("handwritten")}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === "handwritten"
                ? "bg-white dark:bg-[#0B1329] text-indigo-600 dark:text-indigo-400 shadow-2xs"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-[#F1F5F9]"
            }`}
          >
            <span>📷</span>
            <span>Handwritten Solution (Scans)</span>
            {hasPages && (
              <span className="px-1.5 py-0.2 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-300 text-[10px] font-bold">
                {pages.length}
              </span>
            )}
          </button>
        </div>

        {/* Status Pills */}
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Marks: <strong className="text-slate-800 dark:text-[#F1F5F9]">{marks}</strong></span>
          <span>•</span>
          <span className="italic text-[11px]">
            {hasTypedContent && hasPages
              ? "Combined solution (Typed + Scans)"
              : hasTypedContent
              ? "Typed solution only"
              : hasPages
              ? "Handwritten scans only"
              : "Provide typed steps or attach scans"}
          </span>
        </div>
      </div>

      {/* Error banner */}
      {uploadError && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200 text-xs flex items-center justify-between">
          <span>⚠️ {uploadError}</span>
          <button
            type="button"
            onClick={() => setUploadError(null)}
            className="text-rose-600 dark:text-rose-400 font-bold ml-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* TAB 1: TYPED MATHEMATICAL SOLUTION */}
      {activeTab === "typed" && (
        <div className="space-y-3">
          <MathRichEditor
            label="Type your step-by-step mathematical working"
            value={typedText}
            onChange={setTypedText}
            placeholder="Type your derivation, formulas used, steps, and final answer here. You can use math palettes and LaTeX..."
            rows={5}
            helperText="Write detailed steps. You can also switch to 'Handwritten Solution' to attach scanned notebook pages."
          />
        </div>
      )}

      {/* TAB 2: HANDWRITTEN PAGES (SCANS) */}
      {activeTab === "handwritten" && (
        <div className="space-y-4">
          {/* Dropzone Area */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFilesSelected(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-400 rounded-2xl p-6 text-center cursor-pointer bg-slate-50/50 dark:bg-[#1E293B]/30 hover:bg-indigo-50/20 dark:hover:bg-indigo-950/20 transition-all"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/jpg,application/pdf"
              onChange={(e) => handleFilesSelected(e.target.files)}
              className="hidden"
            />
            <div className="w-12 h-12 mx-auto rounded-full bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-2xl mb-3">
              📷
            </div>
            <p className="text-sm font-semibold text-slate-800 dark:text-[#F1F5F9]">
              Click to browse or drag & drop photographs of your notebook
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Supports JPEG, PNG, and PDF • Up to 10 MB per file • Max 10 pages
            </p>
          </div>

          {/* Uploaded Pages Grid */}
          {pages.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                <span>
                  Attached Pages ({pages.length} / {MAX_SUBMISSION_PAGES})
                </span>
                <span className="text-[11px] text-slate-400 font-normal">
                  Use arrows to reorder pages before submitting
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {pages.map((p, idx) => {
                  const isPdf = p.fileName.toLowerCase().endsWith(".pdf");
                  return (
                    <div
                      key={p.storagePath}
                      className="group relative rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] overflow-hidden shadow-2xs hover:shadow-md transition-all aspect-3/4 flex flex-col"
                    >
                      {/* Image / PDF preview */}
                      <div
                        onClick={() => {
                          if (!p.isUploading) {
                            setPreviewModalUrl(p.signedUrl);
                            setPreviewModalTitle(`Page ${p.pageNumber}`);
                          }
                        }}
                        className="flex-1 bg-slate-100 dark:bg-slate-900/60 flex items-center justify-center overflow-hidden cursor-pointer"
                      >
                        {p.isUploading ? (
                          <div className="flex flex-col items-center gap-2 p-3 text-center">
                            <span className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                            <span className="text-[11px] text-slate-500">
                              Uploading...
                            </span>
                          </div>
                        ) : isPdf ? (
                          <div className="text-center p-3">
                            <span className="text-3xl">📄</span>
                            <p className="mt-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 truncate max-w-[120px]">
                              {p.fileName}
                            </p>
                          </div>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.signedUrl}
                            alt={`Page ${p.pageNumber}`}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                        )}
                      </div>

                      {/* Controls Toolbar */}
                      <div className="p-2 bg-white/90 dark:bg-[#151F32]/90 backdrop-blur-xs flex items-center justify-between border-t border-slate-100 dark:border-slate-800 text-[11px]">
                        <span className="font-bold text-slate-700 dark:text-slate-300">
                          P.{p.pageNumber}
                        </span>

                        <div className="flex items-center gap-1">
                          {/* Move Up */}
                          <button
                            type="button"
                            disabled={idx === 0 || p.isUploading}
                            onClick={() => handleMovePage(idx, "up")}
                            title="Move Page Up"
                            className="w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer text-xs"
                          >
                            ←
                          </button>

                          {/* Move Down */}
                          <button
                            type="button"
                            disabled={idx === pages.length - 1 || p.isUploading}
                            onClick={() => handleMovePage(idx, "down")}
                            title="Move Page Down"
                            className="w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 cursor-pointer text-xs"
                          >
                            →
                          </button>

                          {/* Delete */}
                          <button
                            type="button"
                            disabled={p.isUploading}
                            onClick={() => handleRemovePage(idx)}
                            title="Remove Page"
                            className="w-5 h-5 rounded flex items-center justify-center text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-30 cursor-pointer text-xs font-bold ml-1"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Submission Actions */}
      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-500 dark:text-slate-400">
          {hasTypedContent && hasPages ? (
            <span>
              Ready to submit: <strong>Typed mathematical text</strong> and{" "}
              <strong>
                {pages.length} handwritten {pages.length === 1 ? "page" : "pages"}
              </strong>
            </span>
          ) : hasTypedContent ? (
            <span>
              Ready to submit: <strong>Typed mathematical solution</strong>
            </span>
          ) : hasPages ? (
            <span>
              Ready to submit:{" "}
              <strong>
                {pages.length} handwritten {pages.length === 1 ? "page" : "pages"}
              </strong>
            </span>
          ) : (
            <span className="italic">
              Provide a typed solution or attach handwritten pages above
            </span>
          )}
        </div>

        <button
          type="button"
          disabled={
            disabled ||
            isSubmitting ||
            isAnyUploading ||
            (!hasTypedContent && !hasPages)
          }
          onClick={handleSubmit}
          className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 text-white font-semibold text-xs sm:text-sm cursor-pointer transition-colors shadow-sm flex items-center gap-2"
        >
          {isSubmitting ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>Submitting Solution...</span>
            </>
          ) : (
            <span>Submit Solution</span>
          )}
        </button>
      </div>

      {/* Modal for viewing high-res image preview */}
      {previewModalUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setPreviewModalUrl(null)}
        >
          <div
            className="relative max-w-4xl w-full max-h-[90vh] bg-white dark:bg-[#151F32] rounded-2xl overflow-hidden shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
              <h4 className="text-sm font-bold text-slate-900 dark:text-[#F1F5F9]">
                {previewModalTitle}
              </h4>
              <button
                type="button"
                onClick={() => setPreviewModalUrl(null)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-900/40">
              {previewModalUrl.toLowerCase().includes(".pdf") ? (
                <iframe
                  src={previewModalUrl}
                  title={previewModalTitle}
                  className="w-full h-[75vh] rounded-lg border-0"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewModalUrl}
                  alt={previewModalTitle}
                  className="max-h-[75vh] w-auto object-contain rounded-lg shadow-md"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

