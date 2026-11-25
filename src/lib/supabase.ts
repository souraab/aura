import { createClient, type Session } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export const AUTH_COOKIE_NAME = "mathpractice-auth-token";
const REFRESH_COOKIE_NAME = "mathpractice-refresh-token";

export const supabase = createClient(
    supabaseUrl,
    supabasePublishableKey,
    {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
        },
    }
);

/**
 * Synchronizes the Supabase session access & refresh tokens with HTTP cookies
 * so Next.js Server Proxy (`src/proxy.ts`) and Server Components can verify
 * authentication on every request without relying only on client-side state.
 */
export function syncAuthCookies(session: Session | null) {
    if (typeof document === "undefined") return;

    const secureFlag =
        typeof window !== "undefined" && window.location.protocol === "https:"
            ? "; Secure"
            : "";

    if (session?.access_token) {
        const maxAge = session.expires_in ? Math.max(session.expires_in, 3600) : 604800;
        document.cookie = `${AUTH_COOKIE_NAME}=${encodeURIComponent(
            session.access_token
        )}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secureFlag}`;

        if (session.refresh_token) {
            document.cookie = `${REFRESH_COOKIE_NAME}=${encodeURIComponent(
                session.refresh_token
            )}; Path=/; Max-Age=2592000; SameSite=Lax${secureFlag}`;
        }
    } else {
        document.cookie = `${AUTH_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${secureFlag}`;
        document.cookie = `${REFRESH_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${secureFlag}`;
    }
}
