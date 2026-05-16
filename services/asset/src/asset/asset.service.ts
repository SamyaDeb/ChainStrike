import {
  Injectable, NotFoundException, ForbiddenException,
  BadRequestException, InternalServerErrorException, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import algosdk from 'algosdk';
import axios from 'axios';
import { AssetRepository } from './asset.repository';
import { AlgorandAssetService } from '../algorand/algorand-asset.service';
import { EventProducerService } from '../events/event-producer.service';
import { DocumentService } from '../document/document.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { getAsaDetails } from '@chainstrike/algorand';

@Injectable()
export class AssetService {
  private readonly logger = new Logger(AssetService.name);
  private readonly algodClient: algosdk.Algodv2;

  private readonly orderbookUrl: string;
  private readonly complianceUrl: string;

  constructor(
    private readonly assetRepo: AssetRepository,
    private readonly algorandAsset: AlgorandAssetService,
    private readonly events: EventProducerService,
    private readonly documentService: DocumentService,
    private readonly config: ConfigService,
  ) {
    this.algodClient = new algosdk.Algodv2(
      this.config.get<string>('ALGORAND_ALGOD_TOKEN', ''),
      this.config.get<string>('ALGORAND_ALGOD_SERVER', 'https://testnet-api.algonode.cloud'),
      this.config.get<string>('ALGORAND_ALGOD_PORT', '443'),
    );
    this.orderbookUrl = this.config.get<string>('ORDERBOOK_SERVICE_URL', 'http://localhost:3003');
    this.complianceUrl = this.config.get<string>('COMPLIANCE_SERVICE_URL', 'http://localhost:3004');
  }

  // ─── Create asset application ─────────────────────────────────────────────────

  async createAsset(issuerId: string, dto: CreateAssetDto) {
    const existing = await this.assetRepo.findByTicker(dto.ticker.toUpperCase());
    if (existing) throw new BadRequestException(`Ticker ${dto.ticker} already taken`);

    // Verify the liquidity deposit hit the IssuanceLiquidityEscrow contract on-chain
    if (dto.liquidityDepositTxId && dto.liquidityDepositUsdc && dto.issuerWalletAddress) {
      const usdcAsaId = this.config.get<string>('ALGORAND_NETWORK') === 'mainnet' ? 31566704 : 10458941;
      const valid = await this.algorandAsset.verifyLiquidityDeposit({
        txId: dto.liquidityDepositTxId,
        expectedSender: dto.issuerWalletAddress,
        expectedAmountMicroUsdc: dto.liquidityDepositUsdc,
        usdcAsaId,
      });
      if (!valid) {
        throw new BadRequestException(
          'Liquidity deposit transaction could not be verified on Algorand testnet. ' +
          'Ensure the USDC transfer to the issuance escrow contract address is confirmed before submitting.',
        );
      }
    }

    const asset = await this.assetRepo.create({
      issuerId,
      ...dto,
      ticker: dto.ticker.toUpperCase(),
      status: 'SUBMITTED',
      verificationStatus: 'PENDING',
      initialLiquidityTxId: dto.initialLiquidityTxId,
      liquidityDepositUsdc: dto.liquidityDepositUsdc,
      liquidityDepositTxId: dto.liquidityDepositTxId,
      issuerWalletAddress: dto.issuerWalletAddress,
      issuanceEscrowStatus: dto.liquidityDepositUsdc ? 'PENDING' : undefined,
      issuanceEscrowAmount: dto.liquidityDepositUsdc,
      issuanceEscrowTxId: dto.liquidityDepositTxId,
    });

    // Record the issuance lock on-chain in the IssuanceLiquidityEscrow contract
    if (dto.liquidityDepositTxId && dto.liquidityDepositUsdc && dto.issuerWalletAddress) {
      try {
        const lockTxId = await this.algorandAsset.recordIssuanceLock(
          asset.id,
          dto.issuerWalletAddress,
          dto.liquidityDepositUsdc,
        );
        await this.assetRepo.update(asset.id, { issuanceEscrowTxId: lockTxId });
        this.logger.log(`Issuance escrow lock recorded on-chain for asset ${asset.id}: txId=${lockTxId}`);
      } catch (err: any) {
        this.logger.error(`Failed to record issuance escrow lock on-chain: ${err.message}`);
        // Continue — the deposit is verified; admin can manually re-record if needed
      }
    }

    this.logger.log(`Asset application submitted: ${asset.id} by issuer ${issuerId}`);
    return asset;
  }

  // ─── Deploy ASA (after verification approval) ────────────────────────────────

  async deployAsaToMainnet(assetId: string, adminUserId: string) {
    const asset = await this.assetRepo.findById(assetId);
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.verificationStatus !== 'APPROVED') {
      throw new ForbiddenException('Asset must be verified before ASA deployment');
    }
    if (asset.asaId) {
      throw new BadRequestException('ASA already deployed');
    }

    let documentHashes: string[];
    let metadataHash: Buffer;
    try {
      documentHashes = await this.documentService.getDocumentHashes(assetId);
      metadataHash = this.computeMetadataHash(asset, documentHashes);
    } catch (e: any) {
      throw new InternalServerErrorException(`Metadata preparation failed: ${e.message}`);
    }

    // 1. Mint ASA — all tokens go to admin wallet initially (Algorand protocol)
    let asaId: number;
    let complianceContractId: number;
    try {
      ({ asaId, complianceContractId } = await this.algorandAsset.createRwaToken({
        name: asset.name,
        ticker: asset.ticker,
        totalSupply: asset.totalSupply,
        decimals: asset.decimals,
        metadataHash,
        lockupDays: asset.lockupDays,
        minimumKycTier: asset.minimumKycTier,
        totalSupplyBigInt: asset.totalSupply,
      }));
    } catch (e: any) {
      throw new InternalServerErrorException(`ASA mint failed: ${e.message}`);
    }
    this.logger.log(`ASA minted: asaId=${asaId} for asset ${assetId}`);

    // 2. Create orderbook market before vault deployment
    await axios.post(`${this.orderbookUrl}/internal/markets`, {
      assetId,
      asaId,
      ticker: asset.ticker,
      referencePriceUsdc: asset.pricePerToken?.toString() ?? '0',
    }).catch((e) => this.logger.warn(`Orderbook market creation failed: ${e.message}`));

    // 3. Deploy TokenVault — moves all tokens from admin → vault contract
    let vaultContractId = 0;
    try {
      vaultContractId = await this.algorandAsset.deployTokenVault(asaId, asset.totalSupply);
      this.logger.log(`TokenVault deployed: appId=${vaultContractId}, all ${asset.totalSupply} tokens locked in vault`);
    } catch (vaultErr: any) {
      this.logger.error(`Vault deployment failed: ${vaultErr.message}`);
      throw new InternalServerErrorException(`Vault deployment failed: ${vaultErr.message}`);
    }

    await this.assetRepo.update(assetId, {
      asaId,
      complianceContractId,
      vaultContractId: vaultContractId || undefined,
      status: 'PRE_MARKET',
    });

    return {
      assetId,
      asaId,
      complianceContractId,
      vaultContractId,
      issuerAllocation: '0',
      lockedInVault: asset.totalSupply.toString(),
    };
  }

  // ─── Approve verification ─────────────────────────────────────────────────────

  async approveVerification(assetId: string, reviewerId: string) {
    const asset = await this.assetRepo.findById(assetId);
    if (!asset) throw new NotFoundException('Asset not found');

    await this.assetRepo.update(assetId, { verificationStatus: 'APPROVED' });
    await this.assetRepo.addVerificationLog(assetId, 5, 'APPROVED', reviewerId);

    return { assetId, verificationStatus: 'APPROVED' };
  }

  // ─── Activate market ──────────────────────────────────────────────────────────

  async activateMarket(assetId: string, adminUserId: string) {
    const asset = await this.assetRepo.findById(assetId);
    if (!asset) throw new NotFoundException('Asset not found');
    if (asset.status !== 'PRE_MARKET') {
      throw new BadRequestException(`Asset must be in PRE_MARKET status, current: ${asset.status}`);
    }

    // ── Token distribution + escrow release on market activation ─────────────
    const liquidityUsdc = (asset as any).liquidityDepositUsdc as bigint ?? 0n;
    const pricePerToken = asset.pricePerToken ?? 0n;
    const issuerWallet = (asset as any).issuerWalletAddress as string | undefined;
    const vaultContractId = (asset as any).vaultContractId as number | undefined;
    const asaId = asset.asaId as number;
    const usdcAsaId = this.config.get<string>('ALGORAND_NETWORK') === 'mainnet' ? 31566704 : 10458941;

    this.logger.log(`activateMarket — vaultContractId=${vaultContractId}, issuerWallet=${issuerWallet}, asaId=${asaId}, liquidityUsdc=${liquidityUsdc}, pricePerToken=${pricePerToken}`);

    if (!vaultContractId) throw new BadRequestException('Asset has no vault contract — run Deploy ASA first');
    if (!issuerWallet) throw new BadRequestException('Asset has no issuerWalletAddress recorded');
    if (!asaId) throw new BadRequestException('Asset has no ASA ID — run Deploy ASA first');
    if (liquidityUsdc <= 0n) throw new BadRequestException('No liquidity deposit recorded for this asset');
    if (pricePerToken <= 0n) throw new BadRequestException('Asset pricePerToken must be > 0');

    // liquidityUsdc and pricePerToken are both in micro-units (6 decimals).
    // Division gives display tokens; multiply by 10^decimals to get base units for the vault.
    const decimals = (asset as any).decimals ?? 6;
    const issuerAllocation = (liquidityUsdc / pricePerToken) * BigInt(10 ** decimals);

    // a. Whitelist issuer in compliance for this ASA (idempotent)
    await axios.post(`${this.complianceUrl}/compliance/dev/whitelist`, {
      walletAddress: issuerWallet, asaId, assetId, userId: asset.issuerId,
    }).catch((e) => this.logger.warn(`Compliance whitelist: ${e.message}`));

    // b. Release issuance escrow USDC → vault (only if still PENDING)
    const escrowStatus = (asset as any).issuanceEscrowStatus as string | undefined;
    if (escrowStatus === 'PENDING') {
      const vaultAddress = algosdk.getApplicationAddress(vaultContractId).toString();
      await this.algorandAsset.optVaultIntoUsdc(vaultContractId, usdcAsaId);
      const releaseTxId = await this.algorandAsset.releaseIssuanceLiquidityToVault(assetId, vaultAddress);
      await this.assetRepo.update(assetId, {
        issuanceEscrowStatus: 'RELEASED_TO_VAULT',
        issuanceEscrowReleaseTxId: releaseTxId,
      });
      this.logger.log(`Escrow released to vault on activation: txId=${releaseTxId}`);
    }

    // c. Vault → issuer wallet: N tokens on-chain
    if (issuerAllocation > 0n) {
      await this.algorandAsset.vaultDistributeToIssuer(vaultContractId, asaId, issuerWallet, issuerAllocation);
      this.logger.log(`Distributed ${issuerAllocation} tokens to issuer ${issuerWallet}`);

      // d. Seed SELL orders in orderbook at listing price
      await axios.post(`${this.orderbookUrl}/internal/orders/seed`, {
        assetId, userId: asset.issuerId, walletAddress: issuerWallet,
        quantity: issuerAllocation.toString(), priceUsdc: pricePerToken.toString(),
      }).catch((e) => this.logger.warn(`Seed SELL orders: ${e.message}`));
    }
    // ── End distribution ──────────────────────────────────────────────────────

    await this.assetRepo.update(assetId, { status: 'ACTIVE', listedAt: new Date() });

    // Direct HTTP call to orderbook (bypasses broken Kafka GroupCoordinator)
    await axios.post(`${this.orderbookUrl}/internal/markets/status`, {
      assetId,
      newStatus: 'ACTIVE',
    }).catch((e) => this.logger.warn(`Orderbook market activation failed: ${e.message}`));

    this.logger.log(`Market ACTIVATED for asset ${assetId}`);
    return { assetId, status: 'ACTIVE' };
  }

  async addVerificationStage(
    assetId: string,
    reviewerId: string,
    body: { stage: number; status: 'APPROVED' | 'REJECTED'; notes?: string },
  ) {
    const asset = await this.assetRepo.findById(assetId);
    if (!asset) throw new NotFoundException('Asset not found');

    await this.assetRepo.addVerificationLog(assetId, body.stage, body.status, reviewerId, body.notes);

    if (body.stage === 5 && body.status === 'APPROVED') {
      await this.assetRepo.update(assetId, { verificationStatus: 'APPROVED' });
    } else if (body.status === 'REJECTED') {
      await this.assetRepo.update(assetId, { verificationStatus: 'REJECTED', status: 'REJECTED' });

      // Return issuance escrow USDC to issuer on-chain (atomic inner txn from escrow contract)
      const issuerWallet = (asset as any).issuerWalletAddress as string | undefined;
      const escrowStatus = (asset as any).issuanceEscrowStatus as string | undefined;
      if (issuerWallet && escrowStatus === 'PENDING') {
        try {
          const returnTxId = await this.algorandAsset.returnIssuanceLiquidityToIssuer(assetId, issuerWallet);
          await this.assetRepo.update(assetId, {
            issuanceEscrowStatus: 'RETURNED_TO_ISSUER',
            issuanceEscrowReleaseTxId: returnTxId,
          });
          this.logger.log(`Issuance escrow returned to issuer ${issuerWallet} on stage ${body.stage} rejection: txId=${returnTxId}`);
        } catch (err: any) {
          this.logger.error(`Failed to return issuance escrow on rejection for asset ${assetId}: ${err.message}`);
        }
      }
    }

    return { assetId, stage: body.stage, status: body.status };
  }

  async distributeTokens(assetId: string, issuerWalletAddress: string, amount: bigint) {
    const asset = await this.assetRepo.findById(assetId);
    if (!asset) throw new NotFoundException('Asset not found');
    if (!asset.asaId) throw new BadRequestException('ASA not yet deployed');
    if (asset.status !== 'PRE_MARKET') {
      throw new BadRequestException('Asset must be in PRE_MARKET status to distribute tokens');
    }

    const txid = await this.algorandAsset.transferTokensToIssuer(asset.asaId, issuerWalletAddress, amount);
    this.logger.log(`Tokens distributed for asset ${assetId}: txid=${txid}`);

    // Persist issuer wallet so seed-orders doesn't need it re-provided
    await this.assetRepo.update(assetId, { issuerWalletAddress });

    // Auto-opt issuer into USDC so they can receive payment when their SELL orders fill
    const usdcAsaId = this.config.get<string>('ALGORAND_NETWORK') === 'mainnet' ? 31566704 : 10458941;
    await this.algorandAsset.optAddressIntoUsdc(issuerWalletAddress, usdcAsaId)
      .then((r) => this.logger.log(`Issuer USDC opt-in: ${r.alreadyOptedIn ? 'already done' : `txId=${r.txId}`}`))
      .catch((e) => this.logger.warn(`Issuer USDC opt-in failed (issuer may do it manually): ${e.message}`));

    // Auto-whitelist issuer wallet in compliance for this ASA
    await axios.post(`${this.complianceUrl}/compliance/dev/whitelist`, {
      walletAddress: issuerWalletAddress,
      asaId: asset.asaId,
      assetId,
      userId: asset.issuerId,
    }).catch((e) => this.logger.warn(`Compliance whitelist failed: ${e.message}`));

    // Auto-seed all distributed tokens as SELL orders at listing price
    await axios.post(`${this.orderbookUrl}/internal/orders/seed`, {
      assetId,
      userId: asset.issuerId,
      walletAddress: issuerWalletAddress,
      quantity: amount.toString(),
      priceUsdc: asset.pricePerToken?.toString() ?? '0',
    }).catch((e) => this.logger.warn(`Auto-seed orders failed: ${e.message}`));

    this.logger.log(`Auto-seeded ${amount} SELL orders for asset ${assetId} @ ${asset.pricePerToken}`);

    return { assetId, asaId: asset.asaId, issuerWalletAddress, amount: amount.toString(), txid };
  }

  async seedOrders(assetId: string, issuerWalletAddress: string | undefined, seedQuantity: bigint) {
    const asset = await this.assetRepo.findById(assetId);
    if (!asset) throw new NotFoundException('Asset not found');
    if (!asset.asaId) throw new BadRequestException('ASA not yet deployed');

    // Fall back to stored wallet from the distribute-tokens step
    const wallet = issuerWalletAddress ?? (asset as any).issuerWalletAddress;
    if (!wallet) throw new BadRequestException('issuerWalletAddress is required (or run distribute-tokens first)');

    await axios.post(`${this.orderbookUrl}/internal/orders/seed`, {
      assetId,
      userId: asset.issuerId,
      walletAddress: wallet,
      quantity: seedQuantity.toString(),
      priceUsdc: asset.pricePerToken?.toString() ?? '0',
    });

    this.logger.log(`Seeded ${seedQuantity} SELL orders for asset ${assetId} @ ${asset.pricePerToken}`);
    return {
      assetId,
      issuerWalletAddress: wallet,
      seedQuantity: seedQuantity.toString(),
      priceUsdc: asset.pricePerToken?.toString(),
    };
  }

  // ─── Opt escrow/admin wallet into USDC ───────────────────────────────────────
  // Called before the first BUY order on any asset. Uses the admin signing key.
  // Safe to call repeatedly — no-ops if already opted in.

  async setupEscrowUsdcOptIn(network: string): Promise<{ alreadyOptedIn: boolean; txId?: string }> {
    const usdcAsaId = network === 'mainnet' ? 31566704 : 10458941;
    const escrowAddress = this.config.get<string>('ALGORAND_ESCROW_ADDRESS') ||
      this.config.get<string>('ALGORAND_PLATFORM_ADDRESS') ||
      this.algorandAsset.getAdminAddress();

    return this.algorandAsset.optAddressIntoUsdc(escrowAddress, usdcAsaId);
  }

  // ─── Testnet USDC dispenser ───────────────────────────────────────────────────
  // Sends testnet USDC from the admin wallet to a target wallet.
  // Only works in non-production. 100 USDC per call.

  async dispenseTestnetUsdc(targetWallet: string): Promise<{ txId: string; amount: number }> {
    const network = this.config.get<string>('ALGORAND_NETWORK', 'testnet');
    if (network === 'mainnet') {
      throw new BadRequestException('Dispenser not available on mainnet');
    }

    const usdcAsaId = 10458941;

    // Check admin wallet balance first and send whatever is available (max 50 USDC)
    const { hasOptedIn: adminHasUsdc, balance: adminBalance } = await this.algorandAsset.getUsdcBalance(usdcAsaId);
    const maxDispense = BigInt(50_000_000); // 50 USDC cap
    const buffer = BigInt(1_000_000); // keep 1 USDC in admin wallet
    const available = adminBalance > buffer ? adminBalance - buffer : 0n;
    const amount = available < maxDispense ? available : maxDispense;

    if (amount <= 0n) {
      throw new BadRequestException('Admin wallet USDC is depleted. Get testnet USDC via https://faucet.circle.com/algorand then retry.');
    }

    let txId: string;
    try {
      txId = await this.algorandAsset.transferUsdc(targetWallet, amount, usdcAsaId);
    } catch (err: any) {
      const msg: string = err?.message ?? '';
      if (msg.includes('must optin')) {
        throw new BadRequestException(
          'Wallet has not opted into USDC (ASA 10458941). Use your Pera/Defly wallet to opt in first, then retry.',
        );
      }
      throw err;
    }
    const usdcAmount = Number(amount) / 1_000_000;
    this.logger.log(`Dispensed ${usdcAmount} USDC to ${targetWallet} (txId=${txId})`);
    return { txId, amount: usdcAmount };
  }

  // ─── List assets — SQLite index + on-chain enrichment ────────────────────────

  async findAll(filters: { category?: string; status?: string }) {
    const assets = await this.assetRepo.findAll(filters);
    return this.enrichWithChainData(assets);
  }

  // ─── Get asset — SQLite index + on-chain details ──────────────────────────────

  async findById(id: string) {
    const asset = await this.assetRepo.findByIdWithDocuments(id);
    if (!asset) throw new NotFoundException('Asset not found');

    if (asset.asaId) {
      return this.enrichSingle(asset);
    }
    return asset;
  }

  async findByIssuer(issuerId: string) {
    const assets = await this.assetRepo.findByIssuerId(issuerId);
    return this.enrichWithChainData(assets);
  }

  // ─── On-chain enrichment helpers ─────────────────────────────────────────────

  private async enrichWithChainData<T extends { asaId?: number | null; name?: string; [k: string]: unknown }>(
    assets: T[],
  ): Promise<T[]> {
    const results = await Promise.allSettled(
      assets.map((a) => a.asaId ? this.enrichSingle(a) : Promise.resolve(a)),
    );
    return results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value as T;
      this.logger.warn(`Chain enrichment failed for asset: ${(r.reason as Error).message}`);
      return assets[i]!;
    });
  }

  private async enrichSingle<T extends { asaId?: number | null; [k: string]: unknown }>(asset: T): Promise<T> {
    if (!asset.asaId) return asset;
    try {
      const chainData = await getAsaDetails(this.algodClient, asset.asaId);
      return {
        ...asset,
        name: chainData.name || asset['name'],
        ticker: chainData.unitName || asset['ticker'],
        totalSupply: chainData.totalSupply,
        decimals: chainData.decimals,
        metadataHash: chainData.metadataHash ?? asset['metadataHash'],
        onChain: {
          creator: chainData.creator,
          manager: chainData.manager,
          freeze: chainData.freeze,
          clawback: chainData.clawback,
          defaultFrozen: chainData.defaultFrozen,
        },
      };
    } catch (err) {
      this.logger.warn(`Failed to fetch on-chain data for ASA ${asset.asaId}: ${(err as Error).message}`);
      return asset;
    }
  }

  private computeMetadataHash(
    asset: { id: string; name: string; ticker: string; custodianName?: string | null; spvEntityName?: string | null },
    documentHashes: string[] = [],
  ): Buffer {
    const metadata = {
      id: asset.id,
      name: asset.name,
      ticker: asset.ticker,
      custodian: asset.custodianName ?? null,
      spv: asset.spvEntityName ?? null,
      documents: [...documentHashes].sort(),
    };
    return createHash('sha256').update(JSON.stringify(metadata)).digest();
  }
}
