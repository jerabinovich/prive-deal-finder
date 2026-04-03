import { Injectable } from "@nestjs/common";
import { PrismaService } from "../shared/prisma.service";
import { PipelineQueryDto } from "./dto/pipeline-query.dto";
import { buildPipelineContext, renderPipelineHtml, renderPipelineMarkdown, renderPipelineTelegram } from "./report-renderers";

export interface PipelineRow {
  status: string;
  count: number;
  avgScore: number;
}

function escapePdfText(input: string) {
  return input.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildSimplePdf(lines: string[]): Buffer {
  const streamLines = ["BT", "/F1 12 Tf", "50 780 Td"];

  lines.forEach((line, index) => {
    if (index > 0) {
      streamLines.push("0 -18 Td");
    }
    streamLines.push(`(${escapePdfText(line)}) Tj`);
  });

  streamLines.push("ET");
  const stream = streamLines.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];

  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async pipelineSummary(query: PipelineQueryDto = {}): Promise<PipelineRow[]> {
    const deals = await this.prisma.deal.groupBy({
      by: ["status"],
      _count: { status: true },
      _avg: { score: true },
    });

    const rows = deals.map((row: any) => ({
      status: row.status,
      count: row._count.status,
      avgScore: row._avg.score ?? 0,
    }));

    const filtered = rows.filter((row) => {
      if (query.status?.trim() && row.status.toLowerCase() !== query.status.trim().toLowerCase()) return false;
      if (typeof query.minCount === "number" && row.count < query.minCount) return false;
      return true;
    });

    const sortBy = query.sortBy ?? "count";
    const sortDir = query.sortDir === "asc" ? "asc" : "desc";

    return filtered.sort((a, b) => {
      const direction = sortDir === "asc" ? 1 : -1;
      if (sortBy === "status") return a.status.localeCompare(b.status) * direction;
      if (sortBy === "avgScore") return (a.avgScore - b.avgScore) * direction;
      return (a.count - b.count) * direction;
    });
  }

  async pipelineCsv(query: PipelineQueryDto = {}): Promise<string> {
    const rows = await this.pipelineSummary(query);
    const lines = ["status,count,avgScore"];
    rows.forEach((row) => {
      lines.push(`${row.status},${row.count},${row.avgScore.toFixed(2)}`);
    });
    return lines.join("\n");
  }

  async pipelinePdf(query: PipelineQueryDto = {}): Promise<Buffer> {
    const rows = await this.pipelineSummary(query);
    const lines = ["Prive Deal Finder - Pipeline Report", ""];

    rows.forEach((row) => {
      lines.push(`Status: ${row.status} | Count: ${row.count} | Avg Score: ${row.avgScore.toFixed(2)}`);
    });

    if (rows.length === 0) {
      lines.push("No pipeline rows found.");
    }

    return buildSimplePdf(lines);
  }

  async pipelineTelegram(query: PipelineQueryDto = {}): Promise<string> {
    const rows = await this.pipelineSummary(query);
    return renderPipelineTelegram(buildPipelineContext(rows));
  }

  async pipelineMarkdown(query: PipelineQueryDto = {}): Promise<string> {
    const rows = await this.pipelineSummary(query);
    return renderPipelineMarkdown(buildPipelineContext(rows));
  }

  async pipelineHtml(query: PipelineQueryDto = {}): Promise<string> {
    const rows = await this.pipelineSummary(query);
    return renderPipelineHtml(buildPipelineContext(rows));
  }

  async pipelineChannels(query: PipelineQueryDto = {}) {
    const rows = await this.pipelineSummary(query);
    const context = buildPipelineContext(rows);
    return {
      context,
      telegram: renderPipelineTelegram(context),
      markdown: renderPipelineMarkdown(context),
      html: renderPipelineHtml(context),
    };
  }
}
