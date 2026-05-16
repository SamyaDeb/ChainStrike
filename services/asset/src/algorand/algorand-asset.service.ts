import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import algosdk from 'algosdk';
import { buildAsaCreateTransaction, hasOptedIn } from '@chainstrike/algorand';

@Injectable()
export class AlgorandAssetService {
  private readonly logger = new Logger(AlgorandAssetService.name);
  private readonly algodClient: algosdk.Algodv2;
  private readonly adminAccount: algosdk.Account;
  private readonly issuanceEscrowAppId: number;
  private readonly usdcAsaId: number;

  constructor(private readonly config: ConfigService) {
    this.algodClient = new algosdk.Algodv2(
      this.config.get<string>('ALGORAND_ALGOD_TOKEN', ''),
      this.config.get<string>('ALGORAND_ALGOD_SERVER', 'http://localhost'),
      this.config.get<number>('ALGORAND_ALGOD_PORT', 4001),
    );

    const mnemonic = this.config.getOrThrow<string>('ALGORAND_ADMIN_MNEMONIC');
    this.adminAccount = algosdk.mnemonicToSecretKey(mnemonic);

    this.issuanceEscrowAppId = parseInt(this.config.get<string>('ISSUANCE_ESCROW_APP_ID', '0'), 10);
    this.usdcAsaId = this.config.get<string>('ALGORAND_NETWORK') === 'mainnet' ? 31566704 : 10458941;
  }

  getAdminAddress(): string {
    return this.adminAccount.addr.toString();
  }

  // ─── Verify issuer's USDC liquidity deposit on-chain ─────────────────────────
  // Checks that the txId represents a confirmed USDC transfer from the issuer
  // to the issuance escrow contract. Mirrors EscrowService.verifyEscrowLock() logic.

  async verifyLiquidityDeposit(params: {
    txId: string;
    expectedSender: string;
    expectedAmountMicroUsdc: bigint;
    usdcAsaId: number;
  }): Promise<boolean> {
    try {
      this.logger.debug(`Verifying liquidity deposit: txId=${params.txId}, sender=${params.expectedSender}, amount=${params.expectedAmountMicroUsdc}`);

      // Expected receiver is the IssuanceLiquidityEscrow contract address
      if (!this.issuanceEscrowAppId || this.issuanceEscrowAppId === 0) {
        this.logger.error(`ISSUANCE_ESCROW_APP_ID not configured (${this.issuanceEscrowAppId})`);
        return false;
      }

      const escrowAddress = algosdk.getApplicationAddress(this.issuanceEscrowAppId).toString();
      this.logger.debug(`Escrow address: ${escrowAddress}`);

      let txn: any;
      try {
        this.logger.debug(`Looking up pending transaction: ${params.txId}`);
        const txInfo = await this.algodClient.pendingTransactionInformation(params.txId).do();
        if (!txInfo.confirmedRound) {
          this.logger.warn(`Liquidity deposit TX ${params.txId} not yet confirmed`);
          return false;
        }
        txn = txInfo.txn?.txn ?? txInfo.txn;
      } catch (pendingErr) {
        this.logger.debug(`Pending transaction lookup failed, trying indexer: ${(pendingErr as Error).message}`);
        try {
          const indexerServer = this.config.get<string>('ALGORAND_INDEXER_SERVER', 'https://testnet-idx.algonode.cloud');
          const indexer = new algosdk.Indexer('', indexerServer, 443);
          const result = await indexer.lookupTransactionByID(params.txId).do();
          const raw = result.transaction as any;
          // algosdk v3 indexer returns camelCase field names
          const xferRaw = raw.assetTransferTransaction ?? raw['asset-transfer-transaction'];
          txn = {
            type: raw.txType ?? raw['tx-type'],
            sender: raw.sender,
            assetTransfer: xferRaw
              ? {
                  assetIndex: Number(xferRaw.assetId ?? xferRaw['asset-id']),
                  amount: BigInt(xferRaw.amount ?? 0),
                  receiver: xferRaw.receiver,
                }
              : undefined,
          };
          this.logger.debug(`Transaction found in indexer: type=${txn.type}`);
        } catch (indexerErr) {
          this.logger.error(`Failed to lookup transaction in indexer: ${(indexerErr as Error).message}`);
          throw indexerErr;
        }
      }

      if (txn.type !== 'axfer') {
        this.logger.warn(`Deposit TX ${params.txId} is not an asset transfer`);
        return false;
      }

      const xfer = txn.assetTransfer ?? txn;
      if (Number(xfer.assetIndex ?? xfer['xaid']) !== params.usdcAsaId) {
        this.logger.warn(`Deposit TX ${params.txId} asset mismatch`);
        return false;
      }

      const sender = typeof txn.sender === 'string' ? txn.sender : txn.sender?.toString();
      if (sender !== params.expectedSender) {
        this.logger.warn(`Deposit TX ${params.txId} sender mismatch: ${sender} !== ${params.expectedSender}`);
        return false;
      }

      const receiver = typeof xfer.receiver === 'string' ? xfer.receiver : xfer.receiver?.toString();
      if (receiver !== escrowAddress) {
        this.logger.warn(`Deposit TX ${params.txId} receiver mismatch: ${receiver} !== ${escrowAddress} (issuance escrow)`);
        return false;
      }

      const amount = BigInt(xfer.amount ?? xfer['aamt'] ?? 0);
      if (amount < params.expectedAmountMicroUsdc) {
        this.logger.warn(`Deposit TX ${params.txId} amount too low: ${amount} < ${params.expectedAmountMicroUsdc}`);
        return false;
      }

      this.logger.log(`Liquidity deposit verified: txId=${params.txId} amount=${amount}`);
      return true;
    } catch (err) {
      this.logger.error(`Failed to verify liquidity deposit ${params.txId}: ${(err as Error).message}`);
      return false;
    }
  }

