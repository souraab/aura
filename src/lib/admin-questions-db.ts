import { supabase } from "@/lib/supabase";

// ============================================================================
// Core Domain Types
// ============================================================================

export type QuestionType =
  | "MCQ"
  | "TRUE_FALSE"
  | "FILL_BLANK"
  | "SUBJECTIVE"
  | "CASE_BASED";

export type SubjectiveAnswerType = "VERY_SHORT" | "SHORT" | "LONG";

export type McqSelectionMode = "SINGLE" | "MULTIPLE";

export type DifficultyLevel = "EASY" | "MEDIUM" | "HARD";

export type QuestionStatus =
  | "DRAFT"
  | "IN_REVIEW"
  | "VERIFIED"
  | "PUBLISHED"
  | "ARCHIVED";

export interface ChapterRecord {
  id: string;
  chapter_number: number;
  name: string;
  slug: string | null;
  description: string | null;
  is_active: boolean;
  created_at?: string;
}

export interface TopicRecord {
  id: string;
  chapter_id: string;
  name: string;
  slug: string | null;
  is_active: boolean;
}

export interface CaseStudyRecord {
  id: string;
  chapter_id: string | null;
  title: string;
  passage: string;
  created_at?: string;
}

export interface QuestionOptionInput {
  id?: string;
  option_key: string; // "A", "B", "C", "D", ...
  option_text: string;
  display_order: number;
  is_correct: boolean;
}

export interface SolutionStepItem {
  step_number: number;
  title: string;
  explanation: string;
  marks?: number;
}

export interface MarkingSchemeItem {
  criterion: string;
  marks: number;
  notes?: string;
}

export interface QuestionAnswerData {
  id?: string;
  question_id?: string;
  correct_answer: Record<string, unknown> | string | null;
  model_answer: string;
  step_by_step_solution: SolutionStepItem[];
  marking_scheme: MarkingSchemeItem[];
}

export interface QuestionMediaItem {
  id?: string;
  question_id?: string;
  media_url: string;
  media_type: string;
  caption: string;
  storage_path?: string;
  placement?: "STATEMENT" | "SOLUTION" | "ATTACHMENT";
}

export interface QuestionRecord {
  id: string;
  question_code: string;
  chapter_id: string;
  chapter_name: string;
  chapter_number: number | null;
  topic_id: string | null;
  topic_name: string | null;
  case_study_id: string | null;
  case_study_title?: string | null;
  case_study_passage?: string | null;
  question_text: string;
  question_type: QuestionType;
  answer_type: SubjectiveAnswerType | null;
  mcq_mode: McqSelectionMode;
  difficulty: DifficultyLevel;
  marks: number;
  negative_marks: number;
  status: QuestionStatus;
  created_at: string;
  updated_at: string;
}

export interface QuestionDetailRecord extends QuestionRecord {
  options: QuestionOptionInput[];
  answer: QuestionAnswerData;
  media: QuestionMediaItem[];
}

export interface QuestionFormPayload {
  question_code: string;
  chapter_id: string;
  topic_id: string | null;
  new_topic_name?: string;
  case_study_id: string | null;
  case_study_title?: string;
  case_study_passage?: string;
  question_text: string;
  question_type: QuestionType;
  answer_type: SubjectiveAnswerType | null;
  mcq_mode: McqSelectionMode;
  difficulty: DifficultyLevel;
  marks: number;
  negative_marks: number;
  status: QuestionStatus;
  options: QuestionOptionInput[];
  correct_true_false: "TRUE" | "FALSE";
  correct_fill_blank: string;
  correct_subjective_summary: string;
  model_answer: string;
  step_by_step_solution: SolutionStepItem[];
  marking_scheme: MarkingSchemeItem[];
  media: QuestionMediaItem[];
}

export interface QuestionFilterParams {
  page: number;
  pageSize: number;
  search: string;
  chapterId: string;
  questionType: string;
  difficulty: string;
  status: string;
}

export interface PaginatedQuestionsResult {
  questions: QuestionRecord[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface QuestionStatsSummary {
  total: number;
  verified: number;
  published: number;
  inReview: number;
  drafts: number;
  archived: number;
}

// ============================================================================
// Schema Adaptation & Normalization Helpers
// ============================================================================

const COLUMN_FALLBACK_MAP: Record<string, Record<string, string>> = {
  chapters: {
    name: "title",
    title: "name",
    chapter_number: "order_index",
  },
  topics: {
    name: "title",
    title: "name",
  },
  case_studies: {
    passage: "content",
    content: "passage",
  },
  questions: {
    question_code: "code",
    question_text: "stem",
    answer_type: "subjective_type",
  },
  question_options: {
    option_key: "option_label",
    option_label: "label",
    option_text: "content",
    display_order: "sort_order",
    sort_order: "option_order",
  },
  question_answers: {
    step_by_step_solution: "solution_steps",
    solution_steps: "steps",
    correct_answer: "answer_key",
  },
  question_media: {
    media_url: "url",
    url: "file_url",
    caption: "alt_text",
  },
};

function extractMissingColumnFromError(message: string): string | null {
  // Matches PostgREST: Could not find the 'col_name' column of 'table' in the schema cache
  const pgrstMatch = message.match(/Could not find the '([^']+)' column/i);
  if (pgrstMatch?.[1]) return pgrstMatch[1];

  // Matches Postgres: column "col_name" of relation "table" does not exist
  const pgMatch = message.match(/column "([^"]+)" of relation/i);
  if (pgMatch?.[1]) return pgMatch[1];

  return null;
}

async function adaptiveInsertSingle(
  table: string,
  initialPayload: Record<string, unknown>
): Promise<{ data: Record<string, unknown> | null; error: Error | null }> {
  const payload: Record<string, unknown> = { ...initialPayload };
  const fallbacks = COLUMN_FALLBACK_MAP[table] || {};

  for (let attempt = 0; attempt < 10; attempt++) {
    const { data, error } = await supabase
      .from(table)
      .insert(payload)
      .select("*")
      .single();

    if (!error) {
      return { data: data as Record<string, unknown>, error: null };
    }

    const missingCol = extractMissingColumnFromError(error.message || "");
    if (missingCol && missingCol in payload) {
      const altCol = fallbacks[missingCol];
      if (altCol && !(altCol in payload)) {
        payload[altCol] = payload[missingCol];
      }
      delete payload[missingCol];
      continue;
    }

    // Handle MEDIUM <-> MODERATE enum variation if difficulty check fails
    if (
      table === "questions" &&
      (error.code === "22P02" || error.code === "23514") &&
      (error.message?.includes("difficulty") ||
        error.message?.includes("MEDIUM") ||
        error.message?.includes("MODERATE"))
    ) {
      if (payload.difficulty === "MEDIUM") {
        payload.difficulty = "MODERATE";
        continue;
      } else if (payload.difficulty === "MODERATE") {
        payload.difficulty = "MEDIUM";
        continue;
      }
    }

    // Handle answer_type enum check on non-subjective questions
    if (
      table === "questions" &&
      payload.answer_type !== null &&
      (error.code === "22P02" || error.code === "23514") &&
      error.message?.toLowerCase().includes("answer_type")
    ) {
      payload.answer_type = null;
      continue;
    }

    return {
      data: null,
      error: new Error(error.message || `Failed to insert record into ${table}.`),
    };
  }

  return {
    data: null,
    error: new Error(`Exceeded schema adaptation retries for ${table}.`),
  };
}

