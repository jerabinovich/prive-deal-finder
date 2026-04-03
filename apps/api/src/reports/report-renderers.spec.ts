import { buildPipelineContext, renderPipelineHtml, renderPipelineMarkdown, renderPipelineTelegram } from "./report-renderers";
import { PipelineRow } from "./reports.service";

describe("report-renderers", () => {
  const rows: PipelineRow[] = [
    { status: "DISTRESS_OWNER", count: 4, avgScore: 92.5 },
    { status: "AUCTION_MONITOR", count: 2, avgScore: 80 },
  ];

  it("builds pipeline context with weighted average and top lane", () => {
    const context = buildPipelineContext(rows, new Date("2026-04-03T12:00:00.000Z"));
    expect(context.totalDeals).toBe(6);
    expect(context.topLane).toBe("DISTRESS_OWNER");
    expect(context.weightedAvgScore).toBeCloseTo(88.3333, 3);
  });

  it("renders telegram report with core sections", () => {
    const context = buildPipelineContext(rows, new Date("2026-04-03T12:00:00.000Z"));
    const report = renderPipelineTelegram(context);
    expect(report).toContain("REPORTE PIPELINE (ET) — OPERACIONES");
    expect(report).toContain("SECCIÓN 2 — OPERACIONES");
    expect(report).toContain("DISTRESS_OWNER");
  });

  it("renders markdown and html variants", () => {
    const context = buildPipelineContext(rows, new Date("2026-04-03T12:00:00.000Z"));
    const markdown = renderPipelineMarkdown(context);
    const html = renderPipelineHtml(context);

    expect(markdown).toContain("| Lane | Deals | Avg Score |");
    expect(markdown).toContain("DISTRESS_OWNER");

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("REPORTE PIPELINE (ET) — Operaciones");
    expect(html).toContain("DISTRESS_OWNER");
  });
});
