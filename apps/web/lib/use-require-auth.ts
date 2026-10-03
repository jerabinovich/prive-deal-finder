"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "./api";

export const AFTER_LOGIN_KEY = "prive_after_login";

/** Solo rutas internas: empieza con una barra, no con dos, y no vuelve al login. */
export function takeAfterLoginPath(): string {
  if (typeof window === "undefined") return "/deals";
  try {
    const v = window.sessionStorage.getItem(AFTER_LOGIN_KEY) || "";
    window.sessionStorage.removeItem(AFTER_LOGIN_KEY);
    if (v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/login")) return v;
  } catch (_error) {
    // Sin storage, a /deals.
  }
  return "/deals";
}

export function useRequireAuth() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let hardRedirectTimer: ReturnType<typeof setTimeout> | null = null;
    let authGuardTimeout: ReturnType<typeof setTimeout> | null = null;
    let guardResolved = false;

    function redirectToLogin() {
      // 2-oct-2026: recordar a donde iba, para que el link de la alerta abra la ficha despues del login.
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        try {
          window.sessionStorage.setItem(AFTER_LOGIN_KEY, window.location.pathname + window.location.search);
        } catch (_error) {
          // Sin storage, el login vuelve a /deals como antes.
        }
      }
      router.replace("/login");

      if (typeof window !== "undefined") {
        if (hardRedirectTimer) {
          clearTimeout(hardRedirectTimer);
        }
        // Router navigation can fail silently when hydration is unstable; force fallback redirect.
        hardRedirectTimer = setTimeout(() => {
          if (!cancelled && window.location.pathname !== "/login") {
            window.location.replace("/login");
          }
        }, 250);
      }
    }

    async function guard() {
      try {
        await apiFetch("/auth/me");
        guardResolved = true;
        if (!cancelled) {
          if (authGuardTimeout) {
            clearTimeout(authGuardTimeout);
            authGuardTimeout = null;
          }
          if (hardRedirectTimer) {
            clearTimeout(hardRedirectTimer);
            hardRedirectTimer = null;
          }
          setReady(true);
        }
      } catch (_error) {
        guardResolved = true;
        if (!cancelled) {
          if (authGuardTimeout) {
            clearTimeout(authGuardTimeout);
            authGuardTimeout = null;
          }
          redirectToLogin();
        }
      }
    }

    // Defensive timeout so the UI never gets stuck forever in "Checking session...".
    authGuardTimeout = setTimeout(() => {
      if (!cancelled && !guardResolved) {
        redirectToLogin();
      }
    }, 6000);

    guard();

    return () => {
      cancelled = true;
      if (authGuardTimeout) {
        clearTimeout(authGuardTimeout);
      }
      if (hardRedirectTimer) {
        clearTimeout(hardRedirectTimer);
      }
    };
  }, [router]);

  return ready;
}
