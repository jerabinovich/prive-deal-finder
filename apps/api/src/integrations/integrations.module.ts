import { Module } from "@nestjs/common";
import { IntegrationsController } from "./integrations.controller";
import { IntegrationsService } from "./integrations.service";
import { MdpaController } from "./mdpa.controller";
import { MdpaIngestService } from "./mdpa.ingest";

@Module({
  controllers: [IntegrationsController, MdpaController],
  providers: [IntegrationsService, MdpaIngestService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
