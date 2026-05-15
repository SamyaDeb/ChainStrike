import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import algosdk from 'algosdk';
import { buildAsaCreateTransaction } from '@chainstrike/algorand';

@Injectable()
export class AlgorandAssetService {
  private readonly logger = new Logger(AlgorandAssetService.name);
  private readonly algodClient: algosdk.Algodv2;
  private readonly adminAccount: algosdk.Account;

  constructor(private readonly config: ConfigService) {
    this.algodClient = new algosdk.Algodv2(
      this.config.get<string>('ALGORAND_ALGOD_TOKEN', ''),
      this.config.get<string>('ALGORAND_ALGOD_SERVER', 'http://localhost'),
      this.config.get<number>('ALGORAND_ALGOD_PORT', 4001),
    );

    const mnemonic = this.config.getOrThrow<string>('ALGORAND_ADMIN_MNEMONIC');
    this.adminAccount = algosdk.mnemonicToSecretKey(mnemonic);
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
