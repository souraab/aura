import re
import sys

def main():
    with open("supabase/migrations/20261113_subjective_phase1_1_hotfix.sql") as f:
        sql = f.read()

    print("==================================================================")
    print(" MathPractice: Subjective Hotfix Migration SQL Validator")
    print("==================================================================")

    # 1. Structural checks
    lines = [l.strip() for l in sql.splitlines() if l.strip()]
    assert lines[0].startswith("--"), "Header comment missing"
    non_comment = [l for l in lines if not l.startswith("--")]

    assert non_comment[0] == "BEGIN;", f"Expected BEGIN; got {non_comment[0]}"
    assert non_comment[-1] == "COMMIT;", f"Expected COMMIT; got {non_comment[-1]}"
    print("[PASS] Transaction envelope (BEGIN; ... COMMIT;)")

    # 2. Check dollar quotes
    dquotes = re.findall(r"\$\$", sql)
    assert len(dquotes) == 4, f"Expected 4 $$, found {len(dquotes)}"
    print("[PASS] Dollar quotes paired correctly (count: 4)")

    # 3. Check for any user_id
    assert "user_id" not in sql, "Found unexpected user_id"
    print("[PASS] Zero user_id references in file")

    # 4. Check function block endings
    fn_blocks = re.findall(r"AS\s*\$\$(.*?)\$\$;", sql, re.DOTALL)
    assert len(fn_blocks) == 2, f"Expected 2 function bodies, found {len(fn_blocks)}"

    for idx, body in enumerate(fn_blocks):
        fn_name = "get_student_result" if idx == 0 else "submit_student_answer"
        stripped = body.strip()
        assert stripped.endswith("END;"), f"{fn_name} body does not end with END;, ends with: {stripped[-15:]}"
        print(f"[PASS] {fn_name} outer block correctly terminated with END; before $$;")

    # 5. Check nested block balancing inside both function bodies
    def check_nested_blocks(body, fn_name):
        clean = re.sub(r"--[^\n]*", "", body)
        clean = re.sub(r"\x27[^\x27]*\x27", "x", clean)
        
        # Check IF ... END IF
        opening_ifs = len(re.findall(r"(?<!\bEND\s)(?<!\bELS)\bIF\b", clean, re.IGNORECASE))
        end_ifs = len(re.findall(r"\bEND\s+IF\b", clean, re.IGNORECASE))
        assert opening_ifs == end_ifs, f"{fn_name}: Mismatched IF/END IF (IF: {opening_ifs}, END IF: {end_ifs})"
        print(f"[PASS] {fn_name}: opening IF ({opening_ifs}) strictly matches END IF ({end_ifs})")
        
        # Check LOOP ... END LOOP
        opening_loops = len(re.findall(r"(?<!\bEND\s)\bLOOP\b", clean, re.IGNORECASE))
        end_loops = len(re.findall(r"\bEND\s+LOOP\b", clean, re.IGNORECASE))
        assert opening_loops == end_loops, f"{fn_name}: Mismatched LOOP/END LOOP (LOOP: {opening_loops}, END LOOP: {end_loops})"
        print(f"[PASS] {fn_name}: opening LOOP ({opening_loops}) strictly matches END LOOP ({end_loops})")
        
        # Check BEGIN ... END;
        begins = len(re.findall(r"\bBEGIN\b", clean, re.IGNORECASE))
        standalone_ends = len(re.findall(r"\bEND\s*;", clean, re.IGNORECASE))
        assert begins == standalone_ends, f"{fn_name}: Mismatched BEGIN/END; (BEGIN: {begins}, Block END;: {standalone_ends})"
        print(f"[PASS] {fn_name}: BEGIN ({begins}) strictly matches standalone Block END; ({standalone_ends})")

    for idx, body in enumerate(fn_blocks):
        fn_name = "get_student_result" if idx == 0 else "submit_student_answer"
        check_nested_blocks(body, fn_name)

    # 6. Check Permissions
    assert "REVOKE ALL ON FUNCTION public.submit_student_answer(text, text, text[]) FROM public, anon;" in sql
    assert "REVOKE ALL ON FUNCTION public.get_student_result(text, integer) FROM public, anon;" in sql
    assert "GRANT EXECUTE ON FUNCTION public.submit_student_answer(text, text, text[]) TO authenticated;" in sql
    assert "GRANT EXECUTE ON FUNCTION public.get_student_result(text, integer) TO authenticated;" in sql
    print("[PASS] Function grants and revokes correctly matched to signatures")

    print("\nALL HOTFIX SQL VALIDATIONS PASSED WITH EXIT CODE 0.")

if __name__ == "__main__":
    main()