async function adaptiveUpdateById(
  table: string,
  idColumn: string,
  idValue: string,
  initialPayload: Record<string, unknown>
): Promise<{ data: Record<string, unknown> | null; error: Error | null }> {
  const payload: Record<string, unknown> = { ...initialPayload };
  const fallbacks = COLUMN_FALLBACK_MAP[table] || {};

  for (let attempt = 0; attempt < 10; attempt++) {
    const { data, error } = await supabase
      .from(table)
      .update(payload)
      .eq(idColumn, idValue)
      .select("*")
      .maybeSingle();

    if (!error) {
      return { data: (data as Record<string, unknown>) ?? null, error: null };
    }

    const missingCol = extractMissingColumnFromError(error.message || "");
    if (missingCol && missingCol in payload) {
      const altCol = fallbacks[missingCol];
      if (altCol && !(altCol in payload)) {
        payload[altCol] = payload[missingCol];
      }
      delete payload[missingCol];
      continue;
    }

    if (
      table === "questions" &&
      (error.code === "22P02" || error.code === "23514") &&
      (error.message?.includes("difficulty") ||
        error.message?.includes("MEDIUM") ||
        error.message?.includes("MODERATE"))
    ) {
      if (payload.difficulty === "MEDIUM") {
        payload.difficulty = "MODERATE";
        continue;
      } else if (payload.difficulty === "MODERATE") {
        payload.difficulty = "MEDIUM";
        continue;
      }
    }

    return {
      data: null,
      error: new Error(error.message || `Failed to update record in ${table}.`),
    };
  }

  return {
    data: null,
    error: new Error(`Exceeded schema adaptation retries updating ${table}.`),
  };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function generateQuestionCode(chapterNumber?: number | null): string {
  const chPart =
    chapterNumber && chapterNumber > 0
      ? `CH${String(chapterNumber).padStart(2, "0")}`
      : "M10";
  const timePart = Date.now().toString(36).slice(-4).toUpperCase();
  const randPart = Math.floor(100 + Math.random() * 900);
  return `Q-${chPart}-${timePart}${randPart}`;
}

function normalizeChapterRow(row: Record<string, unknown>): ChapterRecord {
  const rawNum =
    row.chapter_number ?? row.number ?? row.order_index ?? row.display_order ?? 1;
  const rawName = (row.name ?? row.title ?? "Untitled Chapter") as string;
  return {
    id: String(row.id),
    chapter_number: Number(rawNum) || 1,
    name: rawName,
    slug: (row.slug as string) ?? null,
    description: (row.description as string) ?? null,
    is_active: row.is_active !== undefined ? Boolean(row.is_active) : true,
    created_at: row.created_at ? String(row.created_at) : undefined,
  };
}

function normalizeTopicRow(row: Record<string, unknown>): TopicRecord {
  return {
    id: String(row.id),
    chapter_id: String(row.chapter_id),
    name: String(row.name ?? row.title ?? "General Topic"),
    slug: (row.slug as string) ?? null,
    is_active: row.is_active !== undefined ? Boolean(row.is_active) : true,
  };
}

function normalizeDifficulty(raw: unknown): DifficultyLevel {
  const upper = String(raw ?? "EASY").toUpperCase();
  if (upper === "HARD") return "HARD";
  if (upper === "MEDIUM" || upper === "MODERATE") return "MEDIUM";
  return "EASY";
}

function normalizeQuestionType(raw: unknown): QuestionType {
  const upper = String(raw ?? "MCQ").toUpperCase();
  if (
    upper === "MCQ" ||
    upper === "TRUE_FALSE" ||
    upper === "FILL_BLANK" ||
    upper === "SUBJECTIVE" ||
    upper === "CASE_BASED"
  ) {
    return upper;
  }
  if (upper.includes("CASE")) return "CASE_BASED";
  if (upper.includes("TRUE") || upper.includes("FALSE")) return "TRUE_FALSE";
  if (upper.includes("FILL") || upper.includes("BLANK")) return "FILL_BLANK";
  if (
    upper.includes("SHORT") ||
    upper.includes("LONG") ||
    upper.includes("DESC") ||
    upper.includes("SUBJ")
  ) {
    return "SUBJECTIVE";
  }
  return "MCQ";
}

function normalizeAnswerType(raw: unknown): SubjectiveAnswerType | null {
  if (!raw) return null;
  const upper = String(raw).toUpperCase();
  if (upper === "VERY_SHORT" || upper === "SHORT" || upper === "LONG") {
    return upper;
  }
  return null;
}

function normalizeStatus(raw: unknown): QuestionStatus {
  const upper = String(raw ?? "DRAFT").toUpperCase();
  if (
    upper === "DRAFT" ||
    upper === "IN_REVIEW" ||
    upper === "VERIFIED" ||
    upper === "PUBLISHED" ||
    upper === "ARCHIVED"
  ) {
    return upper;
  }
  if (upper === "PENDING" || upper === "REVIEW") return "IN_REVIEW";
  return "DRAFT";
}

// ============================================================================
// 1. CHAPTERS & TOPICS OPERATIONS
// ============================================================================

export async function fetchChapters(): Promise<ChapterRecord[]> {
  const { data, error } = await supabase.from("chapters").select("*");

  if (error) {
    throw new Error(`Failed to load chapters: ${error.message}`);
  }

  const normalized = ((data ?? []) as Record<string, unknown>[]).map(
    normalizeChapterRow
  );
  normalized.sort((a, b) => a.chapter_number - b.chapter_number);
  return normalized;
}

export async function createChapter(input: {
  chapter_number: number;
  name: string;
  description?: string;
  is_active?: boolean;
}): Promise<ChapterRecord> {
  const trimmedName = input.name.trim();
  if (!trimmedName) {
    throw new Error("Chapter name is required.");
  }

  const payload: Record<string, unknown> = {
    chapter_number: Number(input.chapter_number) || 1,
    name: trimmedName,
    slug: slugify(trimmedName),
    description: input.description?.trim() || null,
    is_active: input.is_active ?? true,
  };

  const { data, error } = await adaptiveInsertSingle("chapters", payload);
  if (error || !data) {
    throw error ?? new Error("Could not create chapter.");
  }

  return normalizeChapterRow(data);
}

export async function updateChapter(
  chapterId: string,
  input: {
    chapter_number?: number;
    name?: string;
    description?: string | null;
    is_active?: boolean;
  }
): Promise<ChapterRecord> {
  const payload: Record<string, unknown> = {};
  if (input.chapter_number !== undefined) {
    payload.chapter_number = Number(input.chapter_number) || 1;
  }
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new Error("Chapter name cannot be empty.");
    payload.name = trimmed;
    payload.slug = slugify(trimmed);
  }
  if (input.description !== undefined) {
    payload.description = input.description?.trim() || null;
  }
  if (input.is_active !== undefined) {
    payload.is_active = Boolean(input.is_active);
  }

  const { data, error } = await adaptiveUpdateById(
    "chapters",
    "id",
    chapterId,
    payload
  );
  if (error || !data) {
    throw error ?? new Error("Could not update chapter.");
  }

  return normalizeChapterRow(data);
}

export async function fetchTopics(chapterId?: string): Promise<TopicRecord[]> {
  let query = supabase.from("topics").select("*");
  if (chapterId) {
    query = query.eq("chapter_id", chapterId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load topics: ${error.message}`);
  }

  return ((data ?? []) as Record<string, unknown>[])
    .map(normalizeTopicRow)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createTopic(
  chapterId: string,
  topicName: string
): Promise<TopicRecord> {
  const trimmed = topicName.trim();
  if (!trimmed) {
    throw new Error("Topic name cannot be empty.");
  }

  const payload: Record<string, unknown> = {
    chapter_id: chapterId,
    name: trimmed,
    slug: slugify(`${chapterId.slice(0, 6)}-${trimmed}`),
    is_active: true,
  };

  const { data, error } = await adaptiveInsertSingle("topics", payload);
  if (error || !data) {
    throw error ?? new Error("Failed to create topic.");
  }

  return normalizeTopicRow(data);
}

export async function fetchCaseStudies(
  chapterId?: string
): Promise<CaseStudyRecord[]> {
  let query = supabase.from("case_studies").select("*");
  if (chapterId) {
    query = query.eq("chapter_id", chapterId);
  }
  const { data, error } = await query;
  if (error) {
    // Return empty list if case_studies has no rows or error
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    chapter_id: row.chapter_id ? String(row.chapter_id) : null,
    title: String(row.title ?? row.name ?? "Case Study"),
    passage: String(row.passage ?? row.content ?? row.case_text ?? ""),
    created_at: row.created_at ? String(row.created_at) : undefined,
  }));
}

export async function createOrUpdateCaseStudy(input: {
  id?: string | null;
  chapter_id: string;
  title: string;
  passage: string;
}): Promise<string | null> {
  const titleTrimmed = input.title.trim();
  const passageTrimmed = input.passage.trim();
  if (!titleTrimmed && !passageTrimmed) return null;

  const payload: Record<string, unknown> = {
    chapter_id: input.chapter_id,
    title: titleTrimmed || "Case Study Passage",
    passage: passageTrimmed || titleTrimmed,
  };

  if (input.id) {
    const { data, error } = await adaptiveUpdateById(
      "case_studies",
      "id",
      input.id,
      payload
    );
    if (!error && data?.id) return String(data.id);
  }

  const { data, error } = await adaptiveInsertSingle("case_studies", payload);
  if (error) {
    throw error;
  }
  return data?.id ? String(data.id) : null;
}

// ============================================================================
// 2. LOAD QUESTIONS, PAGINATION & STATISTICS
// ============================================================================

export async function fetchQuestionStatistics(): Promise<QuestionStatsSummary> {
  const { data, error } = await supabase.from("questions").select("status");

  if (error) {
    throw new Error(`Failed to load statistics: ${error.message}`);
  }

  const rows = (data ?? []) as { status?: string }[];
  let verified = 0;
  let published = 0;
  let inReview = 0;
  let drafts = 0;
  let archived = 0;

  for (const r of rows) {
    const st = normalizeStatus(r.status);
    if (st === "VERIFIED") verified++;
    else if (st === "PUBLISHED") published++;
    else if (st === "IN_REVIEW") inReview++;
    else if (st === "DRAFT") drafts++;
    else if (st === "ARCHIVED") archived++;
  }

  return {
    total: rows.length,
    verified,
    published,
    inReview,
    drafts,
    archived,
  };
}

export async function fetchPaginatedQuestions(
  params: QuestionFilterParams,
  chaptersMap: Map<string, ChapterRecord>,
  topicsMap: Map<string, TopicRecord>
): Promise<PaginatedQuestionsResult> {
  const page = Math.max(1, params.page);
  const pageSize = Math.max(1, Math.min(100, params.pageSize));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("questions")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (params.chapterId && params.chapterId !== "ALL") {
    query = query.eq("chapter_id", params.chapterId);
  }

  if (params.questionType && params.questionType !== "ALL") {
    query = query.eq("question_type", params.questionType);
  }

  if (params.difficulty && params.difficulty !== "ALL") {
    query = query.eq("difficulty", params.difficulty);
  }

  if (params.status && params.status !== "ALL") {
    query = query.eq("status", params.status);
  }

  const trimmedSearch = params.search.trim();
  if (trimmedSearch) {
    const escaped = trimmedSearch.replace(/[%_]/g, "\\$&");
    query = query.or(
      `question_code.ilike.%${escaped}%,question_text.ilike.%${escaped}%`
    );
  }

  const { data, count, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch questions: ${error.message}`);
  }

  const rawRows = (data ?? []) as Record<string, unknown>[];
  const questions: QuestionRecord[] = rawRows.map((row) => {
    const chapterId = String(row.chapter_id ?? "");
    const topicId = row.topic_id ? String(row.topic_id) : null;
    const chapterObj = chaptersMap.get(chapterId);
    const topicObj = topicId ? topicsMap.get(topicId) : undefined;

    return {
      id: String(row.id),
      question_code: String(
        row.question_code ?? row.code ?? String(row.id).slice(0, 8).toUpperCase()
      ),
      chapter_id: chapterId,
      chapter_name: chapterObj?.name ?? "Unassigned Chapter",
      chapter_number: chapterObj?.chapter_number ?? null,
      topic_id: topicId,
      topic_name: topicObj?.name ?? null,
      case_study_id: row.case_study_id ? String(row.case_study_id) : null,
      question_text: String(row.question_text ?? row.stem ?? ""),
      question_type: normalizeQuestionType(row.question_type),
      answer_type: normalizeAnswerType(row.answer_type ?? row.subjective_type),
      mcq_mode: "SINGLE",
      difficulty: normalizeDifficulty(row.difficulty),
      marks: Number(row.marks ?? 1),
      negative_marks: Number(row.negative_marks ?? 0),
      status: normalizeStatus(row.status),
      created_at: String(row.created_at ?? new Date().toISOString()),
      updated_at: String(
        row.updated_at ?? row.created_at ?? new Date().toISOString()
      ),
    };
  });

  const totalCount = count ?? questions.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return {
    questions,
    totalCount,
    page,
    pageSize,
    totalPages,
  };
}

// ============================================================================
// 3. FETCH SINGLE QUESTION DETAILS (OPTIONS, ANSWERS, MEDIA, CASE STUDY)
// ============================================================================

function parseJsonArray<T>(raw: unknown, fallback: T[]): T[] {
  if (!raw) return fallback;
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as T[];
    } catch {
      return fallback;
    }
  }
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.steps)) return obj.steps as T[];
    if (Array.isArray(obj.items)) return obj.items as T[];
    if (Array.isArray(obj.scheme)) return obj.scheme as T[];
  }
  return fallback;
}

