import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { UserRepository } from './user.repository';
import { RegisterDto } from '../auth/dto/register.dto';

@Injectable()
export class UserService {
  constructor(private readonly userRepo: UserRepository) {}

  async create(dto: RegisterDto) {
    const existing = await this.userRepo.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already registered');

    // argon2id is the current OWASP-recommended password hashing algorithm
    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: 65536,  // 64 MiB
      timeCost: 3,
      parallelism: 4,
    });

    const emailToken = randomBytes(32).toString('hex');
    const role = dto.role.toUpperCase() as 'INVESTOR' | 'ISSUER';

    const user = await this.userRepo.create({
      email: dto.email.toLowerCase().trim(),
      passwordHash,
      role,
      emailToken,
      fullName: dto.fullName?.trim() || undefined,
    });

    if (dto.walletAddress) {
      await this.userRepo.addWalletAddress(user.id, dto.walletAddress);
    }

    return user;
  }

  async verifyEmail(token: string) {
    const user = await this.userRepo.findByEmailToken(token);
    if (!user) throw new NotFoundException('Invalid or expired verification token');
    return this.userRepo.markEmailVerified(user.id);
  }

  async findByEmail(email: string) {
    return this.userRepo.findByEmail(email.toLowerCase().trim());
  }

  async findById(id: string) {
    return this.userRepo.findById(id);
  }

  async findByEmailToken(token: string) {
    return this.userRepo.findByEmailToken(token);
  }

  async createSession(userId: string, refreshToken: string, expiresAt: Date) {
    return this.userRepo.createSession(userId, refreshToken, expiresAt);
  }

  async findSession(refreshToken: string) {
    return this.userRepo.findSession(refreshToken);
  }

  async revokeSession(refreshToken: string) {
    return this.userRepo.revokeSession(refreshToken);
  }

  async updateStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED', reason?: string) {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    return this.userRepo.updateStatus(userId, status);
  }

  async addWalletAddress(userId: string, address: string) {
    return this.userRepo.addWalletAddress(userId, address);
  }

  async findByWalletAddress(address: string) {
    return this.userRepo.findByWalletAddress(address);
  }

  async setRole(userId: string, role: string) {
    return this.userRepo.updateRole(userId, role);
  }

  // Auto-register a wallet-only account (no email/password required).
  // Used by walletLogin when no existing account is linked to the address.
  async createWalletOnlyAccount(walletAddress: string): Promise<{ id: string; email: string; role: string; status: string; emailVerified: boolean; kycProfile: null }> {
    // Generate a deterministic placeholder email from the wallet address
    const shortAddr = walletAddress.slice(0, 8).toLowerCase();
    const placeholderEmail = `wallet-${shortAddr}@chainstrike.testnet`;

    // If placeholder email already exists (race condition), use the existing user
    const existing = await this.userRepo.findByEmail(placeholderEmail);
    if (existing) {
      await this.userRepo.addWalletAddress(existing.id, walletAddress);
      return { ...existing, kycProfile: null };
    }

    const passwordHash = await argon2.hash(randomBytes(32).toString('hex'), {
      type: argon2.argon2id,
    });
    const user = await this.userRepo.create({
      email: placeholderEmail,
      passwordHash,
      role: 'INVESTOR',
      emailToken: randomBytes(32).toString('hex'),
    });
    await this.userRepo.addWalletAddress(user.id, walletAddress);
    return { ...user, emailVerified: true, kycProfile: null };
  }
}
