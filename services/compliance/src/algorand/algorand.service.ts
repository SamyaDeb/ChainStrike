import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import algosdk from 'algosdk';

@Injectable()
export class AlgorandService {
  private readonly logger = new Logger(AlgorandService.name);
  private readonly algodClient: algosdk.Algodv2;
  private readonly adminAccount: algosdk.Account;

  constructor(private readonly config: ConfigService) {
    this.algodClient = new algosdk.Algodv2(
      this.config.get<string>('ALGORAND_ALGOD_TOKEN', ''),
      this.config.get<string>('ALGORAND_ALGOD_SERVER', 'http://localhost'),
      this.config.get<number>('ALGORAND_ALGOD_PORT', 4001),
    );

    const mnemonic = this.config.get<string>('ALGORAND_COMPLIANCE_MNEMONIC', '');
    if (mnemonic) {
      this.adminAccount = algosdk.mnemonicToSecretKey(mnemonic);
    } else {
      // Fallback to admin mnemonic for testnet
      const adminMnemonic = this.config.get<string>('ALGORAND_ADMIN_MNEMONIC', '');
      if (adminMnemonic) {
        this.adminAccount = algosdk.mnemonicToSecretKey(adminMnemonic);
      } else {
        this.adminAccount = algosdk.generateAccount();
        this.logger.warn('Using ephemeral compliance account — set ALGORAND_COMPLIANCE_MNEMONIC in production');
      }
    }
  }

  async updateWhitelistOnChain(input: {
    action: 'add' | 'remove';
    walletAddress: string;
    asaId: number;
    kycTier: number;
    expiryTimestamp?: number;
  }): Promise<string | null> {
    const appId = parseInt(this.config.get<string>('WHITELIST_REGISTRY_APP_ID', '0'), 10);
    const args: Uint8Array[] = [
      new TextEncoder().encode(input.walletAddress),
      algosdk.encodeUint64(input.asaId),
      algosdk.encodeUint64(input.kycTier),
      algosdk.encodeUint64(input.expiryTimestamp ?? 0),
    ];

    return this.callWhitelistContract(appId, input.action, args);
  }

  async callWhitelistContract(appId: number, method: string, args: Uint8Array[]) {
    if (!appId) {
      this.logger.warn(`Whitelist contract not deployed (appId=${appId}), skipping on-chain call`);
      return null;
    }

    try {
      const sp = await this.algodClient.getTransactionParams().do();

      const txn = algosdk.makeApplicationCallTxnFromObject({
        sender: this.adminAccount.addr,
        appIndex: appId,
        onComplete: algosdk.OnApplicationComplete.NoOpOC,
        appArgs: [algosdk.encodeUint64(method === 'add' ? 1 : 2), ...args],
        suggestedParams: sp,
      });

      const signedTxn = txn.signTxn(this.adminAccount.sk);
      const { txid } = await this.algodClient.sendRawTransaction(signedTxn).do();
      await algosdk.waitForConfirmation(this.algodClient, txid, 4);
      return txid;
    } catch (err) {
      this.logger.error(`Whitelist contract call failed: ${(err as Error).message}`);
      return null;
    }
  }
}
