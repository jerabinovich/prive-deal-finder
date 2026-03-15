import { IsArray, IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateIf } from "class-validator";

export class ChatQueryDto {
  @ValidateIf((o: ChatQueryDto) => !o.query && !o.question)
  @IsString()
  @MaxLength(2000)
  message?: string;

  @ValidateIf((o: ChatQueryDto) => !o.message && !o.question)
  @IsString()
  @MaxLength(2000)
  query?: string;

  @ValidateIf((o: ChatQueryDto) => !o.message && !o.query)
  @IsString()
  @MaxLength(2000)
  question?: string;

  @IsOptional()
  @IsString()
  dealId?: string;

  @IsOptional()
  @IsString()
  market?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  @IsIn(["CHAT_COPILOT", "PIPELINE_TRIAGE", "DEAL_DEEP_DIVE", "GOV_LAND_PROFILE"])
  taskType?: "CHAT_COPILOT" | "PIPELINE_TRIAGE" | "DEAL_DEEP_DIVE" | "GOV_LAND_PROFILE";

  @IsOptional()
  @IsObject()
  appState?: {
    route?: string;
    selectedDealId?: string | null;
    selectedDealKey?: string | null;
    activeFiltersCount?: number;
    activeFilters?: Record<string, unknown>;
    pipelineVisibleRange?: string | null;
    pipelineVisibleRows?: Array<Record<string, unknown>>;
    integrationsSnapshot?: Array<Record<string, unknown>>;
    recentRuns?: Array<Record<string, unknown>>;
  };

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  uiCapabilities?: string[];
}
