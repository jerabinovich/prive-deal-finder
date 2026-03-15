import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { Response } from "express";
import { CreateDealDto } from "./dto/create-deal.dto";
import { CreateDealDocumentDto } from "./dto/create-deal-document.dto";
import { CreateDealMediaDto } from "./dto/create-deal-media.dto";
import { CreateWorkflowTaskDto } from "./dto/create-workflow-task.dto";
import { DealsBackfillDto } from "./dto/deals-backfill.dto";
import { ListDealsQueryDto } from "./dto/list-deals-query.dto";
import { ProjectionScenarioDto } from "./dto/projection-scenario.dto";
import { UpdateDealDto } from "./dto/update-deal.dto";
import { UpdateWorkflowTaskDto } from "./dto/update-workflow-task.dto";
import { DealsService } from "./deals.service";
import { Roles } from "../auth/roles.decorator";

@Controller("deals")
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get()
  async list(@Query() query: ListDealsQueryDto) {
    return this.dealsService.list(query);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get("facets")
  async facets(@Query() query: ListDealsQueryDto) {
    return this.dealsService.getFacets(query);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get(":id")
  async get(@Param("id") id: string) {
    return this.dealsService.getById(id);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get(":id/overview")
  async overview(@Param("id") id: string) {
    const overview = await this.dealsService.getOverview(id);
    if (!overview) {
      throw new NotFoundException("Deal not found");
    }
    return overview;
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get(":id/opportunity-summary")
  async opportunitySummary(@Param("id") id: string) {
    return this.dealsService.getOpportunitySummary(id);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get(":id/data-quality")
  async dataQuality(@Param("id") id: string) {
    return this.dealsService.getDataQuality(id);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Post(":id/projections")
  async projections(@Param("id") id: string, @Body() body: ProjectionScenarioDto) {
    return this.dealsService.buildProjection(id, body);
  }

  @Roles("ADMIN")
  @Post()
  async create(@Body() body: CreateDealDto) {
    return this.dealsService.create(body);
  }

  @Roles("ADMIN", "ANALYST")
  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: UpdateDealDto) {
    return this.dealsService.update(id, body);
  }

  @Roles("ADMIN")
  @Post(":id/media")
  async createMedia(@Param("id") id: string, @Body() body: CreateDealMediaDto) {
    return this.dealsService.createMedia(id, body);
  }

  @Roles("ADMIN")
  @Post(":id/documents")
  async createDocument(@Param("id") id: string, @Body() body: CreateDealDocumentDto) {
    return this.dealsService.createDocument(id, body);
  }

  @Roles("ADMIN")
  @Post(":id/recompute-comps")
  async recomputeComps(@Param("id") id: string) {
    return this.dealsService.recomputeComparables(id);
  }

  @Roles("ADMIN")
  @Post(":id/recompute-insights")
  async recomputeInsights(@Param("id") id: string) {
    return this.dealsService.recomputeInsights(id);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get(":id/workflow")
  async workflow(@Param("id") id: string) {
    return this.dealsService.getWorkflow(id);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Post(":id/workflow/tasks")
  async createWorkflowTask(@Param("id") id: string, @Body() body: CreateWorkflowTaskDto) {
    return this.dealsService.createWorkflowTask(id, body);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Patch(":id/workflow/tasks/:taskId")
  async updateWorkflowTask(@Param("id") id: string, @Param("taskId") taskId: string, @Body() body: UpdateWorkflowTaskDto) {
    return this.dealsService.updateWorkflowTask(id, taskId, body);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Post(":id/refresh-facts")
  async refreshFacts(@Param("id") id: string) {
    return this.dealsService.refreshFacts(id);
  }

  @Roles("ADMIN")
  @Post("backfill-facts")
  async backfillFacts(@Body() body: DealsBackfillDto) {
    return this.dealsService.backfillFacts(body);
  }

  @Roles("ADMIN")
  @Post("recompute-triage")
  async recomputeTriage(@Body() body: { limit?: number; onlyMissingLane?: boolean } = {}) {
    return this.dealsService.recomputeOperationalTriage(body);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get(":id/export")
  async export(@Param("id") id: string, @Query("format") format = "json", @Res() res: Response) {
    const deal = await this.dealsService.getById(id);
    if (!deal) {
      throw new NotFoundException("Deal not found");
    }

    if (format === "csv") {
      const headers = [
        "id",
        "name",
        "address",
        "mailingAddress",
        "city",
        "municipality",
        "state",
        "zip",
        "assetType",
        "propertyUseCode",
        "market",
        "latitude",
        "longitude",
        "lotSizeSqft",
        "buildingSizeSqft",
        "yearBuilt",
        "zoning",
        "askingPrice",
        "pricePerSqft",
        "dataCompletenessScore",
        "score",
        "pipelineScore",
        "classification",
        "status",
      ];
      const values = [
        deal.id,
        deal.name,
        deal.address ?? "",
        deal.mailingAddress ?? "",
        deal.city ?? "",
        deal.municipality ?? "",
        deal.state ?? "",
        deal.zip ?? "",
        deal.assetType ?? "",
        deal.propertyUseCode ?? "",
        deal.market ?? "",
        deal.latitude ?? "",
        deal.longitude ?? "",
        deal.lotSizeSqft ?? "",
        deal.buildingSizeSqft ?? "",
        deal.yearBuilt ?? "",
        deal.zoning ?? "",
        deal.askingPrice ?? "",
        deal.pricePerSqft ?? "",
        deal.dataCompletenessScore ?? "",
        deal.score ?? "",
        (deal as { pipelineScore?: number | null }).pipelineScore ?? deal.score ?? "",
        (deal as { classification?: string | null }).classification ?? "",
        deal.status,
      ];
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="deal-${deal.id}.csv"`);
      res.send(`${headers.join(",")}\n${values.join(",")}`);
      return;
    }

    return res.json(deal);
  }
}
