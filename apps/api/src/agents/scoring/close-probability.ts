function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function computeCloseProbability(params: {
  distressStage?: string | null;
  contactabilityScore?: number | null;
  completenessScore?: number | null;
  hasCriticalBlocker?: boolean;
}) {
  const stage = String(params.distressStage || "UNKNOWN").toUpperCase();
  let probability = 0.35;
  if (stage === "AUCTION_SCHEDULED") probability = 0.65;
  else if (stage === "PRE_FORECLOSURE") probability = 0.55;
  else if (stage === "SIGNALS_ONLY") probability = 0.35;
  else if (stage === "NONE" || stage === "UNKNOWN") probability = 0.3;

  const contactability = typeof params.contactabilityScore === "number" ? params.contactabilityScore : 0;
  const completeness = typeof params.completenessScore === "number" ? params.completenessScore : 0;
  if (contactability >= 70) probability += 0.1;
  if (completeness >= 80) probability += 0.05;
  if (params.hasCriticalBlocker) probability -= 0.1;
  return Number(clamp(probability, 0.05, 0.95).toFixed(3));
}
