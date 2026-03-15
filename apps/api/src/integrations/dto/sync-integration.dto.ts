import { IsBoolean, IsOptional } from "class-validator";

export class SyncIntegrationDto {
  @IsOptional()
  @IsBoolean()
  confirmPaidDataUse?: boolean;
}
