"use client";

import React, { useRef, useState } from "react";
import {
  MathContentRenderer,
  renderLatexExpression,
} from "@/components/math-renderer";

// ============================================================================
// Mathematical Palette Categories & Visual Templates (9 Standard Categories)
// ============================================================================

export interface MathPaletteItem {
  label: string;
  title: string;
  latex: string;
  block?: boolean;
  previewLatex?: string;
}

export type MathCategoryKey =
  | "arithmetic"
  | "fractions_roots"
  | "powers_subscripts"
  | "algebra"
  | "trigonometry"
  | "geometry"
  | "matrices"
  | "calculus"
  | "inequalities_greek";

export const MATH_PALETTE_CATEGORIES: {
  key: MathCategoryKey;
  label: string;
  items: MathPaletteItem[];
}[] = [
  {
    key: "arithmetic",
    label: "Arithmetic Operators",
    items: [
      {
        label: "+",
        title: "Addition (+)",
        latex: "+",
        previewLatex: "+",
      },
      {
        label: "−",
        title: "Subtraction (−)",
        latex: "-",
        previewLatex: "-",
      },
      {
        label: "×",
        title: "Multiplication (\\times)",
        latex: "\\times",
        previewLatex: "\\times",
      },
      {
        label: "÷",
        title: "Division (\\div)",
        latex: "\\div",
        previewLatex: "\\div",
      },
      {
        label: "·",
        title: "Dot Product / Center Dot (\\cdot)",
        latex: "\\cdot",
        previewLatex: "\\cdot",
      },
      {
        label: "=",
        title: "Equals (=)",
        latex: "=",
        previewLatex: "=",
      },
      {
        label: "≠",
        title: "Not Equal (\\neq)",
        latex: "\\neq",
        previewLatex: "\\neq",
      },
      {
        label: "≤",
        title: "Less Than or Equal (\\le)",
        latex: "\\le",
        previewLatex: "\\le",
      },
      {
        label: "≥",
        title: "Greater Than or Equal (\\ge)",
        latex: "\\ge",
        previewLatex: "\\ge",
      },
      {
        label: "±",
        title: "Plus or Minus (\\pm)",
        latex: "\\pm",
        previewLatex: "\\pm",
      },
      {
        label: "2×3+4÷2",
        title: "Combined Arithmetic Expression",
        latex: "2 \\times 3 + 4 \\div 2",
        previewLatex: "2 \\times 3 + 4 \\div 2",
      },
    ],
  },
  {
    key: "fractions_roots",
    label: "Fractions and Roots",
    items: [
      {
        label: "a/b",
        title: "Fraction (\\frac{a}{b})",
        latex: "\\frac{a}{b}",
        previewLatex: "\\frac{a}{b}",
      },
      {
        label: "(x+1)/(x-1)",
        title: "Algebraic Fraction",
        latex: "\\frac{x+1}{x-1}",
        previewLatex: "\\frac{x+1}{x-1}",
      },
      {
        label: "Nested Fraction",
        title: "Nested Fraction (\\frac{a/b}{c/d})",
        latex: "\\frac{\\frac{a}{b}}{\\frac{c}{d}}",
        previewLatex: "\\frac{\\frac{a}{b}}{\\frac{c}{d}}",
      },
      {
        label: "√x",
        title: "Square Root (\\sqrt{x})",
        latex: "\\sqrt{x}",
        previewLatex: "\\sqrt{x}",
      },
      {
        label: "√(x²+1)",
        title: "Square Root of Polynomial (\\sqrt{x^2+1})",
        latex: "\\sqrt{x^2+1}",
        previewLatex: "\\sqrt{x^2+1}",
      },
      {
        label: "³√(x²+8)",
        title: "Cube Root (\\sqrt[3]{x^2+8})",
        latex: "\\sqrt[3]{x^2+8}",
        previewLatex: "\\sqrt[3]{x^2+8}",
      },
      {
        label: "ⁿ√x",
        title: "nth Root (\\sqrt[n]{x})",
        latex: "\\sqrt[n]{x}",
        previewLatex: "\\sqrt[n]{x}",
      },
      {
        label: "√(1+√x)",
        title: "Nested Radical (\\sqrt{1+\\sqrt{x}})",
        latex: "\\sqrt{1+\\sqrt{x}}",
        previewLatex: "\\sqrt{1+\\sqrt{x}}",
      },
    ],
  },
  {
    key: "powers_subscripts",
    label: "Powers and Subscripts",
    items: [
      {
        label: "x²",
        title: "Square / Superscript 2 (x^2)",
        latex: "x^{2}",
        previewLatex: "x^{2}",
      },
      {
        label: "x³",
        title: "Cube / Superscript 3 (x^3)",
        latex: "x^{3}",
        previewLatex: "x^{3}",
      },
      {
        label: "xⁿ",
        title: "Power / Exponent (x^n)",
        latex: "x^{n}",
        previewLatex: "x^{n}",
      },
      {
        label: "aₙ",
        title: "Subscript (a_n)",
        latex: "a_{n}",
        previewLatex: "a_{n}",
      },
      {
        label: "aₙ₊₁",
        title: "Compound Subscript (a_{n+1})",
        latex: "a_{n+1}",
        previewLatex: "a_{n+1}",
      },
      {
        label: "x₁²",
        title: "Simultaneous Subscript and Superscript (x_1^2)",
        latex: "x_{1}^{2}",
        previewLatex: "x_{1}^{2}",
      },
      {
        label: "eˣ",
        title: "Exponential Power (e^x)",
        latex: "e^{x}",
        previewLatex: "e^{x}",
      },
      {
        label: "10⁻³",
        title: "Negative Exponent (10^{-3})",
        latex: "10^{-3}",
        previewLatex: "10^{-3}",
      },
    ],
  },
  {
    key: "algebra",
    label: "Algebra",
    items: [
      {
        label: "Quadratic Formula",
        title: "Quadratic Formula",
        latex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
        previewLatex: "\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
      },
      {
        label: "b²−4ac",
        title: "Discriminant (D = b^2 - 4ac)",
        latex: "D = b^2 - 4ac",
        previewLatex: "b^2 - 4ac",
      },
      {
        label: "AP nth Term",
        title: "nth Term of an Arithmetic Progression",
        latex: "a_n = a + (n-1)d",
        previewLatex: "a_n = a + (n-1)d",
      },
      {
        label: "AP Sum Sₙ",
        title: "Sum of first n terms of an AP",
        latex: "S_n = \\frac{n}{2}[2a + (n-1)d]",
        previewLatex: "S_n = \\frac{n}{2}[2a+(n-1)d]",
      },
      {
        label: "Distance Formula",
        title: "Coordinate Distance Formula",
        latex: "\\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}",
        previewLatex: "\\sqrt{(x_2-x_1)^2+(y_2-y_1)^2}",
      },
      {
        label: "Section Formula",
        title: "Internal Section Formula",
        latex:
          "\\left(\\frac{m_1 x_2 + m_2 x_1}{m_1 + m_2}, \\frac{m_1 y_2 + m_2 y_1}{m_1 + m_2}\\right)",
        previewLatex: "\\frac{m_1 x_2 + m_2 x_1}{m_1 + m_2}",
      },
      {
        label: "Piecewise f(x)",
        title: "Piecewise Function with 2 Conditions",
        latex:
          "f(x) = \\begin{cases} x^2 + 1 & \\text{if } x \\ge 0 \\\\ -2x & \\text{if } x < 0 \\end{cases}",
        block: true,
        previewLatex:
          "\\begin{cases} x^2+1 & x\\ge 0 \\\\ -2x & x<0 \\end{cases}",
      },
    ],
  },
  {
    key: "trigonometry",
    label: "Trigonometry",
    items: [
      {
        label: "sin θ",
        title: "Sine of theta",
        latex: "\\sin\\theta",
        previewLatex: "\\sin\\theta",
      },
      {
        label: "cos θ",
        title: "Cosine of theta",
        latex: "\\cos\\theta",
        previewLatex: "\\cos\\theta",
      },
      {
        label: "tan θ",
        title: "Tangent of theta",
        latex: "\\tan\\theta",
        previewLatex: "\\tan\\theta",
      },
      {
        label: "cot θ",
        title: "Cotangent of theta",
        latex: "\\cot\\theta",
        previewLatex: "\\cot\\theta",
      },
      {
        label: "sec θ",
        title: "Secant of theta",
        latex: "\\sec\\theta",
        previewLatex: "\\sec\\theta",
      },
      {
        label: "csc θ",
        title: "Cosecant of theta",
        latex: "\\csc\\theta",
        previewLatex: "\\csc\\theta",
      },
      {
        label: "sin²θ + cos²θ = 1",
        title: "Pythagorean Trigonometric Identity",
        latex: "\\sin^2\\theta + \\cos^2\\theta = 1",
        previewLatex: "\\sin^2\\theta + \\cos^2\\theta = 1",
      },
      {
        label: "1 + tan²θ = sec²θ",
        title: "Secant-Tangent Identity",
        latex: "1 + \\tan^2\\theta = \\sec^2\\theta",
        previewLatex: "1 + \\tan^2\\theta = \\sec^2\\theta",
      },
      {
        label: "90° − θ",
        title: "Complementary Angle",
        latex: "(90^\\circ - \\theta)",
        previewLatex: "90^\\circ - \\theta",
      },
    ],
  },
  {
    key: "geometry",
    label: "Geometry and Mensuration",
    items: [
      {
        label: "△ABC",
        title: "Triangle ABC (\\triangle ABC)",
        latex: "\\triangle ABC",
        previewLatex: "\\triangle ABC",
      },
      {
        label: "∠ABC",
        title: "Angle ABC (\\angle ABC)",
        latex: "\\angle ABC",
        previewLatex: "\\angle ABC",
      },
      {
        label: "90°",
        title: "Degrees (90^\\circ)",
        latex: "90^\\circ",
        previewLatex: "90^\\circ",
      },
      {
        label: "⊥",
        title: "Perpendicular (\\perp)",
        latex: "\\perp",
        previewLatex: "AB \\perp CD",
      },
      {
        label: "∥",
        title: "Parallel (\\parallel)",
        latex: "\\parallel",
        previewLatex: "DE \\parallel BC",
      },
      {
        label: "≅",
        title: "Congruent to (\\cong)",
        latex: "\\cong",
        previewLatex: "\\cong",
      },
      {
        label: "∼",
        title: "Similar to (\\sim)",
        latex: "\\sim",
        previewLatex: "\\triangle ABC \\sim \\triangle DEF",
      },
      {
        label: "AB̄",
        title: "Line Segment AB (\\overline{AB})",
        latex: "\\overline{AB}",
        previewLatex: "\\overline{AB}",
      },
      {
        label: "πr²",
        title: "Area of Circle (\\pi r^2)",
        latex: "\\pi r^2",
        previewLatex: "\\pi r^2",
      },
      {
        label: "4/3 πr³",
        title: "Volume of Sphere",
        latex: "\\frac{4}{3}\\pi r^3",
        previewLatex: "\\frac{4}{3}\\pi r^3",
      },
    ],
  },
  {
    key: "matrices",
    label: "Matrices and Determinants",
    items: [
      {
        label: "2×2 [ ] Matrix",
        title: "2×2 Bracket Matrix (\\begin{bmatrix})",
        latex: "\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}",
        block: true,
        previewLatex: "\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}",
      },
      {
        label: "3×3 [ ] Matrix",
        title: "3×3 Bracket Matrix",
        latex:
          "\\begin{bmatrix} a_{11} & a_{12} & a_{13} \\\\ a_{21} & a_{22} & a_{23} \\\\ a_{31} & a_{32} & a_{33} \\end{bmatrix}",
        block: true,
        previewLatex:
          "\\begin{bmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{bmatrix}",
      },
      {
        label: "2×2 ( ) Matrix",
        title: "2×2 Parenthesis Matrix (\\begin{pmatrix})",
        latex: "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",
        block: true,
        previewLatex: "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",
      },
      {
        label: "2×2 | | Determinant",
        title: "2×2 Determinant (\\begin{vmatrix})",
        latex: "\\begin{vmatrix} a_1 & b_1 \\\\ a_2 & b_2 \\end{vmatrix}",
        block: true,
        previewLatex: "\\begin{vmatrix} a_1 & b_1 \\\\ a_2 & b_2 \\end{vmatrix}",
      },
      {
        label: "3×3 | | Determinant",
        title: "3×3 Determinant",
        latex:
          "\\begin{vmatrix} x_1 & y_1 & 1 \\\\ x_2 & y_2 & 1 \\\\ x_3 & y_3 & 1 \\end{vmatrix}",
        block: true,
        previewLatex:
          "\\begin{vmatrix} x_1 & y_1 & 1 \\\\ x_2 & y_2 & 1 \\\\ x_3 & y_3 & 1 \\end{vmatrix}",
      },
      {
        label: "Piecewise { Cases",
        title: "Piecewise Function (\\begin{cases})",
        latex:
          "f(x) = \\begin{cases} x^2 + 1 & \\text{if } x \\ge 0 \\\\ -2x & \\text{if } x < 0 \\end{cases}",
        block: true,
        previewLatex:
          "\\begin{cases} x^2+1 & x\\ge 0 \\\\ -2x & x<0 \\end{cases}",
      },
    ],
  },
  {
    key: "calculus",
    label: "Limits, Derivatives and Integrals",
    items: [
      {
        label: "lim (sin x)/x = 1",
        title: "Standard Trigonometric Limit",
        latex: "\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1",
        previewLatex: "\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1",
      },
      {
        label: "lim x→a",
        title: "Limit as x approaches a",
        latex: "\\lim_{x \\to a} f(x)",
        previewLatex: "\\lim_{x \\to a} f(x)",
      },
      {
        label: "d/dx",
        title: "First Derivative (\\frac{d}{dx})",
        latex: "\\frac{d}{dx}\\left(x^n\\right)",
        previewLatex: "\\frac{d}{dx}(x^n)",
      },
      {
        label: "d²y/dx²",
        title: "Second Derivative",
        latex: "\\frac{d^2y}{dx^2}",
        previewLatex: "\\frac{d^2y}{dx^2}",
      },
      {
        label: "∫ f(x) dx",
        title: "Indefinite Integral",
        latex: "\\int f(x)\\,dx",
        previewLatex: "\\int f(x)\\,dx",
      },
      {
        label: "∫ₐᵇ f(x) dx",
        title: "Definite Integral",
        latex: "\\int_{a}^{b} f(x)\\,dx",
        previewLatex: "\\int_{a}^{b} f(x)\\,dx",
      },
      {
        label: "∑ xᵢ",
        title: "Summation from i=1 to n (\\sum_{i=1}^{n} x_i)",
        latex: "\\sum_{i=1}^{n} x_i",
        previewLatex: "\\sum_{i=1}^{n} x_i",
      },
      {
        label: "∑ fᵢxᵢ / ∑ fᵢ",
        title: "Mean of Grouped Data",
        latex: "\\bar{x} = \\frac{\\sum_{i=1}^{n} f_i x_i}{\\sum_{i=1}^{n} f_i}",
        previewLatex: "\\frac{\\sum f_i x_i}{\\sum f_i}",
      },
    ],
  },
  {
    key: "inequalities_greek",
    label: "Inequalities and Greek Symbols",
    items: [
      { label: "≤", title: "Less than or equal", latex: "\\le" },
      { label: "≥", title: "Greater than or equal", latex: "\\ge" },
      { label: "≠", title: "Not equal", latex: "\\neq" },
      { label: "≈", title: "Approximately equal", latex: "\\approx" },
      { label: "≡", title: "Identically equal", latex: "\\equiv" },
      { label: "α", title: "Alpha (\\alpha)", latex: "\\alpha" },
      { label: "β", title: "Beta (\\beta)", latex: "\\beta" },
      { label: "γ", title: "Gamma (\\gamma)", latex: "\\gamma" },
      { label: "θ", title: "Theta (\\theta)", latex: "\\theta" },
      { label: "λ", title: "Lambda (\\lambda)", latex: "\\lambda" },
      { label: "π", title: "Pi (\\pi)", latex: "\\pi" },
      { label: "σ", title: "Sigma (\\sigma)", latex: "\\sigma" },
      { label: "Δ", title: "Capital Delta (\\Delta)", latex: "\\Delta" },
      { label: "∞", title: "Infinity (\\infty)", latex: "\\infty" },
      { label: "∴", title: "Therefore (\\therefore)", latex: "\\therefore" },
      { label: "∵", title: "Because (\\because)", latex: "\\because" },
    ],
  },
];

