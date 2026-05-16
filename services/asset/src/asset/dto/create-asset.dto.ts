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

  @ApiPropertyOptional({ description: 'What 1 token represents (e.g. "1 GLDX = 1 gram of 999.9 fine gold")' })
  @IsString()
  @IsOptional()
  tokenizationRatio?: string;

  @ApiPropertyOptional({ description: 'SPV legal entity holding the asset on behalf of token holders' })
  @IsString()
  @IsOptional()
  spvEntityName?: string;

  @ApiPropertyOptional({ description: 'Licensed custodian holding the physical asset' })
  @IsString()
  @IsOptional()
  custodianName?: string;

  @ApiPropertyOptional({ description: 'ISO 3166 country code of the custodian jurisdiction' })
  @IsString()
  @IsOptional()
  custodianJurisdiction?: string;

  @ApiPropertyOptional({ description: 'Algorand txId of the issuer liquidity deposit transaction (also stored as initialLiquidityTxId)' })
  @IsString()
  @IsOptional()
  initialLiquidityTxId?: string;

  @ApiPropertyOptional({ description: 'USDC amount the issuer deposits at launch to receive their initial token allocation (micro-USDC)' })
  @Transform(({ value }) => (value !== undefined ? BigInt(value) : undefined))
  @IsOptional()
  liquidityDepositUsdc?: bigint;

  @ApiPropertyOptional({ description: 'Algorand txId of the issuer liquidity deposit transaction' })
  @IsString()
  @IsOptional()
  liquidityDepositTxId?: string;

  @ApiPropertyOptional({ description: 'Issuer Pera wallet address — tokens are automatically sent here on ASA deployment' })
  @IsString()
  @IsOptional()
  issuerWalletAddress?: string;
}
