import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUrl, Min } from "class-validator";

export const DEAL_MEDIA_KINDS = ["PHOTO", "VIDEO"] as const;

export class CreateDealMediaDto {
  @IsString()
  @IsIn(DEAL_MEDIA_KINDS)
  kind!: (typeof DEAL_MEDIA_KINDS)[number];

  @IsString()
  @IsUrl()
  url!: string;

  @IsOptional()
  @IsString()
  caption?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
