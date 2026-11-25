"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

async function resolveQuestionMediaSignedUrl(rawUrl: string): Promise<string> {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";

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

  if (!storagePath) {
    return trimmed;
  }

  const { data, error } = await supabase.storage
    .from("question-media")
    .createSignedUrl(storagePath, 60 * 60);

  if (error || !data?.signedUrl) {
    return trimmed;
  }
  return data.signedUrl;
}

// ============================================================================
// Private Storage Image Component (`StorageImage`)
// ============================================================================

export function StorageImage({
  src,
  alt,
  caption,
  className = "",
}: {
  src: string;
  alt?: string;
  caption?: string;
  className?: string;
}) {
  const [state, setState] = useState<{
    loadedSrc: string;
    resolvedUrl: string;
    error: boolean;
  }>({
    loadedSrc: "",
    resolvedUrl: "",
    error: false,
  });

  useEffect(() => {
    let active = true;

    resolveQuestionMediaSignedUrl(src)
      .then((url) => {
        if (!active) return;
        setState({ loadedSrc: src, resolvedUrl: url, error: false });
      })
      .catch(() => {
        if (!active) return;
        setState({ loadedSrc: src, resolvedUrl: src, error: false });
      });

    return () => {
      active = false;
    };
  }, [src]);

  const loading = state.loadedSrc !== src;
  const { resolvedUrl, error } = state;

  if (loading) {
    return (
      <span className="my-2 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-[#A7B3C7]">
        <span className="w-3.5 h-3.5 rounded-full border-2 border-indigo-600 border-t-transparent animate-spin" />
        Loading diagram...
      </span>
    );
  }

  if (error || !resolvedUrl) {
    return (
      <span className="my-2 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-600 dark:text-rose-300">
        ⚠️ Unable to load diagram ({alt || caption || src})
      </span>
    );
  }

  return (
    <figure className={`my-3 flex flex-col items-center ${className}`}>
      <div className="p-2.5 rounded-2xl bg-white dark:bg-[#0B1120] border border-slate-200/80 dark:border-slate-800 shadow-2xs max-w-full overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={resolvedUrl}
          alt={alt || caption || "Mathematical Diagram"}
          onError={() =>
            setState((prev) => ({ ...prev, loadedSrc: src, error: true }))
          }
          className="max-h-64 w-auto object-contain rounded-lg mx-auto"
        />
      </div>
      {(caption || alt) && (
        <figcaption className="mt-1.5 text-xs font-medium text-slate-500 dark:text-[#A7B3C7] text-center">
          {caption || alt}
        </figcaption>
      )}
    </figure>
  );
}

// ============================================================================
// LaTeX Mathematical Symbol & Command Lookup Tables
// ============================================================================

const LATEX_SYMBOLS: Record<string, string> = {
  // Greek lowercase
  "\\alpha": "α",
  "\\beta": "β",
  "\\gamma": "γ",
  "\\delta": "δ",
  "\\epsilon": "ϵ",
  "\\varepsilon": "ε",
  "\\zeta": "ζ",
  "\\eta": "η",
  "\\theta": "θ",
  "\\vartheta": "ϑ",
  "\\iota": "ι",
  "\\kappa": "κ",
  "\\lambda": "λ",
  "\\mu": "μ",
  "\\nu": "ν",
  "\\xi": "ξ",
  "\\pi": "π",
  "\\rho": "ρ",
  "\\sigma": "σ",
  "\\tau": "τ",
  "\\upsilon": "υ",
  "\\phi": "ϕ",
  "\\varphi": "φ",
  "\\chi": "χ",
  "\\psi": "ψ",
  "\\omega": "ω",
  // Greek uppercase
  "\\Gamma": "Γ",
  "\\Delta": "Δ",
  "\\Theta": "Θ",
  "\\Lambda": "Λ",
  "\\Xi": "Ξ",
  "\\Pi": "Π",
  "\\Sigma": "Σ",
  "\\Upsilon": "Υ",
  "\\Phi": "Φ",
  "\\Psi": "Ψ",
  "\\Omega": "Ω",
  // Arithmetic & Binary Operators
  "\\times": "×",
  "\\div": "÷",
  "\\cdot": "·",
  "\\pm": "±",
  "\\mp": "∓",
  "\\ast": "∗",
  "\\star": "⋆",
  "\\circ": "∘",
  "\\bullet": "•",
  "\\oplus": "⊕",
  "\\otimes": "⊗",
  // Relations & Inequalities
  "\\leq": "≤",
  "\\le": "≤",
  "\\geq": "≥",
  "\\ge": "≥",
  "\\neq": "≠",
  "\\ne": "≠",
  "\\approx": "≈",
  "\\equiv": "≡",
  "\\cong": "≅",
  "\\sim": "∼",
  "\\simeq": "≃",
  "\\propto": "∝",
  "\\ll": "≪",
  "\\gg": "≫",
  // Geometry & Mensuration
  "\\angle": "∠",
  "\\measuredangle": "∡",
  "\\triangle": "△",
  "\\perp": "⊥",
  "\\parallel": "∥",
  "\\nparallel": "∦",
  "\\degree": "°",
  "\\odot": "⊙",
  "\\square": "□",
  // Set Theory, Logic & Calculus
  "\\infty": "∞",
  "\\partial": "∂",
  "\\nabla": "∇",
  "\\forall": "∀",
  "\\exists": "∃",
  "\\nexists": "∄",
  "\\in": "∈",
  "\\notin": "∉",
  "\\ni": "∋",
  "\\subset": "⊂",
  "\\supset": "⊃",
  "\\subseteq": "⊆",
  "\\supseteq": "⊇",
  "\\cup": "∪",
  "\\cap": "∩",
  "\\emptyset": "∅",
  "\\varnothing": "∅",
  "\\therefore": "∴",
  "\\because": "∵",
  // Arrows
  "\\to": "→",
  "\\rightarrow": "→",
  "\\leftarrow": "←",
  "\\leftrightarrow": "↔",
  "\\Rightarrow": "⇒",
  "\\Leftarrow": "⇐",
  "\\Leftrightarrow": "⇔",
  "\\iff": "⇔",
  "\\mapsto": "↦",
  "\\uparrow": "↑",
  "\\downarrow": "↓",
  // Dots & Misc
  "\\dots": "…",
  "\\cdots": "⋯",
  "\\ldots": "…",
  "\\vdots": "⋮",
  "\\ddots": "⋱",
  "\\prime": "′",
  // Escaped characters & spacing
  "\\{": "{",
  "\\}": "}",
  "\\%": "%",
  "\\&": "&",
  "\\#": "#",
  "\\$": "$",
  "\\,": "\u2009",
  "\\;": "\u2004",
  "\\:": "\u2005",
  "\\!": "",
  "\\quad": "\u2003",
  "\\qquad": "\u2003\u2003",
};

