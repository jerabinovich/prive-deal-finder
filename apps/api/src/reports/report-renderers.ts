import { PipelineRow } from "./reports.service";

export interface PipelineReportContext {
  generatedAtEt: string;
  totalDeals: number;
  weightedAvgScore: number;
  topLane: string;
  rows: PipelineRow[];
}

function escapeHtml(input: string) {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildPipelineContext(rows: PipelineRow[], now: Date = new Date()): PipelineReportContext {
  const totalDeals = rows.reduce((sum, row) => sum + row.count, 0);
  const weightedScoreTotal = rows.reduce((sum, row) => sum + row.avgScore * row.count, 0);
  const weightedAvgScore = totalDeals > 0 ? weightedScoreTotal / totalDeals : 0;
  const topLane = rows.length > 0 ? rows.reduce((max, row) => (row.count > max.count ? row : max)).status : "N/A";

  const generatedAtEt = now.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return { generatedAtEt, totalDeals, weightedAvgScore, topLane, rows };
}

export function renderPipelineTelegram(context: PipelineReportContext): string {
  const lines: string[] = [
    "REPORTE PIPELINE (ET) — OPERACIONES",
    `Generado: ${context.generatedAtEt}`,
    "",
    `📊 Total deals: ${context.totalDeals}`,
    `🎯 Score promedio (ponderado): ${context.weightedAvgScore.toFixed(2)}`,
    `🏁 Lane dominante: ${context.topLane}`,
    "",
    "SECCIÓN 2 — OPERACIONES",
  ];

  if (context.rows.length === 0) {
    lines.push("- Sin datos suficientes");
  } else {
    context.rows.forEach((row, index) => {
      lines.push(`${index + 1}. ${row.status} → ${row.count} deals · avg ${row.avgScore.toFixed(2)}`);
    });
  }

  lines.push("");
  lines.push("SECCIÓN 4 — SISTEMA");
  lines.push("- 🟢 Report pipeline generado correctamente");

  return lines.join("\n");
}

export function renderPipelineMarkdown(context: PipelineReportContext): string {
  const lines: string[] = [
    "# REPORTE PIPELINE (ET) — Operaciones",
    `**Generado:** ${context.generatedAtEt}`,
    "",
    "## Resumen",
    `- Total deals: **${context.totalDeals}**`,
    `- Score promedio ponderado: **${context.weightedAvgScore.toFixed(2)}**`,
    `- Lane dominante: **${context.topLane}**`,
    "",
    "## Pipeline por lane",
    "| Lane | Deals | Avg Score |",
    "| --- | ---: | ---: |",
  ];

  if (context.rows.length === 0) {
    lines.push("| Sin datos suficientes | 0 | 0.00 |");
  } else {
    context.rows.forEach((row) => {
      lines.push(`| ${row.status} | ${row.count} | ${row.avgScore.toFixed(2)} |`);
    });
  }

  lines.push("");
  lines.push("## Sistema");
  lines.push("- Estado: OK");
  return lines.join("\n");
}

export function renderPipelineHtml(context: PipelineReportContext): string {
  const rowHtml =
    context.rows.length === 0
      ? `<tr><td colspan="3" style="padding:12px;color:#8888a0;">Sin datos suficientes</td></tr>`
      : context.rows
          .map(
            (row) =>
              `<tr><td style="padding:12px;border-top:1px solid #2a2a35;">${escapeHtml(row.status)}</td><td style="padding:12px;border-top:1px solid #2a2a35;text-align:right;">${row.count}</td><td style="padding:12px;border-top:1px solid #2a2a35;text-align:right;">${row.avgScore.toFixed(2)}</td></tr>`,
          )
          .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Prive Pipeline Report</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0f;color:#f0f0f5;font-family:Helvetica,Arial,sans-serif;">
  <div style="max-width:760px;margin:24px auto;background:#111118;border:1px solid #2a2a35;border-radius:12px;overflow:hidden;">
    <div style="background:#0f172a;padding:18px 20px;border-bottom:3px solid #c9a96e;">
      <div style="font-size:11px;letter-spacing:.1em;color:#94a3b8;text-transform:uppercase;">Pipeline Report</div>
      <div style="font-size:22px;font-weight:600;color:#f8fafc;margin-top:4px;">REPORTE PIPELINE (ET) — Operaciones</div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px;">Generado: ${escapeHtml(context.generatedAtEt)}</div>
    </div>
    <div style="padding:18px 20px;">
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:18px;">
        <div style="background:#0f1b2e;border:1px solid #2a2a35;border-radius:8px;padding:12px;">
          <div style="font-size:10px;color:#7aa2f7;text-transform:uppercase;letter-spacing:.08em;">Total Deals</div>
          <div style="font-size:24px;font-weight:700;margin-top:4px;">${context.totalDeals}</div>
        </div>
        <div style="background:#1f1a07;border:1px solid #2a2a35;border-radius:8px;padding:12px;">
          <div style="font-size:10px;color:#eab308;text-transform:uppercase;letter-spacing:.08em;">Avg Score</div>
          <div style="font-size:24px;font-weight:700;margin-top:4px;">${context.weightedAvgScore.toFixed(2)}</div>
        </div>
        <div style="background:#102116;border:1px solid #2a2a35;border-radius:8px;padding:12px;">
          <div style="font-size:10px;color:#22c55e;text-transform:uppercase;letter-spacing:.08em;">Top Lane</div>
          <div style="font-size:16px;font-weight:700;margin-top:8px;">${escapeHtml(context.topLane)}</div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;background:#0e0e14;border:1px solid #2a2a35;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#151521;">
            <th style="padding:10px 12px;text-align:left;color:#8888a0;font-size:11px;text-transform:uppercase;letter-spacing:.08em;">Lane</th>
            <th style="padding:10px 12px;text-align:right;color:#8888a0;font-size:11px;text-transform:uppercase;letter-spacing:.08em;">Deals</th>
            <th style="padding:10px 12px;text-align:right;color:#8888a0;font-size:11px;text-transform:uppercase;letter-spacing:.08em;">Avg Score</th>
          </tr>
        </thead>
        <tbody>${rowHtml}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}
