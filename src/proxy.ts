import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { AUTH_COOKIE_NAME } from "@/lib/supabase";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

const PROTECTED_STUDENT_ROUTES = ["/"];

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;

    const isProtectedStudentRoute = PROTECTED_STUDENT_ROUTES.includes(pathname);
    const isAdminRoute = pathname.startsWith("/admin") || pathname.startsWith("/teacher");
    const isLoginPage = pathname === "/login";

    if (!isProtectedStudentRoute && !isAdminRoute && !isLoginPage) {
        return NextResponse.next();
    }

    const rawToken = request.cookies.get(AUTH_COOKIE_NAME)?.value;
    const accessToken = rawToken ? decodeURIComponent(rawToken) : null;

    let isAuthenticated = false;
    let userRole: string | null = null;

    if (accessToken && supabaseUrl && supabasePublishableKey) {
        try {
            const supabaseServer = createClient(
                supabaseUrl,
                supabasePublishableKey,
                {
                    auth: {
                        persistSession: false,
                        autoRefreshToken: false,
                    },
                    global: {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                        },
                    },
                }
            );

            const { data, error } = await supabaseServer.auth.getUser(accessToken);
            if (!error && data?.user) {
                isAuthenticated = true;

                if (isAdminRoute) {
                    const { data: profileData } = await supabaseServer
                        .from("profiles")
                        .select("role")
                        .eq("id", data.user.id)
                        .maybeSingle();

                    if (profileData?.role) {
                        userRole = String(profileData.role).toUpperCase();
                    }
                }
            }
        } catch {
            isAuthenticated = false;
        }
    }

    // Protect student and admin routes: redirect unauthenticated requests to /login
    if ((isProtectedStudentRoute || isAdminRoute) && !isAuthenticated) {
        const loginUrl = new URL("/login", request.url);
        if (pathname !== "/") {
            loginUrl.searchParams.set("redirectTo", pathname);
        }
        const response = NextResponse.redirect(loginUrl);
        if (rawToken) {
            response.cookies.delete(AUTH_COOKIE_NAME);
        }
        return response;
    }

    // Block student accounts from accessing /admin routes
    if (
        isAdminRoute &&
        isAuthenticated &&
        userRole &&
        userRole !== "ADMIN" &&
        userRole !== "TEACHER"
    ) {
        const dashboardUrl = new URL("/", request.url);
        dashboardUrl.searchParams.set("error", "admin_unauthorized");
        return NextResponse.redirect(dashboardUrl);
    }

    // Redirect already-authenticated users away from /login
    // unless they arrived via a password recovery link
    const isRecoveryFlow =
        request.nextUrl.searchParams.get("mode") === "recovery" ||
        request.nextUrl.searchParams.get("type") === "recovery";

    if (isLoginPage && isAuthenticated && !isRecoveryFlow) {
        const redirectTarget = request.nextUrl.searchParams.get("redirectTo");
        const safeTarget =
            redirectTarget && redirectTarget.startsWith("/") ? redirectTarget : "/";
        return NextResponse.redirect(new URL(safeTarget, request.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/", "/login", "/admin/:path*"],
};
