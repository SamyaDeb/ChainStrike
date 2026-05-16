import algosdk from 'algosdk';

// ─── Read full ASA details from Algorand ledger ───────────────────────────────

export interface AsaDetails {
  asaId: number;
  name: string;
  unitName: string;
  totalSupply: bigint;
  decimals: number;
  defaultFrozen: boolean;
  creator: string;
  manager?: string;
  reserve?: string;
  freeze?: string;
  clawback?: string;
  url?: string;
  metadataHash?: string;
}

export async function getAsaDetails(
  algodClient: algosdk.Algodv2,
  asaId: number,
): Promise<AsaDetails> {
  const info = await algodClient.getAssetByID(asaId).do();
  const p = info.params;
  // algosdk v3 uses camelCase; v2 used kebab-case — support both
  return {
    asaId,
    name: p.name ?? '',
    unitName: p.unitName ?? p['unit-name'] ?? '',
    totalSupply: BigInt(p.total),
    decimals: p.decimals,
    defaultFrozen: p.defaultFrozen ?? p['default-frozen'] ?? false,
    creator: p.creator,
    manager: p.manager,
    reserve: p.reserve,
    freeze: p.freeze,
    clawback: p.clawback,
    url: p.url,
    metadataHash: p.metadataHash
      ? Buffer.from(p.metadataHash as Uint8Array).toString('hex')
      : p['metadata-hash']
        ? Buffer.from(p['metadata-hash']).toString('hex')
        : undefined,
  };
}

// ─── Query WhitelistRegistry contract box storage ─────────────────────────────
//
// Box key: 'wl:' prefix + address public key (32 bytes) + asaId (8 bytes BE)
// Box value: approved(8 BE) || tier(8 BE) || expiry(8 BE) = 24 bytes
// Returns { isWhitelisted: false } if the box does not exist.

export async function queryWhitelistOnChain(
  algodClient: algosdk.Algodv2,
  registryAppId: number,
  walletAddress: string,
  asaId: number,
): Promise<{ isWhitelisted: boolean; tier: number; expiresAt: Date | null }> {
  try {
    const addressBytes = algosdk.decodeAddress(walletAddress).publicKey;
    const asaIdBytes = algosdk.encodeUint64(asaId);

    // Full box name = prefix bytes + address + asaId
    const prefix = new TextEncoder().encode('wl:');
    const boxName = new Uint8Array(prefix.length + addressBytes.length + asaIdBytes.length);
    boxName.set(prefix, 0);
    boxName.set(addressBytes, prefix.length);
    boxName.set(asaIdBytes, prefix.length + addressBytes.length);

    const box = await algodClient.getApplicationBoxByName(registryAppId, boxName).do();
    const value: Uint8Array = box.value as Uint8Array;

    if (!value || value.length < 24) {
      return { isWhitelisted: false, tier: 0, expiresAt: null };
    }

    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    // Values are 8-byte big-endian unsigned ints (itob in AVM)
    const approved = Number(view.getBigUint64(0, false));
    const tier = Number(view.getBigUint64(8, false));
    const expiryUnix = Number(view.getBigUint64(16, false));

    if (approved !== 1) {
      return { isWhitelisted: false, tier, expiresAt: null };
    }

    const expiresAt = expiryUnix > 0 ? new Date(expiryUnix * 1000) : null;

    // Check if expired
    if (expiresAt && expiresAt < new Date()) {
      return { isWhitelisted: false, tier, expiresAt };
    }

    return { isWhitelisted: true, tier, expiresAt };
  } catch (err: unknown) {
    // Box not found = not whitelisted
    const msg = (err as Error).message ?? '';
    if (msg.includes('box not found') || msg.includes('404') || msg.includes('does not exist')) {
      return { isWhitelisted: false, tier: 0, expiresAt: null };
    }
    throw err;
  }
}

// ─── Query Escrow contract box storage ───────────────────────────────────────
//
// Box key: 'e:' prefix + orderId (UTF-8 bytes)
// Box value: buyerAddress(32 bytes) || amount(8 BE) || isLocked(8 BE) = 48 bytes
// Returns null if the box does not exist.

export async function queryEscrowOnChain(
  algodClient: algosdk.Algodv2,
  escrowAppId: number,
  orderId: string,
): Promise<{ locked: boolean; amount: bigint; buyerAddress: string } | null> {
  try {
    const prefix = new TextEncoder().encode('e:');
    const orderIdBytes = new TextEncoder().encode(orderId);
    const boxName = new Uint8Array(prefix.length + orderIdBytes.length);
    boxName.set(prefix, 0);
    boxName.set(orderIdBytes, prefix.length);

    const box = await algodClient.getApplicationBoxByName(escrowAppId, boxName).do();
    const value: Uint8Array = box.value as Uint8Array;

    if (!value || value.length < 48) {
      return null;
    }

    // First 32 bytes = buyer address public key
    const buyerPubKey = value.slice(0, 32);
    const buyerAddress = algosdk.encodeAddress(buyerPubKey);

    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    const amount = view.getBigUint64(32, false);
    const isLocked = Number(view.getBigUint64(40, false));

    return {
      locked: isLocked === 1,
      amount,
      buyerAddress,
    };
  } catch (err: unknown) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('box not found') || msg.includes('404') || msg.includes('does not exist')) {
      return null;
    }
    throw err;
  }
}
