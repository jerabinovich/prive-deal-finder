import { IsBoolean, IsIn, IsObject, IsOptional, IsString } from "class-validator";

export class CreateAlertRuleDto {
  @IsString()
  triggerType!: string;

  @IsOptional()
  @IsString()
  market?: string;

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
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @IsIn(["IN_APP", "DIGEST_DAILY"])
  delivery?: "IN_APP" | "DIGEST_DAILY";

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
