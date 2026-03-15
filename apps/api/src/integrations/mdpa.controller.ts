import { Body, Controller, Get, Post } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator";
import { MdpaImportDto } from "./dto/mdpa-import.dto";
import { IntegrationsService } from "./integrations.service";

@Controller("mdpa")
export class MdpaController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get("catalog")
  async catalog() {
    return this.integrationsService.mdpaCatalog();
  }

  @Roles("ADMIN")
  @Post("import")
  async import(@Body() body: MdpaImportDto) {
    return this.integrationsService.importMdpaDataset(body);
  }
}

