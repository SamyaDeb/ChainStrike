import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsString, IsUUID, IsOptional, IsNumberString } from 'class-validator';

export enum OrderSide { BUY = 'BUY', SELL = 'SELL' }
export enum OrderType { LIMIT = 'LIMIT', MARKET = 'MARKET' }
export enum TimeInForce { GTC = 'GTC', IOC = 'IOC', FOK = 'FOK' }

export class PlaceOrderDto {
  @ApiProperty()
  @IsUUID()
  assetId: string;

  @ApiProperty({ enum: OrderSide })
  @IsEnum(OrderSide)
  side: OrderSide;

  @ApiProperty({ enum: OrderType })
  @IsEnum(OrderType)
  orderType: OrderType;

  @ApiProperty({ enum: TimeInForce })
  @IsEnum(TimeInForce)
  timeInForce: TimeInForce;

  @ApiPropertyOptional({ description: 'Limit price in micro-USDC (required for LIMIT orders)' })
  @IsNumberString()
  @IsOptional()
  price?: string;

  @ApiProperty({ description: 'Quantity in base token units' })
  @IsNumberString()
  quantity: string;

  @ApiProperty({ description: 'Algorand wallet address' })
  @IsString()
  walletAddress: string;

  @ApiPropertyOptional({ description: 'Escrow lock transaction ID (required for BUY orders)' })
  @IsOptional()
  @IsString()
  escrowTxId?: string;
}
