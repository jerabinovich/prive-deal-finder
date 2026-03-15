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
}
