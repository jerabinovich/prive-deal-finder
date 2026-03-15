import { ConfigService } from "@nestjs/config";
import { CookieOptions } from "express";

export interface AuthCookieConfig {
  accessCookieName: string;
  refreshCookieName: string;
  options: CookieOptions;
}

function parseBoolean(input: string | undefined, fallback: boolean) {
  if (!input) return fallback;
  const normalized = input.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
}

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};

  return cookieHeader
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, item) => {
      const separatorIndex = item.indexOf("=");
      if (separatorIndex <= 0) return acc;
      const key = item.slice(0, separatorIndex).trim();
      const value = item.slice(separatorIndex + 1).trim();
      if (!key) return acc;
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

export function readCookie(cookieHeader: string | undefined, cookieName: string) {
  return parseCookieHeader(cookieHeader)[cookieName];
}

export function getAuthCookieConfig(config: ConfigService): AuthCookieConfig {
  const sameSite = (config.get<string>("AUTH_COOKIE_SAME_SITE", "lax").toLowerCase() ||
    "lax") as "lax" | "strict" | "none";
  const secureDefault = config.get<string>("NODE_ENV") === "production";
  const domain = config.get<string>("AUTH_COOKIE_DOMAIN", "").trim() || undefined;
  const secure = parseBoolean(config.get<string>("AUTH_COOKIE_SECURE"), secureDefault);

  return {
    accessCookieName: config.get<string>("AUTH_COOKIE_ACCESS_NAME", "prive_access_token"),
    refreshCookieName: config.get<string>("AUTH_COOKIE_REFRESH_NAME", "prive_refresh_token"),
    options: {
      httpOnly: true,
      secure,
      sameSite,
      path: "/",
      ...(domain ? { domain } : {}),
    },
  };
}
