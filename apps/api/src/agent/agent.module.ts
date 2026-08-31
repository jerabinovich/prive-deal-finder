import { Module } from "@nestjs/common";
import { AgentDealsController } from "./agent-deals.controller";
import { DealsModule } from "../deals/deals.module";

@Module({
  imports: [DealsModule],
  controllers: [AgentDealsController],
})
export class AgentModule {}
