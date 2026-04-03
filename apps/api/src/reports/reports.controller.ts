import { Controller, Get, Query, Res } from "@nestjs/common";
import { Response } from "express";
import { ReportsService } from "./reports.service";
import { Roles } from "../auth/roles.decorator";
import { PipelineQueryDto } from "./dto/pipeline-query.dto";

@Controller("reports")
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get("pipeline")
  async pipeline(@Query() query: PipelineQueryDto) {
    return this.reportsService.pipelineSummary(query);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get("pipeline.csv")
  async pipelineCsv(@Query() query: PipelineQueryDto, @Res() res: Response) {
    const csv = await this.reportsService.pipelineCsv(query);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="pipeline-report.csv"');
    res.send(csv);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get("pipeline.pdf")
  async pipelinePdf(@Query() query: PipelineQueryDto, @Res() res: Response) {
    const pdf = await this.reportsService.pipelinePdf(query);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="pipeline-report.pdf"');
    res.send(pdf);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get("pipeline.telegram")
  async pipelineTelegram(@Query() query: PipelineQueryDto, @Res() res: Response) {
    const text = await this.reportsService.pipelineTelegram(query);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(text);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get("pipeline.md")
  async pipelineMarkdown(@Query() query: PipelineQueryDto, @Res() res: Response) {
    const markdown = await this.reportsService.pipelineMarkdown(query);
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.send(markdown);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get("pipeline.html")
  async pipelineHtml(@Query() query: PipelineQueryDto, @Res() res: Response) {
    const html = await this.reportsService.pipelineHtml(query);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get("pipeline.channels")
  async pipelineChannels(@Query() query: PipelineQueryDto) {
    return this.reportsService.pipelineChannels(query);
  }
}
