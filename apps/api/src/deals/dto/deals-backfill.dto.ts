import { Type } from "class-transformer";
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class DealsBackfillDto {
  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  market?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  onlyMissingFacts?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  recomputeComparables?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  recomputeInsights?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  dryRun?: boolean;
}