function extractCorrectOptionKeys(correctAnswerRaw: unknown): {
  keys: Set<string>;
  texts: Set<string>;
  mode: McqSelectionMode;
} {
  const keys = new Set<string>();
  const texts = new Set<string>();
  let mode: McqSelectionMode = "SINGLE";

  if (!correctAnswerRaw) return { keys, texts, mode };

  let parsed: unknown = correctAnswerRaw;
  if (typeof correctAnswerRaw === "string") {
    try {
      parsed = JSON.parse(correctAnswerRaw);
    } catch {
      const trimmed = correctAnswerRaw.trim();
      if (/^[A-Za-z]$/.test(trimmed)) {
        keys.add(trimmed.toUpperCase());
      } else if (trimmed) {
        texts.add(trimmed);
      }
      return { keys, texts, mode };
    }
  }

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const s = String(item).trim();
      if (/^[A-Za-z]$/.test(s)) {
        keys.add(s.toUpperCase());
      } else if (s) {
        texts.add(s);
      }
    }
    if (keys.size > 1 || texts.size > 1) mode = "MULTIPLE";
    return { keys, texts, mode };
  }

  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    if (
      String(obj.selection_mode ?? obj.mode ?? "").toUpperCase() === "MULTIPLE"
    ) {
      mode = "MULTIPLE";
    }

    const keyArr =
      obj.correct_option_keys ??
      obj.correct_options ??
      obj.options ??
      obj.keys ??
      obj.value;

    if (Array.isArray(keyArr)) {
      for (const k of keyArr) {
        const s = String(k).trim();
        if (s) keys.add(s.toUpperCase());
      }
      if (keyArr.length > 1) mode = "MULTIPLE";
    } else if (typeof keyArr === "string") {
      const s = keyArr.trim();
      if (s) keys.add(s.toUpperCase());
    }

    if (Array.isArray(obj.correct_option_texts)) {
      for (const t of obj.correct_option_texts) {
        const s = String(t).trim();
        if (s) texts.add(s);
      }
    }
  }

  return { keys, texts, mode };
}

