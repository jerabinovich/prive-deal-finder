import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { IntegrationsService } from "./integrations.service";
import { Roles } from "../auth/roles.decorator";
import { MdpaImportDto } from "./dto/mdpa-import.dto";
import { IntegrationRunsQueryDto } from "./dto/integration-runs-query.dto";
import { IntegrationStatusQueryDto } from "./dto/integration-status-query.dto";
import { SyncIntegrationDto } from "./dto/sync-integration.dto";

@Controller("integrations")
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get("status")
  async status(@Query() query: IntegrationStatusQueryDto) {
    return this.integrationsService.listStatus(query);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get("connected")
  async connected() {
    return this.integrationsService.listConnectedAndTested();
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get("runs")
  async runs(@Query() query: IntegrationRunsQueryDto) {
    return this.integrationsService.listRuns(query);
  }

  @Roles("ADMIN")
  @Post(":source/sync")
  async sync(@Param("source") source: string, @Body() body: SyncIntegrationDto) {
    return this.integrationsService.sync(source, body);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get("mdpa/catalog")
  async mdpaCatalog() {
    return this.integrationsService.mdpaCatalog();
  }

  @Roles("ADMIN")
  @Post("mdpa/import")
  async mdpaImport(@Body() body: MdpaImportDto) {
    return this.integrationsService.importMdpaDataset(body);
  }
}
