import { cookies } from "next/headers";
import {
  SESSION_COOKIE_NAME,
  getUserForSession,
  type SessionUser,
} from "./auth";

/** Reads the current session cookie (if any). */
export function readSessionCookie(): string | undefined {
  return cookies().get(SESSION_COOKIE_NAME)?.value;
}

/** Sets the session cookie. Only callable from Route Handlers / Server Actions. */
export function writeSessionCookie(sessionId: string, expiresAt: number): void {
  cookies().set({
    name: SESSION_COOKIE_NAME,
    value: sessionId,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

/** Clears the session cookie. Only callable from Route Handlers / Server Actions. */
export function clearSessionCookie(): void {
  cookies().set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** Resolves the currently authenticated user from the session cookie, or null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const sessionId = readSessionCookie();
  return getUserForSession(sessionId);
}
