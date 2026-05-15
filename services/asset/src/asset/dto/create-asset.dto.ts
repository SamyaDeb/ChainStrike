import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsEnum, IsInt, IsOptional, IsDefined, Min, Max, MinLength, MaxLength, Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';

export enum AssetCategory {
  PRECIOUS_METALS = 'PRECIOUS_METALS',
  REAL_ESTATE = 'REAL_ESTATE',
  PRIVATE_DEBT = 'PRIVATE_DEBT',
  CORPORATE_BOND = 'CORPORATE_BOND',
  COMMODITY = 'COMMODITY',
  PRIVATE_EQUITY = 'PRIVATE_EQUITY',
}

export class CreateAssetDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  name: string;

  @ApiProperty({ example: 'GLDX' })
  @IsString()
  @Matches(/^[A-Z0-9]{2,8}$/, { message: 'Ticker must be 2-8 uppercase alphanumeric characters' })
  ticker: string;

  @ApiProperty({ enum: AssetCategory })
  @IsEnum(AssetCategory)
  category: AssetCategory;

  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(2000)
  description: string;

  @ApiProperty({ description: 'Total supply in base units (e.g. 1_000_000_000_000 for 1M tokens with 6 decimals)' })
  @IsDefined()
  @Transform(({ value }) => BigInt(value))
  totalSupply: bigint;

  @ApiProperty({ default: 6 })
  @IsInt()
  @Min(0)
  @Max(6)
  decimals: number;

  @ApiProperty({ description: 'Price per token in micro-USDC (6 decimal places)' })
  @IsDefined()
  @Transform(({ value }) => BigInt(value))
  pricePerToken: bigint;

  @ApiPropertyOptional({ default: 0 })
  @IsInt()
  @Min(0)
  @IsOptional()
  lockupDays?: number;

  @ApiPropertyOptional({ default: 1, description: 'Minimum KYC tier required (1-3)' })
  @IsInt()
  @Min(1)
  @Max(3)
  @IsOptional()
  minimumKycTier?: number;

  @ApiPropertyOptional({ description: 'Minimum investment in micro-USDC' })
  @Transform(({ value }) => (value !== undefined ? BigInt(value) : undefined))
  @IsOptional()
  minimumInvestment?: bigint;

  @ApiPropertyOptional({ description: 'Maximum investment in micro-USDC' })
  @Transform(({ value }) => (value !== undefined ? BigInt(value) : undefined))
  @IsOptional()
  maximumInvestment?: bigint;
}