// ============================================================================
// Guided Visual Formula Builder Types
// ============================================================================

type VisualBuilderTool =
  | "fraction"
  | "root"
  | "power"
  | "matrix"
  | "piecewise"
  | "calculus"
  | "trig";

// ============================================================================
// Props for `MathRichEditor`
// ============================================================================

export interface MathRichEditorProps {
  id?: string;
  label: string;
  required?: boolean;
  value: string;
  onChange: (nextValue: string) => void;
  placeholder?: string;
  rows?: number;
  helperText?: string;
  badgeText?: string;
  onUploadDiagram?: (
    file: File
  ) => Promise<{ mediaUrl: string; defaultCaption: string } | null>;
}

export function MathRichEditor({
  id,
  label,
  required = false,
  value,
  onChange,
  placeholder = "Type text, click mathematical symbols above, or use the Visual Formula Builder...",
  rows = 4,
  helperText,
  badgeText,
  onUploadDiagram,
}: MathRichEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [activeCategory, setActiveCategory] =
    useState<MathCategoryKey>("arithmetic");
  const [showVisualBuilder, setShowVisualBuilder] = useState<boolean>(false);
  const [builderTool, setBuilderTool] = useState<VisualBuilderTool>("fraction");
  const [editorMode, setEditorMode] = useState<"split" | "write" | "preview">(
    "split"
  );
  const [isUploadingImage, setIsUploadingImage] = useState<boolean>(false);

  // Visual Formula Builder States
  // 1. Fraction
  const [fracNum, setFracNum] = useState("x + 1");
  const [fracDen, setFracDen] = useState("x - 1");

  // 2. Root
  const [rootDeg, setRootDeg] = useState("");
  const [rootExpr, setRootExpr] = useState("x^2 + 1");

  // 3. Power / Subscript
  const [powBase, setPowBase] = useState("x");
  const [powExp, setPowExp] = useState("2");
  const [powSub, setPowSub] = useState("1");

  // 4. Matrix / Determinant
  const [matrixRows, setMatrixRows] = useState<number>(2);
  const [matrixCols, setMatrixCols] = useState<number>(2);
  const [matrixBracket, setMatrixBracket] = useState<
    "bmatrix" | "pmatrix" | "vmatrix"
  >("bmatrix");
  const [matrixCells, setMatrixCells] = useState<string[][]>([
    ["1", "2", "0"],
    ["3", "4", "0"],
    ["0", "0", "1"],
  ]);

  // 5. Piecewise Function
  const [piecewiseFnName, setPiecewiseFnName] = useState("f(x) = ");
  const [piecewiseRows, setPiecewiseRows] = useState<
    { expr: string; cond: string }[]
  >([
    { expr: "x^2 + 1", cond: "\\text{if } x \\ge 0" },
    { expr: "-2x", cond: "\\text{if } x < 0" },
  ]);

  // 6. Calculus / Limits / Summation
  const [calcType, setCalcType] = useState<
    "limit" | "derivative" | "definite_integral" | "indefinite_integral" | "sum"
  >("limit");
  const [calcLower, setCalcLower] = useState("x \\to 0");
  const [calcUpper, setCalcUpper] = useState("n");
  const [calcExpr, setCalcExpr] = useState("\\frac{\\sin x}{x}");

  // 7. Trigonometry
  const [trigFn, setTrigFn] = useState("\\sin");
  const [trigPower, setTrigPower] = useState("2");
  const [trigArg, setTrigArg] = useState("\\theta");

  /**
   * Inserts text at the exact cursor position in the textarea without deleting existing content.
   */
  const insertAtCursor = (
    snippet: string,
    wrapStart = "",
    wrapEnd = ""
  ) => {
    const el = textareaRef.current;
    if (!el) {
      const next = value
        ? `${value}${wrapStart}${snippet}${wrapEnd}`
        : `${wrapStart}${snippet}${wrapEnd}`;
      onChange(next);
      return;
    }

    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const selectedText = value.slice(start, end);

    const replacement = selectedText
      ? `${wrapStart}${selectedText}${wrapEnd}`
      : `${wrapStart}${snippet}${wrapEnd}`;

    const nextValue = value.slice(0, start) + replacement + value.slice(end);
    onChange(nextValue);

    const nextCursorPos = start + replacement.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(nextCursorPos, nextCursorPos);
    });
  };

  /**
   * Smart insertion for math palette buttons:
   * - If cursor is already inside `$ ... $` or `$$ ... $$`, inserts raw LaTeX directly.
   * - Otherwise wraps inline math in `$...$` or block math in `\n$$...$$\n`.
   */
  const handleInsertMathPaletteItem = (item: MathPaletteItem) => {
    const el = textareaRef.current;
    const cursorPos = el?.selectionStart ?? value.length;

    const beforeCursor = value.slice(0, cursorPos);
    const singleDollarCount = (
      beforeCursor.match(/(?<!\$)\$(?!\$)/g) || []
    ).length;
    const isInsideInlineMath = singleDollarCount % 2 === 1;

    if (isInsideInlineMath) {
      insertAtCursor(` ${item.latex} `);
    } else if (item.block) {
      const prefix =
        beforeCursor.length > 0 && !beforeCursor.endsWith("\n") ? "\n" : "";
      insertAtCursor(`${prefix}$$${item.latex}$$\n`);
    } else {
      const needsLeadingSpace =
        beforeCursor.length > 0 && !/\s$/.test(beforeCursor);
      insertAtCursor(`${needsLeadingSpace ? " " : ""}$${item.latex}$`);
    }
  };

  /**
   * Computes the LaTeX string for the currently active Visual Formula Builder tab.
   */
  const buildVisualFormulaLatex = (): string => {
    switch (builderTool) {
      case "fraction":
        return `\\frac{${fracNum || "a"}}{${fracDen || "b"}}`;
      case "root":
        return rootDeg.trim()
          ? `\\sqrt[${rootDeg.trim()}]{${rootExpr || "x"}}`
          : `\\sqrt{${rootExpr || "x"}}`;
      case "power": {
        let res = powBase || "x";
        if (powSub.trim()) res += `_{${powSub.trim()}}`;
        if (powExp.trim()) res += `^{${powExp.trim()}}`;
        return res;
      }
      case "matrix": {
        const rowsLatex: string[] = [];
        for (let r = 0; r < matrixRows; r++) {
          const cols: string[] = [];
          for (let c = 0; c < matrixCols; c++) {
            cols.push(matrixCells[r]?.[c] || "0");
          }
          rowsLatex.push(cols.join(" & "));
        }
        return `\\begin{${matrixBracket}} ${rowsLatex.join(
          " \\\\ "
        )} \\end{${matrixBracket}}`;
      }
      case "piecewise": {
        const rowsLatex = piecewiseRows
          .map(
            (r) =>
              `${r.expr || "0"} & ${r.cond || "\\text{otherwise}"}`
          )
          .join(" \\\\ ");
        return `${piecewiseFnName}\\begin{cases} ${rowsLatex} \\end{cases}`;
      }
      case "calculus": {
        if (calcType === "limit") {
          return `\\lim_{${calcLower || "x \\to 0"}} ${calcExpr || "f(x)"}`;
        }
        if (calcType === "derivative") {
          return `\\frac{d}{d${calcLower || "x"}}\\left(${
            calcExpr || "f(x)"
          }\\right)`;
        }
        if (calcType === "definite_integral") {
          return `\\int_{${calcLower || "a"}}^{${calcUpper || "b"}} ${
            calcExpr || "f(x)"
          }\\,dx`;
        }
        if (calcType === "indefinite_integral") {
          return `\\int ${calcExpr || "f(x)"}\\,dx`;
        }
        return `\\sum_{${calcLower || "i=1"}}^{${calcUpper || "n"}} ${
          calcExpr || "a_i"
        }`;
      }
      case "trig": {
        const p = trigPower.trim() ? `^{${trigPower.trim()}}` : "";
        return `${trigFn}${p}\\left(${trigArg || "\\theta"}\\right)`;
      }
    }
  };

  const handleDiagramFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !onUploadDiagram) return;

    setIsUploadingImage(true);
    try {
      const result = await onUploadDiagram(file);
      if (result) {
        const caption = result.defaultCaption || "Diagram";
        const markdownImg = `\n![${caption}](${result.mediaUrl})\n`;
        insertAtCursor(markdownImg);
      }
    } finally {
      setIsUploadingImage(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const currentPalette =
    MATH_PALETTE_CATEGORIES.find((c) => c.key === activeCategory) ??
    MATH_PALETTE_CATEGORIES[0];

  const builtLatexPreview = buildVisualFormulaLatex();

  return (
    <div className="space-y-2">
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          htmlFor={id}
          className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-[#A7B3C7]"
        >
          {label} {required && <span className="text-rose-500">*</span>}
        </label>

        <div className="flex items-center gap-1.5">
          {badgeText && (
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/70">
              {badgeText}
            </span>
          )}

          {/* Mode Toggle: Split | Write | Preview */}
          <div className="inline-flex rounded-lg bg-slate-100 dark:bg-[#0B1120] p-0.5 border border-slate-200/80 dark:border-slate-800 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setEditorMode("split")}
              className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                editorMode === "split"
                  ? "bg-white dark:bg-[#1E293B] text-indigo-600 dark:text-indigo-300 shadow-2xs"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-800"
              }`}
            >
              Split View
            </button>
            <button
              type="button"
              onClick={() => setEditorMode("write")}
              className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                editorMode === "write"
                  ? "bg-white dark:bg-[#1E293B] text-indigo-600 dark:text-indigo-300 shadow-2xs"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-800"
              }`}
            >
              Editor
            </button>
            <button
              type="button"
              onClick={() => setEditorMode("preview")}
              className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
                editorMode === "preview"
                  ? "bg-white dark:bg-[#1E293B] text-indigo-600 dark:text-indigo-300 shadow-2xs"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-800"
              }`}
            >
              Preview
            </button>
          </div>
        </div>
      </div>

      {/* Main Editor Card */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] shadow-2xs overflow-hidden transition-all focus-within:ring-2 focus-within:ring-indigo-600/20 focus-within:border-indigo-500 dark:focus-within:border-indigo-400">
        {/* 1. Rich Text & Diagram Insertion Bar */}
        <div className="px-3 py-2 bg-slate-50/90 dark:bg-[#1E293B]/90 border-b border-slate-200/80 dark:border-slate-700/80 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => insertAtCursor("bold text", "**", "**")}
              title="Bold (**text**)"
              className="px-2.5 py-1 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              B
            </button>
            <button
              type="button"
              onClick={() => insertAtCursor("italic text", "*", "*")}
              title="Italic (*text*)"
              className="px-2.5 py-1 rounded-lg text-xs italic font-serif font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              I
            </button>
            <button
              type="button"
              onClick={() => insertAtCursor("underlined text", "<u>", "</u>")}
              title="Underline (<u>text</u>)"
              className="px-2.5 py-1 rounded-lg text-xs underline text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              U
            </button>

            <span className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-1" />

            <button
              type="button"
              onClick={() => insertAtCursor("\n- List item 1\n- List item 2")}
              title="Bullet List"
              className="px-2 py-1 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              • List
            </button>
            <button
              type="button"
              onClick={() => insertAtCursor("\n1. Step one\n2. Step two")}
              title="Numbered List"
              className="px-2 py-1 rounded-lg text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              1. List
            </button>

            <span className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-1" />

            <button
              type="button"
              onClick={() => insertAtCursor("x^2 + y^2 = r^2", "$", "$")}
              title="Insert Inline Mathematical Equation ($...$)"
              className="px-2.5 py-1 rounded-lg text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50/90 dark:bg-indigo-950/70 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 border border-indigo-200/60 dark:border-indigo-800/70 transition-colors cursor-pointer"
            >
              $ Inline Math
            </button>
            <button
              type="button"
              onClick={() =>
                insertAtCursor(
                  "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
                  "\n$$",
                  "$$\n"
                )
              }
              title="Insert Centered Block Equation ($$...$$)"
              className="px-2.5 py-1 rounded-lg text-xs font-semibold text-violet-700 dark:text-violet-300 bg-violet-50/90 dark:bg-violet-950/70 hover:bg-violet-100 dark:hover:bg-violet-900/60 border border-violet-200/60 dark:border-violet-800/70 transition-colors cursor-pointer"
            >
              $$ Block Equation
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {/* Visual Formula Builder Drawer Button */}
            <button
              type="button"
              onClick={() => setShowVisualBuilder((prev) => !prev)}
              className={`px-3 py-1 rounded-xl text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1.5 ${
                showVisualBuilder
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                  : "bg-white dark:bg-[#151F32] text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/60"
              }`}
            >
              <span>∑ Visual Formula Builder</span>
              <span className="text-[10px]">
                {showVisualBuilder ? "▲" : "▼"}
              </span>
            </button>

            {/* Upload Diagram Inline Button */}
            {onUploadDiagram && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={handleDiagramFileSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={isUploadingImage}
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1 rounded-xl text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/80 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isUploadingImage ? (
                    <>
                      <span className="w-3 h-3 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin" />
                      <span>Uploading...</span>
                    </>
                  ) : (
                    <>
                      <span>🖼️ Insert Diagram</span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>

        {/* 2. Guided Visual Formula Builder (No LaTeX Knowledge Required) */}
        {showVisualBuilder && (
          <div className="p-4 bg-indigo-50/50 dark:bg-indigo-950/25 border-b border-indigo-200/70 dark:border-indigo-900/60 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { key: "fraction", label: "Fraction (a/b)" },
                    { key: "root", label: "Radical (√ / ⁿ√)" },
                    { key: "power", label: "Power & Subscript (x₁²)" },
                    { key: "matrix", label: "Matrix / Determinant" },
                    { key: "piecewise", label: "Piecewise Function" },
                    { key: "calculus", label: "Limits / ∫ / ∑" },
                    { key: "trig", label: "Trigonometry" },
                  ] as { key: VisualBuilderTool; label: string }[]
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setBuilderTool(t.key)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                      builderTool === t.key
                        ? "bg-indigo-600 text-white shadow-2xs"
                        : "bg-white dark:bg-[#1E293B] text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <span className="text-[11px] font-medium text-slate-500 dark:text-[#A7B3C7]">
                Fill the boxes below and click Insert
              </span>
            </div>

            {/* Builder Form Area */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center bg-white dark:bg-[#151F32] p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800">
              <div className="lg:col-span-7 space-y-3">
                {builderTool === "fraction" && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold uppercase text-slate-500 dark:text-[#A7B3C7] mb-1">
                        Numerator (Top)
                      </label>
                      <input
                        type="text"
                        value={fracNum}
                        onChange={(e) => setFracNum(e.target.value)}
                        placeholder="e.g., -b \pm \sqrt{b^2 - 4ac}"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold uppercase text-slate-500 dark:text-[#A7B3C7] mb-1">
                        Denominator (Bottom)
                      </label>
                      <input
                        type="text"
                        value={fracDen}
                        onChange={(e) => setFracDen(e.target.value)}
                        placeholder="e.g., 2a"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs font-mono"
                      />
                    </div>
                  </div>
                )}

                {builderTool === "root" && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold uppercase text-slate-500 dark:text-[#A7B3C7] mb-1">
                        Root Index (Optional)
                      </label>
                      <input
                        type="text"
                        value={rootDeg}
                        onChange={(e) => setRootDeg(e.target.value)}
                        placeholder="Empty for √, 3 for ³√"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs font-mono"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-[11px] font-semibold uppercase text-slate-500 dark:text-[#A7B3C7] mb-1">
                        Expression Inside Radical
                      </label>
                      <input
                        type="text"
                        value={rootExpr}
                        onChange={(e) => setRootExpr(e.target.value)}
                        placeholder="e.g., x^2 + 1"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs font-mono"
                      />
                    </div>
                  </div>
                )}

                {builderTool === "power" && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold uppercase text-slate-500 dark:text-[#A7B3C7] mb-1">
                        Base Variable
                      </label>
                      <input
                        type="text"
                        value={powBase}
                        onChange={(e) => setPowBase(e.target.value)}
                        placeholder="e.g., x or a"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold uppercase text-slate-500 dark:text-[#A7B3C7] mb-1">
                        Exponent / Power
                      </label>
                      <input
                        type="text"
                        value={powExp}
                        onChange={(e) => setPowExp(e.target.value)}
                        placeholder="e.g., 2 or n-1"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold uppercase text-slate-500 dark:text-[#A7B3C7] mb-1">
                        Subscript (Optional)
                      </label>
                      <input
                        type="text"
                        value={powSub}
                        onChange={(e) => setPowSub(e.target.value)}
                        placeholder="e.g., n or 1"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs font-mono"
                      />
                    </div>
                  </div>
                )}

                {builderTool === "matrix" && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Rows:
                        <select
                          value={matrixRows}
                          onChange={(e) => setMatrixRows(Number(e.target.value))}
                          className="ml-1.5 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs"
                        >
                          <option value={2}>2</option>
                          <option value={3}>3</option>
                        </select>
                      </label>
                      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Columns:
                        <select
                          value={matrixCols}
                          onChange={(e) => setMatrixCols(Number(e.target.value))}
                          className="ml-1.5 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs"
                        >
                          <option value={2}>2</option>
                          <option value={3}>3</option>
                        </select>
                      </label>
                      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Brackets:
                        <select
                          value={matrixBracket}
                          onChange={(e) =>
                            setMatrixBracket(
                              e.target.value as
                                | "bmatrix"
                                | "pmatrix"
                                | "vmatrix"
                            )
                          }
                          className="ml-1.5 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs"
                        >
                          <option value="bmatrix">[ ] Square Brackets</option>
                          <option value="pmatrix">( ) Parentheses</option>
                          <option value="vmatrix">| | Determinant</option>
                        </select>
                      </label>
                    </div>

                    <div className="inline-grid gap-2 p-2 rounded-xl bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700">
                      {Array.from({ length: matrixRows }).map((_, rIdx) => (
                        <div key={rIdx} className="flex items-center gap-2">
                          {Array.from({ length: matrixCols }).map((_, cIdx) => (
                            <input
                              key={cIdx}
                              type="text"
                              value={matrixCells[rIdx]?.[cIdx] ?? ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                setMatrixCells((prev) => {
                                  const copy = prev.map((row) => [...row]);
                                  if (!copy[rIdx]) copy[rIdx] = [];
                                  copy[rIdx][cIdx] = val;
                                  return copy;
                                });
                              }}
                              className="w-16 px-2 py-1 text-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#151F32] text-xs font-mono"
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {builderTool === "piecewise" && (
                  <div className="space-y-2.5">
                    <div>
                      <label className="block text-[11px] font-semibold uppercase text-slate-500 dark:text-[#A7B3C7] mb-1">
                        Function Prefix
                      </label>
                      <input
                        type="text"
                        value={piecewiseFnName}
                        onChange={(e) => setPiecewiseFnName(e.target.value)}
                        placeholder="e.g., f(x) = "
                        className="w-40 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs font-mono"
                      />
                    </div>
                    {piecewiseRows.map((row, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-1 sm:grid-cols-2 gap-2"
                      >
                        <input
                          type="text"
                          value={row.expr}
                          onChange={(e) => {
                            const val = e.target.value;
                            setPiecewiseRows((prev) =>
                              prev.map((r, i) =>
                                i === idx ? { ...r, expr: val } : r
                              )
                            );
                          }}
                          placeholder={`Expression ${idx + 1} (e.g. x^2 + 1)`}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs font-mono"
                        />
                        <input
                          type="text"
                          value={row.cond}
                          onChange={(e) => {
                            const val = e.target.value;
                            setPiecewiseRows((prev) =>
                              prev.map((r, i) =>
                                i === idx ? { ...r, cond: val } : r
                              )
                            );
                          }}
                          placeholder={`Condition ${idx + 1} (e.g. \\text{if } x \\ge 0)`}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs font-mono"
                        />
                      </div>
                    ))}
                  </div>
                )}

                {builderTool === "calculus" && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold uppercase text-slate-500 dark:text-[#A7B3C7] mb-1">
                        Operation
                      </label>
                      <select
                        value={calcType}
                        onChange={(e) =>
                          setCalcType(
                            e.target.value as
                              | "limit"
                              | "derivative"
                              | "definite_integral"
                              | "indefinite_integral"
                              | "sum"
                          )
                        }
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs"
                      >
                        <option value="limit">Limit (lim)</option>
                        <option value="derivative">Derivative (d/dx)</option>
                        <option value="definite_integral">
                          Definite Integral (∫ₐᵇ)
                        </option>
                        <option value="indefinite_integral">
                          Indefinite Integral (∫)
                        </option>
                        <option value="sum">Summation (∑)</option>
                      </select>
                    </div>
                    {calcType !== "indefinite_integral" && (
                      <div>
                        <label className="block text-[11px] font-semibold uppercase text-slate-500 dark:text-[#A7B3C7] mb-1">
                          {calcType === "limit"
                            ? "Limit Approach (e.g. x \\to 0)"
                            : calcType === "derivative"
                            ? "Variable (e.g. x)"
                            : "Lower Bound"}
                        </label>
                        <input
                          type="text"
                          value={calcLower}
                          onChange={(e) => setCalcLower(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs font-mono"
                        />
                      </div>
                    )}
                    {(calcType === "definite_integral" ||
                      calcType === "sum") && (
                      <div>
                        <label className="block text-[11px] font-semibold uppercase text-slate-500 dark:text-[#A7B3C7] mb-1">
                          Upper Bound
                        </label>
                        <input
                          type="text"
                          value={calcUpper}
                          onChange={(e) => setCalcUpper(e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs font-mono"
                        />
                      </div>
                    )}
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] font-semibold uppercase text-slate-500 dark:text-[#A7B3C7] mb-1">
                        Function / Expression
                      </label>
                      <input
                        type="text"
                        value={calcExpr}
                        onChange={(e) => setCalcExpr(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs font-mono"
                      />
                    </div>
                  </div>
                )}

                {builderTool === "trig" && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold uppercase text-slate-500 dark:text-[#A7B3C7] mb-1">
                        Function
                      </label>
                      <select
                        value={trigFn}
                        onChange={(e) => setTrigFn(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs"
                      >
                        <option value="\\sin">sin</option>
                        <option value="\\cos">cos</option>
                        <option value="\\tan">tan</option>
                        <option value="\\cot">cot</option>
                        <option value="\\sec">sec</option>
                        <option value="\\csc">csc</option>
                        <option value="\\sin^{-1}">sin⁻¹ (arcsin)</option>
                        <option value="\\cos^{-1}">cos⁻¹ (arccos)</option>
                        <option value="\\tan^{-1}">tan⁻¹ (arctan)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold uppercase text-slate-500 dark:text-[#A7B3C7] mb-1">
                        Power (Optional, e.g. 2)
                      </label>
                      <input
                        type="text"
                        value={trigPower}
                        onChange={(e) => setTrigPower(e.target.value)}
                        placeholder="e.g., 2 for sin²"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold uppercase text-slate-500 dark:text-[#A7B3C7] mb-1">
                        Angle / Argument
                      </label>
                      <input
                        type="text"
                        value={trigArg}
                        onChange={(e) => setTrigArg(e.target.value)}
                        placeholder="e.g., \theta or 90^\circ - A"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#1E293B] text-xs font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Right Side of Visual Builder: Live Preview + Insert Buttons */}
              <div className="lg:col-span-5 flex flex-col justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-[#1E293B] border border-slate-200/80 dark:border-slate-700">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 block mb-1">
                    Visual Formula Preview
                  </span>
                  <div className="min-h-14 flex items-center justify-center py-2 px-3 rounded-lg bg-white dark:bg-[#0B1120] border border-slate-200/70 dark:border-slate-800 text-base overflow-x-auto">
                    {renderLatexExpression(builtLatexPreview, "builder-prev")}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => insertAtCursor(`$${builtLatexPreview}$`)}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    + Insert Inline ($...$)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      insertAtCursor(`\n$$${builtLatexPreview}$$\n`)
                    }
                    className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold cursor-pointer"
                  >
                    + Insert Block ($$...$$)
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3. Visual Mathematical Toolbar Categories (9 Wrapped Categories) */}
        <div className="px-3 py-2.5 bg-slate-100/70 dark:bg-[#0B1120]/50 border-b border-slate-200/80 dark:border-slate-700/80 space-y-2">
          {/* Category Tabs — flex-wrap ensures no controls are ever clipped on smaller screens */}
          <div className="flex flex-wrap items-center gap-1">
            {MATH_PALETTE_CATEGORIES.map((cat) => (
              <button
                key={cat.key}
                type="button"
                onClick={() => setActiveCategory(cat.key)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer ${
                  activeCategory === cat.key
                    ? "bg-indigo-600 text-white shadow-2xs"
                    : "text-slate-600 dark:text-[#A7B3C7] bg-white/70 dark:bg-[#1E293B]/60 hover:bg-white dark:hover:bg-[#1E293B]"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Visual Math Buttons for Active Category */}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {currentPalette.items.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleInsertMathPaletteItem(item)}
                title={`${item.title} — Click to insert at cursor`}
                className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-[#1E293B] hover:bg-indigo-50 dark:hover:bg-indigo-950/70 border border-slate-200/90 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 text-xs text-slate-800 dark:text-slate-100 shadow-2xs transition-all cursor-pointer inline-flex items-center gap-1.5"
              >
                <span className="math-expression">
                  {renderLatexExpression(
                    item.previewLatex ?? item.latex,
                    `pal-${activeCategory}-${idx}`
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 4. Editor Textarea & Live Rendered Math Split View */}
        {editorMode !== "preview" && (
          <div className="p-3">
            <textarea
              id={id}
              ref={textareaRef}
              rows={rows}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              className="w-full p-2.5 rounded-xl border border-slate-200/70 dark:border-slate-700/70 bg-slate-50/40 dark:bg-[#0B1120]/40 focus:bg-white dark:focus:bg-[#0B1120] text-sm text-slate-900 dark:text-[#F1F5F9] placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 dark:focus:border-indigo-400 leading-relaxed font-sans resize-y"
            />
          </div>
        )}

        {(editorMode === "split" || editorMode === "preview") && (
          <div
            className={`px-4 py-3 bg-slate-50/70 dark:bg-[#0B1120]/60 ${
              editorMode === "split"
                ? "border-t border-slate-200/80 dark:border-slate-800"
                : ""
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                Live Mathematical & Rich Text Rendering
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                KaTeX-Compatible Output
              </span>
            </div>
            {value.trim() ? (
              <div className="text-sm text-slate-900 dark:text-[#F1F5F9] leading-relaxed">
                <MathContentRenderer content={value} />
              </div>
            ) : (
              <p className="text-xs italic text-slate-400 dark:text-slate-500">
                Start typing or click any symbol above to see the live
                mathematical preview here...
              </p>
            )}
          </div>
        )}
      </div>

      {helperText && (
        <p className="text-[11px] text-slate-500 dark:text-[#A7B3C7]">
          {helperText}
        </p>
      )}
    </div>
  );
}

