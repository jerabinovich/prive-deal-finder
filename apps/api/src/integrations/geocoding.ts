interface GeocodeResult {
  latitude: number;
  longitude: number;
}

const cache = new Map<string, GeocodeResult | null>();

function normalizeQuery(query: string) {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

function toQuery(address?: string, city?: string, state?: string, zip?: string) {
  return [address, city, state, zip].filter(Boolean).join(", ").trim();
}

async function geocodeWithGoogle(query: string, apiKey: string): Promise<GeocodeResult | null> {
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json?" +
    `address=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url);
  if (!response.ok) return null;

  const payload = (await response.json()) as {
    status?: string;
    results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
  };

  if (payload.status !== "OK" || !payload.results?.length) {
    return null;
  }

  const location = payload.results[0]?.geometry?.location;
  if (!location || typeof location.lat !== "number" || typeof location.lng !== "number") {
    return null;
  }

  return { latitude: location.lat, longitude: location.lng };
}

export async function geocodeAddress(address?: string, city?: string, state?: string, zip?: string) {
  const provider = (process.env.GEOCODING_PROVIDER || "none").trim().toLowerCase();
  const apiKey = (process.env.GEOCODING_API_KEY || "").trim();
  if (provider !== "google" || !apiKey) return null;

  const query = toQuery(address, city, state, zip);
  if (!query) return null;

  const normalized = normalizeQuery(query);
  if (cache.has(normalized)) {
    return cache.get(normalized) ?? null;
  }

  try {
    const result = await geocodeWithGoogle(query, apiKey);
    cache.set(normalized, result);
    return result;
  } catch (_error) {
    cache.set(normalized, null);
    return null;
  }
}
