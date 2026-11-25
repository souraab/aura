"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase, syncAuthCookies } from "@/lib/supabase";
import { useAuth } from "@/components/auth-provider";
import { ThemeSwitcher } from "@/components/theme-switcher";

// --- Types ---
type AuthTab = "login" | "register";
type AuthViewMode = "standard" | "forgot-password" | "update-password";

interface LoginFormState {
  email: string;
  password: string;
  rememberMe: boolean;
}

interface RegisterFormState {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

interface FormErrors {
  fullName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  general?: string;
}

// --- Inline Lucide-Style SVG Icons ---
function EyeIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

function MailIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function LockIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function UserIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function AlertCircleIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}

function CheckCircle2Icon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function ArrowRightIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AuthenticationPage() {
  const router = useRouter();
  const {
    user,
    loading: authLoading,
    isPasswordRecovery,
    clearPasswordRecovery,
    refreshProfile,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<AuthTab>("login");
  const [viewMode, setViewMode] = useState<AuthViewMode>("standard");
  const effectiveViewMode: AuthViewMode = isPasswordRecovery
    ? "update-password"
    : viewMode;

  // Form states
  const [loginForm, setLoginForm] = useState<LoginFormState>({
    email: "",
    password: "",
    rememberMe: true,
  });

  const [registerForm, setRegisterForm] = useState<RegisterFormState>({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [newPasswordForm, setNewPasswordForm] = useState({
    password: "",
    confirmPassword: "",
  });

  // Password visibility states
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Validation & Submission Feedback
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Redirect authenticated users to their target route or student dashboard unless updating password
  useEffect(() => {
    if (
      !authLoading &&
      user &&
      effectiveViewMode !== "update-password" &&
      !isPasswordRecovery
    ) {
      const params =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search)
          : null;
      const redirectTo = params?.get("redirectTo");
      const target =
        redirectTo && redirectTo.startsWith("/") ? redirectTo : "/";
      router.replace(target);
    }
  }, [authLoading, user, effectiveViewMode, isPasswordRecovery, router]);

  const handleTabSwitch = (tab: AuthTab) => {
    setActiveTab(tab);
    setViewMode("standard");
    setErrors({});
    setSuccessMessage(null);
  };

  // Validate Login Form
  const validateLogin = (): FormErrors => {
    const nextErrors: FormErrors = {};
    const emailTrimmed = loginForm.email.trim();

    if (!emailTrimmed) {
      nextErrors.email = "Email address is required.";
    } else if (!EMAIL_REGEX.test(emailTrimmed)) {
      nextErrors.email =
        "Please enter a valid email address (e.g., student@school.edu).";
    }

    if (!loginForm.password) {
      nextErrors.password = "Password is required.";
    } else if (loginForm.password.length < 6) {
      nextErrors.password = "Password must be at least 6 characters long.";
    }

    return nextErrors;
  };

  // Validate Registration Form
  const validateRegister = (): FormErrors => {
    const nextErrors: FormErrors = {};
    const nameTrimmed = registerForm.fullName.trim();
    const emailTrimmed = registerForm.email.trim();

    if (!nameTrimmed) {
      nextErrors.fullName = "Full name is required.";
    } else if (nameTrimmed.length < 2) {
      nextErrors.fullName = "Full name must be at least 2 characters.";
    }

    if (!emailTrimmed) {
      nextErrors.email = "Email address is required.";
    } else if (!EMAIL_REGEX.test(emailTrimmed)) {
      nextErrors.email =
        "Please enter a valid email address (e.g., student@school.edu).";
    }

    if (!registerForm.password) {
      nextErrors.password = "Password is required.";
    } else if (registerForm.password.length < 8) {
      nextErrors.password = "Password must be at least 8 characters long.";
    } else if (
      !/[A-Za-z]/.test(registerForm.password) ||
      !/[0-9]/.test(registerForm.password)
    ) {
      nextErrors.password =
        "Password must include at least one letter and one number.";
    }

    if (!registerForm.confirmPassword) {
      nextErrors.confirmPassword = "Please confirm your password.";
    } else if (registerForm.confirmPassword !== registerForm.password) {
      nextErrors.confirmPassword = "Passwords do not match.";
    }

    return nextErrors;
  };

  // Handle Login & Registration Submission via Supabase Auth
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSuccessMessage(null);

    const validationErrors =
      activeTab === "login" ? validateLogin() : validateRegister();

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setErrors({});
    setIsSubmitting(true);

    try {
      if (activeTab === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: loginForm.email.trim(),
          password: loginForm.password,
        });

        if (error) {
          setErrors({
            general: error.message || "Invalid email or password. Please try again.",
          });
          return;
        }

        if (data.session) {
          syncAuthCookies(data.session);
          await refreshProfile();
          const params =
            typeof window !== "undefined"
              ? new URLSearchParams(window.location.search)
              : null;
          const redirectTo = params?.get("redirectTo");
          const target =
            redirectTo && redirectTo.startsWith("/") ? redirectTo : "/";
          setSuccessMessage("Signed in! Redirecting...");
          router.replace(target);
          router.refresh();
        }
      } else {
        // Registration via Supabase signUp() passing full_name in options.data
        // Note: We do NOT insert into the profiles table here because the Supabase
        // database trigger automatically creates a STUDENT profile on sign-up.
        const emailRedirectTo =
          typeof window !== "undefined"
            ? `${window.location.origin}/login`
            : undefined;

        const { data, error } = await supabase.auth.signUp({
          email: registerForm.email.trim(),
          password: registerForm.password,
          options: {
            data: {
              full_name: registerForm.fullName.trim(),
            },
            ...(emailRedirectTo ? { emailRedirectTo } : {}),
          },
        });

        if (error) {
          setErrors({
            general:
              error.message ||
              "Unable to create your account. Please check your details and try again.",
          });
          return;
        }

        // If email confirmation is disabled, Supabase returns an active session immediately
        if (data.session) {
          syncAuthCookies(data.session);
          setSuccessMessage(
            `Welcome, ${registerForm.fullName.trim()}! Redirecting to your dashboard...`
          );
          router.replace("/");
          router.refresh();
        } else {
          // Email confirmation is enabled in Supabase
          setSuccessMessage(
            `Account created for ${registerForm.fullName.trim()}! Please check your inbox (${registerForm.email.trim()}) and click the confirmation link to activate your student account.`
          );
          setRegisterForm({
            fullName: "",
            email: "",
            password: "",
            confirmPassword: "",
          });
        }
      }
    } catch {
      setErrors({
        general:
          "A network error occurred while communicating with the authentication server. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Forgot Password Request via Supabase resetPasswordForEmail()
  const handleForgotPasswordSubmit = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();
    setSuccessMessage(null);
    const trimmed = recoveryEmail.trim();

    if (!trimmed) {
      setErrors({ email: "Please enter the email address for your account." });
      return;
    }
    if (!EMAIL_REGEX.test(trimmed)) {
      setErrors({ email: "Please enter a valid email address." });
      return;
    }

    setErrors({});
    setIsSubmitting(true);

    try {
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/login?mode=recovery`
          : undefined;

      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
        ...(redirectTo ? { redirectTo } : {}),
      });

      if (error) {
        setErrors({
          general:
            error.message ||
            "Could not send password recovery email. Please try again.",
        });
        return;
      }

      setSuccessMessage(
        `Password recovery instructions have been sent to ${trimmed}. Check your inbox and follow the link to reset your password.`
      );
    } catch {
      setErrors({
        general: "Unable to send recovery email right now. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle New Password Update after clicking Supabase recovery email link
  const handleUpdatePasswordSubmit = async (
    e: React.FormEvent<HTMLFormElement>
  ) => {
    e.preventDefault();
    setSuccessMessage(null);

    const nextErrors: FormErrors = {};
    if (!newPasswordForm.password) {
      nextErrors.password = "New password is required.";
    } else if (newPasswordForm.password.length < 8) {
      nextErrors.password = "Password must be at least 8 characters long.";
    } else if (
      !/[A-Za-z]/.test(newPasswordForm.password) ||
      !/[0-9]/.test(newPasswordForm.password)
    ) {
      nextErrors.password =
        "Password must include at least one letter and one number.";
    }

    if (newPasswordForm.confirmPassword !== newPasswordForm.password) {
      nextErrors.confirmPassword = "Passwords do not match.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setIsSubmitting(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPasswordForm.password,
      });

      if (error) {
        setErrors({
          general: error.message || "Failed to update password.",
        });
        return;
      }

      clearPasswordRecovery();
      setViewMode("standard");
      setActiveTab("login");
      setSuccessMessage(
        "Your password has been updated! Redirecting to your student dashboard..."
      );
      router.replace("/");
      router.refresh();
    } catch {
      setErrors({
        general: "An unexpected error occurred while updating your password.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Password strength helper for registration
  const passwordStrength = (() => {
    const pwd =
      effectiveViewMode === "update-password"
        ? newPasswordForm.password
        : registerForm.password;
    if (!pwd) return { score: 0, label: "" };
    let score = 0;
    if (pwd.length >= 8) score += 1;
    if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score += 1;
    if (/[0-9]/.test(pwd)) score += 1;
    if (/[^A-Za-z0-9]/.test(pwd)) score += 1;

    const labels = ["Weak", "Fair", "Good", "Strong"];
    return {
      score: Math.max(1, score),
      label: labels[Math.max(0, score - 1)],
    };
  })();

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1120] text-[#0F172A] dark:text-[#F1F5F9] flex flex-col font-sans selection:bg-indigo-600 selection:text-white transition-colors duration-200">
      {/* Top Minimal Navigation Bar with Theme Switcher */}
      <header className="w-full border-b border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-[#0B1120]/90 backdrop-blur-md px-4 sm:px-8 py-4 transition-colors">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-sm shadow-indigo-500/25 group-hover:scale-[1.02] transition-transform">
              <span className="font-mono font-bold text-lg tracking-tighter">∑</span>
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight text-slate-950 dark:text-slate-100 block leading-none">
                MathPractice
              </span>
              <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 tracking-wide uppercase mt-1 block">
                CBSE Class 10 • NCERT
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <ThemeSwitcher />
          </div>
        </div>
      </header>

      {/* Main Responsive Split Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-8 py-8 sm:py-12 flex items-center">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
          {/* LEFT COLUMN: Mathematics-Inspired Visual & Educational Showcase */}
          <div className="lg:col-span-6 order-2 lg:order-1 flex flex-col justify-between rounded-3xl bg-gradient-to-br from-[#0F172A] via-[#1E1B4B] to-[#2E1065] dark:from-[#151F32] dark:via-[#1E1B4B] dark:to-[#0B1120] border border-transparent dark:border-slate-800 text-white p-7 sm:p-10 relative overflow-hidden shadow-xl">
            {/* Subtle Coordinate Grid & Geometric SVG Background */}
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 w-full h-full opacity-[0.14]"
              viewBox="0 0 600 600"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <pattern
                  id="math-grid"
                  width="40"
                  height="40"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M 40 0 L 0 0 0 40"
                    fill="none"
                    stroke="white"
                    strokeWidth="0.75"
                  />
                </pattern>
              </defs>
              <rect width="600" height="600" fill="url(#math-grid)" />
              {/* Coordinate Axes */}
              <line x1="60" y1="320" x2="540" y2="320" stroke="white" strokeWidth="1.5" strokeDasharray="4 4" />
              <line x1="220" y1="60" x2="220" y2="540" stroke="white" strokeWidth="1.5" strokeDasharray="4 4" />
              {/* Quadratic Parabola y = ax^2 + bx + c */}
              <path
                d="M 90 120 Q 260 520 430 120"
                stroke="#A78BFA"
                strokeWidth="3"
                fill="none"
              />
              {/* Circumscribed Circle & Right Triangle */}
              <circle
                cx="420"
                cy="420"
                r="95"
                stroke="#818CF8"
                strokeWidth="2"
              />
              <polygon
                points="355,475 485,475 485,355"
                stroke="#C4B5FD"
                strokeWidth="2"
                fill="rgba(139, 92, 246, 0.12)"
              />
              {/* Right Angle Marker */}
              <rect
                x="471"
                y="461"
                width="14"
                height="14"
                stroke="#C4B5FD"
                strokeWidth="1.5"
              />
            </svg>

            {/* Top Badge & Heading */}
            <div className="relative z-10 space-y-4">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/15 text-indigo-200 text-xs font-semibold">
                <span className="w-2 h-2 rounded-full bg-violet-400" />
                <span>Class 10 Board Exam Mastery</span>
              </div>

              <h1 className="text-2xl sm:text-4xl font-bold tracking-tight text-white leading-tight">
                Master every theorem, root, and identity with confidence.
              </h1>

              <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-xl">
                Join thousands of Class 10 students practising chapter-wise NCERT questions, Board PYQs, and adaptive Geometry & Trigonometry drills.
              </p>
            </div>

            {/* Interactive-Looking Mathematical Diagram & Formula Cards */}
            <div className="relative z-10 my-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Card 1: Geometric Diagram (Pythagoras & Trigonometry) */}
              <div className="rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 p-4 flex flex-col justify-between">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-200">
                    Chapter 08 • Trigonometry
                  </span>
                  <span className="text-[11px] font-mono text-violet-300 bg-white/10 px-2 py-0.5 rounded-md">
                    ∠B = 90°
                  </span>
                </div>

                {/* Crisp Inline Geometric Right Triangle Diagram */}
                <div className="my-2 flex items-center justify-center bg-slate-950/50 rounded-xl p-3 border border-white/10">
                  <svg
                    className="w-40 h-28"
                    viewBox="0 0 180 120"
                    fill="none"
                    aria-label="Right triangle ABC showing hypotenuse AC, perpendicular AB, base BC and angle theta"
                  >
                    {/* Triangle */}
                    <polygon
                      points="35,95 145,95 145,25"
                      fill="rgba(99, 102, 241, 0.22)"
                      stroke="#A5B4FC"
                      strokeWidth="2.2"
                    />
                    {/* Right angle square at B (145, 95) */}
                    <polyline
                      points="133,95 133,83 145,83"
                      stroke="#C4B5FD"
                      strokeWidth="1.6"
                      fill="none"
                    />
                    {/* Angle arc at A (35, 95) */}
                    <path
                      d="M 62 95 A 27 27 0 0 0 58 80"
                      stroke="#FDE68A"
                      strokeWidth="1.8"
                      fill="none"
                    />
                    {/* Vertex Labels */}
                    <text x="20" y="99" fill="#E2E8F0" fontSize="11" fontWeight="bold">
                      A
                    </text>
                    <text x="151" y="99" fill="#E2E8F0" fontSize="11" fontWeight="bold">
                      B
                    </text>
                    <text x="148" y="20" fill="#E2E8F0" fontSize="11" fontWeight="bold">
                      C
                    </text>
                    {/* Theta Label */}
                    <text x="66" y="90" fill="#FDE68A" fontSize="11" fontFamily="monospace">
                      θ
                    </text>
                    {/* Side Labels */}
                    <text x="72" y="52" fill="#C4B5FD" fontSize="10" fontFamily="monospace">
                      r = √(x²+y²)
                    </text>
                    <text x="82" y="110" fill="#94A3B8" fontSize="10" fontFamily="monospace">
                      x (Base)
                    </text>
                  </svg>
                </div>

                <p className="text-xs font-mono text-indigo-100 text-center pt-1">
                  sin²θ + cos²θ = 1 • tan θ = sin θ / cos θ
                </p>
              </div>

              {/* Card 2: Key Class 10 Identities & Quadratic Formula */}
              <div className="rounded-2xl bg-white/10 backdrop-blur-md border border-white/15 p-4 flex flex-col justify-between space-y-3">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-200 block mb-2">
                    Core Board Formulas
                  </span>

                  <div className="space-y-2.5">
                    <div className="p-2.5 rounded-xl bg-slate-950/50 border border-white/10">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                        Quadratic Roots
                      </span>
                      <p className="text-xs sm:text-sm font-mono font-semibold text-white mt-0.5">
                        x = (-b ± √(b² - 4ac)) / 2a
                      </p>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-950/50 border border-white/10">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                        Arithmetic Progression Sum
                      </span>
                      <p className="text-xs sm:text-sm font-mono font-semibold text-white mt-0.5">
                        Sₙ = (n/2) [2a + (n - 1)d]
                      </p>
                    </div>

                    <div className="p-2.5 rounded-xl bg-slate-950/50 border border-white/10">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                        Thales&apos; Theorem (BPT)
                      </span>
                      <p className="text-xs sm:text-sm font-mono font-semibold text-white mt-0.5">
                        DE ∥ BC ⇒ AD / DB = AE / EC
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Social Proof / Metrics Strip */}
            <div className="relative z-10 pt-5 border-t border-white/15 grid grid-cols-3 gap-4 text-left">
              <div>
                <p className="text-lg sm:text-xl font-bold text-white">1,250+</p>
                <p className="text-xs text-slate-300">Verified NCERT Qs</p>
              </div>
              <div>
                <p className="text-lg sm:text-xl font-bold text-white">14 Chapters</p>
                <p className="text-xs text-slate-300">Step-by-Step Solutions</p>
              </div>
              <div>
                <p className="text-lg sm:text-xl font-bold text-white">95%+ Target</p>
                <p className="text-xs text-slate-300">Adaptive Weak-Area Drills</p>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Authentication Card (Login, Create Account, and Password Recovery) */}
          <div className="lg:col-span-6 order-1 lg:order-2 flex items-center justify-center">
            <div className="w-full max-w-xl bg-white dark:bg-[#151F32] rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xl shadow-slate-900/5 dark:shadow-black/30 p-6 sm:p-10 transition-colors">
              {/* Card Header */}
              <div className="mb-6">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/70 text-xs font-semibold mb-3">
                  <span>Student Portal</span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-950 dark:text-[#F1F5F9]">
                  {effectiveViewMode === "forgot-password"
                    ? "Reset your password"
                    : effectiveViewMode === "update-password"
                    ? "Set a new password"
                    : activeTab === "login"
                    ? "Welcome back to MathPractice"
                    : "Create your student account"}
                </h2>
                <p className="text-sm text-slate-500 dark:text-[#A7B3C7] mt-1">
                  {effectiveViewMode === "forgot-password"
                    ? "Enter your registered email address and we will send you a password recovery link."
                    : effectiveViewMode === "update-password"
                    ? "Enter and confirm your new password below to regain access to your account."
                    : activeTab === "login"
                    ? "Sign in to resume your Class 10 chapter progress and daily streak."
                    : "Start practising chapter-wise questions and track your board exam readiness."}
                </p>
              </div>

              {/* Two-Tab Switcher: Login | Create Account (Visible in standard mode) */}
              {effectiveViewMode === "standard" && (
                <div
                  role="tablist"
                  aria-label="Authentication Mode"
                  className="grid grid-cols-2 p-1.5 rounded-2xl bg-slate-100 dark:bg-[#1E293B] border border-slate-200/70 dark:border-slate-700/80 mb-6"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "login"}
                    onClick={() => handleTabSwitch("login")}
                    className={`py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                      activeTab === "login"
                        ? "bg-white dark:bg-[#151F32] text-indigo-700 dark:text-indigo-400 shadow-xs ring-1 ring-slate-200/80 dark:ring-slate-700"
                        : "text-slate-600 dark:text-[#A7B3C7] hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    Login
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "register"}
                    onClick={() => handleTabSwitch("register")}
                    className={`py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer ${
                      activeTab === "register"
                        ? "bg-white dark:bg-[#151F32] text-indigo-700 dark:text-indigo-400 shadow-xs ring-1 ring-slate-200/80 dark:ring-slate-700"
                        : "text-slate-600 dark:text-[#A7B3C7] hover:text-slate-900 dark:hover:text-white"
                    }`}
                  >
                    Create Account
                  </button>
                </div>
              )}

              {/* Validation & Server Error Summary Alert */}
              {Object.keys(errors).length > 0 && (
                <div
                  role="alert"
                  className="mb-5 p-4 rounded-2xl bg-rose-50/90 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/80 text-rose-900 dark:text-rose-200 text-xs sm:text-sm flex items-start gap-3"
                >
                  <AlertCircleIcon className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold text-rose-950 dark:text-rose-100">
                      {errors.general
                        ? "Authentication Error"
                        : "Please fix the highlighted fields below:"}
                    </p>
                    <ul className="list-disc list-inside space-y-0.5 text-rose-800 dark:text-rose-200">
                      {Object.values(errors).map((errMsg, index) => (
                        <li key={index}>{errMsg}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Success Feedback Alert */}
              {successMessage && (
                <div
                  role="status"
                  className="mb-5 p-4 rounded-2xl bg-emerald-50/90 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/80 text-emerald-950 dark:text-emerald-100 text-xs sm:text-sm flex items-start gap-3"
                >
                  <CheckCircle2Icon className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-bold">Success</p>
                    <p className="text-emerald-800 dark:text-emerald-200">
                      {successMessage}
                    </p>
                  </div>
                </div>
              )}

              {/* VIEW 1: FORGOT PASSWORD FORM */}
              {effectiveViewMode === "forgot-password" && (
                <form
                  onSubmit={handleForgotPasswordSubmit}
                  noValidate
                  className="space-y-4"
                >
                  <div>
                    <label
                      htmlFor="recovery-email"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-[#A7B3C7] mb-1.5"
                    >
                      Registered Email Address
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none">
                        <MailIcon className="w-4 h-4" />
                      </span>
                      <input
                        id="recovery-email"
                        name="recoveryEmail"
                        type="email"
                        autoComplete="email"
                        value={recoveryEmail}
                        onChange={(e) => {
                          setRecoveryEmail(e.target.value);
                          if (errors.email || errors.general) {
                            setErrors({});
                          }
                        }}
                        placeholder="student@example.com"
                        className={`w-full pl-10 pr-4 py-3 rounded-xl border text-sm text-slate-950 dark:text-[#F1F5F9] placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all focus:outline-none focus:ring-2 ${
                          errors.email
                            ? "border-rose-400 dark:border-rose-500 bg-rose-50/40 dark:bg-rose-950/30 focus:ring-rose-500/20 focus:border-rose-500"
                            : "border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] focus:bg-white dark:focus:bg-[#1E293B] focus:ring-indigo-600/20 dark:focus:ring-indigo-500/30 focus:border-indigo-600 dark:focus:border-indigo-400"
                        }`}
                      />
                    </div>
                    {errors.email && (
                      <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 flex items-center gap-1">
                        <AlertCircleIcon className="w-3.5 h-3.5 shrink-0" />
                        <span>{errors.email}</span>
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 disabled:opacity-60 text-white font-bold text-sm shadow-md shadow-indigo-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <span>
                      {isSubmitting
                        ? "Sending Recovery Link..."
                        : "Send Password Reset Link"}
                    </span>
                    <ArrowRightIcon className="w-4 h-4" />
                  </button>

                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setViewMode("standard");
                        setErrors({});
                        setSuccessMessage(null);
                      }}
                      className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 cursor-pointer"
                    >
                      ← Back to Login
                    </button>
                  </div>
                </form>
              )}

              {/* VIEW 2: UPDATE PASSWORD FORM (Password Recovery Callback) */}
              {effectiveViewMode === "update-password" && (
                <form
                  onSubmit={handleUpdatePasswordSubmit}
                  noValidate
                  className="space-y-4"
                >
                  <div>
                    <label
                      htmlFor="new-password"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-[#A7B3C7] mb-1.5"
                    >
                      New Password
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none">
                        <LockIcon className="w-4 h-4" />
                      </span>
                      <input
                        id="new-password"
                        type={showRegisterPassword ? "text" : "password"}
                        autoComplete="new-password"
                        value={newPasswordForm.password}
                        onChange={(e) => {
                          setNewPasswordForm((prev) => ({
                            ...prev,
                            password: e.target.value,
                          }));
                          if (errors.password) {
                            setErrors((prev) => ({ ...prev, password: undefined }));
                          }
                        }}
                        placeholder="At least 8 characters (letters & numbers)"
                        className="w-full pl-10 pr-12 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] text-sm text-slate-950 dark:text-[#F1F5F9] placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegisterPassword((prev) => !prev)}
                        aria-label={
                          showRegisterPassword ? "Hide password" : "Show password"
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                      >
                        {showRegisterPassword ? (
                          <EyeOffIcon className="w-4 h-4" />
                        ) : (
                          <EyeIcon className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="confirm-new-password"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-[#A7B3C7] mb-1.5"
                    >
                      Confirm New Password
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none">
                        <LockIcon className="w-4 h-4" />
                      </span>
                      <input
                        id="confirm-new-password"
                        type={showConfirmPassword ? "text" : "password"}
                        autoComplete="new-password"
                        value={newPasswordForm.confirmPassword}
                        onChange={(e) => {
                          setNewPasswordForm((prev) => ({
                            ...prev,
                            confirmPassword: e.target.value,
                          }));
                          if (errors.confirmPassword) {
                            setErrors((prev) => ({
                              ...prev,
                              confirmPassword: undefined,
                            }));
                          }
                        }}
                        placeholder="Re-enter your new password"
                        className="w-full pl-10 pr-12 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] text-sm text-slate-950 dark:text-[#F1F5F9] placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                        aria-label={
                          showConfirmPassword
                            ? "Hide confirm password"
                            : "Show confirm password"
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                      >
                        {showConfirmPassword ? (
                          <EyeOffIcon className="w-4 h-4" />
                        ) : (
                          <EyeIcon className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 disabled:opacity-60 text-white font-bold text-sm shadow-md shadow-indigo-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <span>
                      {isSubmitting ? "Updating Password..." : "Update Password"}
                    </span>
                    <ArrowRightIcon className="w-4 h-4" />
                  </button>
                </form>
              )}

              {/* VIEW 3: STANDARD LOGIN & REGISTRATION FORM */}
              {effectiveViewMode === "standard" && (
                <form onSubmit={handleSubmit} noValidate className="space-y-4">
                  {/* Full Name (Registration Only) */}
                  {activeTab === "register" && (
                    <div>
                      <label
                        htmlFor="register-full-name"
                        className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-[#A7B3C7] mb-1.5"
                      >
                        Full Name
                      </label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none">
                          <UserIcon className="w-4 h-4" />
                        </span>
                        <input
                          id="register-full-name"
                          name="fullName"
                          type="text"
                          autoComplete="name"
                          value={registerForm.fullName}
                          onChange={(e) => {
                            setRegisterForm((prev) => ({
                              ...prev,
                              fullName: e.target.value,
                            }));
                            if (errors.fullName || errors.general) {
                              setErrors((prev) => ({
                                ...prev,
                                fullName: undefined,
                                general: undefined,
                              }));
                            }
                          }}
                          placeholder="Enter your full name"
                          aria-invalid={Boolean(errors.fullName)}
                          aria-describedby={
                            errors.fullName ? "error-full-name" : undefined
                          }
                          className={`w-full pl-10 pr-4 py-3 rounded-xl border text-sm text-slate-950 dark:text-[#F1F5F9] placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all focus:outline-none focus:ring-2 ${
                            errors.fullName
                              ? "border-rose-400 dark:border-rose-500 bg-rose-50/40 dark:bg-rose-950/30 focus:ring-rose-500/20 focus:border-rose-500"
                              : "border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] focus:bg-white dark:focus:bg-[#1E293B] focus:ring-indigo-600/20 dark:focus:ring-indigo-500/30 focus:border-indigo-600 dark:focus:border-indigo-400"
                          }`}
                        />
                      </div>
                      {errors.fullName && (
                        <p
                          id="error-full-name"
                          className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 flex items-center gap-1"
                        >
                          <AlertCircleIcon className="w-3.5 h-3.5 shrink-0" />
                          <span>{errors.fullName}</span>
                        </p>
                      )}
                    </div>
                  )}

                  {/* Email Address (Both Login & Registration) */}
                  <div>
                    <label
                      htmlFor="auth-email"
                      className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-[#A7B3C7] mb-1.5"
                    >
                      Email Address
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none">
                        <MailIcon className="w-4 h-4" />
                      </span>
                      <input
                        id="auth-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        value={
                          activeTab === "login"
                            ? loginForm.email
                            : registerForm.email
                        }
                        onChange={(e) => {
                          const value = e.target.value;
                          if (activeTab === "login") {
                            setLoginForm((prev) => ({ ...prev, email: value }));
                          } else {
                            setRegisterForm((prev) => ({ ...prev, email: value }));
                          }
                          if (errors.email || errors.general) {
                            setErrors((prev) => ({
                              ...prev,
                              email: undefined,
                              general: undefined,
                            }));
                          }
                        }}
                        placeholder="student@example.com"
                        aria-invalid={Boolean(errors.email)}
                        aria-describedby={errors.email ? "error-email" : undefined}
                        className={`w-full pl-10 pr-4 py-3 rounded-xl border text-sm text-slate-950 dark:text-[#F1F5F9] placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all focus:outline-none focus:ring-2 ${
                          errors.email
                            ? "border-rose-400 dark:border-rose-500 bg-rose-50/40 dark:bg-rose-950/30 focus:ring-rose-500/20 focus:border-rose-500"
                            : "border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] focus:bg-white dark:focus:bg-[#1E293B] focus:ring-indigo-600/20 dark:focus:ring-indigo-500/30 focus:border-indigo-600 dark:focus:border-indigo-400"
                        }`}
                      />
                    </div>
                    {errors.email && (
                      <p
                        id="error-email"
                        className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 flex items-center gap-1"
                      >
                        <AlertCircleIcon className="w-3.5 h-3.5 shrink-0" />
                        <span>{errors.email}</span>
                      </p>
                    )}
                  </div>

                  {/* Password Field (Both Login & Registration) */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label
                        htmlFor="auth-password"
                        className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-[#A7B3C7]"
                      >
                        Password
                      </label>
                      {activeTab === "login" && (
                        <button
                          type="button"
                          onClick={() => {
                            setErrors({});
                            setSuccessMessage(null);
                            setRecoveryEmail(loginForm.email.trim());
                            setViewMode("forgot-password");
                          }}
                          className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 cursor-pointer"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none">
                        <LockIcon className="w-4 h-4" />
                      </span>
                      <input
                        id="auth-password"
                        name="password"
                        type={
                          activeTab === "login"
                            ? showLoginPassword
                              ? "text"
                              : "password"
                            : showRegisterPassword
                            ? "text"
                            : "password"
                        }
                        autoComplete={
                          activeTab === "login"
                            ? "current-password"
                            : "new-password"
                        }
                        value={
                          activeTab === "login"
                            ? loginForm.password
                            : registerForm.password
                        }
                        onChange={(e) => {
                          const value = e.target.value;
                          if (activeTab === "login") {
                            setLoginForm((prev) => ({
                              ...prev,
                              password: value,
                            }));
                          } else {
                            setRegisterForm((prev) => ({
                              ...prev,
                              password: value,
                            }));
                          }
                          if (errors.password || errors.general) {
                            setErrors((prev) => ({
                              ...prev,
                              password: undefined,
                              general: undefined,
                            }));
                          }
                        }}
                        placeholder={
                          activeTab === "login"
                            ? "Enter your password"
                            : "At least 8 characters (letters & numbers)"
                        }
                        aria-invalid={Boolean(errors.password)}
                        aria-describedby={
                          errors.password ? "error-password" : undefined
                        }
                        className={`w-full pl-10 pr-12 py-3 rounded-xl border text-sm text-slate-950 dark:text-[#F1F5F9] placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all focus:outline-none focus:ring-2 ${
                          errors.password
                            ? "border-rose-400 dark:border-rose-500 bg-rose-50/40 dark:bg-rose-950/30 focus:ring-rose-500/20 focus:border-rose-500"
                            : "border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] focus:bg-white dark:focus:bg-[#1E293B] focus:ring-indigo-600/20 dark:focus:ring-indigo-500/30 focus:border-indigo-600 dark:focus:border-indigo-400"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (activeTab === "login") {
                            setShowLoginPassword((prev) => !prev);
                          } else {
                            setShowRegisterPassword((prev) => !prev);
                          }
                        }}
                        aria-label={
                          (activeTab === "login"
                            ? showLoginPassword
                            : showRegisterPassword)
                            ? "Hide password"
                            : "Show password"
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      >
                        {(
                          activeTab === "login"
                            ? showLoginPassword
                            : showRegisterPassword
                        ) ? (
                          <EyeOffIcon className="w-4 h-4" />
                        ) : (
                          <EyeIcon className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    {errors.password && (
                      <p
                        id="error-password"
                        className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 flex items-center gap-1"
                      >
                        <AlertCircleIcon className="w-3.5 h-3.5 shrink-0" />
                        <span>{errors.password}</span>
                      </p>
                    )}

                    {/* Password Strength Meter (Registration only) */}
                    {activeTab === "register" &&
                      registerForm.password.length > 0 && (
                        <div className="mt-2 space-y-1">
                          <div className="flex gap-1.5">
                            {[1, 2, 3, 4].map((step) => (
                              <div
                                key={step}
                                className={`h-1.5 flex-1 rounded-full transition-colors ${
                                  passwordStrength.score >= step
                                    ? passwordStrength.score <= 1
                                      ? "bg-rose-500"
                                      : passwordStrength.score === 2
                                      ? "bg-amber-500"
                                      : "bg-indigo-600 dark:bg-indigo-400"
                                    : "bg-slate-200 dark:bg-slate-700"
                                }`}
                              />
                            ))}
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-[#A7B3C7]">
                            Password strength:{" "}
                            <strong className="text-slate-800 dark:text-slate-200">
                              {passwordStrength.label}
                            </strong>
                          </p>
                        </div>
                      )}
                  </div>

                  {/* Confirm Password Field (Registration Only) */}
                  {activeTab === "register" && (
                    <div>
                      <label
                        htmlFor="register-confirm-password"
                        className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-[#A7B3C7] mb-1.5"
                      >
                        Confirm Password
                      </label>
                      <div className="relative">
                        <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none">
                          <LockIcon className="w-4 h-4" />
                        </span>
                        <input
                          id="register-confirm-password"
                          name="confirmPassword"
                          type={showConfirmPassword ? "text" : "password"}
                          autoComplete="new-password"
                          value={registerForm.confirmPassword}
                          onChange={(e) => {
                            setRegisterForm((prev) => ({
                              ...prev,
                              confirmPassword: e.target.value,
                            }));
                            if (errors.confirmPassword || errors.general) {
                              setErrors((prev) => ({
                                ...prev,
                                confirmPassword: undefined,
                                general: undefined,
                              }));
                            }
                          }}
                          placeholder="Re-enter your password"
                          aria-invalid={Boolean(errors.confirmPassword)}
                          aria-describedby={
                            errors.confirmPassword
                              ? "error-confirm-password"
                              : undefined
                          }
                          className={`w-full pl-10 pr-12 py-3 rounded-xl border text-sm text-slate-950 dark:text-[#F1F5F9] placeholder:text-slate-400 dark:placeholder:text-slate-500 transition-all focus:outline-none focus:ring-2 ${
                            errors.confirmPassword
                              ? "border-rose-400 dark:border-rose-500 bg-rose-50/40 dark:bg-rose-950/30 focus:ring-rose-500/20 focus:border-rose-500"
                              : "border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#1E293B] focus:bg-white dark:focus:bg-[#1E293B] focus:ring-indigo-600/20 dark:focus:ring-indigo-500/30 focus:border-indigo-600 dark:focus:border-indigo-400"
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword((prev) => !prev)}
                          aria-label={
                            showConfirmPassword
                              ? "Hide confirm password"
                              : "Show confirm password"
                          }
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                        >
                          {showConfirmPassword ? (
                            <EyeOffIcon className="w-4 h-4" />
                          ) : (
                            <EyeIcon className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                      {errors.confirmPassword && (
                        <p
                          id="error-confirm-password"
                          className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400 flex items-center gap-1"
                        >
                          <AlertCircleIcon className="w-3.5 h-3.5 shrink-0" />
                          <span>{errors.confirmPassword}</span>
                        </p>
                      )}
                    </div>
                  )}

                  {/* Remember Me (Login Only) */}
                  {activeTab === "login" && (
                    <div className="flex items-center justify-between pt-1">
                      <label className="inline-flex items-center gap-2.5 text-xs sm:text-sm text-slate-600 dark:text-[#A7B3C7] cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={loginForm.rememberMe}
                          onChange={(e) =>
                            setLoginForm((prev) => ({
                              ...prev,
                              rememberMe: e.target.checked,
                            }))
                          }
                          className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>Keep me signed in on this device</span>
                      </label>
                    </div>
                  )}

                  {/* Submit Action Button */}
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full mt-2 py-3.5 px-6 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 active:from-indigo-800 active:to-violet-800 disabled:opacity-60 text-white font-bold text-sm shadow-md shadow-indigo-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <span>
                      {isSubmitting
                        ? activeTab === "login"
                          ? "Signing In..."
                          : "Creating Account..."
                        : activeTab === "login"
                        ? "Sign In to MathPractice"
                        : "Create Student Account"}
                    </span>
                    <ArrowRightIcon className="w-4 h-4" />
                  </button>
                </form>
              )}

              {/* Bottom Mode Toggle Footer */}
              {effectiveViewMode === "standard" && (
                <div className="mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-[#A7B3C7]">
                  <span>
                    {activeTab === "login"
                      ? "New to MathPractice?"
                      : "Already have a student account?"}{" "}
                    <button
                      type="button"
                      onClick={() =>
                        handleTabSwitch(
                          activeTab === "login" ? "register" : "login"
                        )
                      }
                      className="font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 underline underline-offset-4 cursor-pointer"
                    >
                      {activeTab === "login"
                        ? "Create an account"
                        : "Sign in here"}
                    </button>
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