export async function fetchQuestionDetails(
  question: QuestionRecord
): Promise<QuestionDetailRecord> {
  const [optionsRes, answerRes, mediaRes, caseStudyRes] = await Promise.all([
    supabase
      .from("question_options")
      .select("*")
      .eq("question_id", question.id),
    supabase
      .from("question_answers")
      .select("*")
      .eq("question_id", question.id)
      .maybeSingle(),
    supabase
      .from("question_media")
      .select("*")
      .eq("question_id", question.id),
    question.case_study_id
      ? supabase
          .from("case_studies")
          .select("*")
          .eq("id", question.case_study_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const answerRow = (answerRes.data ?? null) as Record<string, unknown> | null;
  const rawCorrectAnswer =
    answerRow?.correct_answer ?? answerRow?.answer_key ?? null;

  const {
    keys: correctKeys,
    texts: correctTexts,
    mode: detectedMcqMode,
  } = extractCorrectOptionKeys(rawCorrectAnswer);

  const optionRows = (optionsRes.data ?? []) as Record<string, unknown>[];
  const anyRowHasExplicitIsCorrect = optionRows.some(
    (r) => r.is_correct === true
  );

  const rawOptions = optionRows.map((row, idx) => {
    const key = String(
      row.option_key ??
        row.option_label ??
        row.label ??
        String.fromCharCode(65 + idx)
    )
      .trim()
      .toUpperCase();
    const text = String(row.option_text ?? row.content ?? row.text ?? "");
    const order = Number(
      row.display_order ?? row.sort_order ?? row.option_order ?? idx + 1
    );

    let isCorrect = false;
    if (correctKeys.size > 0) {
      isCorrect = correctKeys.has(key);
    } else if (anyRowHasExplicitIsCorrect) {
      isCorrect = Boolean(row.is_correct);
    } else if (correctTexts.size > 0 && text.trim() !== "") {
      isCorrect = correctTexts.has(text.trim());
    }

    return {
      id: row.id ? String(row.id) : undefined,
      option_key: key,
      option_text: text,
      display_order: order,
      is_correct: isCorrect,
    };
  });

  rawOptions.sort((a, b) => a.display_order - b.display_order);

  if (rawOptions.length === 0 && question.question_type === "MCQ") {
    ["A", "B", "C", "D"].forEach((key, idx) => {
      rawOptions.push({
        id: undefined,
        option_key: key,
        option_text: "",
        display_order: idx + 1,
        is_correct: correctKeys.has(key),
      });
    });
  }

  // Enforce single-choice exclusivity when selection mode is SINGLE
  if (detectedMcqMode === "SINGLE") {
    let seenCorrect = false;
    for (const opt of rawOptions) {
      if (opt.is_correct) {
        if (seenCorrect) {
          opt.is_correct = false;
        } else {
          seenCorrect = true;
        }
      }
    }
  }

  const stepRaw =
    answerRow?.step_by_step_solution ??
    answerRow?.solution_steps ??
    answerRow?.steps ??
    [];
  const schemeRaw = answerRow?.marking_scheme ?? [];

  const parsedSteps = parseJsonArray<SolutionStepItem>(stepRaw, []).map(
    (item, idx) => ({
      step_number: Number(item.step_number ?? idx + 1),
      title: String(item.title ?? `Step ${idx + 1}`),
      explanation: String(item.explanation ?? ""),
      marks: item.marks !== undefined ? Number(item.marks) : undefined,
    })
  );

  const parsedScheme = parseJsonArray<MarkingSchemeItem>(schemeRaw, []).map(
    (item) => ({
      criterion: String(item.criterion ?? ""),
      marks: Number(item.marks ?? 1),
      notes: item.notes ? String(item.notes) : undefined,
    })
  );

  const answerData: QuestionAnswerData = {
    id: answerRow?.id ? String(answerRow.id) : undefined,
    question_id: question.id,
    correct_answer:
      (rawCorrectAnswer as Record<string, unknown> | string | null) ?? null,
    model_answer: String(answerRow?.model_answer ?? ""),
    step_by_step_solution: parsedSteps,
    marking_scheme: parsedScheme,
  };

  const mediaItems: QuestionMediaItem[] = (
    (mediaRes.data ?? []) as Record<string, unknown>[]
  ).map((m) => ({
    id: m.id ? String(m.id) : undefined,
    question_id: question.id,
    media_url: String(m.media_url ?? m.url ?? m.file_url ?? ""),
    media_type: String(m.media_type ?? "IMAGE"),
    caption: String(m.caption ?? m.alt_text ?? ""),
  }));

  const caseRow = (caseStudyRes.data ?? null) as Record<string, unknown> | null;

  return {
    ...question,
    mcq_mode:
      rawOptions.filter((o) => o.is_correct).length > 1
        ? "MULTIPLE"
        : detectedMcqMode,
    case_study_title: caseRow
      ? String(caseRow.title ?? caseRow.name ?? "")
      : null,
    case_study_passage: caseRow
      ? String(caseRow.passage ?? caseRow.content ?? "")
      : null,
    options: rawOptions,
    answer: answerData,
    media: mediaItems,
  };
}

// ============================================================================
// 4. CREATE, UPDATE & DELETE QUESTION (WITH OPTIONS, ANSWERS & MEDIA)
// ============================================================================

function buildCorrectAnswerJson(
  payload: QuestionFormPayload
): Record<string, unknown> {
  switch (payload.question_type) {
    case "MCQ": {
      const correctOpts = payload.options.filter((o) => o.is_correct);
      return {
        type: "MCQ",
        selection_mode: payload.mcq_mode,
        correct_option_keys: correctOpts.map((o) => o.option_key),
        correct_option_texts: correctOpts.map((o) => o.option_text.trim()),
        value:
          payload.mcq_mode === "SINGLE"
            ? (correctOpts[0]?.option_key ?? null)
            : correctOpts.map((o) => o.option_key),
      };
    }
    case "TRUE_FALSE": {
      return {
        type: "TRUE_FALSE",
        value: payload.correct_true_false,
        correct_option_keys: [payload.correct_true_false],
      };
    }
    case "FILL_BLANK": {
      const accepted = payload.correct_fill_blank
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      return {
        type: "FILL_BLANK",
        value: payload.correct_fill_blank.trim(),
        accepted_answers: accepted,
      };
    }
    case "SUBJECTIVE":
    case "CASE_BASED": {
      const correctOpts = payload.options.filter((o) => o.is_correct);
      return {
        type: payload.question_type,
        answer_type: payload.answer_type,
        value:
          payload.correct_subjective_summary.trim() ||
          payload.model_answer.trim(),
        ...(correctOpts.length > 0
          ? {
              selection_mode: payload.mcq_mode,
              correct_option_keys: correctOpts.map((o) => o.option_key),
              correct_option_texts: correctOpts.map((o) =>
                o.option_text.trim()
              ),
            }
          : {}),
      };
    }
  }
}

async function syncQuestionOptions(
  questionId: string,
  questionType: QuestionType,
  options: QuestionOptionInput[]
): Promise<void> {
  // Delete existing options for this question first so removed options are cleaned up
  const { error: deleteErr } = await supabase
    .from("question_options")
    .delete()
    .eq("question_id", questionId);

  if (deleteErr) {
    throw new Error(`Failed to update question options: ${deleteErr.message}`);
  }

  const shouldSaveOptions =
    questionType === "MCQ" ||
    (questionType === "CASE_BASED" &&
      options.some((o) => o.option_text.trim() !== "" || o.is_correct));

  if (!shouldSaveOptions) return;

  const optionsToSave =
    questionType === "MCQ"
      ? options
      : options.filter((o) => o.option_text.trim() !== "" || o.is_correct);

  for (let i = 0; i < optionsToSave.length; i++) {
    const opt = optionsToSave[i];
    const optionKey =
      opt.option_key?.trim().toUpperCase() || String.fromCharCode(65 + i);

    const optPayload: Record<string, unknown> = {
      question_id: questionId,
      option_key: optionKey,
      option_text: opt.option_text.trim(),
      display_order: i + 1,
      is_correct: Boolean(opt.is_correct),
    };

    const { error } = await adaptiveInsertSingle(
      "question_options",
      optPayload
    );
    if (error) {
      throw error;
    }
  }
}

async function syncQuestionAnswer(
  questionId: string,
  payload: QuestionFormPayload
): Promise<void> {
  const correctAnswerJson = buildCorrectAnswerJson(payload);
  const cleanSteps = payload.step_by_step_solution
    .filter((s) => s.explanation.trim() !== "" || s.title.trim() !== "")
    .map((s, idx) => ({
      step_number: idx + 1,
      title: s.title.trim() || `Step ${idx + 1}`,
      explanation: s.explanation.trim(),
      ...(s.marks !== undefined ? { marks: Number(s.marks) } : {}),
    }));

  const cleanScheme = payload.marking_scheme
    .filter((m) => m.criterion.trim() !== "")
    .map((m) => ({
      criterion: m.criterion.trim(),
      marks: Number(m.marks) || 0,
      ...(m.notes?.trim() ? { notes: m.notes.trim() } : {}),
    }));

  const answerPayload: Record<string, unknown> = {
    question_id: questionId,
    correct_answer: correctAnswerJson,
    model_answer: payload.model_answer.trim() || null,
    step_by_step_solution: cleanSteps,
    marking_scheme: cleanScheme,
  };

  // Check if an answer row already exists for this question
  const { data: existingAnswer } = await supabase
    .from("question_answers")
    .select("id, question_id")
    .eq("question_id", questionId)
    .maybeSingle();

  if (existingAnswer) {
    const { error } = await adaptiveUpdateById(
      "question_answers",
      "question_id",
      questionId,
      answerPayload
    );
    if (error) {
      throw error;
    }
  } else {
    const { error } = await adaptiveInsertSingle(
      "question_answers",
      answerPayload
    );
    if (error) {
      throw error;
    }
  }
}

async function syncQuestionMedia(
  questionId: string,
  mediaItems: QuestionMediaItem[]
): Promise<void> {
  await supabase.from("question_media").delete().eq("question_id", questionId);

  const validMedia = mediaItems.filter((m) => m.media_url.trim() !== "");
  for (const item of validMedia) {
    const mediaPayload: Record<string, unknown> = {
      question_id: questionId,
      media_url: item.media_url.trim(),
      media_type: item.media_type || "IMAGE",
      caption: item.caption.trim() || null,
    };
    const { error } = await adaptiveInsertSingle(
      "question_media",
      mediaPayload
    );
    if (error) {
      throw error;
    }
  }
}

export async function saveQuestionToDatabase(
  payload: QuestionFormPayload,
  editingQuestionId: string | null,
  chapterNumber?: number | null
): Promise<string> {
  if (!payload.chapter_id) {
    throw new Error("Please select a chapter before saving the question.");
  }
  if (!payload.question_text.trim()) {
    throw new Error("Question text is required.");
  }

  // Resolve or create topic if new_topic_name is provided
  let resolvedTopicId = payload.topic_id || null;
  if (payload.new_topic_name && payload.new_topic_name.trim() !== "") {
    const createdTopic = await createTopic(
      payload.chapter_id,
      payload.new_topic_name.trim()
    );
    resolvedTopicId = createdTopic.id;
  }

  // Resolve or create case study if question_type === "CASE_BASED"
  let resolvedCaseStudyId = payload.case_study_id || null;
  if (
    payload.question_type === "CASE_BASED" &&
    (payload.case_study_title?.trim() || payload.case_study_passage?.trim())
  ) {
    resolvedCaseStudyId = await createOrUpdateCaseStudy({
      id: payload.case_study_id,
      chapter_id: payload.chapter_id,
      title: payload.case_study_title || "Case Study",
      passage: payload.case_study_passage || "",
    });
  }

  const finalCode =
    payload.question_code.trim() || generateQuestionCode(chapterNumber);

  const effectiveAnswerType =
    payload.question_type === "SUBJECTIVE" ||
    payload.question_type === "CASE_BASED"
      ? payload.answer_type
      : null;

  const questionRowPayload: Record<string, unknown> = {
    question_code: finalCode,
    chapter_id: payload.chapter_id,
    topic_id: resolvedTopicId,
    case_study_id:
      payload.question_type === "CASE_BASED" ? resolvedCaseStudyId : null,
    question_text: payload.question_text.trim(),
    question_type: payload.question_type,
    answer_type: effectiveAnswerType,
    difficulty: payload.difficulty,
    marks: Number(payload.marks) || 1,
    negative_marks: Math.max(0, Number(payload.negative_marks) || 0),
    status: payload.status,
  };

  let savedQuestionId = editingQuestionId;

  if (editingQuestionId) {
    const { data, error } = await adaptiveUpdateById(
      "questions",
      "id",
      editingQuestionId,
      questionRowPayload
    );
    if (error) {
      throw error;
    }
    savedQuestionId = data?.id ? String(data.id) : editingQuestionId;
  } else {
    const { data, error } = await adaptiveInsertSingle(
      "questions",
      questionRowPayload
    );
    if (error || !data?.id) {
      throw error ?? new Error("Failed to create question in database.");
    }
    savedQuestionId = String(data.id);
  }

  // Sync child tables: question_options, question_answers, question_media
  await syncQuestionOptions(
    savedQuestionId,
    payload.question_type,
    payload.options
  );
  await syncQuestionAnswer(savedQuestionId, payload);
  if (payload.media.length > 0 || editingQuestionId) {
    await syncQuestionMedia(savedQuestionId, payload.media);
  }

  return savedQuestionId;
}

export async function updateQuestionWorkflowStatus(
  questionId: string,
  nextStatus: QuestionStatus
): Promise<void> {
  const { error } = await adaptiveUpdateById("questions", "id", questionId, {
    status: nextStatus,
  });
  if (error) {
    throw error;
  }
}

export async function deleteQuestionFromDatabase(
  questionId: string
): Promise<void> {
  // Explicitly delete child records first in case foreign keys do not cascade
  const [optDel, ansDel, mediaDel] = await Promise.all([
    supabase.from("question_options").delete().eq("question_id", questionId),
    supabase.from("question_answers").delete().eq("question_id", questionId),
    supabase.from("question_media").delete().eq("question_id", questionId),
  ]);

  if (optDel.error) {
    throw new Error(
      `Failed to delete question options: ${optDel.error.message}`
    );
  }
  if (ansDel.error) {
    throw new Error(
      `Failed to delete question answer: ${ansDel.error.message}`
    );
  }
  if (mediaDel.error) {
    throw new Error(
      `Failed to delete question media: ${mediaDel.error.message}`
    );
  }

  const { error } = await supabase
    .from("questions")
    .delete()
    .eq("id", questionId);

  if (error) {
    throw new Error(`Failed to delete question: ${error.message}`);
  }
}

// ============================================================================
// 5. STUDENT-SAFE QUESTION QUERY HELPER (NEVER EXPOSES CORRECT ANSWERS)
// ============================================================================

/**
 * Fetches published questions and their display options for student practice
 * without querying `public.question_answers` or exposing `is_correct`.
 */
export interface StudentPracticeOption {
  id: string;
  option_key: string;
  option_text: string;
  display_order: number;
}

export interface StudentPracticeQuestion {
  id: string;
  question_code: string;
  chapter_id: string;
  topic_id: string | null;
  question_text: string;
  question_type: QuestionType;
  difficulty: string;
  marks: number;
  negative_marks: number;
  mcq_mode: McqSelectionMode;
  options: StudentPracticeOption[];
}

export async function fetchPublishedQuestionsForStudent(params?: {
  chapterId?: string;
  topicId?: string;
  difficulty?: string;
  questionType?: string;
  limit?: number;
}): Promise<StudentPracticeQuestion[]> {
  // `questions` rows contain no answer key, so `*` is safe and tolerates column renames.
  let query = supabase
    .from("questions")
    .select("*")
    .eq("status", "PUBLISHED")
    .order("created_at", { ascending: false })
    .limit(params?.limit ?? 100);

  if (params?.chapterId && params.chapterId !== "ALL") {
    query = query.eq("chapter_id", params.chapterId);
  }

  if (params?.topicId && params.topicId !== "ALL") {
    query = query.eq("topic_id", params.topicId);
  }

  if (params?.difficulty && params.difficulty !== "ALL") {
    const diff = params.difficulty.toUpperCase();
    if (diff === "EASY") {
      query = query.in("difficulty", ["EASY"]);
    } else if (diff === "MEDIUM" || diff === "MODERATE") {
      query = query.in("difficulty", ["MEDIUM", "MODERATE"]);
    } else if (diff === "HARD" || diff === "DIFFICULT") {
      query = query.in("difficulty", ["HARD", "DIFFICULT"]);
    } else {
      query = query.eq("difficulty", diff);
    }
  }

  if (params?.questionType && params.questionType !== "ALL") {
    query = query.eq("question_type", params.questionType);
  }

  const { data: questions, error } = await query;
  if (error) {
    throw new Error(`Failed to load practice questions: ${error.message}`);
  }

  const rows = (questions ?? []) as Record<string, unknown>[];
  const questionIds = rows.map((q) => String(q.id));
  if (questionIds.length === 0) return [];

  // Student-safe option columns only (never request is_correct or question_answers)
  const optRes = await supabase
    .from("question_options")
    .select("id, question_id, option_label, option_text, display_order")
    .in("question_id", questionIds);

  if (optRes.error) {
    throw new Error(
      `Failed to load question options: ${optRes.error.message}`
    );
  }
  const optionRows = (optRes.data ?? []) as Record<string, unknown>[];

  const optionsByQuestion = new Map<string, StudentPracticeOption[]>();
  optionRows.forEach((row, idx) => {
    const qId = String(row.question_id);
    const list = optionsByQuestion.get(qId) ?? [];
    list.push({
      id: String(row.id ?? `${qId}-${idx}`),
      option_key: String(
        row.option_label ??
          row.option_key ??
          row.label ??
          String.fromCharCode(65 + list.length)
      )
        .trim()
        .toUpperCase(),
      option_text: String(row.option_text ?? row.content ?? row.text ?? ""),
      display_order: Number(
        row.display_order ?? row.sort_order ?? row.option_order ?? list.length + 1
      ),
    });
    optionsByQuestion.set(qId, list);
  });

  return rows.map((q) => ({
    id: String(q.id),
    question_code: String(q.question_code ?? q.code ?? ""),
    chapter_id: String(q.chapter_id ?? ""),
    topic_id: q.topic_id ? String(q.topic_id) : null,
    question_text: String(q.question_text ?? q.stem ?? ""),
    question_type: String(q.question_type ?? "MCQ") as QuestionType,
    difficulty: String(q.difficulty ?? "EASY"),
    marks: Number(q.marks ?? 1),
    negative_marks: Number(q.negative_marks ?? 0),
    mcq_mode: "SINGLE" as McqSelectionMode,
    options: (optionsByQuestion.get(String(q.id)) ?? []).sort(
      (a, b) => a.display_order - b.display_order
    ),
  }));
}

export interface StudentEvaluationResult {
  submitted: boolean;
  attempt_id?: string;
  attempt_number?: number;
  total_attempts?: number;
  submission_id?: string;
  submission_status?: string;
  evaluation_status?:
    | "PENDING"
    | "AI_PROCESSING"
    | "AI_SUGGESTED"
    | "TEACHER_REVIEW"
    | "FINALIZED";
  is_correct?: boolean | null;
  final_marks?: number | null;
  marks_awarded?: number | null;
  max_marks?: number;
  negative_marks?: number;
  selected_option_id?: string | null;
  selected_option_label?: string | null;
  typed_answer?: string | null;
  mode?: string;
  reveal?: boolean;
  images?: { page_number: number; storage_path: string }[];
  correct_option_ids?: string[];
  correct_keys?: string[];
  correct_option_label?: string | null;
  correct_answer_text?: string | null;
  accepted_answers?: string[];
  model_answer?: string | null;
  solution_steps?: unknown;
  feedback?: string;
}

/**
 * Submits a student's answer to the secure server-side evaluation engine.
 * Grading runs inside PostgreSQL SECURITY DEFINER rpc, ensuring answer keys
 * are never exposed to the client prior to or during evaluation.
 */
export async function submitStudentAnswer(params: {
  questionId: string;
  selectedOptionId?: string;
  answerText?: string;
  imagePaths?: string[];
  rawPayload?: string;
}): Promise<StudentEvaluationResult> {
  const payload =
    params.rawPayload ??
    JSON.stringify({
      type: params.selectedOptionId ? "MCQ" : "SUBJECTIVE",
      selected_option_id: params.selectedOptionId ?? null,
      text: params.answerText ?? null,
    });

  const { data, error } = await supabase.rpc("submit_student_answer", {
    p_question_id: params.questionId,
    p_typed_answer: payload,
    p_image_paths: params.imagePaths ?? [],
  });

  if (error) {
    throw new Error(`Evaluation failed: ${error.message}`);
  }

  return data as StudentEvaluationResult;
}

/**
 * Restores past submissions and evaluations for the specified questions.
 * Allows the student practice dashboard to persist state across page refreshes.
 */
export async function fetchStudentResults(
  questionIds: string[]
): Promise<{
  results: Record<string, StudentEvaluationResult>;
  selectedOptions: Record<string, string>;
}> {
  if (questionIds.length === 0) {
    return { results: {}, selectedOptions: {} };
  }

  const { data, error } = await supabase.rpc("get_student_results", {
    p_question_ids: questionIds,
  });

  if (error) {
    console.warn("Could not restore student past submissions:", error.message);
    return { results: {}, selectedOptions: {} };
  }

  const map = (data as Record<string, StudentEvaluationResult>) || {};
  const selectedOptions: Record<string, string> = {};

  Object.entries(map).forEach(([qId, res]) => {
    if (res.selected_option_id) {
      selectedOptions[qId] = res.selected_option_id;
    } else if (res.typed_answer) {
      try {
        const parsed = JSON.parse(res.typed_answer);
        if (parsed.value !== undefined && parsed.value !== null) {
          selectedOptions[qId] = String(parsed.value);
        } else if (parsed.text !== undefined && parsed.text !== null) {
          selectedOptions[qId] = String(parsed.text);
        }
      } catch {
        const trimmed = res.typed_answer.trim();
        if (trimmed) {
          selectedOptions[qId] = trimmed;
        }
      }
    }
  });

  return { results: map, selectedOptions };
}

/**
 * Compatibility wrapper for checkSubmittedMcqAnswer.
 * Evaluates a student's submitted option keys server-side.
 */
export async function checkSubmittedMcqAnswer(
  questionId: string,
  selectedKeys: string[]
): Promise<{ isCorrect: boolean; correctKeys: string[] } | null> {
  // If called directly, fetch options to map option key to id
  const { data: options } = await supabase
    .from("question_options")
    .select("id, option_label")
    .eq("question_id", questionId);

  const matched = (options ?? []).find(
    (o) =>
      selectedKeys.includes(String(o.option_label).toUpperCase()) ||
      selectedKeys.includes(String(o.id))
  );

  if (!matched) return null;

  try {
    const res = await submitStudentAnswer({
      questionId,
      selectedOptionId: matched.id,
    });

    return {
      isCorrect: Boolean(res.is_correct),
      correctKeys: res.correct_keys ?? (res.correct_option_label ? [res.correct_option_label] : []),
    };
  } catch (e) {
    console.warn("checkSubmittedMcqAnswer RPC failed:", e);
    return null;
  }
}

// ============================================================================
// 6. PRIVATE `question-media` SUPABASE STORAGE BUCKET HELPERS
// ============================================================================

export async function uploadDiagramToQuestionMediaBucket(
  file: File,
  placement: "STATEMENT" | "SOLUTION" | "ATTACHMENT" = "STATEMENT"
): Promise<{
  mediaUrl: string;
  previewUrl: string;
  storagePath: string;
  defaultCaption: string;
}> {
  const maxBytes = 10 * 1024 * 1024; // 10 MB
  if (file.size > maxBytes) {
    throw new Error("Diagram file size must be under 10 MB.");
  }

  const sanitizedFileName = file.name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_");
  const folder = placement.toLowerCase();
  const storagePath = `${folder}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}-${sanitizedFileName}`;

  const { error: uploadError } = await supabase.storage
    .from("question-media")
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type || "image/png",
    });

  if (uploadError) {
    throw new Error(
      `Failed to upload diagram to question-media bucket: ${uploadError.message}`
    );
  }

  const { data: signedData } = await supabase.storage
    .from("question-media")
    .createSignedUrl(storagePath, 60 * 60 * 24);

  const canonicalMediaUrl = `storage://question-media/${storagePath}`;
  const previewUrl =
    signedData?.signedUrl ||
    (typeof URL !== "undefined" ? URL.createObjectURL(file) : canonicalMediaUrl);

  const defaultCaption = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");

  return {
    mediaUrl: canonicalMediaUrl,
    previewUrl,
    storagePath,
    defaultCaption,
  };
}

export async function removeDiagramFromQuestionMediaBucket(
  mediaUrlOrPath: string
): Promise<void> {
  const trimmed = mediaUrlOrPath.trim();
  if (!trimmed) return;

  let storagePath: string | null = null;
  if (trimmed.startsWith("storage://question-media/")) {
    storagePath = trimmed.replace("storage://question-media/", "");
  } else if (trimmed.startsWith("question-media/")) {
    storagePath = trimmed.replace("question-media/", "");
  } else {
    const match = trimmed.match(
      /\/storage\/v1\/object\/(?:public|sign|authenticated)\/question-media\/([^?#]+)/i
    );
    if (match?.[1]) {
      storagePath = decodeURIComponent(match[1]);
    }
  }

  if (!storagePath) return;

  await supabase.storage.from("question-media").remove([storagePath]);
}

// ============================================================================
// 7. PRIVATE `student-submissions` SUPABASE STORAGE BUCKET HELPERS
// ============================================================================

export const ALLOWED_SUBMISSION_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/jpg",
  "application/pdf",
];

export const MAX_SUBMISSION_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_SUBMISSION_PAGES = 10;

/**
 * Uploads a single page scan or work image for a student's subjective answer.
 * Files are isolated in the private `student-submissions` bucket under `{userId}/`.
 */
export async function uploadStudentSubmissionPage(
  file: File,
  pageIndex: number
): Promise<{
  storagePath: string;
  signedUrl: string;
  pageNumber: number;
}> {
  if (file.size > MAX_SUBMISSION_FILE_SIZE) {
    throw new Error("Page file size must be 10 MB or less.");
  }

  const mime = file.type?.toLowerCase() || "";
  if (!ALLOWED_SUBMISSION_MIME_TYPES.includes(mime)) {
    throw new Error(
      "Unsupported file format. Please upload JPEG, PNG, or PDF files only."
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("You must be logged in to upload submission pages.");
  }

  const sanitizedFileName = file.name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_");

  // Path convention: <uid>/<timestamp>-p<pageIndex>-<filename>
  const storagePath = `${user.id}/${Date.now()}-p${pageIndex}-${sanitizedFileName}`;

  const { error: uploadError } = await supabase.storage
    .from("student-submissions")
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "image/jpeg",
    });

  if (uploadError) {
    throw new Error(
      `Failed to upload submission page: ${uploadError.message}`
    );
  }

  // Create signed URL for client preview (expires in 24 hours)
  const { data: signedData, error: signedError } = await supabase.storage
    .from("student-submissions")
    .createSignedUrl(storagePath, 60 * 60 * 24);

  if (signedError || !signedData?.signedUrl) {
    throw new Error("Failed to generate preview URL for uploaded page.");
  }

  return {
    storagePath,
    signedUrl: signedData.signedUrl,
    pageNumber: pageIndex,
  };
}

/**
 * Deletes an unsubmitted draft page from the private `student-submissions` bucket.
 * The database RLS policy enforces that submitted pages referenced in `submission_images`
 * cannot be deleted.
 */
export async function removeStudentSubmissionPage(
  storagePath: string
): Promise<void> {
  const trimmed = storagePath.trim();
  if (!trimmed) return;

  const cleanPath = trimmed.startsWith("student-submissions/")
    ? trimmed.replace("student-submissions/", "")
    : trimmed;

  const { error } = await supabase.storage
    .from("student-submissions")
    .remove([cleanPath]);

  if (error) {
    throw new Error(`Failed to remove draft page: ${error.message}`);
  }
}

/**
 * Generates signed read URLs for an array of submission images.
 * Useful for restoring image previews on page refresh or review.
 */
export async function getSubmissionSignedUrls(
  images: { page_number: number; storage_path: string }[],
  expiresInSeconds = 60 * 60 * 24
): Promise<{ page_number: number; storage_path: string; signedUrl: string }[]> {
  if (!images || images.length === 0) return [];

  const results: { page_number: number; storage_path: string; signedUrl: string }[] = [];

  for (const img of images) {
    const cleanPath = img.storage_path.startsWith("student-submissions/")
      ? img.storage_path.replace("student-submissions/", "")
      : img.storage_path;

    const { data, error } = await supabase.storage
      .from("student-submissions")
      .createSignedUrl(cleanPath, expiresInSeconds);

    if (!error && data?.signedUrl) {
      results.push({
        page_number: img.page_number,
        storage_path: img.storage_path,
        signedUrl: data.signedUrl,
      });
    }
  }

  return results;
}





// ============================================================================
// Competitive Mathematics Dashboard Types & Helpers
// ============================================================================

export interface CompetitiveLeaderboardEntry {
  rank: number;
  student_name: string;
  school_name: string | null;
  city: string | null;
  total_points: number;
  questions_solved: number;
  accuracy_pct: number;
  is_current_user: boolean;
}

export interface CompetitiveLeaderboardResponse {
  scope: "OVERALL" | "SCHOOL" | "CITY";
  total_competitors: number;
  leaderboard: CompetitiveLeaderboardEntry[];
  my_rank: number | null;
  my_points: number;
  my_questions_solved: number;
  my_accuracy_pct: number;
  points_to_next_rank: number | null;
  school_configured: boolean;
  school_name: string | null;
  city_configured: boolean;
  city: string | null;
  opted_in: boolean;
}

export type CompetitiveLeaderboardResult = CompetitiveLeaderboardResponse;
export type CompetitiveLeaderboardRow = CompetitiveLeaderboardEntry;

export interface VerifiedSchoolRecord {
  id: string;
  name: string;
  city: string;
  state: string;
  board: string;
}

export interface DailyTrendPoint {
  dateStr: string;
  shortDate: string;
  dayLabel: string;
  questionsAttempted: number;
  questionsFinalized: number;
  questionsSolved: number;
  accuracyPct: number;
  marksScored: number;
  hasActivity: boolean;
}

export interface SubmissionRecord {
  id: string;
  attempt_id: string;
  submission_status: string;
  submitted_at: string | null;
  created_at?: string;
}

/**
 * Pure comparator to sort submissions for an attempt:
 * 1. Genuinely submitted records (non-null, non-empty submitted_at) take precedence over drafts (null/empty submitted_at).
 * 2. Among genuinely submitted records, latest submitted_at comes first.
 * 3. Among drafts (or when submitted_at is equal), latest created_at comes first.
 * 4. Deterministic secondary tie-break by submission ID (localeCompare descending).
 */
export function compareSubmissionsForAttempt(
  a: SubmissionRecord,
  b: SubmissionRecord
): number {
  const hasSubA = Boolean(a.submitted_at && a.submitted_at.trim());
  const hasSubB = Boolean(b.submitted_at && b.submitted_at.trim());

  if (hasSubA && !hasSubB) return -1;
  if (!hasSubA && hasSubB) return 1;

  if (hasSubA && hasSubB) {
    const tA = new Date(a.submitted_at!).getTime();
    const tB = new Date(b.submitted_at!).getTime();
    if (tB !== tA) return tB - tA;
  } else {
    const tA = new Date(a.created_at || 0).getTime();
    const tB = new Date(b.created_at || 0).getTime();
    if (tB !== tA) return tB - tA;
  }

  return b.id.localeCompare(a.id);
}

/**
 * Pure function to select the active submission for an attempt.
 * Returns the latest genuinely submitted record if one exists; otherwise returns the latest draft (or null if empty).
 */
export function selectActiveSubmissionForAttempt(
  subs: SubmissionRecord[]
): SubmissionRecord | null {
  if (!subs || subs.length === 0) return null;
  const sorted = [...subs].sort(compareSubmissionsForAttempt);
  return sorted[0] || null;
}

export type RecentActivityEvaluationStatus =
  | "FINALIZED"
  | "PENDING"
  | "NOT_SUBMITTED"
  | "IN_PROGRESS";

export interface RecentSolveActivity {
  attemptId: string;
  attemptNumber: number;
  questionId: string;
  questionCode: string;
  chapterName: string;
  difficulty: DifficultyLevel;
  questionType: QuestionType;
  evaluationStatus: RecentActivityEvaluationStatus;
  marksAwarded: number | null;
  maxMarks: number;
  isCorrect: boolean | null;
  submittedAt: string;
}

export interface StudentCompetitiveOverview {
  totalPoints: number;
  totalMarksScored: number;
  questionsAttempted: number;
  questionsFinalized: number;
  questionsSolved: number;
  accuracyPct: number;
  currentStreak: number;
  pointsError?: string | null;
  sevenDayStreak: Array<{
    dayLabel: string;
    dateStr: string;
    isActive: boolean;
  }>;
  dailyTrend: DailyTrendPoint[];
  leagueTier: string;
  leagueBadgeColor: string;
  nextTierPoints: number;
  tierProgressPct: number;
  solvedByDifficulty: {
    easy: number;
    medium: number;
    hard: number;
  };
  solvedByChapter: Record<
    string,
    {
      solved: number;
      totalAttempted: number;
      totalFinalized: number;
      accuracyPct: number;
      points: number;
    }
  >;
  recentSolves: RecentSolveActivity[];
  achievements: Array<{
    code: string;
    title: string;
    description: string;
    category: "accuracy" | "streak" | "volume" | "points";
    unlocked: boolean;
    progress: number;
    maxProgress: number;
    unlockedAt?: string;
  }>;
}

/**
 * Fetches the competitive leaderboard for a given scope ('OVERALL', 'SCHOOL', 'CITY').
 * Calls the secure `get_competitive_leaderboard` RPC if available, with a resilient fallback.
 */
export async function fetchCompetitiveLeaderboard(
  scope: "OVERALL" | "SCHOOL" | "CITY" = "OVERALL",
  limit = 50
): Promise<CompetitiveLeaderboardResponse> {
  try {
    const { data, error } = await supabase.rpc(
      "get_competitive_leaderboard",
      {
        p_scope: scope,
        p_limit: limit,
      }
    );

    if (!error && data) {
      const res = data as Record<string, unknown>;
      const rawList = Array.isArray(res.leaderboard) ? res.leaderboard : [];
      const leaderboard: CompetitiveLeaderboardEntry[] = rawList.map(
        (item: Record<string, unknown>, idx: number) => ({
          rank: Number(item.rank ?? idx + 1),
          student_name: String(item.student_name ?? "Student"),
          school_name: item.school_name ? String(item.school_name) : null,
          city: item.city ? String(item.city) : null,
          total_points: Number(item.total_points ?? 0),
          questions_solved: Number(item.questions_solved ?? 0),
          accuracy_pct: Number(item.accuracy_pct ?? 0),
          is_current_user: Boolean(item.is_current_user),
        })
      );

      return {
        scope,
        total_competitors: Number(res.total_competitors ?? leaderboard.length),
        leaderboard,
        my_rank: res.my_rank !== null && res.my_rank !== undefined ? Number(res.my_rank) : null,
        my_points: Number(res.my_points ?? 0),
        my_questions_solved: Number(res.my_questions_solved ?? 0),
        my_accuracy_pct: Number(res.my_accuracy_pct ?? 0),
        points_to_next_rank:
          res.points_to_next_rank !== null && res.points_to_next_rank !== undefined
            ? Number(res.points_to_next_rank)
            : null,
        school_configured: Boolean(res.school_configured),
        school_name: res.school_name ? String(res.school_name) : null,
        city_configured: Boolean(res.city_configured),
        city: res.city ? String(res.city) : null,
        opted_in: Boolean(res.opted_in),
      };
    }
  } catch (err) {
    console.warn("get_competitive_leaderboard RPC call error; applying client fallback:", err);
  }

  // Graceful fallback structure when migration has not yet been applied to Supabase
  return {
    scope,
    total_competitors: 0,
    leaderboard: [],
    my_rank: null,
    my_points: 0,
    my_questions_solved: 0,
    my_accuracy_pct: 0,
    points_to_next_rank: null,
    school_configured: false,
    school_name: null,
    city_configured: false,
    city: null,
    opted_in: false,
  };
}

/**
 * Fetches verified schools from public.schools.
 * Gracefully falls back to representative CBSE institutions if table is not yet migrated.
 */
export async function fetchVerifiedSchools(): Promise<VerifiedSchoolRecord[]> {
  try {
    const { data, error } = await supabase
      .from("schools")
      .select("id, name, city, state, board")
      .eq("is_verified", true)
      .order("name", { ascending: true });

    if (!error && Array.isArray(data) && data.length > 0) {
      return data as VerifiedSchoolRecord[];
    }
  } catch {
    // Ignore schema error if schools table is not yet created
  }

  // Resilient fallback benchmark schools
  return [
    { id: "sch-dps-rkp", name: "Delhi Public School, R.K. Puram", city: "New Delhi", state: "Delhi", board: "CBSE" },
    { id: "sch-spv-del", name: "Sardar Patel Vidyalaya", city: "New Delhi", state: "Delhi", board: "CBSE" },
    { id: "sch-nps-blr", name: "National Public School, Indiranagar", city: "Bengaluru", state: "Karnataka", board: "CBSE" },
    { id: "sch-psbb-chn", name: "Padma Seshadri Bala Bhavan (PSBB)", city: "Chennai", state: "Tamil Nadu", board: "CBSE" },
    { id: "sch-podar-mum", name: "RN Podar School, Santacruz", city: "Mumbai", state: "Maharashtra", board: "CBSE" },
    { id: "sch-dps-hyd", name: "Delhi Public School, Hyderabad", city: "Hyderabad", state: "Telangana", board: "CBSE" },
    { id: "sch-southpoint-kol", name: "South Point High School", city: "Kolkata", state: "West Bengal", board: "CBSE" },
    { id: "sch-cms-lko", name: "City Montessori School, Gomti Nagar", city: "Lucknow", state: "Uttar Pradesh", board: "CBSE" },
    { id: "sch-xaviers-jpr", name: "St. Xavier's Senior Secondary School", city: "Jaipur", state: "Rajasthan", board: "CBSE" },
    { id: "sch-shriram-ggn", name: "The Shri Ram School, Aravali", city: "Gurugram", state: "Haryana", board: "CBSE" },
  ];
}

/**
 * Updates student's competitive preferences (opt-in and verified school affiliation).
 * Invokes the secure `set_student_competitive_profile` RPC.
 */
export async function updateStudentCompetitivePreferences(
  optIn: boolean,
  schoolId?: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "set_student_competitive_profile",
      {
        p_competitive_opt_in: optIn,
        p_school_id: schoolId || null,
      }
    );

    if (!rpcError) {
      return { success: true };
    }

    // Fallback direct update on profiles if RPC is not yet created
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user?.id) {
      const { error: profileErr } = await supabase
        .from("profiles")
        .update({
          competitive_opt_in: optIn,
          school_id: schoolId || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (!profileErr) {
        return { success: true };
      }
      return { success: false, error: profileErr.message };
    }

    return { success: false, error: rpcError.message };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Calculates a student's real competitive metrics, practice streak, difficulty distribution,
 * points, and achievements using live data from student_attempts, student_submissions,
 * evaluations, questions, and chapters.
 */
export async function fetchStudentCompetitiveOverview(
  studentId: string
): Promise<StudentCompetitiveOverview> {
  // Default metrics structure
  const overview: StudentCompetitiveOverview = {
    totalPoints: 0,
    totalMarksScored: 0,
    questionsAttempted: 0,
    questionsFinalized: 0,
    questionsSolved: 0,
    accuracyPct: 0,
    currentStreak: 0,
    sevenDayStreak: [],
    dailyTrend: [],
    leagueTier: "Pythagoras Novice",
    leagueBadgeColor: "from-amber-700 to-amber-900 border-amber-600",
    nextTierPoints: 40,
    tierProgressPct: 0,
    solvedByDifficulty: { easy: 0, medium: 0, hard: 0 },
    solvedByChapter: {},
    recentSolves: [],
    achievements: [
      {
        code: "FIRST_QUESTION",
        title: "First Step to Aryabhata",
        description: "Solve your first Class 10 CBSE mathematics problem",
        category: "volume",
        unlocked: false,
        progress: 0,
        maxProgress: 1,
      },
      {
        code: "SOLVED_10",
        title: "Problem Solver",
        description: "Successfully master 10 distinct Class 10 problems",
        category: "volume",
        unlocked: false,
        progress: 0,
        maxProgress: 10,
      },
      {
        code: "POINTS_100",
        title: "Centurion Scholar",
        description: "Accumulate 100 competitive math mastery points",
        category: "points",
        unlocked: false,
        progress: 0,
        maxProgress: 100,
      },
      {
        code: "STREAK_3",
        title: "Discipline Champion",
        description: "Maintain a continuous 3-day daily math practice streak",
        category: "streak",
        unlocked: false,
        progress: 0,
        maxProgress: 3,
      },
      {
        code: "HIGH_ACCURACY",
        title: "NCERT Precision",
        description: "Maintain 80%+ accuracy across 5 or more evaluated questions",
        category: "accuracy",
        unlocked: false,
        progress: 0,
        maxProgress: 80,
      },
      {
        code: "POINTS_500",
        title: "Ramanujan Legend",
        description: "Reach 500 competitive points and enter the Master League",
        category: "points",
        unlocked: false,
        progress: 0,
        maxProgress: 500,
      },
    ],
  };

  if (!studentId) return overview;

  try {
    // 1. Fetch all student attempts
    const { data: attempts, error: attError } = await supabase
      .from("student_attempts")
      .select("id, question_id, attempt_number, status, started_at, submitted_at")
      .eq("student_id", studentId)
      .order("started_at", { ascending: false });

    if (attError || !attempts || attempts.length === 0) {
      return overview;
    }

    const attemptIds = attempts.map((a) => a.id);
    const questionIds = Array.from(new Set(attempts.map((a) => a.question_id)));

    // 2. Fetch submissions for these attempts, ordered newest first
    const { data: submissions } = await supabase
      .from("student_submissions")
      .select("id, attempt_id, typed_answer, submission_status, submitted_at, created_at")
      .in("attempt_id", attemptIds)
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    const subMap = new Map<string, SubmissionRecord[]>();
    const allSubIds: string[] = [];
    if (submissions) {
      for (const s of submissions) {
        allSubIds.push(s.id);
        const existing = subMap.get(s.attempt_id) || [];
        existing.push({
          id: s.id,
          attempt_id: s.attempt_id,
          submission_status: (s.submission_status as string) || "SUBMITTED",
          submitted_at: (s.submitted_at as string) || null,
          created_at: (s.created_at as string) || "",
        });
        subMap.set(s.attempt_id, existing);
      }

      // Deterministic tie-breaking: prioritize genuine submissions over drafts, then newest first
      for (const [attId, subsList] of subMap.entries()) {
        subsList.sort(compareSubmissionsForAttempt);
        subMap.set(attId, subsList);
      }
    }

    // 3. Fetch evaluations for these submissions
    const evalMap = new Map<
      string,
      {
        evaluation_status: string;
        final_marks: number | null;
        stepwise_feedback: Record<string, unknown> | null;
        evaluated_at: string | null;
      }
    >();

    if (allSubIds.length > 0) {
      const { data: evals } = await supabase
        .from("evaluations")
        .select("id, submission_id, evaluation_status, final_marks, stepwise_feedback, evaluated_at")
        .in("submission_id", allSubIds)
        .order("evaluated_at", { ascending: false, nullsFirst: false });

      if (evals) {
        for (const e of evals) {
          evalMap.set(e.submission_id, {
            evaluation_status: e.evaluation_status,
            final_marks: typeof e.final_marks === "number" ? e.final_marks : null,
            stepwise_feedback:
              typeof e.stepwise_feedback === "object" && e.stepwise_feedback !== null
                ? (e.stepwise_feedback as Record<string, unknown>)
                : null,
            evaluated_at: e.evaluated_at,
          });
        }
      }
    }

    // 4. Fetch question metadata
    const questionMap = new Map<
      string,
      {
        id: string;
        question_code: string;
        chapter_id: string;
        question_type: QuestionType;
        difficulty: DifficultyLevel;
        marks: number;
      }
    >();

    if (questionIds.length > 0) {
      const { data: qRows } = await supabase
        .from("questions")
        .select("id, question_code, chapter_id, question_type, difficulty, marks")
        .in("id", questionIds);

      if (qRows) {
        for (const q of qRows) {
          questionMap.set(q.id, {
            id: q.id,
            question_code: q.question_code || "Q-10",
            chapter_id: q.chapter_id,
            question_type: (q.question_type as QuestionType) || "MCQ",
            difficulty: (q.difficulty as DifficultyLevel) || "EASY",
            marks: typeof q.marks === "number" ? q.marks : 1,
          });
        }
      }
    }

    // 5. Fetch chapter names
    const chapterIds = Array.from(
      new Set(
        Array.from(questionMap.values())
          .map((q) => q.chapter_id)
          .filter(Boolean)
      )
    );
    const chapterNameMap = new Map<string, string>();

    if (chapterIds.length > 0) {
      const { data: chRows } = await supabase
        .from("chapters")
        .select("id, name")
        .in("id", chapterIds);

      if (chRows) {
        for (const ch of chRows) {
          chapterNameMap.set(ch.id, ch.name);
        }
      }
    }

    // 6. Fetch authoritative points exclusively from student_points_ledger
    const pointsLedgerMap = new Map<string, number>();
    let pointsError: string | null = null;

    const { data: ledgerRows, error: ledgerError } = await supabase
      .from("student_points_ledger")
      .select("question_id, points_awarded")
      .eq("student_id", studentId);

    if (ledgerError) {
      console.error("Failed to query student_points_ledger:", ledgerError);
      pointsError = `Failed to query student_points_ledger: ${ledgerError.message}`;
    } else if (ledgerRows) {
      for (const row of ledgerRows) {
        pointsLedgerMap.set(row.question_id, Number(row.points_awarded) || 0);
      }
    }

    // 7. Aggregate distinct question outcomes
    // Each distinct question attempted by the student is aggregated exactly once,
    // avoiding duplicate counting across multiple attempts or submissions.
    const questionOutcomes = new Map<
      string,
      {
        questionId: string;
        isFinalized: boolean;
        isMastered: boolean;
        difficulty: DifficultyLevel;
        chapterId: string;
        attemptsCount: number;
        bestMarks: number;
        maxMarks: number;
        latestSubmittedAt: string;
      }
    >();

    for (const att of attempts) {
      const q = questionMap.get(att.question_id);
      if (!q) continue;

      const subs = subMap.get(att.id) || [];
      let isAttemptFinalized = false;
      let isAttemptCorrect = false;
      let marksAwarded = 0;
      let submittedDate = att.submitted_at || att.started_at;

      for (const sub of subs) {
        if (sub.submitted_at) submittedDate = sub.submitted_at;
        const ev = evalMap.get(sub.id);
        if (ev && ev.evaluation_status === "FINALIZED") {
          isAttemptFinalized = true;
          const marks = ev.final_marks ?? 0;
          if (marks > marksAwarded) marksAwarded = marks;

          const isObj = ["MCQ", "TRUE_FALSE", "FILL_BLANK"].includes(q.question_type);
          if (isObj) {
            const fb = ev.stepwise_feedback;
            if (fb && typeof fb.is_correct === "boolean") {
              if (fb.is_correct) isAttemptCorrect = true;
            } else if (marks >= q.marks && q.marks > 0) {
              isAttemptCorrect = true;
            }
          } else {
            // Subjective questions require 100% full marks
            if (marks >= q.marks && q.marks > 0) {
              isAttemptCorrect = true;
            }
          }
        }
      }

      const existingOutcome = questionOutcomes.get(q.id);
      if (!existingOutcome) {
        questionOutcomes.set(q.id, {
          questionId: q.id,
          isFinalized: isAttemptFinalized,
          isMastered: isAttemptCorrect,
          difficulty: q.difficulty,
          chapterId: q.chapter_id,
          attemptsCount: 1,
          bestMarks: marksAwarded,
          maxMarks: q.marks,
          latestSubmittedAt: submittedDate,
        });
      } else {
        existingOutcome.attemptsCount += 1;
        if (isAttemptFinalized) existingOutcome.isFinalized = true;
        if (isAttemptCorrect) existingOutcome.isMastered = true;
        if (marksAwarded > existingOutcome.bestMarks) existingOutcome.bestMarks = marksAwarded;
        if (new Date(submittedDate) > new Date(existingOutcome.latestSubmittedAt)) {
          existingOutcome.latestSubmittedAt = submittedDate;
        }
      }
    }

    // 8. Compute Mastered Solves and Points
    let totalComputedPoints = 0;
    let easySolved = 0;
    let mediumSolved = 0;
    let hardSolved = 0;
    let totalSolved = 0;
    let totalFinalized = 0;
    const distinctAttemptedCount = questionOutcomes.size;

    const chapterStats: Record<
      string,
      {
        solved: number;
        totalAttempted: number;
        totalFinalized: number;
        accuracyPct: number;
        points: number;
      }
    > = {};

    for (const outcome of questionOutcomes.values()) {
      const chName = chapterNameMap.get(outcome.chapterId) || "Mathematics";
      if (!chapterStats[chName]) {
        chapterStats[chName] = {
          solved: 0,
          totalAttempted: 0,
          totalFinalized: 0,
          accuracyPct: 0,
          points: 0,
        };
      }
      chapterStats[chName].totalAttempted += 1;

      if (outcome.isFinalized) {
        totalFinalized += 1;
        chapterStats[chName].totalFinalized += 1;
      }

      if (outcome.isFinalized && outcome.isMastered) {
        totalSolved += 1;
        chapterStats[chName].solved += 1;

        // Competitive XP comes exclusively from student_points_ledger
        const questionPoints = pointsLedgerMap.get(outcome.questionId) ?? 0;
        chapterStats[chName].points += questionPoints;

        if (outcome.difficulty === "HARD") hardSolved += 1;
        else if (outcome.difficulty === "MEDIUM") mediumSolved += 1;
        else easySolved += 1;
      }
    }

    // Compute chapter accuracy percentage strictly based on finalized evaluated questions
    for (const ch of Object.values(chapterStats)) {
      ch.accuracyPct =
        ch.totalFinalized > 0
          ? Math.round((ch.solved / ch.totalFinalized) * 100)
          : 0;
    }

    // Competitive XP comes exclusively from student_points_ledger.
    // If the ledger contains no entries, finalPoints is strictly 0.
    const finalPoints = Array.from(pointsLedgerMap.values()).reduce(
      (sum, p) => sum + p,
      0
    );

    // 9. Calculate Daily Streak
    const activeDates = new Set<string>();
    for (const a of attempts) {
      if (a.started_at) {
        activeDates.add(a.started_at.substring(0, 10));
      }
    }

    let streak = 0;
    const now = new Date();
    const todayStr = now.toISOString().substring(0, 10);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayStr = yesterday.toISOString().substring(0, 10);

    let checkDate = activeDates.has(todayStr) ? now : activeDates.has(yesterdayStr) ? yesterday : null;

    if (checkDate) {
      while (true) {
        const dStr = checkDate.toISOString().substring(0, 10);
        if (activeDates.has(dStr)) {
          streak += 1;
          checkDate = new Date(checkDate.getTime() - 24 * 60 * 60 * 1000);
        } else {
          break;
        }
      }
    }

    // 10. Determine League Tier
    let leagueTier = "Pythagoras Novice";
    let leagueBadgeColor = "from-amber-700 to-amber-900 border-amber-600";
    let nextTierPoints = 40;
    let tierProgressPct = Math.min(100, Math.round((finalPoints / 40) * 100));

    if (finalPoints >= 500) {
      leagueTier = "Ramanujan Legend";
      leagueBadgeColor = "from-amber-400 via-yellow-300 to-amber-500 border-yellow-200 text-slate-950 shadow-yellow-500/20";
      nextTierPoints = 1000;
      tierProgressPct = 100;
    } else if (finalPoints >= 250) {
      leagueTier = "Euler Master";
      leagueBadgeColor = "from-cyan-500 via-sky-400 to-blue-600 border-cyan-300 shadow-cyan-500/20";
      nextTierPoints = 500;
      tierProgressPct = Math.min(100, Math.round(((finalPoints - 250) / 250) * 100));
    } else if (finalPoints >= 100) {
      leagueTier = "Aryabhata Scholar";
      leagueBadgeColor = "from-purple-600 via-violet-500 to-indigo-600 border-purple-400 shadow-purple-500/20";
      nextTierPoints = 250;
      tierProgressPct = Math.min(100, Math.round(((finalPoints - 100) / 150) * 100));
    } else if (finalPoints >= 40) {
      leagueTier = "Bhaskara Challenger";
      leagueBadgeColor = "from-slate-400 via-slate-300 to-zinc-400 border-slate-200 text-slate-950 shadow-slate-400/20";
      nextTierPoints = 100;
      tierProgressPct = Math.min(100, Math.round(((finalPoints - 40) / 60) * 100));
    }

    // 11. Compile Recent Solves (Attempt-based, preserving separate genuine attempts)
    const recentSolves: RecentSolveActivity[] = [];
    const sortedAttempts = [...attempts]
      .sort((a, b) => {
        const timeA = new Date(a.submitted_at || a.started_at || 0).getTime();
        const timeB = new Date(b.submitted_at || b.started_at || 0).getTime();
        if (timeB !== timeA) return timeB - timeA;
        const numA = Number((a as Record<string, unknown>).attempt_number) || 0;
        const numB = Number((b as Record<string, unknown>).attempt_number) || 0;
        if (numB !== numA) return numB - numA;
        return String(b.id).localeCompare(String(a.id));
      })
      .slice(0, 8);

    for (const att of sortedAttempts) {
      const q = questionMap.get(att.question_id);
      if (!q) continue;

      const chName = chapterNameMap.get(q.chapter_id) || "Mathematics";
      const subs = subMap.get(att.id) || [];
      const latestSub = selectActiveSubmissionForAttempt(subs);
      const ev = latestSub ? evalMap.get(latestSub.id) : null;

      let evalStatus: RecentActivityEvaluationStatus = "NOT_SUBMITTED";
      let marksAwarded: number | null = null;
      let isCorrect: boolean | null = null;

      if (!latestSub || !latestSub.submitted_at) {
        evalStatus = att.status === "IN_PROGRESS" ? "IN_PROGRESS" : "NOT_SUBMITTED";
      } else if (!ev) {
        evalStatus = "PENDING";
      } else {
        const upperStatus = String(ev.evaluation_status || "").toUpperCase();
        if (upperStatus === "FINALIZED") {
          evalStatus = "FINALIZED";
          marksAwarded = typeof ev.final_marks === "number" ? ev.final_marks : 0;
          const isObj = ["MCQ", "TRUE_FALSE", "FILL_BLANK"].includes(q.question_type);
          if (isObj) {
            const fb = ev.stepwise_feedback;
            if (fb && typeof fb.is_correct === "boolean") {
              isCorrect = Boolean(fb.is_correct);
            } else {
              isCorrect = marksAwarded >= q.marks && q.marks > 0;
            }
          } else {
            isCorrect = marksAwarded >= q.marks && q.marks > 0;
          }
        } else if (upperStatus === "PENDING" || upperStatus === "IN_REVIEW" || upperStatus === "SUBMITTED") {
          evalStatus = "PENDING";
          marksAwarded = null;
          isCorrect = null;
        } else {
          evalStatus = "PENDING";
          marksAwarded = null;
          isCorrect = null;
        }
      }

      recentSolves.push({
        attemptId: att.id,
        attemptNumber: Number((att as Record<string, unknown>).attempt_number) || 1,
        questionId: q.id,
        questionCode: q.question_code,
        chapterName: chName,
        difficulty: q.difficulty,
        questionType: q.question_type,
        evaluationStatus: evalStatus,
        marksAwarded,
        maxMarks: q.marks,
        isCorrect,
        submittedAt: (latestSub?.submitted_at) || att.submitted_at || att.started_at || new Date().toISOString(),
      });
    }

    // 12. Evaluate Dynamic Achievements
    // Evaluated Accuracy: Correctly solved finalized questions / total finalized evaluated questions * 100
    // Pending evaluations must NOT enter the denominator.
    const accuracy =
      totalFinalized > 0
        ? Math.round((totalSolved / totalFinalized) * 1000) / 10
        : 0;

    const achievements = overview.achievements.map((ach) => {
      let progress = 0;
      let unlocked = false;

      if (ach.code === "FIRST_QUESTION") {
        progress = Math.min(1, totalSolved);
        unlocked = totalSolved >= 1;
      } else if (ach.code === "SOLVED_10") {
        progress = Math.min(10, totalSolved);
        unlocked = totalSolved >= 10;
      } else if (ach.code === "POINTS_100") {
        progress = Math.min(100, finalPoints);
        unlocked = finalPoints >= 100;
      } else if (ach.code === "STREAK_3") {
        progress = Math.min(3, streak);
        unlocked = streak >= 3;
      } else if (ach.code === "HIGH_ACCURACY") {
        progress = Math.min(80, Math.round(accuracy));
        unlocked = accuracy >= 80 && totalFinalized >= 5;
      } else if (ach.code === "POINTS_500") {
        progress = Math.min(500, finalPoints);
        unlocked = finalPoints >= 500;
      }

      return {
        ...ach,
        progress,
        unlocked,
      };
    });

    // 13. Total marks scored across all evaluated questions
    const totalMarksScored = Array.from(questionOutcomes.values()).reduce(
      (sum, o) => sum + (o.bestMarks || 0),
      0
    );

    // 14. Compute 7-day daily activity trend & streak dots based on actual records
    const dayLabels = ["S", "M", "T", "W", "T", "F", "S"];
    const dailyTrend: DailyTrendPoint[] = [];
    const sevenDayStreak: Array<{ dayLabel: string; dateStr: string; isActive: boolean }> = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().substring(0, 10);
      const shortDate = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const dayLabel = dayLabels[d.getDay()];

      const dayAttempts = attempts.filter(
        (a) => (a.started_at && a.started_at.substring(0, 10) === dateStr) ||
               (a.submitted_at && a.submitted_at.substring(0, 10) === dateStr)
      );

      // Distinct questions attempted on this day
      const dayQIds = Array.from(new Set(dayAttempts.map((a) => a.question_id)));
      const dayQuestionsAttempted = dayQIds.length;
      let dayQuestionsFinalized = 0;
      let dayQuestionsSolved = 0;
      let dayMarksScored = 0;

      for (const qId of dayQIds) {
        const q = questionMap.get(qId);
        const qAttemptsOnDay = dayAttempts.filter((a) => a.question_id === qId);
        let qFinalizedOnDay = false;
        let qSolvedOnDay = false;

        for (const att of qAttemptsOnDay) {
          const subs = subMap.get(att.id) || [];
          for (const sub of subs) {
            const ev = evalMap.get(sub.id);
            if (ev && ev.evaluation_status === "FINALIZED") {
              qFinalizedOnDay = true;
              const marks = ev.final_marks ?? 0;
              dayMarksScored += marks;
              if (q) {
                const isObj = ["MCQ", "TRUE_FALSE", "FILL_BLANK"].includes(q.question_type);
                if (isObj) {
                  if (ev.stepwise_feedback && typeof ev.stepwise_feedback.is_correct === "boolean") {
                    if (ev.stepwise_feedback.is_correct) qSolvedOnDay = true;
                  } else if (marks >= q.marks && q.marks > 0) {
                    qSolvedOnDay = true;
                  }
                } else {
                  if (marks >= q.marks && q.marks > 0) {
                    qSolvedOnDay = true;
                  }
                }
              }
            }
          }
        }

        if (qFinalizedOnDay) {
          dayQuestionsFinalized += 1;
          if (qSolvedOnDay) {
            dayQuestionsSolved += 1;
          }
        }
      }

      // Pending evaluations on this day do NOT enter the denominator
      const dayAccuracy =
        dayQuestionsFinalized > 0
          ? Math.round((dayQuestionsSolved / dayQuestionsFinalized) * 100)
          : 0;

      const hasActivity = dayQuestionsAttempted > 0;

      dailyTrend.push({
        dateStr,
        shortDate,
        dayLabel,
        questionsAttempted: dayQuestionsAttempted,
        questionsFinalized: dayQuestionsFinalized,
        questionsSolved: dayQuestionsSolved,
        accuracyPct: dayAccuracy,
        marksScored: dayMarksScored,
        hasActivity,
      });

      sevenDayStreak.push({
        dayLabel,
        dateStr,
        isActive: hasActivity,
      });
    }

    return {
      totalPoints: finalPoints,
      totalMarksScored,
      questionsAttempted: distinctAttemptedCount,
      questionsFinalized: totalFinalized,
      questionsSolved: totalSolved,
      accuracyPct: accuracy,
      currentStreak: streak,
      sevenDayStreak,
      dailyTrend,
      leagueTier,
      leagueBadgeColor,
      nextTierPoints,
      tierProgressPct,
      solvedByDifficulty: {
        easy: easySolved,
        medium: mediumSolved,
        hard: hardSolved,
      },
      solvedByChapter: chapterStats,
      recentSolves,
      achievements,
      pointsError,
    };
  } catch (err) {
    console.error("Error computing competitive overview:", err);
    return {
      ...overview,
      pointsError: err instanceof Error ? err.message : "Error computing competitive overview",
    };
  }
}