  // ─── Opt vault contract into USDC (inner-txn via app call) ───────────────────
  // Must be called before releasing escrow USDC to the vault address.

  async optVaultIntoUsdc(vaultAppId: number, usdcAsaId: number): Promise<void> {
    const vaultAddress = algosdk.getApplicationAddress(vaultAppId).toString();
    const alreadyOptedIn = await hasOptedIn(this.algodClient, vaultAddress, usdcAsaId);
    if (alreadyOptedIn) {
      this.logger.log(`Vault ${vaultAppId} already opted into USDC`);
      return;
    }

    const sp = await this.algodClient.getTransactionParams().do();
    // Fund vault for USDC opt-in storage cost (0.1 ALGO per asset opt-in)
    const fundTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: this.adminAccount.addr.toString(),
      receiver: vaultAddress,
      amount: 100_000n,
      suggestedParams: sp,
    });
    // Inner axfer (vault asset opt-in) requires 2x minFee on outer app call
    const optInTxn = algosdk.makeApplicationNoOpTxnFromObject({
      sender: this.adminAccount.addr.toString(),
      appIndex: vaultAppId,
      appArgs: [Buffer.from('f7f0d0a6', 'hex'), algosdk.encodeUint64(usdcAsaId)],  // optIntoUsdc(uint64)void
      foreignAssets: [usdcAsaId],
      suggestedParams: { ...sp, flatFee: true, fee: 2000 },
    });
    algosdk.assignGroupID([fundTxn, optInTxn]);
    const signed = [fundTxn, optInTxn].map((t) => t.signTxn(this.adminAccount.sk));
    const { txid } = await this.algodClient.sendRawTransaction(signed).do();
    await algosdk.waitForConfirmation(this.algodClient, txid, 4);
    this.logger.log(`Vault ${vaultAppId} opted into USDC (txId=${txid})`);
  }

  // ─── Record issuance lock in escrow contract (admin-signed) ─────────────────
  // Called after verifyLiquidityDeposit confirms the issuer's USDC reached the
  // escrow contract address. Funds box MBR + calls recordIssuanceLock() atomically.

  async recordIssuanceLock(assetId: string, issuerAddress: string, amount: bigint): Promise<string> {
    if (!this.issuanceEscrowAppId) throw new Error('ISSUANCE_ESCROW_APP_ID not configured');

    const sp = await this.algodClient.getTransactionParams().do();
    const escrowAddress = algosdk.getApplicationAddress(this.issuanceEscrowAppId).toString();
    const boxKey = Buffer.concat([Buffer.from('il:'), Buffer.from(assetId)]);

    // Box MBR: 2500 + 400 * (key_bytes + value_bytes)
    // key = 'il:' (3) + UUID (36) = 39 bytes
    // value = pubKey(32) + amount(8, itob) + status(8, itob) = 48 bytes
    // MBR = 2500 + 400 * (39 + 48) = 37,300 — use 40,000 for buffer
    const boxMbr = 40_000n;

    const fundTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: this.adminAccount.addr.toString(),
      receiver: escrowAddress,
      amount: boxMbr,
      suggestedParams: sp,
    });

    // ABI selector for recordIssuanceLock(byte[],address,uint64)void
    const selector = Buffer.from('013be981', 'hex');
    // ARC-4 byte[] encoding: 2-byte big-endian length prefix + content
    const assetIdBytes = Buffer.from(assetId);
    const assetIdLenBuf = Buffer.allocUnsafe(2);
    assetIdLenBuf.writeUInt16BE(assetIdBytes.length, 0);
    const encodedAssetId = Buffer.concat([assetIdLenBuf, assetIdBytes]);
    const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
      sender: this.adminAccount.addr.toString(),
      appIndex: this.issuanceEscrowAppId,
      appArgs: [
        selector,
        encodedAssetId,
        algosdk.decodeAddress(issuerAddress).publicKey,
        algosdk.encodeUint64(amount),
      ],
      accounts: [issuerAddress],
      boxes: [{ appIndex: this.issuanceEscrowAppId, name: boxKey }],
      foreignAssets: [this.usdcAsaId],
      suggestedParams: sp,
    });

    algosdk.assignGroupID([fundTxn, appCallTxn]);
    const signed = [fundTxn, appCallTxn].map((t) => t.signTxn(this.adminAccount.sk));
    const { txid } = await this.algodClient.sendRawTransaction(signed).do();
    await algosdk.waitForConfirmation(this.algodClient, txid, 4);
    this.logger.log(`Issuance escrow lock recorded on-chain: assetId=${assetId} amount=${amount} txId=${txid}`);
    return txid;
  }

  // ─── Release issuance USDC from escrow → vault (on Stage 5 approval) ─────────
  // Vault must already be opted into USDC before this call.
  // Issues an inner axfer inside the escrow contract.

  async releaseIssuanceLiquidityToVault(assetId: string, vaultAddress: string): Promise<string> {
    if (!this.issuanceEscrowAppId) throw new Error('ISSUANCE_ESCROW_APP_ID not configured');

    const sp = await this.algodClient.getTransactionParams().do();
    const boxKey = Buffer.concat([Buffer.from('il:'), Buffer.from(assetId)]);

    // ABI selector for releaseToVault(byte[],address)void
    const selector = Buffer.from('f27e2c8c', 'hex');
    // ARC-4 byte[] encoding: 2-byte big-endian length prefix + content
    const assetIdBytes = Buffer.from(assetId);
    const assetIdLenBuf = Buffer.allocUnsafe(2);
    assetIdLenBuf.writeUInt16BE(assetIdBytes.length, 0);
    const encodedAssetId = Buffer.concat([assetIdLenBuf, assetIdBytes]);
    // Inner axfer (escrow → vault USDC transfer) requires 2x minFee on outer app call
    const txn = algosdk.makeApplicationNoOpTxnFromObject({
      sender: this.adminAccount.addr.toString(),
      appIndex: this.issuanceEscrowAppId,
      appArgs: [
        selector,
        encodedAssetId,
        algosdk.decodeAddress(vaultAddress).publicKey,
      ],
      accounts: [vaultAddress],
      boxes: [{ appIndex: this.issuanceEscrowAppId, name: boxKey }],
      foreignAssets: [this.usdcAsaId],
      suggestedParams: { ...sp, flatFee: true, fee: 2000 },
    });

    const signed = txn.signTxn(this.adminAccount.sk);
    const { txid } = await this.algodClient.sendRawTransaction(signed).do();
    await algosdk.waitForConfirmation(this.algodClient, txid, 4);
    this.logger.log(`Issuance escrow released to vault ${vaultAddress}: assetId=${assetId} txId=${txid}`);
    return txid;
  }

  // ─── Return issuance USDC from escrow → issuer (on any stage rejection) ───────
  // Issues an inner axfer inside the escrow contract back to issuer's wallet.

  async returnIssuanceLiquidityToIssuer(assetId: string, issuerAddress: string): Promise<string> {
    if (!this.issuanceEscrowAppId) throw new Error('ISSUANCE_ESCROW_APP_ID not configured');

    const sp = await this.algodClient.getTransactionParams().do();
    const boxKey = Buffer.concat([Buffer.from('il:'), Buffer.from(assetId)]);

    // ABI selector for returnToIssuer(byte[])void
    const selector = Buffer.from('ea2eb641', 'hex');
    // ARC-4 byte[] encoding: 2-byte big-endian length prefix + content
    const assetIdBytes = Buffer.from(assetId);
    const assetIdLenBuf = Buffer.allocUnsafe(2);
    assetIdLenBuf.writeUInt16BE(assetIdBytes.length, 0);
    const encodedAssetId = Buffer.concat([assetIdLenBuf, assetIdBytes]);
    // Inner axfer (escrow → issuer USDC return) requires 2x minFee on outer app call
    const txn = algosdk.makeApplicationNoOpTxnFromObject({
      sender: this.adminAccount.addr.toString(),
      appIndex: this.issuanceEscrowAppId,
      appArgs: [
        selector,
        encodedAssetId,
      ],
      accounts: [issuerAddress],
      boxes: [{ appIndex: this.issuanceEscrowAppId, name: boxKey }],
      foreignAssets: [this.usdcAsaId],
      suggestedParams: { ...sp, flatFee: true, fee: 2000 },
    });

    const signed = txn.signTxn(this.adminAccount.sk);
    const { txid } = await this.algodClient.sendRawTransaction(signed).do();
    await algosdk.waitForConfirmation(this.algodClient, txid, 4);
    this.logger.log(`Issuance escrow returned to issuer ${issuerAddress}: assetId=${assetId} txId=${txid}`);
    return txid;
  }

  async createRwaToken(params: {
    name: string;
    ticker: string;
    totalSupply: bigint;
    decimals: number;
    metadataHash: Buffer;
    lockupDays?: number;
    minimumKycTier?: number;
    totalSupplyBigInt: bigint;
  }): Promise<{ asaId: number; complianceContractId: number }> {
    const txn = await buildAsaCreateTransaction(this.algodClient, {
      creator: this.adminAccount.addr.toString(),
      assetName: params.name,
      unitName: params.ticker,
      total: params.totalSupply,
      decimals: params.decimals,
      defaultFrozen: true,
      managerAddress: this.adminAccount.addr.toString(),
      freezeAddress: this.adminAccount.addr.toString(),
      clawbackAddress: this.adminAccount.addr.toString(),
      reserveAddress: this.adminAccount.addr.toString(),
      metadataHash: new Uint8Array(params.metadataHash),
    });

    const signedTxn = txn.signTxn(this.adminAccount.sk);
    const { txid } = await this.algodClient.sendRawTransaction(signedTxn).do();

    const result = await algosdk.waitForConfirmation(this.algodClient, txid, 4);
    const asaId = Number(result.assetIndex);

    this.logger.log(`ASA created: asaId=${asaId}, txId=${txid}`);

    // In production, deploy per-asset TransferRestriction contract here
    // For now, return a stub contract ID (0 = not deployed)
    const complianceContractId = 0;

    return { asaId, complianceContractId };
  }

  async transferTokensToIssuer(asaId: number, issuerWalletAddress: string, amount: bigint): Promise<string> {
    const sp = await this.algodClient.getTransactionParams().do();
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: this.adminAccount.addr,
      receiver: issuerWalletAddress,
      assetIndex: asaId,
      amount,
      suggestedParams: sp,
    });

    const signedTxn = txn.signTxn(this.adminAccount.sk);
    const { txid } = await this.algodClient.sendRawTransaction(signedTxn).do();
    await algosdk.waitForConfirmation(this.algodClient, txid, 4);

    this.logger.log(`Tokens distributed: ${amount} of ASA ${asaId} → ${issuerWalletAddress} (txId=${txid})`);
    return txid;
  }

  // ─── Get admin wallet USDC balance ────────────────────────────────────────────

  async getUsdcBalance(usdcAsaId: number): Promise<{ hasOptedIn: boolean; balance: bigint }> {
    try {
      const info = await this.algodClient.accountAssetInformation(this.adminAccount.addr, usdcAsaId).do();
      const holding = info.assetHolding ?? (info as any)['asset-holding'];
      return { hasOptedIn: true, balance: BigInt(holding?.amount ?? 0) };
    } catch {
      return { hasOptedIn: false, balance: 0n };
    }
  }

  // ─── Transfer USDC from admin wallet to target ────────────────────────────────

  async transferUsdc(targetAddress: string, amount: bigint, usdcAsaId: number): Promise<string> {
    const sp = await this.algodClient.getTransactionParams().do();
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: this.adminAccount.addr,
      receiver: targetAddress,
      assetIndex: usdcAsaId,
      amount,
      suggestedParams: sp,
    });
    const signedTxn = txn.signTxn(this.adminAccount.sk);
    const { txid } = await this.algodClient.sendRawTransaction(signedTxn).do();
    await algosdk.waitForConfirmation(this.algodClient, txid, 4);
    return txid;
  }

  // ─── Opt admin/escrow address into USDC (or any ASA) ───────────────────────
  // Called before first BUY order to ensure the escrow can receive USDC.
  // Safe to call repeatedly — no-ops if already opted in.
  async optAddressIntoUsdc(escrowAddress: string, usdcAsaId: number): Promise<{ alreadyOptedIn: boolean; txId?: string }> {
    const alreadyOptedIn = await hasOptedIn(this.algodClient, escrowAddress, usdcAsaId);
    if (alreadyOptedIn) return { alreadyOptedIn: true };

    const sp = await this.algodClient.getTransactionParams().do();
    // An opt-in is a 0-amount self-transfer of the ASA
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: this.adminAccount.addr,
      receiver: this.adminAccount.addr,
      assetIndex: usdcAsaId,
      amount: 0n,
      suggestedParams: sp,
    });

    const signedTxn = txn.signTxn(this.adminAccount.sk);
    const { txid } = await this.algodClient.sendRawTransaction(signedTxn).do();
    await algosdk.waitForConfirmation(this.algodClient, txid, 4);

    this.logger.log(`Opted ${escrowAddress} into ASA ${usdcAsaId} (txId=${txid})`);
    return { alreadyOptedIn: false, txId: txid };
  }

  // ─── Deploy TokenVault contract ───────────────────────────────────────────────
  // Deploys a new vault contract, opts it into the ASA, then transfers the full
  // token supply from admin wallet → vault. Returns the vault's Algorand app ID.

  async deployTokenVault(asaId: number, totalSupply: bigint): Promise<number> {
    const approvalPath = path.resolve(
      __dirname, '../../../../contracts/token-vault/src/out/TokenVault.approval.teal',
    );
    const clearPath = path.resolve(
      __dirname, '../../../../contracts/token-vault/src/out/TokenVault.clear.teal',
    );
    const approvalTeal = fs.readFileSync(approvalPath, 'utf-8');
    const clearTeal = fs.readFileSync(clearPath, 'utf-8');

    const approvalResult = await this.algodClient.compile(approvalTeal).do();
    const clearResult = await this.algodClient.compile(clearTeal).do();
    const approval = new Uint8Array(Buffer.from(approvalResult.result, 'base64'));
    const clear = new Uint8Array(Buffer.from(clearResult.result, 'base64'));

    const adminPk = algosdk.decodeAddress(this.adminAccount.addr.toString()).publicKey;
    const sp = await this.algodClient.getTransactionParams().do();

    // Deploy vault
    const deployTxn = algosdk.makeApplicationCreateTxnFromObject({
      sender: this.adminAccount.addr.toString(),
      approvalProgram: approval,
      clearProgram: clear,
      numGlobalInts: 3,
      numGlobalByteSlices: 1,
      numLocalInts: 0,
      numLocalByteSlices: 0,
      onComplete: algosdk.OnApplicationComplete.NoOpOC,
      suggestedParams: sp,
      appArgs: [
        Buffer.from('1fc4f1f3', 'hex'),   // createApplication(address,uint64,uint64)void
        adminPk,
        algosdk.encodeUint64(asaId),
        algosdk.encodeUint64(totalSupply),
      ],
    });
    const signedDeploy = deployTxn.signTxn(this.adminAccount.sk);
    const { txid: deployTxid } = await this.algodClient.sendRawTransaction(signedDeploy).do();
    const deployConfirm = await algosdk.waitForConfirmation(this.algodClient, deployTxid, 4);
    const appId = Number(deployConfirm.applicationIndex ?? deployConfirm['application-index']);
    const vaultAddress = algosdk.getApplicationAddress(appId);
    this.logger.log(`TokenVault deployed: appId=${appId} address=${vaultAddress}`);

    // Fund vault (min balance + asset opt-in cost) then opt into ASA — atomic group
    const sp2 = await this.algodClient.getTransactionParams().do();
    const fundTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: this.adminAccount.addr.toString(),
      receiver: vaultAddress,
      amount: 300_000n,  // 0.3 ALGO covers min balance + asset opt-in storage
      suggestedParams: sp2,
    });
    // Inner txn (asset opt-in by vault) requires the outer app call to pay 2x minFee
    const optInTxn = algosdk.makeApplicationNoOpTxnFromObject({
      sender: this.adminAccount.addr.toString(),
      appIndex: appId,
      appArgs: [Buffer.from('bb757b1c', 'hex')],  // optIntoAsset()void
      foreignAssets: [asaId],
      suggestedParams: { ...sp2, flatFee: true, fee: 2000 },
    });
    algosdk.assignGroupID([fundTxn, optInTxn]);
    const signedGroup = [fundTxn, optInTxn].map((t) => t.signTxn(this.adminAccount.sk));
    const { txid: groupTxid } = await this.algodClient.sendRawTransaction(signedGroup).do();
    await algosdk.waitForConfirmation(this.algodClient, groupTxid, 4);
    this.logger.log(`Vault funded and opted into ASA ${asaId}`);

    // Unfreeze vault for the new ASA (defaultFrozen=true means opt-in puts vault in frozen state)
    const sp2b = await this.algodClient.getTransactionParams().do();
    const unfreezeTxn = algosdk.makeAssetFreezeTxnWithSuggestedParamsFromObject({
      sender: this.adminAccount.addr.toString(),
      assetIndex: asaId,
      freezeTarget: vaultAddress.toString(),
      frozen: false,
      suggestedParams: sp2b,
    });
    const signedUnfreeze = unfreezeTxn.signTxn(this.adminAccount.sk);
    const { txid: unfreezeTxid } = await this.algodClient.sendRawTransaction(signedUnfreeze).do();
    await algosdk.waitForConfirmation(this.algodClient, unfreezeTxid, 4);
    this.logger.log(`Vault unfrozen for ASA ${asaId}`);

    // Transfer full token supply admin → vault
    const sp3 = await this.algodClient.getTransactionParams().do();
    const transferAllTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: this.adminAccount.addr.toString(),
      receiver: vaultAddress,
      assetIndex: asaId,
      amount: totalSupply,
      suggestedParams: sp3,
    });
    const signedTransfer = transferAllTxn.signTxn(this.adminAccount.sk);
    const { txid: transferTxid } = await this.algodClient.sendRawTransaction(signedTransfer).do();
    await algosdk.waitForConfirmation(this.algodClient, transferTxid, 4);
    this.logger.log(`All ${totalSupply} tokens transferred to vault (appId=${appId})`);

    return appId;
  }

  // ─── Vault: distribute issuer's allocation ────────────────────────────────────
  // Calls the vault contract's distributeToIssuer method which transfers tokens
  // from the vault directly to the issuer's wallet on-chain.

  async vaultDistributeToIssuer(
    vaultAppId: number,
    asaId: number,
    issuerAddress: string,
    amount: bigint,
  ): Promise<string> {
    const optedIn = await hasOptedIn(this.algodClient, issuerAddress, asaId);
    if (!optedIn) {
      const issuerIsAdmin = issuerAddress === this.adminAccount.addr.toString();
      if (issuerIsAdmin) {
        // Testnet: admin wallet is also the issuer wallet — sign opt-in on their behalf
        const spOptIn = await this.algodClient.getTransactionParams().do();
        const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          sender: this.adminAccount.addr.toString(),
          receiver: this.adminAccount.addr.toString(),
          assetIndex: asaId,
          amount: 0,
          suggestedParams: spOptIn,
        });
        const signedOptIn = optInTxn.signTxn(this.adminAccount.sk);
        const { txid: optInTxId } = await this.algodClient.sendRawTransaction(signedOptIn).do();
        await algosdk.waitForConfirmation(this.algodClient, optInTxId, 4);
        this.logger.log(`Auto opted issuer (admin wallet) into ASA ${asaId} (txId=${optInTxId})`);
      } else {
        throw new Error(
          `Issuer ${issuerAddress} has not opted into ASA ${asaId}. ` +
          `Issuer must opt-in from their dashboard before tokens can be distributed.`,
        );
      }
    }

    // Unfreeze issuer for the ASA (defaultFrozen=true freezes them on opt-in)
    const spFreeze = await this.algodClient.getTransactionParams().do();
    const issuerUnfreezeTxn = algosdk.makeAssetFreezeTxnWithSuggestedParamsFromObject({
      sender: this.adminAccount.addr.toString(),
      assetIndex: asaId,
      freezeTarget: issuerAddress,
      frozen: false,
      suggestedParams: spFreeze,
    });
    const signedIssuerUnfreeze = issuerUnfreezeTxn.signTxn(this.adminAccount.sk);
    const { txid: issuerUnfreezeTxid } = await this.algodClient.sendRawTransaction(signedIssuerUnfreeze).do();
    await algosdk.waitForConfirmation(this.algodClient, issuerUnfreezeTxid, 4);
    this.logger.log(`Issuer ${issuerAddress} unfrozen for ASA ${asaId}`);

    const sp = await this.algodClient.getTransactionParams().do();
    const issuerPk = algosdk.decodeAddress(issuerAddress).publicKey;
    // Inner axfer (vault → issuer) requires 2x minFee on the outer app call
    const txn = algosdk.makeApplicationNoOpTxnFromObject({
      sender: this.adminAccount.addr.toString(),
      appIndex: vaultAppId,
      appArgs: [
        Buffer.from('af9aed85', 'hex'),  // distributeToIssuer(address,uint64)void
        issuerPk,
        algosdk.encodeUint64(amount),
      ],
      accounts: [issuerAddress],
      foreignAssets: [asaId],
      suggestedParams: { ...sp, flatFee: true, fee: 2000 },
    });
    const signed = txn.signTxn(this.adminAccount.sk);
    const { txid } = await this.algodClient.sendRawTransaction(signed).do();
    await algosdk.waitForConfirmation(this.algodClient, txid, 4);
    this.logger.log(`Vault distributed ${amount} tokens to issuer ${issuerAddress} (txId=${txid})`);
    return txid;
  }

  async freezeAccount(asaId: number, targetAddress: string, freeze: boolean) {
    const sp = await this.algodClient.getTransactionParams().do();
    const txn = algosdk.makeAssetFreezeTxnWithSuggestedParamsFromObject({
      sender: this.adminAccount.addr,
      assetIndex: asaId,
      freezeTarget: targetAddress,
      frozen: freeze,
      suggestedParams: sp,
    });

    const signedTxn = txn.signTxn(this.adminAccount.sk);
    const { txid } = await this.algodClient.sendRawTransaction(signedTxn).do();
    await algosdk.waitForConfirmation(this.algodClient, txid, 4);
    return txid;
  }
}
