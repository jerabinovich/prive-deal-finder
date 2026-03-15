import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.module";
import { DealsModule } from "../deals/deals.module";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";

@Module({
  imports: [DealsModule, AgentsModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
