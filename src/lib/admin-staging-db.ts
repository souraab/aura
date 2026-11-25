import { supabase } from "@/lib/supabase";
import type {
  QuestionType,
  SubjectiveAnswerType,
  DifficultyLevel,
  QuestionOptionInput,
} from "@/lib/admin-questions-db";

// ============================================================================
// Core Staging Domain Types
// ============================================================================

export type IngestionBatchStatus =
  | "PENDING"
  | "IN_REVIEW"
  | "APPROVED"
  | "COMPLETED"
  | "ARCHIVED";

export type StagingReviewStatus =
  | "PENDING"
  | "IN_REVIEW"
  | "NEEDS_CORRECTION"
  | "ACCEPTED"
  | "EDITED"
  | "REJECTED"
  | "PROMOTING"
  | "PROMOTED";

export type TriageReviewCategory = "CATEGORY_A" | "CATEGORY_B" | "CATEGORY_C";

export interface ValidationCheckResultItem {
  check_name: string;
  status: "PASS" | "WARNING" | "FAIL" | "NOT_APPLICABLE";
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface DiagramRecord {
  diagram_id: string;
  source_page: number;
  bbox?: number[];
  storage_path?: string;
  storage_url?: string;
  caption?: string;
  width?: number;
  height?: number;
}

export interface IngestionBatchRecord {
  id: string;
  pdf_storage_path: string;
  pdf_filename: string;
  pdf_file_hash: string;
  pdf_file_size_bytes: number;
  pdf_mime_type: string;
  extractor_backend: string;
  total_pages: number;
  total_questions: number;
  extraction_failures_count: number;
  high_confidence_count: number;
  promoted_count: number;
  status: IngestionBatchStatus;
  metadata: Record<string, unknown>;
  triage_summary?: Record<string, unknown>;
  created_by: string | null;
  organization_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface StagingQuestionRecord {
  id: string;
  batch_id: string;
  candidate_id: string;
  source_page_number: number;
  detected_question_label: string;
  question_heading: string | null;
  section: string | null;
  inferred_type: QuestionType;
  candidate_question_text: string;
  content_hash: string;
  detected_options: Array<{
    key: string;
    text: string;
    is_correct?: boolean;
  }>;
  detected_subparts: Array<{
    label: string;
    text: string;
  }>;
  detected_answer: string | null;
  detected_solution: string | null;
  detected_diagrams: DiagramRecord[];
  original_extracted_text: string;
  extraction_warnings: string[];
  has_extraction_failures: boolean;
  extraction_confidence: number;
  review_category?: TriageReviewCategory | null;
  quality_breakdown?: Record<string, number>;
  validation_checks?: Record<string, ValidationCheckResultItem>;
  inspection_targets?: string[];
  gate_failures?: string[];
  category_reasons?: string[];
  target_chapter_id: string | null;
  target_topic_id: string | null;
  target_difficulty: DifficultyLevel;
  target_marks: number;
  target_negative_marks: number;
  review_status: StagingReviewStatus;
  review_notes: string | null;
  assigned_to?: string | null;
  specialist_review_required?: boolean;
  promoted_question_id: string | null;
  promotion_token: string | null;
  promotion_generation: number;
  promotion_started_at: string | null;
  promotion_expires_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StagingQuestionFilter {
  review_status?: StagingReviewStatus | "ALL";
  has_failures?: boolean;
  min_confidence?: number;
  search_query?: string;
  chapter_id?: string;
}

export interface LeaseAcquisitionResult {
  acquired: boolean;
  promotion_token: string | null;
  promotion_generation: number;
  promotion_expires_at: string | null;
  message: string;
}

export interface PromotionOverrides {
  target_chapter_id?: string;
  target_topic_id?: string | null;
  candidate_question_text?: string;
  inferred_type?: QuestionType;
  answer_type?: SubjectiveAnswerType | null;
  target_difficulty?: DifficultyLevel;
  target_marks?: number;
  target_negative_marks?: number;
  question_code?: string;
  detected_options?: Array<{ key: string; text: string; is_correct?: boolean }>;
  detected_diagrams?: DiagramRecord[];
}

export interface DuplicateMatchResult {
  question_id: string;
  question_code: string;
  question_text: string;
  similarity_score: number;
  chapter_id: string;
}

// ============================================================================
// Staging Batches Data Access
// ============================================================================

export async function fetchIngestionBatches(
  limit = 20,
  offset = 0,
  status?: IngestionBatchStatus
): Promise<{ batches: IngestionBatchRecord[]; total: number }> {
  let query = supabase
    .from("ingestion_batches")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, count, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch ingestion batches: ${error.message}`);
  }

  return {
    batches: (data || []) as IngestionBatchRecord[],
    total: count || 0,
  };
}

export async function fetchIngestionBatchById(
  batchId: string
): Promise<IngestionBatchRecord | null> {
  const { data, error } = await supabase
    .from("ingestion_batches")
    .select("*")
    .eq("id", batchId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch ingestion batch ${batchId}: ${error.message}`);
  }