// ============================================================================
// Compact Mathematical Input for MCQ Options, Fill-in-Blank & Solution Steps
// ============================================================================

export function CompactMathInput({
  value,
  onChange,
  placeholder,
  multiline = false,
  rows = 2,
}: {
  value: string;
  onChange: (nextValue: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [showQuickMath, setShowQuickMath] = useState(false);
  const [activeCategory, setActiveCategory] =
    useState<MathCategoryKey>("arithmetic");

  /**
   * Inserts a mathematical snippet at the exact current cursor position (`selectionStart`/`selectionEnd`)
   * without deleting existing content, and preserves cursor focus.
   */
  const insertItemAtCursor = (item: MathPaletteItem) => {
    const el = multiline ? textareaRef.current : inputRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;

    const beforeCursor = value.slice(0, start);
    const singleDollarCount = (
      beforeCursor.match(/(?<!\$)\$(?!\$)/g) || []
    ).length;
    const isInsideInlineMath = singleDollarCount % 2 === 1;

    let snippetToInsert: string;
    if (isInsideInlineMath) {
      snippetToInsert = ` ${item.latex} `;
    } else {
      const needsLeadingSpace =
        beforeCursor.length > 0 && !/\s$/.test(beforeCursor);
      snippetToInsert = `${needsLeadingSpace ? " " : ""}$${item.latex}$`;
    }

    const nextValue =
      value.slice(0, start) + snippetToInsert + value.slice(end);
    onChange(nextValue);

    const nextCursorPos = start + snippetToInsert.length;
    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        el.setSelectionRange(nextCursorPos, nextCursorPos);
      }
    });
  };

  const currentPalette =
    MATH_PALETTE_CATEGORIES.find((c) => c.key === activeCategory) ??
    MATH_PALETTE_CATEGORIES[0];

  return (
    <div className="flex-1 space-y-1.5">
      <div className="flex items-start gap-2">
        {multiline ? (
          <textarea
            ref={textareaRef}
            rows={rows}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="flex-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] text-xs sm:text-sm text-slate-900 dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
          />
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="flex-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] text-xs sm:text-sm text-slate-900 dark:text-[#F1F5F9] focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
          />
        )}

        <button
          type="button"
          onClick={() => setShowQuickMath((prev) => !prev)}
          title="Insert mathematical operators, fractions, roots & symbols at cursor"
          className={`px-2.5 py-1.5 rounded-xl border text-xs font-mono font-bold transition-colors cursor-pointer shrink-0 ${
            showQuickMath
              ? "bg-indigo-600 text-white border-indigo-600"
              : "bg-indigo-50/80 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100"
          }`}
        >
          ∑ Math
        </button>
      </div>

      {showQuickMath && (
        <div className="p-2.5 rounded-xl bg-slate-100/90 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800 space-y-2">
          {/* Wrapped 9-Category Selector */}
          <div className="flex flex-wrap items-center gap-1">
            {MATH_PALETTE_CATEGORIES.map((cat) => (
              <button
                key={cat.key}
                type="button"
                onClick={() => setActiveCategory(cat.key)}
                className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors cursor-pointer ${
                  activeCategory === cat.key
                    ? "bg-indigo-600 text-white"
                    : "bg-white dark:bg-[#1E293B] text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-950"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Category Symbol Buttons — inserts at exact cursor position */}
          <div className="flex flex-wrap items-center gap-1">
            {currentPalette.items.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => insertItemAtCursor(item)}
                title={`${item.title} — Insert at cursor`}
                className="px-2 py-1 rounded-lg bg-white dark:bg-[#1E293B] hover:bg-indigo-50 dark:hover:bg-indigo-950 border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-800 dark:text-slate-200 cursor-pointer inline-flex items-center"
              >
                <span className="math-expression">
                  {renderLatexExpression(
                    item.previewLatex ?? item.latex,
                    `cmp-${activeCategory}-${idx}`
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {value.trim() !== "" && (
        <div className="px-2.5 py-1.5 rounded-lg bg-slate-50/90 dark:bg-[#0B1120]/50 border border-slate-200/60 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 shrink-0">
            Preview:
          </span>
          <div className="flex-1 overflow-x-auto">
            <MathContentRenderer content={value} inline={!multiline} />
          </div>
        </div>
      )}
    </div>
  );
}
