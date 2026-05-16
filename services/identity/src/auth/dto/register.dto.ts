import { IsEmail, IsString, MinLength, IsIn, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'investor@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 12, description: 'Minimum 12 chars, must include upper, lower, digit, symbol' })
  @IsString()
  @MinLength(12)
  password: string;

  @ApiProperty({ enum: ['investor', 'issuer'] })
  @IsIn(['investor', 'issuer'])
  role: 'investor' | 'issuer';

  @ApiPropertyOptional({ description: 'Algorand wallet address to associate with the account' })
  @IsString()
  @IsOptional()
  @Matches(/^[A-Z2-7]{58}$/, { message: 'Invalid Algorand address format' })
  walletAddress?: string;
}
