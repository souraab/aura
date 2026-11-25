#!/usr/bin/env python3
"""
Generates a representative Class 10 Mathematics PDF fixture for ingestion testing.
Pure Python implementation without external dependencies (PDF 1.4 compliant).
"""

import sys
import os

def create_sample_cbse_math_pdf(output_path: str):
    pages = [
        # PAGE 1: Section A (MCQs and Assertion-Reason)
        """CLASS X MATHEMATICS - PRACTICE PAPER
SECTION A (Multiple Choice Questions)

Q. 1 The HCF of 96 and 404 is:
(A) 2
(B) 4
(C) 6
(D) 8
Ans: (B) 4

Q. 2 If alpha and beta are the zeroes of the quadratic polynomial f(x) = x^2 - 5x + k such that alpha - beta = 1, then the value of k is:
(A) 6   (B) 12   (C) -6   (D) 4
Answer: (A)

Q. 3 For what value of k will the system of equations 2x + 3y = 7 and (k-1)x + (k+2)y = 3k have infinitely many solutions?
(A) k = 5
(B) k = 7
(C) k = 1
(D) k = -7

Q. 4 The distance of the point P(-6, 8) from the origin is:
(A) 8
(B) 2\sqrt{7}
(C) 10
(D) 6
Ans: (C) 10
Explanation: Distance = \sqrt{(-6)^2 + 8^2} = \sqrt{36 + 64} = \sqrt{100} = 10 units.""",

        # PAGE 2: Section B & C (Subjective Questions with Mathematical Expressions)
        """SECTION B & C (Subjective Questions)

Q. 5 Prove that \sqrt{5} is an irrational number.
Solution:
Let us assume, to the contrary, that \sqrt{5} is rational.
Then there exist coprime integers a and b (b != 0) such that:
\sqrt{5} = a / b
Squaring both sides:
5 = a^2 / b^2  =>  5b^2 = a^2
Therefore, 5 divides a^2, which implies 5 divides a.
Let a = 5c for some integer c.
5b^2 = (5c)^2 = 25c^2  =>  b^2 = 5c^2
This implies 5 divides b^2, hence 5 divides b.
Thus, 5 is a common factor of a and b, contradicting that a and b are coprime.
Hence, \sqrt{5} is irrational.

Q. 6 In an Arithmetic Progression, if the sum of the first 7 terms is 49 and that of 17 terms is 289, find:
(i) The first term (a) and common difference (d).
(ii) The sum of the first n terms (S_n).
(iii) The 20th term of this AP.

Q. 7 A malformed question statement without clear boundary and missing options""",

        # PAGE 3: Section E (Case Based Questions with Passage and Subparts)
        """SECTION E (Case Study Based Questions)

Case Study 1: Solar Power Project
A school decided to install solar panels on its roof to promote renewable energy. The panels are arranged in a triangular grid array where the number of panels in successive rows forms an AP. The 1st row has 3 panels, the 2nd row has 5 panels, and the 3rd row has 7 panels.

Based on the above information, answer the following questions:
(i) Write the common difference of the AP formed by the number of panels in rows.
(ii) If there are 15 rows in total, how many solar panels are installed in the 15th row?
(iii) Find the total number of solar panels installed in all 15 rows.
Solution:
(i) Common difference d = 5 - 3 = 2.
(ii) a_15 = a + 14d = 3 + 14(2) = 3 + 28 = 31 panels.
(iii) S_15 = (15/2)[2(3) + 14(2)] = (15/2)[6 + 28] = (15/2)(34) = 15 * 17 = 255 panels."""
    ]

    objects = []
    objects.append('<< /Type /Catalog /Pages 2 0 R >>') # Obj 1
    objects.append('') # Obj 2 (Pages placeholder)
    objects.append('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>') # Obj 3

    page_ids = []
    for text in pages:
        escaped_lines = []
        y = 770
        for raw_line in text.split('\n'):
            line = raw_line.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
            escaped_lines.append(f'1 0 0 1 45 {y} Tm ({line}) Tj')
            y -= 14
            if y < 40:
                break
        stream_data = 'BT /F1 9 Tf ' + ' '.join(escaped_lines) + ' ET'
        stream_bytes = stream_data.encode('latin1')
        c_id = len(objects) + 1
        objects.append(f'<< /Length {len(stream_bytes)} >>\nstream\n{stream_data}\nendstream')
        p_id = len(objects) + 1
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents {c_id} 0 R /Resources << /Font << /F1 3 0 R >> >> >>')
        page_ids.append(f'{p_id} 0 R')

    kids_str = ' '.join(page_ids)
    objects[1] = f'<< /Type /Pages /Kids [ {kids_str} ] /Count {len(page_ids)} >>'

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, 'wb') as f:
        f.write(b'%PDF-1.4\n')
        offsets = [0]
        for i, obj in enumerate(objects):
            offsets.append(f.tell())
            f.write(f'{i+1} 0 obj\n{obj}\nendobj\n'.encode('latin1'))

        xref_offset = f.tell()
        f.write(b'xref\n')
        f.write(f'0 {len(objects)+1}\n'.encode('latin1'))
        f.write(b'0000000000 65535 f \n')
        for off in offsets[1:]:
            f.write(f'{off:010d} 00000 n \n'.encode('latin1'))

        f.write(b'trailer\n')
        f.write(f'<< /Size {len(objects)+1} /Root 1 0 R >>\n'.encode('latin1'))
        f.write(b'startxref\n')
        f.write(f'{xref_offset}\n%%EOF\n'.encode('latin1'))

    print(f"Sample CBSE Mathematics PDF generated at: {output_path}")

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "scripts/ingestion/sample_math_paper.pdf"
    create_sample_cbse_math_pdf(out)

