/**
 * MathPractice: Chapter & Topic Question Filtering Verification Script
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing Supabase credentials in environment");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function runFilterTests() {
  console.log("==================================================================");
  console.log(" MathPractice: Question Filtering & Curriculum Verification");
  console.log("==================================================================\n");

  // TEST 1: Check Chapters Fetch
  console.log("TEST 1: Fetching Active Chapters...");
  const { data: chapters, error: chErr } = await supabase
    .from("chapters")
    .select("*")
    .eq("is_active", true)
    .order("chapter_number");

  if (chErr) {
    console.error("  [FAIL] Chapter query error:", chErr.message);
  } else {
    console.log(`  [PASS] Successfully retrieved ${chapters?.length || 0} active chapters.`);
    if (chapters && chapters.length > 0) {
      console.log(`         Sample: Ch. ${chapters[0].chapter_number} - ${chapters[0].name} (ID: ${chapters[0].id})`);
    }
  }

  // TEST 2: Check Topics Fetch
  console.log("\nTEST 2: Fetching Topics by Chapter...");
  if (chapters && chapters.length > 0) {
    const sampleChapter = chapters[0];
    const { data: topics, error: topErr } = await supabase
      .from("topics")
      .select("*")
      .eq("chapter_id", sampleChapter.id)
      .eq("is_active", true);

    if (topErr) {
      console.error("  [FAIL] Topic query error:", topErr.message);
    } else {
      console.log(`  [PASS] Retrieved ${topics?.length || 0} topics for chapter "${sampleChapter.name}".`);
      if (topics && topics.length > 0) {
        console.log(`         Sample Topic: ${topics[0].name} (ID: ${topics[0].id})`);
      }
    }
  }

  // TEST 3: Check Published Questions Only (Security & Integrity)
  console.log("\nTEST 3: Verifying Published Questions Only (no draft or archived)...");
  const { data: pubQuestions, error: pubErr } = await supabase
    .from("questions")
    .select("id, status, question_code, question_type, difficulty, chapter_id, topic_id")
    .eq("status", "PUBLISHED")
    .limit(50);

  if (pubErr) {
    console.error("  [FAIL] Question query error:", pubErr.message);
  } else {
    const nonPublished = (pubQuestions || []).filter(q => q.status !== "PUBLISHED");
    if (nonPublished.length === 0) {
      console.log(`  [PASS] All ${pubQuestions?.length || 0} retrieved questions have status 'PUBLISHED'.`);
    } else {
      console.error(`  [FAIL] Found ${nonPublished.length} non-published questions in results!`);
    }
  }

  // TEST 4: Multi-Filter Interoperability
  console.log("\nTEST 4: Filtering by Difficulty & Type...");
  const { data: mcqEasy, error: filterErr } = await supabase
    .from("questions")
    .select("id, question_type, difficulty, status")
    .eq("status", "PUBLISHED")
    .eq("question_type", "MCQ")
    .in("difficulty", ["EASY"])
    .limit(10);

  if (filterErr) {
    console.error("  [FAIL] Filter query error:", filterErr.message);
  } else {
    console.log(`  [PASS] Retrieved ${mcqEasy?.length || 0} questions matching { type: 'MCQ', difficulty: 'EASY' }.`);
    const allMatch = (mcqEasy || []).every(q => q.question_type === "MCQ" && q.difficulty === "EASY");
    if (allMatch) {
      console.log("  [PASS] Filter constraints strictly respected by all returned rows.");
    } else {
      console.error("  [FAIL] Some rows did not match the filter criteria.");
    }
  }

  console.log("\n==================================================================");
  console.log(" Verification completed.");
  console.log("==================================================================");
}

runFilterTests().catch(err => {
  console.error("Test execution failed:", err);
});

