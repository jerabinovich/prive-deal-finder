"use client";

import { useEffect } from "react";
import { apiBase, clearStoredAuthTokens, getStoredAuthTokens } from "../../lib/api";

export default function LogoutPage() {
  useEffect(() => {
    const { refreshToken, accessToken } = getStoredAuthTokens();

    fetch(`${apiBase}/auth/logout`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: refreshToken ? JSON.stringify({ refreshToken }) : undefined,
    })
      .catch(() => undefined)
      .finally(() => {
        clearStoredAuthTokens();
        window.location.href = "/login";
      });
  }, []);

  return (
    <div className="card">
      <p>Signing out...</p>
    </div>
  );
}
