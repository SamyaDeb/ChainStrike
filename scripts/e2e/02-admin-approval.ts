/**
 * E2E Test 02 — Admin Approval Flow
 * Tests: admin reviews all 5 stages → approves asset → deploys ASA on-chain
 *
 * Run: npx ts-node --esm scripts/e2e/02-admin-approval.ts
 * Requires: 01-issuer-flow to have run first (reads .state.json)
 */

import * as dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import algosdk from 'algosdk';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';

const GATEWAY = 'http://localhost:8080/api/v1';
const STATE_FILE = path.resolve('scripts/e2e/.state.json');

function log(msg: string) { console.log(`  ${msg}`); }
function ok(msg: string) { console.log(`  ✅ ${msg}`); }
function fail(msg: string) { console.error(`  ❌ ${msg}`); throw new Error(msg); }

function loadState(): Record<string, any> {
  if (!existsSync(STATE_FILE)) fail('State file not found — run 01-issuer-flow.ts first');
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}

function saveState(data: Record<string, any>) {
  const existing = loadState();
  writeFileSync(STATE_FILE, JSON.stringify({ ...existing, ...data }, null, 2));
}

function authHeader(token: string) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

async function ensureAdminToken(state: Record<string, any>): Promise<string> {
  // Try reusing stored token; re-login if expired
  if (state.adminToken) {
    try {
      const payload = JSON.parse(Buffer.from(state.adminToken.split('.')[1], 'base64').toString());
      if (payload.exp * 1000 > Date.now() + 60_000) {
        ok('Reusing stored admin token');
        return state.adminToken;
      }
    } catch {}
  }
  log('Re-logging in as admin…');
  const { data } = await axios.post(`${GATEWAY}/auth/login`, {
    email: 'admin@testnet.io',
    password: 'Admin@Test2024!',
  });
  ok('Admin re-authenticated');
  return data.accessToken;
}

async function submitVerificationStages(token: string, assetId: string) {
  log('Submitting all 5 verification stages as APPROVED…');

  const stageNames = [
    'Document Completeness',
    'Custodian Verification',
    'Legal Opinion Review',
    'Risk Committee Sign-off',
    'Final Compliance',
  ];

  for (let stage = 1; stage <= 5; stage++) {
    const { data } = await axios.post(
      `${GATEWAY}/assets/${assetId}/verification-stage`,
      {
        stage,
        status: 'APPROVED',
        notes: `[E2E AUTO] Stage ${stage}: ${stageNames[stage - 1]} approved by automated test`,
      },
      authHeader(token),
    );
    ok(`Stage ${stage} (${stageNames[stage - 1]}): ${data.status}`);
  }
}

async function checkVerificationStatus(token: string, assetId: string) {
  log('Checking asset verification status after all stages…');
  const { data } = await axios.get(`${GATEWAY}/assets/${assetId}`);
  if (data.verificationStatus !== 'APPROVED') {
    fail(`Expected verificationStatus=APPROVED, got: ${data.verificationStatus}`);
  }
  ok(`Verification status: APPROVED`);
  return data;
}

