import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: {
    email: string;
    passwordHash: string;
    role: 'INVESTOR' | 'ISSUER';
    emailToken: string;
  }) {
    // Auto-verify email in non-production so testnet registrations work without email flow
    const autoVerify = process.env['NODE_ENV'] !== 'production';
    return this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        role: data.role,
        emailToken: data.emailToken,
        emailVerified: autoVerify,
      },
      select: { id: true, email: true, role: true, status: true, createdAt: true },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        role: true,
        status: true,
        emailVerified: true,
        mfaEnabled: true,
        mfaSecret: true,
        kycProfile: { select: { tier: true } },
      },
    });
  }

  async findById(id: string) {
    return this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        emailVerified: true,
        mfaEnabled: true,
        kycProfile: { select: { tier: true } },
      },
    });
  }

  async findByEmailToken(token: string) {
    return this.prisma.user.findFirst({
      where: { emailToken: token, deletedAt: null },
    });
  }

  async markEmailVerified(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true, emailToken: null },
      select: { id: true, email: true },
    });
  }

  async createSession(userId: string, refreshToken: string, expiresAt: Date) {
    return this.prisma.session.create({
      data: { userId, refreshToken, expiresAt },
    });
  }

  async findSession(refreshToken: string) {
    return this.prisma.session.findFirst({
      where: { refreshToken },
    });
  }

  async revokeSession(refreshToken: string) {
    return this.prisma.session.updateMany({
      where: { refreshToken },
      data: { revokedAt: new Date() },
    });
  }

  async updateStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED') {
    return this.prisma.user.update({
      where: { id: userId },
      data: { status },
      select: { id: true, status: true },
    });
  }

  async updateRole(userId: string, role: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { role: role as any },
      select: { id: true, role: true },
    });
  }
}
