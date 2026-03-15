import { IsIn, IsString, IsUrl } from "class-validator";

export const DEAL_DOCUMENT_KINDS = ["OM", "FLYER", "BROCHURE", "RENT_ROLL", "OTHER"] as const;

export class CreateDealDocumentDto {
  @IsString()
  @IsIn(DEAL_DOCUMENT_KINDS)
  kind!: (typeof DEAL_DOCUMENT_KINDS)[number];

  @IsString()
  title!: string;

  @IsString()
  @IsUrl()
  url!: string;
}
