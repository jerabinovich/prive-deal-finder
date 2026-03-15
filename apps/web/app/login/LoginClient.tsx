"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiBase, apiFetch, setStoredAuthTokens } from "../../lib/api";

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    role: string;
  };
}

export default function LoginClient() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(true);
  const [googleConfigNote, setGoogleConfigNote] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);

  const navigateToDeals = useCallback(() => {
    router.replace("/deals");
    if (typeof window !== "undefined") {
      setTimeout(() => {
        if (window.location.pathname.startsWith("/login")) {
          window.location.replace("/deals");
        }
      }, 250);
    }
  }, [router]);

  useEffect(() => {
    setHydrated(true);
    Promise.all([
      apiFetch<{ id: string; email: string; role: string }>("/auth/me")
        .then(() => {
          navigateToDeals();
        })
        .catch(() => undefined),
      fetch(`${apiBase}/auth/google/status`, { cache: "no-store", credentials: "include" })
        .then((res) => res.json())
        .then((data: { enabled: boolean; missing?: string[] }) => {
          setGoogleEnabled(Boolean(data.enabled));
          if (!data.enabled && data.missing?.length) {
            setGoogleConfigNote(`Google disabled: ${data.missing.join(", ")}`);
          } else {
            setGoogleConfigNote("");
          }
        })
        .catch(() => {
          setGoogleEnabled(true);
          setGoogleConfigNote("Google status check failed, but you can still try Google sign-in.");
        }),
    ]).catch(() => undefined);
  }, [navigateToDeals]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Logging in...");

    const form = e.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    const submittedEmail = String(formData.get("email") || email).trim();

    try {
      if (!submittedEmail) {
        throw new Error("Login failed");
      }

      const res = await fetch(`${apiBase}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: submittedEmail }),
      });

      if (!res.ok) throw new Error("Login failed");

      const data = (await res.json()) as LoginResponse;
      if (!data.accessToken) {
        throw new Error("Login failed");
      }

      setStoredAuthTokens(data.accessToken, data.refreshToken);
      setStatus("Logged in");
      navigateToDeals();
    } catch (_err) {
      setStatus("Login failed");
    }
  }

  function handleGoogle() {
    window.location.href = `${apiBase}/auth/google`;
  }

  return (
    <div className="auth-shell">
      <div className="auth-intro">
        <h1>Welcome back to Prive Deal Finder</h1>
        <p>Securely access your deal console and prioritize the best opportunities.</p>
        <ul className="checklist">
          <li>Centralized deal pipeline updates</li>
          <li>Reporting exports for investors and partners</li>
          <li>Live integration status from every data source</li>
        </ul>
      </div>

      <div className="card" style={{ maxWidth: 480, width: "100%" }}>
        <div style={{ marginBottom: 16 }}>
          <h2 className="page-title" style={{ fontSize: 22 }}>Login</h2>
          <p className="page-subtitle">Use your corporate email to access the console. No password is required in this internal release.</p>
        </div>
        {!hydrated ? (
          <p className="muted">Initializing secure login...</p>
        ) : (
          <>
            <button
              onClick={handleGoogle}
              disabled={!googleEnabled}
              style={{ width: "100%", marginBottom: 12, opacity: googleEnabled ? 1 : 0.6 }}
            >
              Continue with Google
            </button>
            {googleConfigNote && <p className="muted" style={{ marginTop: -4, marginBottom: 12 }}>{googleConfigNote}</p>}
            <div style={{ margin: "12px 0", textAlign: "center", color: "#64748b" }}>or</div>
            <form onSubmit={handleLogin}>
              <input
                type="email"
                name="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@privegroup.com"
                required
              />
              <button type="submit" style={{ width: "100%", marginTop: 12 }}>
                Continue with Email
              </button>
            </form>
          </>
        )}
        {status && <p className="muted">{status}</p>}
      </div>
    </div>
  );
}
