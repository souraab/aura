"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, syncAuthCookies } from "@/lib/supabase";

export interface UserProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
}

// Keep StudentProfile alias for backwards compatibility across existing imports
export type StudentProfile = UserProfile;

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  profileLoading: boolean;
  profileError: string | null;
  isPasswordRecovery: boolean;
  clearPasswordRecovery: () => void;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<UserProfile | null>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  profile: null,
  loading: true,
  profileLoading: false,
  profileError: null,
  isPasswordRecovery: false,
  clearPasswordRecovery: () => {},
  signOut: async () => {},
  refreshProfile: async () => null,
});

/**
 * Queries `public.profiles` for the given authenticated user ID.
 * Uses `profiles.role` as the sole authoritative role source.
 * Uses `.select("*")` (with a fallback to `.select("role")`) so the query
 * never fails if optional columns like `email` or `full_name` are not in `public.profiles`.
 */
export async function fetchAuthoritativeProfile(
  currentUser: User
): Promise<{ profile: UserProfile | null; error: string | null }> {
  const displayFallbackName =
    typeof currentUser.user_metadata?.full_name === "string" &&
    currentUser.user_metadata.full_name.trim() !== ""
      ? currentUser.user_metadata.full_name.trim()
      : currentUser.email?.split("@")[0] || null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (!error && data) {
      const row = data as Record<string, unknown>;
      const authoritativeRole = String(row.role ?? "")
        .trim()
        .toUpperCase();

      const dbName =
        typeof row.full_name === "string" && row.full_name.trim() !== ""
          ? row.full_name.trim()
          : typeof row.name === "string" && row.name.trim() !== ""
          ? row.name.trim()
          : displayFallbackName;

      const dbEmail =
        typeof row.email === "string" && row.email.trim() !== ""
          ? row.email.trim()
          : currentUser.email ?? null;

      return {
        profile: {
          id: String(row.id ?? currentUser.id),
          full_name: dbName,
          email: dbEmail,
          role: authoritativeRole,
        },
        error: null,
      };
    }

    // Fallback minimal query selecting only `role` in case of column-level permissions
    const { data: roleOnlyData, error: roleOnlyError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (!roleOnlyError && roleOnlyData) {
      const row = roleOnlyData as Record<string, unknown>;
      const authoritativeRole = String(row.role ?? "")
        .trim()
        .toUpperCase();

      return {
        profile: {
          id: currentUser.id,
          full_name: displayFallbackName,
          email: currentUser.email ?? null,
          role: authoritativeRole,
        },
        error: null,
      };
    }

    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    } else {
      return {
        profile: null,
        error:
          error?.message ||
          roleOnlyError?.message ||
          "Could not load user profile from public.profiles.",
      };
    }
  }

  return {
    profile: null,
    error: "User profile row was not found in public.profiles.",
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [resolvedProfileUserId, setResolvedProfileUserId] = useState<
    string | null
  >(null);
  const [isRefreshingProfile, setIsRefreshingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  // 1. Initialize and subscribe to Supabase Auth session state
  useEffect(() => {
    let mounted = true;

    async function initializeSession() {
      try {
        const {
          data: { session: initialSession },
        } = await supabase.auth.getSession();

        if (!mounted) return;

        syncAuthCookies(initialSession);
        setSession(initialSession);
        setUser(initialSession?.user ?? null);
      } finally {
        if (mounted) {
          setSessionLoading(false);
        }
      }
    }

    void initializeSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;

      syncAuthCookies(nextSession);
      setSession(nextSession);
      const nextUser = nextSession?.user ?? null;
      setUser(nextUser);

      if (event === "PASSWORD_RECOVERY") {
        setIsPasswordRecovery(true);
      }

      if (!nextUser) {
        setProfile(null);
        setProfileError(null);
        setResolvedProfileUserId(null);
        setIsRefreshingProfile(false);
      }

      setSessionLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // 2. Fetch authoritative profile from `public.profiles` whenever the authenticated user ID changes.
  // Running in a dedicated effect outside `onAuthStateChange` avoids Supabase auth lock contention
  // and guarantees `isProfilePendingForUser` stays true until `public.profiles.role` is resolved.
  const currentUserId = user?.id ?? null;

  useEffect(() => {
    if (!user || !currentUserId) {
      return;
    }

    let cancelled = false;

    async function loadProfileForCurrentUser(activeUser: User) {
      const { profile: fetchedProfile, error } =
        await fetchAuthoritativeProfile(activeUser);

      if (cancelled) return;

      if (fetchedProfile) {
        setProfile(fetchedProfile);
        setProfileError(null);
      } else {
        setProfile(null);
        setProfileError(error);
      }
      setResolvedProfileUserId(activeUser.id);
    }

    void loadProfileForCurrentUser(user);

    return () => {
      cancelled = true;
    };
    // We intentionally key on currentUserId so redundant token refresh events for the same user
    // do not cancel an in-flight profile fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  const refreshProfile = useCallback(async (): Promise<UserProfile | null> => {
    setIsRefreshingProfile(true);
    try {
      const {
        data: { user: latestUser },
      } = await supabase.auth.getUser();

      const targetUser = latestUser ?? user;
      if (!targetUser) {
        setProfile(null);
        setProfileError(null);
        setResolvedProfileUserId(null);
        return null;
      }

      const { profile: fetchedProfile, error } =
        await fetchAuthoritativeProfile(targetUser);

      if (fetchedProfile) {
        setProfile(fetchedProfile);
        setProfileError(null);
      } else {
        setProfile(null);
        setProfileError(error);
      }
      setResolvedProfileUserId(targetUser.id);
      return fetchedProfile;
    } finally {
      setIsRefreshingProfile(false);
    }
  }, [user]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    syncAuthCookies(null);
    setSession(null);
    setUser(null);
    setProfile(null);
    setProfileError(null);
    setResolvedProfileUserId(null);
    setIsRefreshingProfile(false);
  }, []);

  const clearPasswordRecovery = useCallback(() => {
    setIsPasswordRecovery(false);
  }, []);

  // Derived loading state: keep loading true until BOTH the auth session AND
  // the user's `public.profiles` record for the current user ID have finished loading.
  const isProfilePendingForUser =
    Boolean(user) &&
    (resolvedProfileUserId !== user?.id || isRefreshingProfile);

  const combinedLoading = sessionLoading || isProfilePendingForUser;

  const value = useMemo(
    () => ({
      user,
      session,
      profile,
      loading: combinedLoading,
      profileLoading: isProfilePendingForUser,
      profileError,
      isPasswordRecovery,
      clearPasswordRecovery,
      signOut,
      refreshProfile,
    }),
    [
      user,
      session,
      profile,
      combinedLoading,
      isProfilePendingForUser,
      profileError,
      isPasswordRecovery,
      clearPasswordRecovery,
      signOut,
      refreshProfile,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
