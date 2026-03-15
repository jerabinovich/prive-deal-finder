"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../lib/api";

type SessionUser = {
  id: string;
  email: string;
  role: "ADMIN" | "ANALYST" | "PARTNER";
};

export default function TopNav() {
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadingTimeout = setTimeout(() => {
      if (!cancelled) {
        setLoading(false);
      }
    }, 6000);

    apiFetch<SessionUser>("/auth/me")
      .then((payload) => {
        if (!cancelled) {
          setUser(payload);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      clearTimeout(loadingTimeout);
    };
  }, [pathname]);

  const links = useMemo(() => {
    if (!user) {
      return [{ href: "/login", label: "Login" }];
    }

    return [
      { href: "/deals", label: "Deals" },
      { href: "/reports", label: "Reports" },
      { href: "/settings/integrations", label: "Integrations" },
      { href: "/logout", label: "Logout" },
    ];
  }, [user]);

  return (
    <nav className="nav-links" aria-label="Primary">
      {links.map((link) => {
        const isActive = link.href !== "/logout" && pathname.startsWith(link.href);
        return (
          <a key={link.href} href={link.href} className={`nav-link ${isActive ? "active" : ""}`}>
            {link.label}
          </a>
        );
      })}
      {loading ? <span className="nav-status">Session...</span> : null}
      {!loading && user ? (
        <span className={`nav-role role-${user.role.toLowerCase()}`}>
          {user.role}
        </span>
      ) : null}
    </nav>
  );
}