const BINARY_OR_RELATION_SYMBOLS = new Set([
  "×",
  "÷",
  "·",
  "±",
  "∓",
  "≤",
  "≥",
  "≠",
  "≈",
  "≡",
  "≅",
  "∼",
  "≃",
  "∝",
  "⊥",
  "∥",
  "∦",
  "∈",
  "∉",
  "⊂",
  "⊃",
  "⊆",
  "⊇",
  "∪",
  "∩",
  "→",
  "←",
  "↔",
  "⇒",
  "⇐",
  "⇔",
  "↦",
]);

const FUNCTION_COMMANDS: Record<string, string> = {
  "\\sin": "sin",
  "\\cos": "cos",
  "\\tan": "tan",
  "\\cot": "cot",
  "\\sec": "sec",
  "\\csc": "csc",
  "\\cosec": "cosec",
  "\\arcsin": "arcsin",
  "\\arccos": "arccos",
  "\\arctan": "arctan",
  "\\sinh": "sinh",
  "\\cosh": "cosh",
  "\\tanh": "tanh",
  "\\log": "log",
  "\\ln": "ln",
  "\\det": "det",
  "\\gcd": "gcd",
  "\\lcm": "lcm",
  "\\max": "max",
  "\\min": "min",
  "\\mod": "mod",
};

// ============================================================================
// Scalable SVG Mathematical Delimiters & Radical Primitives
// ============================================================================

/**
 * Full-height scalable SVG radical sign that seamlessly connects its top right edge
 * at (12, 0.75) to the top border (`border-t-[1.5px]`) of the radicand container.
 */
