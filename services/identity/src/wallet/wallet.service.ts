import { Injectable, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import algosdk from 'algosdk';
import { WalletRepository } from './wallet.repository';
import { EventProducerService } from '../events/event-producer.service';
import { Topics } from '@chainstrike/events';
import { KycRepository } from '../kyc/kyc.repository';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly walletRepo: WalletRepository,
    private readonly kycRepo: KycRepository,
    private readonly events: EventProducerService,
  ) {}

  // ─── Connect wallet ───────────────────────────────────────────────────────────
  // Requires user to sign a challenge message to prove ownership of the address.
  // This is the only way we accept a wallet address — no self-reporting.

  async connectWallet(
    userId: string,
    address: string,
    signedChallenge: string,
    challenge: string,
    network: string,
  ) {
    // Validate Algorand address format
    if (!algosdk.isValidAddress(address)) {
      throw new BadRequestException('Invalid Algorand address');
    }

    // Verify the signature proves ownership of the address
    const isValid = this.verifyAlgorandSignature(address, challenge, signedChallenge);
    if (!isValid) {
      throw new BadRequestException('Signature verification failed');
    }

    // Check if address already registered to another account
    const existing = await this.walletRepo.findByAddress(address);
    if (existing && existing.userId !== userId) {
      throw new ConflictException('Wallet already registered to another account');
    }

    const wallet = await this.walletRepo.upsert(userId, address, network);

    // If user has approved KYC, emit event so Compliance Service can whitelist
    const kycProfile = await this.kycRepo.findByUserId(userId);
    if (kycProfile?.status === 'APPROVED') {
      await this.events.emit(Topics.KYC_VERIFIED, {
        userId,
        walletAddress: address,
        tier: kycProfile.tier as 1 | 2 | 3,
        jurisdiction: kycProfile.jurisdiction,
        expiresAt: kycProfile.expiresAt?.toISOString() ?? '',
      });
    }

    return wallet;
  }

  async getWallets(userId: string) {
    return this.walletRepo.findByUserId(userId);
  }

  // ─── Generate challenge for wallet ownership proof ───────────────────────────

  generateChallenge(userId: string): string {
    const ts = Date.now();
    return `ChainStrike wallet verification: ${userId}:${ts}`;
  }

  private verifyAlgorandSignature(
    address: string,
    message: string,
    signatureB64: string,
  ): boolean {
    try {
      const encodedMessage = new TextEncoder().encode(message);
      const signature = Buffer.from(signatureB64, 'base64');
      return algosdk.verifyBytes(encodedMessage, signature, address);
    } catch {
      return false;
    }
  }
}
