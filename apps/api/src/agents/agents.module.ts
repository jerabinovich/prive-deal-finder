import { Module } from "@nestjs/common";
import { DealsModule } from "../deals/deals.module";
import { IntegrationsModule } from "../integrations/integrations.module";
import { OutreachModule } from "../outreach/outreach.module";
import { OpenAIResponsesClient } from "./openai-responses.client";
import { AgentsService } from "./agents.service";
import { ToolRegistry } from "./tool-registry";

@Module({
  imports: [DealsModule, IntegrationsModule, OutreachModule],
  providers: [OpenAIResponsesClient, ToolRegistry, AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