  return (data as IngestionBatchRecord) || null;
}

export interface CreateIngestionBatchParams {
  file: File;
  targetChapterId?: string | null;
  sourceName?: string;
  notes?: string;
}

export interface IngestionBatchStatsSummary {
  totalBatches: number;
  pendingOrProcessing: number;
  completedOrReview: number;
  requiringAttention: number;
}

/**
 * Computes live batch metrics across all ingestion batches in Supabase.
 */
export async function fetchIngestionBatchStatistics(): Promise<IngestionBatchStatsSummary> {
  const { data, error } = await supabase
    .from("ingestion_batches")
    .select("status, extraction_failures_count");

  if (error || !data) {
    return {
      totalBatches: 0,
      pendingOrProcessing: 0,
      completedOrReview: 0,
      requiringAttention: 0,
    };
  }

  let pendingOrProcessing = 0;
  let completedOrReview = 0;
  let requiringAttention = 0;

  for (const b of data) {
    const status = String(b.status || "").toUpperCase();
    if (status === "PENDING") {
      pendingOrProcessing++;
    } else if (
      status === "IN_REVIEW" ||
      status === "APPROVED" ||
      status === "COMPLETED"
    ) {
      completedOrReview++;
    }
    if (Number(b.extraction_failures_count ?? 0) > 0) {
      requiringAttention++;
    }
  }

  return {
    totalBatches: data.length,
    pendingOrProcessing,
    completedOrReview,
    requiringAttention,
  };
}

/**
 * Computes the SHA-256 hash of a file in the browser using the native Web Crypto API.
 */
export async function computeFileSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validates, uploads a source PDF to `question-media/ingestion/{batch_id}/source.pdf`,
 * and registers the corresponding batch record in `public.ingestion_batches`.
 */
export async function uploadSourcePdfAndCreateBatch(
  params: CreateIngestionBatchParams,
  onProgress?: (progressPercent: number) => void
): Promise<IngestionBatchRecord> {
  const { file, targetChapterId, sourceName, notes } = params;

  // 1. Validate file constraints
  const maxBytes = 50 * 1024 * 1024; // 50 MB (matches storage bucket configuration)
  if (file.size > maxBytes) {
    throw new Error(
      `PDF file size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 50 MB storage bucket limit.`
    );
  }

  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Only PDF files are supported for ingestion.");
  }

  onProgress?.(10);

  // 2. Compute SHA-256 hash
  const fileHash = await computeFileSha256(file);
  onProgress?.(25);

  // 3. Generate batch UUID and permanent storage path
  const batchId = crypto.randomUUID();
  const storagePath = `ingestion/${batchId}/source.pdf`;

  // 4. Upload PDF to private Supabase storage bucket `question-media`
  onProgress?.(45);
  const { error: uploadError } = await supabase.storage
    .from("question-media")
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: "application/pdf",
    });

  if (uploadError) {
    throw new Error(`Failed to upload source PDF to storage: ${uploadError.message}`);
  }

  onProgress?.(80);

  // 5. Insert batch record into public.ingestion_batches
  const metadata: Record<string, unknown> = {
    source_name: sourceName?.trim() || null,
    target_chapter_id: targetChapterId || null,
    notes: notes?.trim() || null,
    client: "admin-web-dashboard",
    uploaded_at: new Date().toISOString(),
  };

  const { data: batchData, error: dbError } = await supabase
    .from("ingestion_batches")
    .insert({
      id: batchId,
      pdf_storage_path: storagePath,
      pdf_filename: file.name,
      pdf_file_hash: fileHash,
      pdf_file_size_bytes: file.size,
      pdf_mime_type: "application/pdf",
      extractor_backend: "MacPDFKit2D",
      total_pages: 1,
      total_questions: 0,
      extraction_failures_count: 0,
      high_confidence_count: 0,
      promoted_count: 0,
      status: "PENDING",
      metadata,
    })
    .select("*")
    .single();

  if (dbError) {
    // Clean up uploaded file if database record insertion fails
    await supabase.storage.from("question-media").remove([storagePath]);
    throw new Error(`Failed to record ingestion batch in database: ${dbError.message}`);
  }

  onProgress?.(100);
  return batchData as IngestionBatchRecord;
}

