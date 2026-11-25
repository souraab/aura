"use client";

import React from "react";
import { useTheme, type ThemePreference } from "./theme-provider";

// --- Lucide-Style Sun, Moon & Monitor SVG Icons ---
function SunIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function MoonIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

function MonitorIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  );
}

interface ThemeSwitcherProps {
  variant?: "compact" | "expanded";
  className?: string;
}

const OPTIONS: {
  key: ThemePreference;
  label: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    key: "light",
    label: "Light",
    description: "Crisp white paper & deep navy ink",
    Icon: SunIcon,
  },
  {
    key: "dark",
    label: "Dark",
    description: "Low-glare midnight slate for late study",
    Icon: MoonIcon,
  },
  {
    key: "system",
    label: "System",
    description: "Follows your device OS appearance",
    Icon: MonitorIcon,
  },
];

export function ThemeSwitcher({
  variant = "compact",
  className = "",
}: ThemeSwitcherProps) {
  const { theme, resolvedTheme, setTheme, mounted } = useTheme();

  if (variant === "expanded") {
    return (
      <div className={`space-y-3 ${className}`}>
        <div
          role="radiogroup"
          aria-label="Theme preference"
          className="grid grid-cols-1 sm:grid-cols-3 gap-3"
        >
          {OPTIONS.map(({ key, label, description, Icon }) => {
            const isSelected = mounted ? theme === key : key === "system";
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setTheme(key)}
                className={`flex items-start gap-3.5 p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                  isSelected
                    ? "bg-indigo-50/90 dark:bg-indigo-950/60 border-indigo-600 dark:border-indigo-400 ring-2 ring-indigo-600/15 dark:ring-indigo-400/20"
                    : "bg-white dark:bg-[#151F32] border-slate-200/90 dark:border-slate-700/80 hover:border-indigo-300 dark:hover:border-indigo-500/60"
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-xl shrink-0 flex items-center justify-center transition-colors ${
                    isSelected
                      ? "bg-indigo-600 text-white shadow-xs"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-950 dark:text-slate-100">
                      {label}
                    </span>
                    {isSelected && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-600 text-white">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                    {description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
        {mounted && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Active theme:{" "}
            <strong className="text-slate-800 dark:text-slate-200 capitalize">
              {theme}
            </strong>
            {theme === "system" && (
              <span>
                {" "}
                (currently resolved to{" "}
                <strong className="text-indigo-600 dark:text-indigo-400">
                  {resolvedTheme}
                </strong>{" "}
                via OS setting)
              </span>
            )}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Select colour theme"
      className={`inline-flex items-center p-1 rounded-xl bg-slate-100/90 dark:bg-[#1E293B] border border-slate-200/80 dark:border-slate-700/80 shadow-2xs ${className}`}
    >
      {OPTIONS.map(({ key, label, Icon }) => {
        const isSelected = mounted ? theme === key : false;
        return (
          <button
            key={key}
            type="button"
            onClick={() => setTheme(key)}
            title={`${label} theme`}
            aria-label={`${label} theme`}
            aria-pressed={isSelected}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              isSelected
                ? "bg-white dark:bg-[#151F32] text-indigo-600 dark:text-indigo-400 shadow-2xs ring-1 ring-slate-200/80 dark:ring-slate-700"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-slate-200"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

