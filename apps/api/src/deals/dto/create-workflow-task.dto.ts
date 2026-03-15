import { IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min } from "class-validator";

export class CreateWorkflowTaskDto {
  @IsString()
  taskType!: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @IsIn([
    "DISTRESS_OWNER",
    "AUCTION_MONITOR",
    "GOV_LAND_P3",
    "OFF_MARKET_STANDARD",
    "NON_ACQUIRABLE_NOISE",
    "RESEARCH_REQUIRED",
  ])
  lane?:
    | "DISTRESS_OWNER"
    | "AUCTION_MONITOR"
    | "GOV_LAND_P3"
    | "OFF_MARKET_STANDARD"
    | "NON_ACQUIRABLE_NOISE"
    | "RESEARCH_REQUIRED";

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  priority?: number;

  @IsOptional()
  @IsString()
  @IsIn(["TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELED"])
  status?: "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELED";

  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @IsOptional()
  @IsString()
  @IsIn(["AGENT", "SYSTEM", "USER"])
  source?: "AGENT" | "SYSTEM" | "USER";

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
