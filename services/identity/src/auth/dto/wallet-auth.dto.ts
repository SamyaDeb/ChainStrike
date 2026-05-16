import { IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WalletChallengeDto {
  @ApiProperty({ description: 'Algorand wallet address requesting a login challenge' })
  @IsString()
  @Matches(/^[A-Z2-7]{58}$/, { message: 'Invalid Algorand address' })
  address: string;
}

export class WalletLoginDto {
  @ApiProperty({ description: 'Algorand wallet address' })
  @IsString()
  @Matches(/^[A-Z2-7]{58}$/, { message: 'Invalid Algorand address' })
  address: string;

  @ApiProperty({ description: 'Nonce returned by /auth/wallet-challenge' })
  @IsString()
  nonce: string;

  @ApiProperty({ description: 'Base64-encoded Ed25519 signature of the nonce (via Pera signData)' })
  @IsString()
  signature: string;
}
