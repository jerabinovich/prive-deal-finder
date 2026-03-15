import { Transform, Type } from "class-transformer";
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class ListDealsQueryDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "boolean") return value;
    const normalized = String(value).trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    return undefined;
  })
  isNoise?: boolean;

  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  market?: string;

  @IsOptional()
  @IsString()
  assetType?: string;

  @IsOptional()
  @IsString()
  propertyUseCode?: string;

  @IsOptional()
  @IsString()
  parcelId?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  @IsIn(["PIPELINE_LISTING", "WATCHLIST", "TRUE_OPPORTUNITY", "DISTRESS_CANDIDATE"])
  classification?: "PIPELINE_LISTING" | "WATCHLIST" | "TRUE_OPPORTUNITY" | "DISTRESS_CANDIDATE";

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
  @IsString()
  @IsIn(["CONTACT_NOW", "MONITOR", "AUCTION_PREP", "GOV_PURSUE", "RESEARCH", "ARCHIVE"])
  recommendedAction?: "CONTACT_NOW" | "MONITOR" | "AUCTION_PREP" | "GOV_PURSUE" | "RESEARCH" | "ARCHIVE";

  @IsOptional()
  @IsString()
  @IsIn([
    "NONE",
    "SIGNALS_ONLY",
    "PRE_FORECLOSURE",
    "AUCTION_SCHEDULED",
    "AUCTION_POSTPONED_OR_CANCELLED",
    "REO_BANK_OWNED",
    "SHORT_SALE_ACTIVE",
    "TAX_SALE_PROCESS",
    "PROBATE_ESTATE",
    "CODE_ENFORCEMENT",
    "BANKRUPTCY",
    "GOVERNMENT_LAND",
    "UNKNOWN",
  ])
  distressStage?:
    | "NONE"
    | "SIGNALS_ONLY"
    | "PRE_FORECLOSURE"
    | "AUCTION_SCHEDULED"
    | "AUCTION_POSTPONED_OR_CANCELLED"
    | "REO_BANK_OWNED"
    | "SHORT_SALE_ACTIVE"
    | "TAX_SALE_PROCESS"
    | "PROBATE_ESTATE"
    | "CODE_ENFORCEMENT"
    | "BANKRUPTCY"
    | "GOVERNMENT_LAND"
    | "UNKNOWN";

  @IsOptional()
  @IsString()
  ownerType?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  @Max(100)
  contactability?: number;

  @IsOptional()
  @IsDateString()
  nextEventFrom?: string;

  @IsOptional()
  @IsDateString()
  nextEventTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minScore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Max(100)
  maxScore?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsString()
  @IsIn([
    "name",
    "market",
    "assetType",
    "propertyUseCode",
    "score",
    "classification",
    "lane",
    "recommendedAction",
    "distressStage",
    "nextEventDate",
    "contactabilityScore",
    "status",
    "updatedAt",
  ])
  sortBy?:
    | "name"
    | "market"
    | "assetType"
    | "propertyUseCode"
    | "score"
    | "classification"
    | "lane"
    | "recommendedAction"
    | "distressStage"
    | "nextEventDate"
    | "contactabilityScore"
    | "status"
    | "updatedAt";

  @IsOptional()
  @IsString()
  @IsIn(["asc", "desc"])
  sortDir?: "asc" | "desc";
}
