import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Min } from "class-validator";

export class PipelineQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minCount?: number;

  @IsOptional()
  @IsString()
  @IsIn(["status", "count", "avgScore"])
  sortBy?: "status" | "count" | "avgScore";

  @IsOptional()
  @IsString()
  @IsIn(["asc", "desc"])
  sortDir?: "asc" | "desc";
}
