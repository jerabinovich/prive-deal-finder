function inferApiBaseFromBrowser(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const url = new URL(window.location.origin);

    if (url.hostname.includes("prive-deal-finder-web-")) {
      url.hostname = url.hostname.replace("prive-deal-finder-web-", "prive-deal-finder-api-");
      return `${url.origin}/api`;
    }

    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return "http://localhost:4000/api";
    }

    return `${url.origin}/api`;
  } catch (_error) {
    return null;
  }
}

export const apiBase =
  process.env.NEXT_PUBLIC_API_URL || inferApiBaseFromBrowser() || "http://localhost:4000/api";
const REQUEST_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_API_TIMEOUT_MS || 60000);

const ACCESS_TOKEN_STORAGE_KEY = "prive_access_token";
const REFRESH_TOKEN_STORAGE_KEY = "prive_refresh_token";

function isBrowser() {
  return typeof window !== "undefined";
}

function readStorage(key: string): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch (_error) {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  if (!isBrowser()) return;
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch (_error) {
    // Ignore storage errors (private mode / blocked storage).
  }
}

export function getStoredAuthTokens() {
  return {
    accessToken: readStorage(ACCESS_TOKEN_STORAGE_KEY),
    refreshToken: readStorage(REFRESH_TOKEN_STORAGE_KEY),
  };
}

export function setStoredAuthTokens(accessToken?: string, refreshToken?: string) {
  writeStorage(ACCESS_TOKEN_STORAGE_KEY, accessToken || null);
  writeStorage(REFRESH_TOKEN_STORAGE_KEY, refreshToken || null);
}

export function clearStoredAuthTokens() {
  setStoredAuthTokens(undefined, undefined);
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const { refreshToken } = getStoredAuthTokens();
    const res = await fetchWithTimeout(`${apiBase}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: refreshToken ? JSON.stringify({ refreshToken }) : undefined,
    });

    if (!res.ok) {
      clearStoredAuthTokens();
      return false;
    }

    try {
      const body = (await res.json()) as { accessToken?: string; refreshToken?: string };
      if (body.accessToken || body.refreshToken) {
        setStoredAuthTokens(body.accessToken, body.refreshToken);
      }
    } catch (_error) {
      // Response body is optional; cookies may still have been refreshed.
    }

    return true;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

function buildHeaders(options?: RequestInit) {
  const headers = new Headers(options?.headers || {});
  const { accessToken } = getStoredAuthTokens();

  if (!headers.has("Content-Type") && options?.body) {
    headers.set("Content-Type", "application/json");
  }

  if (accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  return headers;
}

async function fetchWithTimeout(input: string, init: RequestInit = {}) {
  const timeoutMs = Number.isFinite(REQUEST_TIMEOUT_MS) && REQUEST_TIMEOUT_MS > 0 ? REQUEST_TIMEOUT_MS : 60000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`API timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function parseErrorMessage(res: Response) {
  try {
    const body = (await res.json()) as { message?: string; code?: string };
    return body?.message || body?.code || `API error ${res.status}`;
  } catch (_error) {
    return `API error ${res.status}`;
  }
}

export async function apiFetch<T>(path: string, options?: RequestInit, retryOnAuth = true): Promise<T> {
  const res = await fetchWithTimeout(`${apiBase}${path}`, {
    ...options,
    headers: buildHeaders(options),
    credentials: "include",
    cache: "no-store",
  });

  if (res.status === 401 && retryOnAuth && !path.startsWith("/auth/refresh") && !path.startsWith("/auth/login")) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiFetch<T>(path, options, false);
    }
  }

  if (!res.ok) {
    throw new Error(await parseErrorMessage(res));
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

export async function apiFetchBlob(path: string, options?: RequestInit, retryOnAuth = true): Promise<Blob> {
  const res = await fetchWithTimeout(`${apiBase}${path}`, {
    ...options,
    headers: buildHeaders(options),
    credentials: "include",
    cache: "no-store",
  });

  if (res.status === 401 && retryOnAuth && !path.startsWith("/auth/refresh") && !path.startsWith("/auth/login")) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiFetchBlob(path, options, false);
    }
  }

  if (!res.ok) {
    throw new Error(await parseErrorMessage(res));
  }

  return res.blob();
}
