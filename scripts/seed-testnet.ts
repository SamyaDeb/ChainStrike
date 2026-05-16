/**
 * Seed ChainStrike testnet with test data for end-to-end testing.
 *
 * Usage:
 *   npx ts-node --esm scripts/seed-testnet.ts
 *
 * Prerequisites:
 *   - .env configured with admin mnemonic
 *   - Services running (or at least databases accessible)
 *   - Admin account funded with testnet ALGO + USDC
 */

import * as dotenv from 'dotenv';
import path from 'path';
import algosdk from 'algosdk';
import { PrismaClient as IdentityPrismaClient } from '../node_modules/.prisma/identity-client/index.js';
import { PrismaClient as AssetPrismaClient } from '../node_modules/.prisma/asset-client/index.js';
import { PrismaClient as OrderbookPrismaClient } from '../node_modules/.prisma/orderbook-client/index.js';
import { PrismaClient as CompliancePrismaClient } from '../node_modules/.prisma/compliance-client/index.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ─── Config ──────────────────────────────────────────────────────────────────

const ADMIN_MNEMONIC = process.env.ALGORAND_ADMIN_MNEMONIC ?? '';
const ALGOD_SERVER = process.env.ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud';
const ALGOD_PORT = Number(process.env.ALGORAND_ALGOD_PORT ?? 443);
const ALGOD_TOKEN = process.env.ALGORAND_ALGOD_TOKEN ?? '';
const USDC_ASA_ID = Number(process.env.USDC_ASSET_ID ?? '10458941');

// ─── Test Data ───────────────────────────────────────────────────────────────

const TEST_USERS = [
  {
    email: 'admin@testnet.io',
    password: 'Admin@Test2024!',
    role: 'ADMIN',
    name: 'Admin User',
  },
  {
    email: 'compliance@testnet.io',
    password: 'Compliance@Test2024!',
    role: 'COMPLIANCE_OFFICER',
    name: 'Compliance Officer',
  },
  {
    email: 'issuer@testnet.io',
    password: 'Issuer@Test2024!',
    role: 'ISSUER',
    name: 'Test Issuer',
  },
  {
    email: 'investor@testnet.io',
    password: 'Investor@Test2024!',
    role: 'INVESTOR',
    name: 'Test Investor',
  },
];

