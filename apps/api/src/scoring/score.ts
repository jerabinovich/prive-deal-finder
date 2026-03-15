export function computeScore(params: {
  parcelId?: string;
  address?: string;
  city?: string;
  zip?: string;
  source?: string;
  hasOwner: boolean;
}) {
  let score = 40;
  if (params.parcelId) score += 15;
  if (params.address) score += 15;
  if (params.city) score += 5;
  if (params.zip) score += 5;
  if (params.hasOwner) score += 15;
  if (params.source === "mdpa") score += 10;
  if (params.source?.includes("parcels")) score += 5;
  return Math.min(100, score);
}