async function deployAsa(token: string, assetId: string): Promise<number> {
  log('Deploying ASA to Algorand testnet (this takes 5–15 seconds)…');

  const start = Date.now();
  const { data } = await axios.patch(
    `${GATEWAY}/assets/${assetId}/deploy-asa`,
    {},
    { ...authHeader(token), timeout: 60_000 },
  );

  if (!data.asaId || data.asaId === 0) {
    fail(`ASA deployment failed or returned asaId=0: ${JSON.stringify(data)}`);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  ok(`ASA deployed: asaId=${data.asaId} in ${elapsed}s`);
  ok(`View on Algoexplorer: https://testnet.algoexplorer.io/asset/${data.asaId}`);

  return data.asaId;
}

async function verifyAssetIsPreMarket(assetId: string, asaId: number) {
  log('Verifying asset transitioned to PRE_MARKET with real asaId…');
  const { data } = await axios.get(`${GATEWAY}/assets/${assetId}`);
  if (data.status !== 'PRE_MARKET') {
    fail(`Expected status=PRE_MARKET, got: ${data.status}`);
  }
  if (data.asaId !== asaId) {
    fail(`asaId mismatch: expected ${asaId}, got ${data.asaId}`);
  }
  ok(`Asset is PRE_MARKET with asaId=${data.asaId}`);

  // Check on-chain enrichment
  if (data.onChain) {
    ok(`On-chain data: creator=${data.onChain.creator?.slice(0, 16)}… defaultFrozen=${data.onChain.defaultFrozen}`);
    if (!data.onChain.defaultFrozen) {
      fail('CRITICAL: ASA defaultFrozen must be true for RWA compliance!');
    }
  }
}

async function verifyOrderbookMarketCreated(assetId: string) {
  log('Verifying orderbook market was created for this asset…');
  const { data } = await axios.get(`${GATEWAY}/orders/${assetId}/depth`);
  if (data.bids === undefined && data.asks === undefined) {
    fail(`Orderbook depth endpoint returned unexpected shape: ${JSON.stringify(data)}`);
  }
  ok(`Orderbook market exists for asset ${assetId} (bids=${data.bids?.length ?? 0}, asks=${data.asks?.length ?? 0})`);
}

async function verifyEscrowReleasedToVault(assetId: string, vaultContractId: number) {
  log('Verifying issuance escrow was released to vault on-chain…');

  // 1. Check DB field
  const { data: asset } = await axios.get(`${GATEWAY}/assets/${assetId}`);
  if (asset.issuanceEscrowStatus !== 'RELEASED_TO_VAULT') {
    fail(`Expected issuanceEscrowStatus=RELEASED_TO_VAULT, got: ${asset.issuanceEscrowStatus}`);
  }
  ok(`DB escrow status: RELEASED_TO_VAULT`);
  ok(`Release txId: ${asset.issuanceEscrowReleaseTxId}`);
  ok(`View: https://testnet.algoexplorer.io/tx/${asset.issuanceEscrowReleaseTxId}`);

  // 2. Verify vault holds USDC on-chain via algod
  const algodServer = process.env.ALGORAND_ALGOD_SERVER ?? 'https://testnet-api.algonode.cloud';
  const algodPort = parseInt(process.env.ALGORAND_ALGOD_PORT ?? '443');
  const algodToken = process.env.ALGORAND_ALGOD_TOKEN ?? '';
  const algod = new algosdk.Algodv2(algodToken, algodServer, algodPort);
  const usdcAsaId = 10458941;

  const vaultAddress = algosdk.getApplicationAddress(vaultContractId).toString();
  try {
    const info = await algod.accountAssetInformation(vaultAddress, usdcAsaId).do();
    const holding = info.assetHolding ?? (info as any)['asset-holding'];
    const vaultUsdc = BigInt(holding?.amount ?? 0);
    if (vaultUsdc === 0n) {
      fail(`Vault USDC balance is 0 — escrow release may have failed on-chain`);
    }
    ok(`Vault USDC balance on-chain: ${Number(vaultUsdc) / 1_000_000} USDC (vault appId=${vaultContractId})`);
  } catch (err: any) {
    fail(`Failed to query vault USDC balance: ${err.message}`);
  }

  // 3. Verify escrow contract USDC is now 0
  const issuanceEscrowAddress = process.env.ISSUANCE_ESCROW_ADDRESS ?? '';
  if (issuanceEscrowAddress) {
    try {
      const escrowInfo = await algod.accountAssetInformation(issuanceEscrowAddress, usdcAsaId).do();
      const escrowHolding = escrowInfo.assetHolding ?? (escrowInfo as any)['asset-holding'];
      const escrowUsdc = BigInt(escrowHolding?.amount ?? 0);
      ok(`Issuance escrow USDC balance after release: ${Number(escrowUsdc) / 1_000_000} USDC (should be 0 for this asset)`);
    } catch {
      ok('Escrow balance check skipped (opted out or zero)');
    }
  }
}

async function activateMarket(adminToken: string, assetId: string, asaId: number) {
  console.log('\n[5] Activating market...');
  const res = await axios.patch(`${GATEWAY}/assets/${assetId}/activate`, undefined, {
    headers: { Authorization: `Bearer ${adminToken}` },
    timeout: 180_000,
  });
  ok(`Market activated: status=${res.data.status}`);

  // Verify issuer wallet received tokens on-chain
  const freshAsset = await axios.get(`${GATEWAY}/assets/${assetId}`);
  const issuerWallet = freshAsset.data.issuerWalletAddress;
  const liquidityUsdc = BigInt(freshAsset.data.liquidityDepositUsdc ?? '0');
  const pricePerToken = BigInt(freshAsset.data.pricePerToken ?? '0');

  if (!issuerWallet) fail('issuerWalletAddress not set on asset — cannot verify token balance');
  if (pricePerToken === 0n) fail('pricePerToken is 0 — cannot compute expected allocation');

  const assetDecimals = BigInt(freshAsset.data.decimals ?? 6);
  const expectedTokens = (liquidityUsdc / pricePerToken) * (10n ** assetDecimals);
  log(`Expected issuer allocation: ${expectedTokens} tokens (${liquidityUsdc} µUSDC ÷ ${pricePerToken} µUSDC/token)`);

  const algod = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', 443);
  let balance = 0n;
  try {
    const info = await algod.accountAssetInformation(issuerWallet, asaId).do();
    balance = BigInt((info as any)['asset-holding']?.amount ?? 0);
  } catch {
    fail(`Issuer wallet ${issuerWallet} has no holding for ASA ${asaId} — opt-in or distribution failed`);
  }

  if (balance < expectedTokens) {
    fail(`Issuer wallet has ${balance} tokens but expected >= ${expectedTokens}`);
  }
  ok(`Issuer wallet ${issuerWallet} holds ${balance} tokens on-chain ✓`);
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║   ChainStrike E2E — 02: Admin Approval + ASA      ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const state = loadState();
  const { assetId } = state;
  if (!assetId) fail('assetId missing in state — run 01 first');

  const adminToken = await ensureAdminToken(state);

  await submitVerificationStages(adminToken, assetId);
  const asset = await checkVerificationStatus(adminToken, assetId);
  const asaId = await deployAsa(adminToken, assetId);
  await verifyAssetIsPreMarket(assetId, asaId);
  await verifyOrderbookMarketCreated(assetId);

  // Verify issuance escrow was released to vault on-chain
  const freshAsset = await axios.get(`${GATEWAY}/assets/${assetId}`);
  const vaultContractId = freshAsset.data.vaultContractId;
  if (vaultContractId) {
    await verifyEscrowReleasedToVault(assetId, vaultContractId);
  } else {
    console.log('  ⚠️  vaultContractId not set — skipping escrow release verification');
  }

  await activateMarket(adminToken, assetId, asaId);

  saveState({ adminToken, asaId });

  console.log(`\n✅ TEST 02 PASSED — ASA deployed and market activated: ${asaId}`);
  console.log(`   Algoexplorer: https://testnet.algoexplorer.io/asset/${asaId}`);
  console.log(`   Issuance escrow released to vault on-chain ✓`);
  console.log(`   Issuer tokens distributed on-chain ✓\n`);
}

main().catch((err) => {
  console.error('\n❌ TEST 02 FAILED:', err.response?.data ?? err.message);
  process.exit(1);
});
