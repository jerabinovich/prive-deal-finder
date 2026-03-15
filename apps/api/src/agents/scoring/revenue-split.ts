export interface RevenueSplitConfigInput {
  operatorPct: number;
  investorPct: number;
}

export interface RevenueSplitOutcome {
  operatorPct: number;
  investorPct: number;
  operatorShare: number;
  investorShare: number;
  splitPositive: boolean;
}

export function applyRevenueSplit(profitNet: number, config: RevenueSplitConfigInput): RevenueSplitOutcome {
  const operatorPct = Number(config.operatorPct.toFixed(4));
  const investorPct = Number(config.investorPct.toFixed(4));
  const operatorShare = Number((profitNet * operatorPct).toFixed(2));
  const investorShare = Number((profitNet * investorPct).toFixed(2));
  const splitPositive = operatorShare > 0 && investorShare > 0;
  return {
    operatorPct,
    investorPct,
    operatorShare,
    investorShare,
    splitPositive,
  };
}

export function normalizeSplitConfig(input?: Partial<RevenueSplitConfigInput> | null): RevenueSplitConfigInput {
  const operatorPct = typeof input?.operatorPct === "number" && Number.isFinite(input.operatorPct) ? input.operatorPct : 0.5;
  const investorPct = typeof input?.investorPct === "number" && Number.isFinite(input.investorPct) ? input.investorPct : 0.5;
  const total = operatorPct + investorPct;
  if (total <= 0) {
    return { operatorPct: 0.5, investorPct: 0.5 };
  }
  return {
    operatorPct: Number((operatorPct / total).toFixed(4)),
    investorPct: Number((investorPct / total).toFixed(4)),
  };
}