/**
 * Creates a signed download/view URL for an ingestion source PDF.
 */
export async function getSourcePdfSignedUrl(
  storagePath: string,
  expiresInSeconds = 3600
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from("question-media")
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data) {
    return null;
  }
  return data.signedUrl;
}

// ============================================================================
// Staging Questions Data Access
// ============================================================================

export async function fetchStagingQuestions(
  batchId: string,
  filter?: StagingQuestionFilter
): Promise<StagingQuestionRecord[]> {
  let query = supabase
    .from("staging_questions")
    .select("*")
    .eq("batch_id", batchId)
    .order("source_page_number", { ascending: true })
    .order("created_at", { ascending: true });

  if (filter?.review_status && filter.review_status !== "ALL") {
    query = query.eq("review_status", filter.review_status);
  }
  if (filter?.has_failures !== undefined) {
    query = query.eq("has_extraction_failures", filter.has_failures);
  }
  if (filter?.min_confidence !== undefined) {
    query = query.gte("extraction_confidence", filter.min_confidence);
  }
  if (filter?.chapter_id) {
    query = query.eq("target_chapter_id", filter.chapter_id);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch staging questions: ${error.message}`);
  }

  let results = (data || []) as StagingQuestionRecord[];

  if (filter?.search_query && filter.search_query.trim() !== "") {
    const q = filter.search_query.toLowerCase().trim();
    results = results.filter(
      (sq) =>
        sq.candidate_question_text.toLowerCase().includes(q) ||
        sq.detected_question_label.toLowerCase().includes(q) ||
        (sq.question_heading && sq.question_heading.toLowerCase().includes(q))
    );
  }

  return results;
}

export async function fetchStagingQuestionById(
  stagingId: string
): Promise<StagingQuestionRecord | null> {
  const { data, error } = await supabase
    .from("staging_questions")
    .select("*")
    .eq("id", stagingId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch staging question ${stagingId}: ${error.message}`);
  }

  return (data as StagingQuestionRecord) || null;
}

// ============================================================================
// Staging Question Curation & Workflow
// ============================================================================

export async function updateStagingQuestionCuration(
  stagingId: string,
  updates: Partial<
    Pick<
      StagingQuestionRecord,
      | "target_chapter_id"
      | "target_topic_id"
      | "target_difficulty"
      | "target_marks"
      | "target_negative_marks"
      | "candidate_question_text"
      | "question_heading"
      | "inferred_type"
      | "detected_options"
      | "detected_subparts"
      | "detected_answer"
      | "detected_solution"
      | "review_status"
      | "review_notes"
    >
  >
): Promise<void> {
  const { error } = await supabase
    .from("staging_questions")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("id", stagingId);

  if (error) {
    throw new Error(`Failed to update curation for staging question ${stagingId}: ${error.message}`);
  }
}

export async function rejectStagingQuestion(
  stagingId: string,
  reason?: string
): Promise<void> {
  await updateStagingQuestionCuration(stagingId, {
    review_status: "REJECTED",
    review_notes: reason || "Rejected by administrator",
  });
}

// ============================================================================
// Atomic Lease Fencing & Promotion Service
// ============================================================================

/**
 * Atomically acquires or takes over a 5-minute promotion lease on a staging question.
 * Generates a unique UUID promotion_token and increments promotion_generation.
 */
