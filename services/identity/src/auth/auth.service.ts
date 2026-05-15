import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { jwtConfig } from '@chainstrike/config';
import { AuthTokens, JwtPayload } from '@chainstrike/types';
import { UserService } from '../user/user.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  async login(email: string, password: string): Promise<AuthTokens> {
    const user = await this.userService.findByEmail(email);
    if (!user) {
      // Constant-time comparison to prevent timing attacks
      await argon2.hash('dummy-password-for-timing-safety');
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('Account suspended');
    }

    const passwordValid = await argon2.verify(user.passwordHash, password);
    if (!passwordValid) throw new UnauthorizedException('Invalid credentials');

    if (!user.emailVerified) {
      throw new ForbiddenException('Email not verified. Check your inbox.');
    }

    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const session = await this.userService.findSession(refreshToken);
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const user = await this.userService.findById(session.userId);
    if (!user) throw new UnauthorizedException('User not found');

    // Rotate: revoke old session and issue new tokens
    await this.userService.revokeSession(refreshToken);
    return this.issueTokens(user);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.userService.revokeSession(refreshToken);
  }

  private async issueTokens(user: {
    id: string;
    email: string;
    role: string;
    kycTier?: number;
  }): Promise<AuthTokens> {
    const cfg = jwtConfig();
    const kycTier = (user.kycTier ?? 0) as 0 | 1 | 2 | 3;

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      email: user.email,
      role: user.role as JwtPayload['role'],
      kycTier,
    };

    const accessToken = this.jwtService.sign(payload);

    const refreshToken = randomBytes(40).toString('hex');
    const expiryMs = this.parseExpiry(cfg.refreshExpiry);
    await this.userService.createSession(user.id, refreshToken, new Date(Date.now() + expiryMs));

    return { accessToken, refreshToken, expiresIn: 900 }; // 15 min in seconds
  }

  private parseExpiry(expiry: string): number {
    const unit = expiry.slice(-1);
    const value = parseInt(expiry.slice(0, -1), 10);
    const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return value * (multipliers[unit] ?? 1000);
  }
}