function ScalableRadicalSvg() {
  return (
    <svg
      viewBox="0 0 12 24"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="w-[0.68em] min-h-[1.25em] self-stretch shrink-0 overflow-visible select-none"
    >
      <path
        d="M 0.5 13.5 L 2.8 11.8 L 6.2 22.2 L 11.4 0.75 L 12 0.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Full-height scalable left or right parenthesis for `\begin{pmatrix}`
 */
function ScalableParenSvg({ side }: { side: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 8 32"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`w-[7px] min-h-[1.6em] self-stretch shrink-0 select-none ${
        side === "left" ? "mr-0.5" : "ml-0.5"
      }`}
    >
      <path
        d={
          side === "left"
            ? "M 6.5 1 C 1.5 6, 1.5 26, 6.5 31"
            : "M 1.5 1 C 6.5 6, 6.5 26, 1.5 31"
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * Full-height scalable curly brace for `\begin{cases}` and `\begin{Bmatrix}`
 */
function ScalableBraceSvg({ side }: { side: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 10 36"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`w-[9px] min-h-[1.8em] self-stretch shrink-0 select-none ${
        side === "left" ? "mr-1" : "ml-1"
      }`}
    >
      <path
        d={
          side === "left"
            ? "M 8.5 1 C 5 1, 4.5 3, 4.5 6.5 L 4.5 14 C 4.5 16.5, 3 18, 1 18 C 3 18, 4.5 19.5, 4.5 22 L 4.5 29.5 C 4.5 33, 5 35, 8.5 35"
            : "M 1.5 1 C 5 1, 5.5 3, 5.5 6.5 L 5.5 14 C 5.5 16.5, 7 18, 9 18 C 7 18, 5.5 19.5, 5.5 22 L 5.5 29.5 C 5.5 33, 5 35, 1.5 35"
        }
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ============================================================================
// Recursive LaTeX Parser Helpers
// ============================================================================

/**
 * Reads a balanced `{...}` group starting at `startIndex`.
 */
function readBraceGroup(
  src: string,
  startIndex: number
): { content: string; nextIndex: number } | null {
  let i = startIndex;
  while (i < src.length && src[i] === " ") i++;
  if (i >= src.length || src[i] !== "{") return null;

  let depth = 0;
  const contentStart = i + 1;
  while (i < src.length) {
    if (src[i] === "\\" && i + 1 < src.length) {
      i += 2;
      continue;
    }
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        return {
          content: src.slice(contentStart, i),
          nextIndex: i + 1,
        };
      }
    }
    i++;
  }

  return {
    content: src.slice(contentStart),
    nextIndex: src.length,
  };
}

/**
 * Reads an optional `[...]` group starting at `startIndex`.
 */
function readBracketGroup(
  src: string,
  startIndex: number
): { content: string; nextIndex: number } | null {
  let i = startIndex;
  while (i < src.length && src[i] === " ") i++;
  if (i >= src.length || src[i] !== "[") return null;

  let depth = 0;
  const contentStart = i + 1;
  while (i < src.length) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]") {
      depth--;
      if (depth === 0) {
        return {
          content: src.slice(contentStart, i),
          nextIndex: i + 1,
        };
      }
    }
    i++;
  }
  return null;
}

/**
 * Reads a single LaTeX token or `{...}` group after `^`, `_`, `\frac`, `\sqrt`, etc.
 */
function readScriptAtom(
  src: string,
  startIndex: number
): { content: string; nextIndex: number } {
  let i = startIndex;
  while (i < src.length && src[i] === " ") i++;
  if (i >= src.length) return { content: "", nextIndex: i };

  if (src[i] === "{") {
    const grp = readBraceGroup(src, i);
    if (grp) return grp;
  }

  if (src[i] === "\\") {
    let j = i + 1;
    while (j < src.length && /[A-Za-z]/.test(src[j])) j++;
    if (j === i + 1 && j < src.length) j++;
    return { content: src.slice(i, j), nextIndex: j };
  }

  return { content: src[i], nextIndex: i + 1 };
}

/**
 * Reads optional subscript and/or superscript attached to an operator or base.
 * Supports both `_a^b` and `^b_a` ordering.
 */
function readSubSupPair(
  src: string,
  startIndex: number
): {
  subContent: string | null;
  supContent: string | null;
  nextIndex: number;
} {
  let i = startIndex;
  let subContent: string | null = null;
  let supContent: string | null = null;

  for (let pass = 0; pass < 2; pass++) {
    let k = i;
    while (k < src.length && src[k] === " ") k++;
    if (k < src.length && src[k] === "_" && subContent === null) {
      const atom = readScriptAtom(src, k + 1);
      subContent = atom.content;
      i = atom.nextIndex;
    } else if (k < src.length && src[k] === "^" && supContent === null) {
      const atom = readScriptAtom(src, k + 1);
      supContent = atom.content;
      i = atom.nextIndex;
    } else {
      break;
    }
  }

  return { subContent, supContent, nextIndex: i };
}

/**
 * Finds the matching `\end{envName}` respecting nested `\begin{envName}...\end{envName}`.
 */
function findMatchingEnvironmentEnd(
  src: string,
  startIndex: number,
  envName: string
): number {
  const beginTag = `\\begin{${envName}}`;
  const endTag = `\\end{${envName}}`;
  let depth = 1;
  let i = startIndex;

  while (i < src.length) {
    if (src.startsWith(beginTag, i)) {
      depth++;
      i += beginTag.length;
      continue;
    }
    if (src.startsWith(endTag, i)) {
      depth--;
      if (depth === 0) return i;
      i += endTag.length;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Splits a matrix or cases body by `\\` row separators only at the top brace/environment level.
 */
function splitTopLevelRows(body: string): string[] {
  const rows: string[] = [];
  let current = "";
  let braceDepth = 0;
  let envDepth = 0;
  let i = 0;

  while (i < body.length) {
    if (body.startsWith("\\begin{", i)) {
      envDepth++;
    } else if (body.startsWith("\\end{", i)) {
      envDepth = Math.max(0, envDepth - 1);
    }

    if (body[i] === "{" && (i === 0 || body[i - 1] !== "\\")) {
      braceDepth++;
    } else if (body[i] === "}" && (i === 0 || body[i - 1] !== "\\")) {
      braceDepth = Math.max(0, braceDepth - 1);
    }

    if (
      braceDepth === 0 &&
      envDepth === 0 &&
      body[i] === "\\" &&
      i + 1 < body.length &&
      body[i + 1] === "\\"
    ) {
      rows.push(current.trim());
      current = "";
      i += 2;
      continue;
    }

    current += body[i];
    i++;
  }

  if (current.trim().length > 0) {
    rows.push(current.trim());
  }

  return rows;
}

/**
 * Splits a single row by `&` column separators only at the top brace/environment level.
 */
function splitTopLevelColumns(row: string): string[] {
  const cols: string[] = [];
  let current = "";
  let braceDepth = 0;
  let envDepth = 0;
  let i = 0;

  while (i < row.length) {
    if (row.startsWith("\\begin{", i)) {
      envDepth++;
    } else if (row.startsWith("\\end{", i)) {
      envDepth = Math.max(0, envDepth - 1);
    }

    if (row[i] === "{" && (i === 0 || row[i - 1] !== "\\")) {
      braceDepth++;
    } else if (row[i] === "}" && (i === 0 || row[i - 1] !== "\\")) {
      braceDepth = Math.max(0, braceDepth - 1);
    }

    if (
      braceDepth === 0 &&
      envDepth === 0 &&
      row[i] === "&" &&
      (i === 0 || row[i - 1] !== "\\")
    ) {
      cols.push(current.trim());
      current = "";
      i++;
      continue;
    }

    current += row[i];
    i++;
  }

  cols.push(current.trim());
  return cols;
}

/**
 * Renders a superscript node, converting `\circ` into a clean degree symbol `°`.
 */
function renderSuperscriptContent(
  supContent: string,
  keyPrefix: string
): React.ReactNode {
  const trimmed = supContent.trim();
  if (trimmed === "\\circ" || trimmed === "\\degree") {
    return "°";
  }
  return renderLatexExpression(supContent, keyPrefix);
}

/**
 * Renders a LaTeX math expression into rich semantic HTML/SVG nodes.
 * Supports:
 * - Fractions (\frac{a}{b}, \dfrac{a}{b}, \tfrac{a}{b}) and nested fractions
 * - Square roots (\sqrt{x}) and nth roots (\sqrt[3]{x}) with scalable SVG radical & contiguous vinculum
 * - Simultaneous or single superscripts (x^2) and subscripts (a_n, x_1^2)
 * - Matrices & Determinants (\begin{bmatrix}, \begin{pmatrix}, \begin{vmatrix}, \begin{Bmatrix})
 * - Piecewise functions (\begin{cases}) with scalable left brace & aligned conditions
 * - Limits (\lim_{x \to 0}), Summations (\sum_{i=1}^n), Integrals (\int_a^b)
 * - Trigonometry, Geometry, Algebra, Greek symbols, Text blocks (\text{...})
 */
export function renderLatexExpression(
  latex: string,
  keyPrefix = "m"
): React.ReactNode {
  if (!latex) return null;

  const nodes: React.ReactNode[] = [];
  let i = 0;
  let tokenCounter = 0;
  // Track whether the previous emitted token was an operator or open delimiter
  // so unary `+` / `-` (e.g. `-b\pm\sqrt{...}` or `(-2x)`) has tight unary spacing
  let prevWasOperatorOrOpen = true;

  while (i < latex.length) {
    // Skip redundant whitespace
    if (latex[i] === " " || latex[i] === "\t" || latex[i] === "\n") {
      i++;
      continue;
    }

    tokenCounter++;
    const currentKey = `${keyPrefix}-${tokenCounter}`;

    // 1. Check for \begin{...} environments (matrices, determinants, piecewise cases, aligned)
    if (latex.startsWith("\\begin", i)) {
      const envGroup = readBraceGroup(latex, i + 6);
      if (envGroup) {
        const envName = envGroup.content.trim();
        const endTag = `\\end{${envName}}`;
        const endIdx = findMatchingEnvironmentEnd(
          latex,
          envGroup.nextIndex,
          envName
        );
        if (endIdx !== -1) {
          const body = latex.slice(envGroup.nextIndex, endIdx).trim();
          const rawRows = splitTopLevelRows(body);
          const parsedRows = rawRows.map((row) => splitTopLevelColumns(row));
          const maxCols = Math.max(
            1,
            ...parsedRows.map((r) => r.length)
          );

          if (envName === "cases") {
            nodes.push(
              <span
                key={currentKey}
                className="inline-flex items-stretch align-middle mx-1 my-0.5"
              >
                <ScalableBraceSvg side="left" />
                <span
                  className="inline-grid gap-x-4 gap-y-1 py-0.5 items-baseline text-left"
                  style={{
                    gridTemplateColumns: `repeat(${maxCols}, auto)`,
                  }}
                >
                  {parsedRows.map((cols, rIdx) =>
                    Array.from({ length: maxCols }).map((_, cIdx) => {
                      const cell = cols[cIdx] ?? "";
                      return (
                        <span
                          key={`${currentKey}-r${rIdx}-c${cIdx}`}
                          className={`whitespace-nowrap leading-snug ${
                            cIdx > 0
                              ? "text-slate-600 dark:text-slate-300 text-[0.92em]"
                              : ""
                          }`}
                        >
                          {renderLatexExpression(
                            cell,
                            `${currentKey}-r${rIdx}-c${cIdx}`
                          )}
                        </span>
                      );
                    })
                  )}
                </span>
              </span>
            );
          } else {
            // Matrix or Determinant environment (bmatrix, pmatrix, vmatrix, Bmatrix, matrix, aligned)
            const isBmatrix = envName === "bmatrix";
            const isPmatrix = envName === "pmatrix";
            const isVmatrix = envName === "vmatrix" || envName === "Vmatrix";
            const isCurlyMatrix = envName === "Bmatrix";

            nodes.push(
              <span
                key={currentKey}
                className="inline-flex items-stretch align-middle mx-1 my-0.5"
              >
                {/* Left Scalable Delimiter */}
                {isBmatrix && (
                  <span
                    aria-hidden="true"
                    className="self-stretch w-[5px] border-l-[1.75px] border-t-[1.75px] border-b-[1.75px] border-current mr-0.5 shrink-0"
                  />
                )}
                {isVmatrix && (
                  <span
                    aria-hidden="true"
                    className="self-stretch w-[2px] border-l-[1.75px] border-current mr-1 shrink-0"
                  />
                )}
                {isPmatrix && <ScalableParenSvg side="left" />}
                {isCurlyMatrix && <ScalableBraceSvg side="left" />}

                {/* Aligned R x C Matrix Grid */}
                <span
                  className="inline-grid gap-x-3 gap-y-0.5 px-1.5 py-0.5 items-center"
                  style={{
                    gridTemplateColumns: `repeat(${maxCols}, auto)`,
                  }}
                >
                  {parsedRows.map((cols, rIdx) =>
                    Array.from({ length: maxCols }).map((_, cIdx) => {
                      const cell = cols[cIdx] ?? "";
                      return (
                        <span
                          key={`${currentKey}-r${rIdx}-c${cIdx}`}
                          className="text-center whitespace-nowrap leading-snug px-0.5"
                        >
                          {renderLatexExpression(
                            cell,
                            `${currentKey}-r${rIdx}-c${cIdx}`
                          )}
                        </span>
                      );
                    })
                  )}
                </span>

                {/* Right Scalable Delimiter */}
                {isBmatrix && (
                  <span
                    aria-hidden="true"
                    className="self-stretch w-[5px] border-r-[1.75px] border-t-[1.75px] border-b-[1.75px] border-current ml-0.5 shrink-0"
                  />
                )}
                {isVmatrix && (
                  <span
                    aria-hidden="true"
                    className="self-stretch w-[2px] border-r-[1.75px] border-current ml-1 shrink-0"
                  />
                )}
                {isPmatrix && <ScalableParenSvg side="right" />}
                {isCurlyMatrix && <ScalableBraceSvg side="right" />}
              </span>
            );
          }

          prevWasOperatorOrOpen = false;
          i = endIdx + endTag.length;
          continue;
        }
      }
    }

    // 2. Check for \frac{num}{den} or \dfrac{num}{den} or \tfrac{num}{den}
    if (
      latex.startsWith("\\frac", i) ||
      latex.startsWith("\\dfrac", i) ||
      latex.startsWith("\\tfrac", i)
    ) {
      const cmdLen = latex.startsWith("\\frac", i) ? 5 : 6;
      const numGroup = readScriptAtom(latex, i + cmdLen);
      const denGroup = readScriptAtom(latex, numGroup.nextIndex);

      nodes.push(
        <span
          key={currentKey}
          className="inline-flex flex-col items-center justify-center align-middle mx-1 text-[0.92em] leading-tight select-auto"
        >
          <span className="px-1.5 pb-[2px] text-center leading-tight whitespace-nowrap">
            {renderLatexExpression(numGroup.content, `${currentKey}-num`)}
          </span>
          <span className="w-full border-t-[1.5px] border-current my-[0.5px]" />
          <span className="px-1.5 pt-[2px] text-center leading-tight whitespace-nowrap">
            {renderLatexExpression(denGroup.content, `${currentKey}-den`)}
          </span>
        </span>
      );
      prevWasOperatorOrOpen = false;
      i = denGroup.nextIndex;
      continue;
    }

    // 3. Check for \sqrt[n]{x} or \sqrt{x}
    if (latex.startsWith("\\sqrt", i)) {
      let nextIdx = i + 5;
      const optRoot = readBracketGroup(latex, nextIdx);
      let rootDegree: string | null = null;
      if (optRoot) {
        rootDegree = optRoot.content;
        nextIdx = optRoot.nextIndex;
      }
      const radicand = readScriptAtom(latex, nextIdx);

      // Check if the entire `\sqrt{...}` is immediately followed by `^` or `_`
      const postScripts = readSubSupPair(latex, radicand.nextIndex);

      nodes.push(
        <span
          key={currentKey}
          className="inline-flex items-center align-middle mx-0.5"
        >
          <span className="inline-flex items-stretch">
            {rootDegree && (
              <sup className="self-start text-[0.65em] leading-none font-serif mr-[-2.5px] mt-[0.12em] px-0.5 select-none">
                {renderLatexExpression(rootDegree, `${currentKey}-deg`)}
              </sup>
            )}
            <ScalableRadicalSvg />
            <span className="border-t-[1.5px] border-current pt-[2px] pb-[1px] px-[2.5px] inline-flex items-center leading-tight">
              {renderLatexExpression(radicand.content, `${currentKey}-rad`)}
            </span>
          </span>
          {(postScripts.supContent !== null ||
            postScripts.subContent !== null) && (
            <span className="inline-flex flex-col justify-center items-start align-middle text-[0.7em] leading-none ml-[1px]">
              {postScripts.supContent !== null && (
                <span className="pb-[1px]">
                  {renderSuperscriptContent(
                    postScripts.supContent,
                    `${currentKey}-rsup`
                  )}
                </span>
              )}
              {postScripts.subContent !== null && (
                <span className="pt-[1px]">
                  {renderLatexExpression(
                    postScripts.subContent,
                    `${currentKey}-rsub`
                  )}
                </span>
              )}
            </span>
          )}
        </span>
      );
      prevWasOperatorOrOpen = false;
      i = postScripts.nextIndex;
      continue;
    }

    // 4. Check for \text{...}, \textbf{...}, \mathrm{...}, \mathbf{...}
    if (
      latex.startsWith("\\text", i) ||
      latex.startsWith("\\textbf", i) ||
      latex.startsWith("\\mathrm", i) ||
      latex.startsWith("\\mathbf", i)
    ) {
      let cmdEnd = i + 1;
      while (cmdEnd < latex.length && /[A-Za-z]/.test(latex[cmdEnd])) cmdEnd++;
      const cmdName = latex.slice(i, cmdEnd);
      const grp = readBraceGroup(latex, cmdEnd);
      if (grp) {
        const isBold = cmdName === "\\textbf" || cmdName === "\\mathbf";
        nodes.push(
          <span
            key={currentKey}
            className={`font-sans not-italic whitespace-pre-wrap ${
              isBold ? "font-bold" : "font-normal"
            }`}
          >
            {grp.content}
          </span>
        );
        prevWasOperatorOrOpen = false;
        i = grp.nextIndex;
        continue;
      }
    }

    // 5. Check for \overline{...}, \bar{...}, \vec{...}, \overrightarrow{...}, \widehat{...}, \hat{...}
    if (
      latex.startsWith("\\overline", i) ||
      latex.startsWith("\\bar", i) ||
      latex.startsWith("\\vec", i) ||
      latex.startsWith("\\overrightarrow", i) ||
      latex.startsWith("\\widehat", i) ||
      latex.startsWith("\\hat", i)
    ) {
      let cmdEnd = i + 1;
      while (cmdEnd < latex.length && /[A-Za-z]/.test(latex[cmdEnd])) cmdEnd++;
      const cmdName = latex.slice(i, cmdEnd);
      const grp = readScriptAtom(latex, cmdEnd);
      if (cmdName === "\\overline" || cmdName === "\\bar") {
        nodes.push(
          <span
            key={currentKey}
            className="border-t-[1.5px] border-current pt-[1px] px-0.5 inline-block leading-tight"
          >
            {renderLatexExpression(grp.content, `${currentKey}-bar`)}
          </span>
        );
      } else if (cmdName === "\\vec" || cmdName === "\\overrightarrow") {
        nodes.push(
          <span
            key={currentKey}
            className="inline-flex flex-col items-center align-middle leading-none mx-0.5"
          >
            <span className="text-[0.65em] leading-none -mb-0.5 select-none">
              →
            </span>
            <span>
              {renderLatexExpression(grp.content, `${currentKey}-vec`)}
            </span>
          </span>
        );
      } else {
        nodes.push(
          <span
            key={currentKey}
            className="inline-flex flex-col items-center align-middle leading-none mx-0.5"
          >
            <span className="text-[0.65em] leading-none -mb-0.5 select-none">
              ^
            </span>
            <span>
              {renderLatexExpression(grp.content, `${currentKey}-hat`)}
            </span>
          </span>
        );
      }
      prevWasOperatorOrOpen = false;
      i = grp.nextIndex;
      continue;
    }

    // 6. Check for Big Operators: \lim, \sum, \int, \prod
    if (
      latex.startsWith("\\lim", i) ||
      latex.startsWith("\\sum", i) ||
      latex.startsWith("\\int", i) ||
      latex.startsWith("\\prod", i)
    ) {
      let cmdEnd = i + 1;
      while (cmdEnd < latex.length && /[A-Za-z]/.test(latex[cmdEnd])) cmdEnd++;
      const cmd = latex.slice(i, cmdEnd);

      const scripts = readSubSupPair(latex, cmdEnd);
      const subExpr = scripts.subContent;
      const supExpr = scripts.supContent;
      const nextIdx = scripts.nextIndex;

      if (cmd === "\\lim") {
        nodes.push(
          <span
            key={currentKey}
            className="inline-flex flex-col items-center justify-center align-middle mx-1 leading-none"
          >
            <span className="not-italic font-serif text-[0.98em]">lim</span>
            {subExpr && (
              <span className="text-[0.68em] text-slate-600 dark:text-slate-300 mt-0.5 whitespace-nowrap">
                {renderLatexExpression(subExpr, `${currentKey}-sub`)}
              </span>
            )}
          </span>
        );
      } else {
        const symbol = cmd === "\\sum" ? "∑" : cmd === "\\prod" ? "∏" : "∫";
        if (cmd === "\\int") {
          // Integral with side-stacked bounds
          nodes.push(
            <span
              key={currentKey}
              className="inline-flex items-center align-middle mx-0.5 leading-none"
            >
              <span className="text-[1.35em] font-serif leading-none select-none">
                {symbol}
              </span>
              {(supExpr !== null || subExpr !== null) && (
                <span className="inline-flex flex-col justify-between text-[0.65em] leading-none ml-0.5 gap-1">
                  <span className="-mt-1 whitespace-nowrap">
                    {supExpr
                      ? renderLatexExpression(supExpr, `${currentKey}-sup`)
                      : "\u00A0"}
                  </span>
                  <span className="-mb-1 whitespace-nowrap">
                    {subExpr
                      ? renderLatexExpression(subExpr, `${currentKey}-sub`)
                      : "\u00A0"}
                  </span>
                </span>
              )}
            </span>
          );
        } else {
          // Summation / Product with stacked upper/lower bounds
          nodes.push(
            <span
              key={currentKey}
              className="inline-flex flex-col items-center justify-center align-middle mx-1 leading-none"
            >
              {supExpr && (
                <span className="text-[0.65em] mb-0.5 whitespace-nowrap">
                  {renderLatexExpression(supExpr, `${currentKey}-sup`)}
                </span>
              )}
              <span className="text-[1.22em] font-serif leading-none select-none">
                {symbol}
              </span>
              {subExpr && (
                <span className="text-[0.65em] mt-0.5 whitespace-nowrap">
                  {renderLatexExpression(subExpr, `${currentKey}-sub`)}
                </span>
              )}
            </span>
          );
        }
      }

      prevWasOperatorOrOpen = true;
      i = nextIdx;
      continue;
    }

    // 7. Check for other backslash commands (\sin, \alpha, \times, \left, \right, etc.)
    if (latex[i] === "\\") {
      // Check for `\\` line break outside an environment
      if (i + 1 < latex.length && latex[i + 1] === "\\") {
        nodes.push(<br key={currentKey} />);
        prevWasOperatorOrOpen = true;
        i += 2;
        continue;
      }

      let cmdEnd = i + 1;
      if (cmdEnd < latex.length && /[A-Za-z]/.test(latex[cmdEnd])) {
        while (cmdEnd < latex.length && /[A-Za-z]/.test(latex[cmdEnd])) {
          cmdEnd++;
        }
      } else if (cmdEnd < latex.length) {
        cmdEnd++;
      }

      const cmd = latex.slice(i, cmdEnd);

      // Ignore sizing prefixes like \left, \right, \big, \Big, \bigg, \Bigg, \displaystyle, \textstyle
      if (
        cmd === "\\left" ||
        cmd === "\\right" ||
        cmd === "\\big" ||
        cmd === "\\Big" ||
        cmd === "\\bigg" ||
        cmd === "\\Bigg" ||
        cmd === "\\displaystyle" ||
        cmd === "\\textstyle"
      ) {
        if ((cmd === "\\left" || cmd === "\\right") && cmdEnd < latex.length && latex[cmdEnd] === ".") {
          i = cmdEnd + 1;
        } else {
          i = cmdEnd;
        }
        continue;
      }

      // Check standard functions (\sin, \cos, \tan, \log, \ln, etc.)
      if (FUNCTION_COMMANDS[cmd]) {
        const scripts = readSubSupPair(latex, cmdEnd);
        const hasScripts =
          scripts.supContent !== null || scripts.subContent !== null;

        nodes.push(
          <span
            key={currentKey}
            className="inline-flex items-baseline not-italic font-serif ml-0.5 mr-[3px]"
          >
            <span>{FUNCTION_COMMANDS[cmd]}</span>
            {hasScripts &&
              scripts.supContent !== null &&
              scripts.subContent !== null && (
                <span className="inline-flex flex-col justify-center items-start align-middle text-[0.7em] leading-none ml-[1px]">
                  <span className="pb-[1px]">
                    {renderSuperscriptContent(
                      scripts.supContent,
                      `${currentKey}-fnsup`
                    )}
                  </span>
                  <span className="pt-[1px]">
                    {renderLatexExpression(
                      scripts.subContent,
                      `${currentKey}-fnsub`
                    )}
                  </span>
                </span>
              )}
            {hasScripts &&
              scripts.supContent !== null &&
              scripts.subContent === null && (
                <sup className="text-[0.72em] leading-none relative -top-[0.42em] ml-[0.5px]">
                  {renderSuperscriptContent(
                    scripts.supContent,
                    `${currentKey}-fnsup`
                  )}
                </sup>
              )}
            {hasScripts &&
              scripts.subContent !== null &&
              scripts.supContent === null && (
                <sub className="text-[0.72em] leading-none relative -bottom-[0.22em] ml-[0.5px]">
                  {renderLatexExpression(
                    scripts.subContent,
                    `${currentKey}-fnsub`
                  )}
                </sub>
              )}
          </span>
        );
        prevWasOperatorOrOpen = false;
        i = scripts.nextIndex;
        continue;
      }

      // Check symbol lookup table
      if (cmd in LATEX_SYMBOLS) {
        const sym = LATEX_SYMBOLS[cmd];
        const isBinaryOrRel = BINARY_OR_RELATION_SYMBOLS.has(sym);
        const isUnaryPm =
          (sym === "±" || sym === "∓") && prevWasOperatorOrOpen;

        nodes.push(
          <span
            key={currentKey}
            className={`not-italic ${
              isUnaryPm
                ? "mr-0.5"
                : isBinaryOrRel
                ? "mx-1"
                : ""
            }`}
          >
            {sym}
          </span>
        );
        prevWasOperatorOrOpen = isBinaryOrRel;
        i = cmdEnd;
        continue;
      }

      // Unknown command fallback: strip leading slash
      nodes.push(
        <span key={currentKey} className="not-italic">
          {cmd.slice(1)}
        </span>
      );
      prevWasOperatorOrOpen = false;
      i = cmdEnd;
      continue;
    }

    // 8. Check for Superscript `^` and/or Subscript `_` (including simultaneous `x_1^2` or `x^2_1`)
    if (latex[i] === "^" || latex[i] === "_") {
      const scripts = readSubSupPair(latex, i);
      const { subContent, supContent, nextIndex } = scripts;

      if (subContent !== null && supContent !== null) {
        // Simultaneous subscript + superscript stacked vertically on the same base!
        nodes.push(
          <span
            key={currentKey}
            className="inline-flex flex-col justify-center items-start align-middle text-[0.7em] leading-none ml-[1px] mr-[1px]"
          >
            <span className="pb-[1px]">
              {renderSuperscriptContent(supContent, `${currentKey}-sup`)}
            </span>
            <span className="pt-[1px]">
              {renderLatexExpression(subContent, `${currentKey}-sub`)}
            </span>
          </span>
        );
      } else if (supContent !== null) {
        const trimmedSup = supContent.trim();
        const isDegree =
          trimmedSup === "\\circ" ||
          trimmedSup === "\\degree" ||
          (trimmedSup === "o" && i > 0 && /[0-9]/.test(latex[i - 1]));

        if (isDegree) {
          nodes.push(
            <span key={currentKey} className="not-italic ml-[0.5px]">
              °
            </span>
          );
        } else {
          nodes.push(
            <sup
              key={currentKey}
              className="text-[0.72em] leading-none relative -top-[0.42em] ml-[0.5px] mr-[1px] inline-block"
            >
              {renderLatexExpression(supContent, `${currentKey}-sup`)}
            </sup>
          );
        }
      } else if (subContent !== null) {
        nodes.push(
          <sub
            key={currentKey}
            className="text-[0.72em] leading-none relative -bottom-[0.24em] ml-[0.5px] mr-[1px] inline-block"
          >
            {renderLatexExpression(subContent, `${currentKey}-sub`)}
          </sub>
        );
      }

      prevWasOperatorOrOpen = false;
      i = nextIndex;
      continue;
    }

    // 9. Check for explicit brace group `{...}`
    if (latex[i] === "{") {
      const group = readBraceGroup(latex, i);
      if (group) {
        nodes.push(
          <span key={currentKey}>
            {renderLatexExpression(group.content, `${currentKey}-grp`)}
          </span>
        );
        prevWasOperatorOrOpen = false;
        i = group.nextIndex;
        continue;
      }
    }

    // 10. Plain characters (variables, numbers, operators, brackets)
    const ch = latex[i];
    if (/[A-Za-z]/.test(ch)) {
      nodes.push(
        <span key={currentKey} className="italic font-serif">
          {ch}
        </span>
      );
      prevWasOperatorOrOpen = false;
    } else if (ch === "-" || ch === "+") {
      const displayChar = ch === "-" ? "−" : "+";
      const isUnary = prevWasOperatorOrOpen;
      nodes.push(
        <span
          key={currentKey}
          className={`not-italic ${isUnary ? "mr-[1px]" : "mx-1"}`}
        >
          {displayChar}
        </span>
      );
      prevWasOperatorOrOpen = true;
    } else if (ch === "=" || ch === "<" || ch === ">") {
      nodes.push(
        <span key={currentKey} className="mx-1 not-italic">
          {ch}
        </span>
      );
      prevWasOperatorOrOpen = true;
    } else if (ch === "(" || ch === "[") {
      nodes.push(
        <span key={currentKey} className="not-italic">
          {ch}
        </span>
      );
      prevWasOperatorOrOpen = true;
    } else if (ch === ",") {
      nodes.push(
        <span key={currentKey} className="not-italic mr-1">
          ,
        </span>
      );
      prevWasOperatorOrOpen = true;
    } else {
      nodes.push(
        <span key={currentKey} className="not-italic">
          {ch}
        </span>
      );
      prevWasOperatorOrOpen = false;
    }
    i++;
  }

  return <>{nodes}</>;
}

// ============================================================================
// Rich Text + Math + Inline Image Renderer (`MathContentRenderer`)
// ============================================================================

/**
 * Normalizes multi-line math blocks (`$$...$$`, `\[...\]`, `\(...\)`, `$...$`, and `\begin{...}...\end{...}`)
 * so that paragraph splitting on `\n` never tears apart a matrix or piecewise function.
 */
function collapseMathBlockNewlines(raw: string): string {
  return raw
    .replace(
      /\$\$([\s\S]*?)\$\$/g,
      (_, inner: string) => `$$${inner.replace(/\r?\n/g, " ")}$$`
    )
    .replace(
      /\\\[([\s\S]*?)\\\]/g,
      (_, inner: string) => `\\[${inner.replace(/\r?\n/g, " ")}\\]`
    )
    .replace(
      /\\\(([\s\S]*?)\\\)/g,
      (_, inner: string) => `\\(${inner.replace(/\r?\n/g, " ")}\\)`
    )
    .replace(
      /\\begin\{([A-Za-z]+)\}([\s\S]*?)\\end\{\1\}/g,
      (fullMatch) => fullMatch.replace(/\r?\n/g, " ")
    );
}

/**
 * Renders inline formatting (Bold `**...**`, Italic `*...*`, Underline `<u>...</u>`),
 * inline images `![caption](url)`, and inline/display LaTeX math (`$$...$$`, `\[...\]`, `$...$`, `\(...\)`).
 */
function renderInlineTokens(
  text: string,
  keyPrefix: string
): React.ReactNode[] {
  if (!text) return [];

  const normalized = collapseMathBlockNewlines(text);

  // Tokenize by:
  // 1. Markdown image: ![alt](url)
  // 2. Display math: $$...$$ or \[...\]
  // 3. Inline math: $...$ or \(...\)
  const tokenRegex =
    /(!\[[^\]]*\]\([^)]+\)|\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\$[^$]+\$|\\\([\s\S]+?\\\))/g;

  const parts = normalized.split(tokenRegex);
  const result: React.ReactNode[] = [];

  parts.forEach((part, idx) => {
    if (!part) return;
    const partKey = `${keyPrefix}-p-${idx}`;

    // 1. Image token: ![caption](url)
    const imgMatch = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      const caption = imgMatch[1].trim();
      const url = imgMatch[2].trim();
      result.push(
        <StorageImage key={partKey} src={url} alt={caption} caption={caption} />
      );
      return;
    }

    // 2. Display Math: $$...$$ or \[...\]
    if (
      (part.startsWith("$$") && part.endsWith("$$") && part.length > 4) ||
      (part.startsWith("\\[") && part.endsWith("\\]") && part.length > 4)
    ) {
      const innerLatex = part.slice(2, -2).trim();
      result.push(
        <div
          key={partKey}
          className="my-2.5 py-2.5 px-3 rounded-xl bg-slate-100/70 dark:bg-[#0B1120]/60 border border-slate-200/60 dark:border-slate-800/80 overflow-x-auto text-center katex-display math-expression text-base sm:text-lg"
        >
          {renderLatexExpression(innerLatex, partKey)}
        </div>
      );
      return;
    }

    // 3. Inline Math: $...$ or \(...\)
    if (
      (part.startsWith("$") && part.endsWith("$") && part.length > 2) ||
      (part.startsWith("\\(") && part.endsWith("\\)") && part.length > 4)
    ) {
      const innerLatex = part.startsWith("$")
        ? part.slice(1, -1).trim()
        : part.slice(2, -2).trim();
      result.push(
        <span
          key={partKey}
          className="inline-flex items-center align-middle katex math-expression px-0.5 text-[1.03em]"
        >
          {renderLatexExpression(innerLatex, partKey)}
        </span>
      );
      return;
    }

    // 4. If plain text contains raw LaTeX commands like \frac, \sqrt, \begin{, \sin, \alpha, etc.,
    // render those segments seamlessly even if not wrapped in $...$
    if (
      /\\(frac|dfrac|tfrac|sqrt|begin|lim|sum|int|prod|alpha|beta|gamma|delta|theta|pi|sigma|omega|triangle|angle|perp|parallel|cong|sim|le|leq|ge|geq|neq|ne|approx|equiv|pm|mp|times|div|cdot|to|rightarrow|Rightarrow|iff|infty|therefore|because)\b/.test(
        part
      )
    ) {
      result.push(
        <span
          key={partKey}
          className="inline-flex items-center align-middle math-expression"
        >
          {renderLatexExpression(part, partKey)}
        </span>
      );
      return;
    }

    // 5. Rich text formatting: **bold**, *italic*, <u>underline</u>
    const richRegex = /(\*\*[^*]+\*\*|<u>[\s\S]+?<\/u>|\*[^*\n]+\*)/g;
    const richParts = part.split(richRegex);
    richParts.forEach((rp, rIdx) => {
      if (!rp) return;
      const rKey = `${partKey}-r-${rIdx}`;
      if (rp.startsWith("**") && rp.endsWith("**") && rp.length > 4) {
        result.push(
          <strong key={rKey} className="font-bold">
            {rp.slice(2, -2)}
          </strong>
        );
      } else if (rp.startsWith("<u>") && rp.endsWith("</u>") && rp.length > 7) {
        result.push(
          <span key={rKey} className="underline underline-offset-2">
            {rp.slice(3, -4)}
          </span>
        );
      } else if (rp.startsWith("*") && rp.endsWith("*") && rp.length > 2) {
        result.push(
          <em key={rKey} className="italic">
            {rp.slice(1, -1)}
          </em>
        );
      } else {
        result.push(<React.Fragment key={rKey}>{rp}</React.Fragment>);
      }
    });
  });

  return result;
}

export function MathContentRenderer({
  content,
  className = "",
  inline = false,
}: {
  content: string;
  className?: string;
  inline?: boolean;
}) {
  if (!content || !content.trim()) {
    return null;
  }

  if (inline) {
    return (
      <span className={`math-expression ${className}`}>
        {renderInlineTokens(content, "inl")}
      </span>
    );
  }

  let normalizedContent = collapseMathBlockNewlines(content);
  // Ensure markdown table rows get proper newlines even if concatenated
  normalizedContent = normalizedContent.replace(/([^\n])\s*(\|(?:\s*[^|\n]+\s*\|)+)/g, "$1\n$2");
  normalizedContent = normalizedContent.replace(/(\|(?:\s*[^|\n]+\s*\|)+)\s*([^\n|])/g, "$1\n$2");

  const lines = normalizedContent.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Markdown Table Detection
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim().startsWith("|") &&
        lines[i].trim().endsWith("|")
      ) {
        tableLines.push(lines[i].trim());
        i++;
      }

      if (tableLines.length >= 2) {
        const parseRow = (rowStr: string) =>
          rowStr
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((c) => c.trim());

        const isSeparator = (cells: string[]) =>
          cells.every((c) => /^:?-+:?$/.test(c));

        let headerCells: string[] = [];
        let dataRows: string[][] = [];

        if (tableLines.length >= 2 && isSeparator(parseRow(tableLines[1]))) {
          headerCells = parseRow(tableLines[0]);
          dataRows = tableLines.slice(2).map(parseRow);
        } else {
          dataRows = tableLines.map(parseRow);
        }

        blocks.push(
          <div
            key={`tbl-${i}`}
            className="my-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs max-w-full"
          >
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-center text-xs sm:text-sm">
              {headerCells.length > 0 && (
                <thead className="bg-slate-50 dark:bg-slate-900/80 font-semibold text-slate-800 dark:text-slate-200">
                  <tr>
                    {headerCells.map((cell, cIdx) => (
                      <th
                        key={`th-${cIdx}`}
                        className="px-3.5 py-2.5 border-r last:border-r-0 border-slate-200 dark:border-slate-800 whitespace-nowrap"
                      >
                        {renderInlineTokens(cell, `th-${i}-${cIdx}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 bg-white dark:bg-slate-950 font-medium text-slate-700 dark:text-slate-300">
                {dataRows.map((row, rIdx) => (
                  <tr
                    key={`tr-${rIdx}`}
                    className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40 transition-colors"
                  >
                    {row.map((cell, cIdx) => (
                      <td
                        key={`td-${cIdx}`}
                        className="px-3.5 py-2 border-r last:border-r-0 border-slate-100 dark:border-slate-800 whitespace-nowrap"
                      >
                        {renderInlineTokens(cell, `td-${i}-${rIdx}-${cIdx}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    // Bullet list items (- or •)
    if (/^[-•]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-•]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul
          key={`ul-${i}`}
          className="list-disc list-inside space-y-1 my-1.5 pl-1"
        >
          {items.map((item, idx) => (
            <li key={`ul-${i}-${idx}`} className="leading-relaxed">
              {renderInlineTokens(item, `ul-${i}-${idx}`)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Numbered list items (1. , 2. , etc.)
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol
          key={`ol-${i}`}
          className="list-decimal list-inside space-y-1 my-1.5 pl-1"
        >
          {items.map((item, idx) => (
            <li key={`ol-${i}-${idx}`} className="leading-relaxed">
              {renderInlineTokens(item, `ol-${i}-${idx}`)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Standard paragraph
    blocks.push(
      <div key={`p-${i}`} className="leading-relaxed">
        {renderInlineTokens(line, `p-${i}`)}
      </div>
    );
    i++;
  }

  return <div className={`space-y-1.5 ${className}`}>{blocks}</div>;
}
