import { IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InitiateKycDto {
  @ApiProperty({ example: 'IN', description: 'ISO 3166 alpha-2 country code' })
  @IsString()
  @Length(2, 2)
  jurisdiction: string;
}
