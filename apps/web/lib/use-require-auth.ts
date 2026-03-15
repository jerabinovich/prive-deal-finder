"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "./api";

export function useRequireAuth() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let hardRedirectTimer: ReturnType<typeof setTimeout> | null = null;
    let authGuardTimeout: ReturnType<typeof setTimeout> | null = null;
    let guardResolved = false;

    function redirectToLogin() {
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