export async function acquirePromotionLease(
  stagingId: string,
  leaseDurationSeconds = 300
): Promise<LeaseAcquisitionResult> {
  const { data, error } = await supabase.rpc("acquire_promotion_lease", {
    p_staging_id: stagingId,
    p_lease_duration_seconds: leaseDurationSeconds,
  });

  if (error) {
    throw new Error(`Lease acquisition RPC failed: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error("No response returned from lease acquisition RPC.");
  }

  return {
    acquired: Boolean(row.acquired),
    promotion_token: row.promotion_token ? String(row.promotion_token) : null,
    promotion_generation: Number(row.promotion_generation) || 0,
    promotion_expires_at: row.promotion_expires_at ? String(row.promotion_expires_at) : null,
    message: String(row.message || ""),
  };
}

/**
 * Promotes a staging question to production in a single atomic database transaction.
 * Validates promotion_token, promotion_generation, and lease expiration.
 * Recovers previously created questions via questions.staging_id if partial failure occurred.
 */
export async function promoteStagingQuestionAtomic(
  stagingId: string,
  promotionToken: string,
  promotionGeneration: number,
  overrides: PromotionOverrides = {}
): Promise<string> {
  const { data, error } = await supabase.rpc("promote_staging_question_atomic", {
    p_staging_id: stagingId,
    p_promotion_token: promotionToken,
    p_promotion_generation: promotionGeneration,
    p_overrides: overrides,
  });

  if (error) {
    throw new Error(`Atomic promotion RPC failed: ${error.message}`);
  }

  if (!data) {
    throw new Error("Atomic promotion did not return a question ID.");
  }

  return String(data);
}

/**
 * High-level promotion orchestration method:
 * 1. Acquires lease with generation fencing token.
 * 2. Invokes atomic promotion RPC.
 * 3. Returns production question UUID.
 */
export async function promoteStagingQuestion(
  stagingId: string,
  overrides: PromotionOverrides = {}
): Promise<string> {
  const lease = await acquirePromotionLease(stagingId);
  if (!lease.acquired || !lease.promotion_token) {
    throw new Error(lease.message || "Failed to acquire exclusive promotion lease.");
  }

  return await promoteStagingQuestionAtomic(
    stagingId,
    lease.promotion_token,
    lease.promotion_generation,
    overrides
  );
}

// ============================================================================
// Duplicate Question Detection Against Production
// ============================================================================

/**
 * Normalizes question text for similarity comparisons:
 * Lowercases, strips punctuation, normalizes LaTeX whitespace.
 */
export function normalizeQuestionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\\[a-zA-Z]+/g, " ") // Normalize LaTeX commands
    .replace(/[^a-z0-9]/g, " ")   // Replace non-alphanumeric with spaces
    .replace(/\s+/g, " ")         // Collapse whitespace
    .trim();
}

/**
 * Calculates Jaccard similarity of word sets between two strings.
 */
function calculateJaccardSimilarity(strA: string, strB: string): number {
  const wordsA = new Set(strA.split(" ").filter((w) => w.length > 2));
  const wordsB = new Set(strB.split(" ").filter((w) => w.length > 2));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }

  const union = wordsA.size + wordsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Checks for potential duplicate production questions matching candidate text.
 * Compares normalized text without altering or adding columns to public.questions.
 */
export async function detectProductionDuplicateMatches(
  candidateText: string,
  chapterId?: string | null,
  minSimilarity = 0.7
): Promise<DuplicateMatchResult[]> {
  const normalizedCandidate = normalizeQuestionText(candidateText);
  if (!normalizedCandidate || normalizedCandidate.length < 10) {
    return [];
  }

  // Fetch production questions (optionally scoped to chapter)
  let query = supabase
    .from("questions")
    .select("id, question_code, question_text, chapter_id")
    .limit(100);

  if (chapterId) {
    query = query.eq("chapter_id", chapterId);
  }

  const { data, error } = await query;
  if (error || !data) {
    return [];
  }

  const matches: DuplicateMatchResult[] = [];
  for (const q of data) {
    const normProd = normalizeQuestionText(q.question_text || "");
    const score = calculateJaccardSimilarity(normalizedCandidate, normProd);
    if (score >= minSimilarity) {
      matches.push({
        question_id: q.id,
        question_code: q.question_code,
        question_text: q.question_text,
        similarity_score: Math.round(score * 100) / 100,
        chapter_id: q.chapter_id,
      });
    }
  }

  return matches.sort((a, b) => b.similarity_score - a.similarity_score);
}

