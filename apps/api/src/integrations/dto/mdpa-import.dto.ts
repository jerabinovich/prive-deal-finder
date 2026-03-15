import { IsBoolean, IsIn, IsOptional, IsString } from "class-validator";

const DATASET_TYPES = [
  "MUNICIPAL_ROLLS",
  "SALES_INFO",
  "ROLL_EVENTS",
  "PROPERTY_INFO",
  "SPECIAL_REQUEST",
  "GENERIC",
] as const;

export class MdpaImportDto {
  @IsOptional()
  @IsIn(DATASET_TYPES)
  datasetType?: (typeof DATASET_TYPES)[number];

  @IsOptional()
  @IsString()
  filePath?: string;

  @IsOptional()
  @IsString()
  sourceUrl?: string;

  @IsOptional()
  @IsBoolean()
  confirmPaidDataUse?: boolean;
}