const TEST_ASSET = {
  name: 'Test Gold Token',
  ticker: 'XGLD',
  category: 'PRECIOUS_METALS',
  description: 'Test gold-backed token for testnet trading',
  totalSupply: BigInt(1_000_000_000_000), // 1M tokens with 6 decimals
  decimals: 6,
  tokenizationRatio: '1 XGLD = 1 gram of 999.9 fine gold',
  minimumInvestment: BigInt(10_000_000), // 10 USDC
  lockupDays: 0,
  minimumKycTier: 1,
  custodianName: 'Test Custodian',
  custodianJurisdiction: 'SG',
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('ChainStrike Testnet Seeder');
  console.log('==========================\n');

  if (!ADMIN_MNEMONIC) {
    console.error('ERROR: ALGORAND_ADMIN_MNEMONIC not set in .env');
    process.exit(1);
  }

  const client = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_SERVER, ALGOD_PORT);
  const adminAccount = algosdk.mnemonicToSecretKey(ADMIN_MNEMONIC);

  // Verify balance
  const info = await client.accountInformation(adminAccount.addr.toString()).do();
  const balance = Number(info.amount) / 1_000_000;
  console.log(`Admin: ${adminAccount.addr.toString()}`);
  console.log(`Balance: ${balance.toFixed(4)} ALGO\n`);

  if (balance < 0.2) {
    console.error('ERROR: Insufficient ALGO. Fund at https://bank.testnet.algorand.network');
    process.exit(1);
  }

  // ─── Seed database ──────────────────────────────────────────────────────────
  console.log('[1/5] Connecting database…');

  const identityDb = new IdentityPrismaClient({
    datasources: { db: { url: process.env.IDENTITY_DATABASE_URL } },
  });
  const assetDb = new AssetPrismaClient({
    datasources: { db: { url: process.env.ASSET_DATABASE_URL } },
  });
  const orderbookDb = new OrderbookPrismaClient({
    datasources: { db: { url: process.env.ORDERBOOK_DATABASE_URL } },
  });
  const complianceDb = new CompliancePrismaClient({
    datasources: { db: { url: process.env.COMPLIANCE_DATABASE_URL } },
  });

  try {
    // ─── Reuse existing ASA if possible ───────────────────────────────────────
    let asaId = 0;
    const existingAssetForAsa = await assetDb.asset.findFirst({ where: { ticker: TEST_ASSET.ticker } });
    if (existingAssetForAsa?.asaId) {
      asaId = existingAssetForAsa.asaId;
      console.log(`      Reusing existing ASA from database: ${TEST_ASSET.ticker} (ID: ${asaId})\n`);
    } else {
      console.log('[2/5] Creating test ASA…');
      const sp = await client.getTransactionParams().do();
      const asaTxn = algosdk.makeAssetCreateTxnWithSuggestedParamsFromObject({
        sender: adminAccount.addr.toString(),
        total: TEST_ASSET.totalSupply,
        decimals: TEST_ASSET.decimals,
        defaultFrozen: true,
        unitName: TEST_ASSET.ticker,
        assetName: TEST_ASSET.name,
        assetURL: 'https://chainstrike.io/assets/xgld',
        manager: adminAccount.addr.toString(),
        reserve: adminAccount.addr.toString(),
        freeze: adminAccount.addr.toString(),
        clawback: adminAccount.addr.toString(),
        suggestedParams: sp,
      });

      const signedAsa = asaTxn.signTxn(adminAccount.sk);
      const { txid: asaTxId } = await client.sendRawTransaction(signedAsa).do();
      const asaResult = await algosdk.waitForConfirmation(client, asaTxId, 4);
      asaId = Number(asaResult.assetIndex);
      console.log(`      ASA created: ${TEST_ASSET.ticker} (ID: ${asaId})`);
      console.log(`      TX: ${asaTxId}\n`);
    }

    console.log('[3/5] Seeding database…');
    // Seed users
    const users: Record<string, any> = {};
    for (const u of TEST_USERS) {
      const existing = await identityDb.user.findFirst({ where: { email: u.email } });
      if (existing) {
        users[u.role] = existing;
        console.log(`      User ${u.email} already exists`);
        continue;
      }

      const user = await identityDb.user.create({
        data: {
          email: u.email,
          passwordHash: await hashPassword(u.password),
          role: u.role as any,
          emailVerified: true,
          status: 'ACTIVE',
        },
      });
      users[u.role] = user;
      console.log(`      Created ${u.role}: ${u.email}`);
    }

    // Seed KYC for investor
    const investor = users['INVESTOR'];
    const existingKyc = await identityDb.kycProfile.findUnique({ where: { userId: investor.id } });
    if (!existingKyc) {
      await identityDb.kycProfile.create({
        data: {
          userId: investor.id,
          tier: 1,
          status: 'APPROVED',
          jurisdiction: 'US',
          approvedAt: new Date(),
          expiresAt: new Date(Date.now() + 730 * 24 * 60 * 60 * 1000),
        },
      });
      console.log('      KYC approved for investor');
    }

    // Seed KYB for issuer
    const issuer = users['ISSUER'];
    const existingKyb = await identityDb.kybEntity.findUnique({ where: { issuerId: issuer.id } });
    if (!existingKyb) {
      await identityDb.kybEntity.create({
        data: {
          issuerId: issuer.id,
          legalName: 'Test Gold Issuer Pte Ltd',
          businessType: 'PRIVATE_LIMITED',
          registrationNumber: 'TEST123456',
          incorporationJurisdiction: 'SG',
          incorporationDate: new Date('2023-01-01'),
          registeredAddress: { street: '1 Test St', city: 'Singapore', country: 'SG' },
          primaryBusinessActivity: 'Precious metals trading',
          status: 'APPROVED',
          approvedAt: new Date(),
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        },
      });
      console.log('      KYB approved for issuer');
    }

    // Seed asset
    const existingAsset = await assetDb.asset.findFirst({ where: { ticker: TEST_ASSET.ticker } });
    let asset;
    if (!existingAsset) {
      asset = await assetDb.asset.create({
        data: {
          issuerId: issuer.id,
          name: TEST_ASSET.name,
          ticker: TEST_ASSET.ticker,
          category: TEST_ASSET.category as any,
          description: TEST_ASSET.description,
          totalSupply: TEST_ASSET.totalSupply,
          decimals: TEST_ASSET.decimals,
          tokenizationRatio: TEST_ASSET.tokenizationRatio,
          minimumInvestment: TEST_ASSET.minimumInvestment,
          lockupDays: TEST_ASSET.lockupDays,
          minimumKycTier: TEST_ASSET.minimumKycTier,
          custodianName: TEST_ASSET.custodianName,
          custodianJurisdiction: TEST_ASSET.custodianJurisdiction,
          asaId,
          status: 'ACTIVE',
          verificationStatus: 'APPROVED',
          listedAt: new Date(),
        },
      });
      console.log(`      Asset created: ${TEST_ASSET.ticker} (ID: ${asset.id})`);
    } else {
      asset = existingAsset;
      console.log(`      Asset ${TEST_ASSET.ticker} already exists`);
    }

    // Seed market
    const existingMarket = await orderbookDb.market.findFirst({ where: { assetId: asset.id } });
    let market = existingMarket;
    if (!existingMarket) {
      market = await orderbookDb.market.create({
        data: {
          assetId: asset.id,
          asaId,
          ticker: TEST_ASSET.ticker,
          status: 'ACTIVE',
          referencePriceUsdc: BigInt(10_000_000), // 10.00 USDC
          lastTradedPrice: BigInt(10_000_000),
          openedAt: new Date(),
        },
      });
      console.log('      Market opened');
    }

    // Seed oracle price
    const existingPrice = await assetDb.oraclePrice.findFirst({ where: { asaId } });
    if (!existingPrice) {
      await assetDb.oraclePrice.create({
        data: {
          asaId,
          assetId: asset.id,
          price: BigInt(10_000_000), // 10.00 USDC
          source: 'manual_seed',
          timestamp: new Date(),
          isActive: true,
        },
      });
      console.log('      Oracle price set: 10.00 USDC');
    }

    // Seed whitelist
    const existingWhitelist = await complianceDb.whitelistEntry.findFirst({
      where: { walletAddress: adminAccount.addr.toString(), asaId },
    });
    if (!existingWhitelist) {
      await complianceDb.whitelistEntry.create({
        data: {
          userId: investor.id,
          walletAddress: adminAccount.addr.toString(),
          asaId,
          assetId: asset.id,
          kycTier: 1,
          addedAt: new Date(),
          expiresAt: new Date(Date.now() + 730 * 24 * 60 * 60 * 1000),
        },
      });
      console.log('      Whitelist entry created for investor');
    }

    console.log('\n[4/5] Database seeded successfully\n');

    // ─── Seed initial orders ──────────────────────────────────────────────────
    console.log('[5/5] Placing initial orders…');

    // Admin places a sell order (initial liquidity)
    // For testnet, we'll skip the actual order placement via API and insert directly
    // This avoids needing all services to be running
    if (!market) {
      throw new Error('Market not found after seed step');
    }

    const existingOrders = await orderbookDb.order.findMany({ where: { marketId: market.id } });
    if (existingOrders.length === 0) {
      await orderbookDb.order.create({
        data: {
          marketId: market.id,
          userId: issuer.id,
          walletAddress: adminAccount.addr.toString(),
          side: 'SELL',
          type: 'LIMIT',
          timeInForce: 'GTC',
          price: BigInt(10_500_000), // 10.50 USDC
          quantity: BigInt(100_000_000), // 100 tokens
          remainingQuantity: BigInt(100_000_000),
          filledQuantity: BigInt(0),
          status: 'ACCEPTED',
        },
      });
      console.log('      Sell order: 100 XGLD @ 10.50 USDC');

      await orderbookDb.order.create({
        data: {
          marketId: market.id,
          userId: investor.id,
          walletAddress: adminAccount.addr.toString(),
          side: 'BUY',
          type: 'LIMIT',
          timeInForce: 'GTC',
          price: BigInt(9_800_000), // 9.80 USDC
          quantity: BigInt(50_000_000), // 50 tokens
          remainingQuantity: BigInt(50_000_000),
          filledQuantity: BigInt(0),
          status: 'ACCEPTED',
        },
      });
      console.log('      Buy order: 50 XGLD @ 9.80 USDC');
    } else {
      console.log('      Orders already exist');
    }

    console.log('\nDone!\n');
    console.log('Testnet is ready for testing:');
    console.log(`  Admin:    admin@testnet.io / Admin@Test2024!`);
    console.log(`  Issuer:   issuer@testnet.io / Issuer@Test2024!`);
    console.log(`  Investor: investor@testnet.io / Investor@Test2024!`);
    console.log(`  Asset:    ${TEST_ASSET.ticker} (ASA ${asaId})`);
    console.log(`  Market:   http://localhost:3000/trade/${asset.id}`);

  } finally {
    await identityDb.$disconnect();
    await assetDb.$disconnect();
    await orderbookDb.$disconnect();
    await complianceDb.$disconnect();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function hashPassword(password: string): Promise<string> {
  // Simple bcrypt-like hash for seeding — in production use argon2id
  const { hash } = await import('argon2');
  return hash(password, { type: 2, memoryCost: 65536, timeCost: 3, parallelism: 4 });
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
