import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import algosdk from 'algosdk';
import nacl from 'tweetnacl';
import { jwtConfig } from '@chainstrike/config';
import { AuthTokens, JwtPayload } from '@chainstrike/types';
import { UserService } from '../user/user.service';

interface ChallengeEntry {
  nonce: string;
  expiresAt: number;
}

// Wallet address that is always granted ADMIN role on sign-in.
const ADMIN_WALLET_ADDRESS =
  process.env.ADMIN_WALLET_ADDRESS ??
  'HMPG7YLTESN4FQXIGCAHQOXDEIDUIFBOINJDGQ7WUFBTYMOIKDIN6CITPM';

@Injectable()
export class AuthService {
  // In-memory nonce store — keyed by wallet address, TTL 5 minutes
  private readonly challengeStore = new Map<string, ChallengeEntry>();

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

    if (!user.emailVerified && process.env['NODE_ENV'] === 'production') {
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

  walletChallenge(address: string): { nonce: string; expiresAt: number } {
    const nonce = `chainstrike-login:${randomBytes(16).toString('hex')}:${Date.now()}`;
    const expiresAt = Date.now() + 5 * 60 * 1000;
    this.challengeStore.set(address, { nonce, expiresAt });
    return { nonce, expiresAt };
  }

  async walletLogin(address: string, nonce: string, signature: string): Promise<AuthTokens> {
    const entry = this.challengeStore.get(address);
    if (!entry || entry.nonce !== nonce || Date.now() > entry.expiresAt) {
      throw new UnauthorizedException('Invalid or expired wallet challenge');
    }
    this.challengeStore.delete(address);

    const valid = this.verifySignedTransaction(address, nonce, signature);
    if (!valid) throw new UnauthorizedException('Wallet signature verification failed');

    let user = await this.userService.findByWalletAddress(address);

    // Auto-register: first-time wallet login creates an investor account linked to this address
    if (!user) {
      user = await this.userService.createWalletOnlyAccount(address) as any;
    }

    if ((user as any).status === 'SUSPENDED') throw new ForbiddenException('Account suspended');

    // Designated admin wallet: ensure the linked account always has ADMIN role
    // so the issued JWT authorizes admin access across all services.
    if (address === ADMIN_WALLET_ADDRESS && (user as any).role !== 'ADMIN') {
      await this.userService.setRole((user as any).id, 'ADMIN');
      (user as any).role = 'ADMIN';
    }

    return this.issueTokens(user as any);
  }

  private verifySignedTransaction(address: string, nonce: string, signatureB64: string): boolean {
    try {
      const sig = Buffer.from(signatureB64, 'base64');
      const pubKey = algosdk.decodeAddress(address).publicKey;

      // Pera signData prepends "MX" before hashing — primary verification path
      if (sig.length === 64) {
        const msgMX = Buffer.concat([Buffer.from('MX'), Buffer.from(nonce)]);
        if (nacl.sign.detached.verify(msgMX, sig, pubKey)) return true;
      }

      // Fallback: full signed Algorand transaction (other wallet providers)
      const decoded = algosdk.decodeSignedTransaction(sig);
      if (decoded.txn.sender.toString() !== address) return false;
      const note = decoded.txn.note ? new TextDecoder().decode(decoded.txn.note) : '';
      if (note !== nonce) return false;
      const txnBytes = algosdk.encodeUnsignedTransaction(decoded.txn);
      const msgTX = new Uint8Array([...Buffer.from('TX'), ...txnBytes]);
      return nacl.sign.detached.verify(msgTX, decoded.sig!, pubKey);
    } catch {
      return false;
    }
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
