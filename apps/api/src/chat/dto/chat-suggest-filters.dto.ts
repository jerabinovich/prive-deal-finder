import { IsString, MaxLength, ValidateIf } from "class-validator";

export class ChatSuggestFiltersDto {
  @ValidateIf((o: ChatSuggestFiltersDto) => !o.query && !o.question)
  @IsString()
  @MaxLength(1000)
  message?: string;

  @ValidateIf((o: ChatSuggestFiltersDto) => !o.message && !o.question)
  @IsString()
  @MaxLength(1000)
  query?: string;

  @ValidateIf((o: ChatSuggestFiltersDto) => !o.message && !o.query)
  @IsString()
  @MaxLength(1000)
  question?: string;
}
