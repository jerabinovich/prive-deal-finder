function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function computeOpportunityActionabilityScore(params: {
  marginPct: number;
  closeProbability: number;
  hasOfficialDistressEvidence: boolean;
  hasCriticalBlockers: boolean;
  splitPositive: boolean;
}) {
  let score = params.marginPct * 2.5 + params.closeProbability * 40;
  if (params.hasOfficialDistressEvidence) score += 10;
  if (params.splitPositive) score += 10;
  if (params.hasCriticalBlockers) score -= 20;
  return Number(clamp(score, 0, 100).toFixed(1));
}
