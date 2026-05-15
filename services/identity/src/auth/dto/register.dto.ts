import { IsEmail, IsString, MinLength, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

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
}
