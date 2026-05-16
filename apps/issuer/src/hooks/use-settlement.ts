'use client';

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3003';

interface SignRequestPayload {
  tradeId: string;
  unsignedTxnGroup: string[];
  expiresAt: number;
}

// Connects to the settlement WebSocket namespace and auto-signs token transfer (Txn 0)
// using the provided signer function. Must be active whenever the issuer might have
// sell orders on the book so that settlement can proceed on match.
export function useSettlement(
  walletAddress: string | null,
  walletSigner: ((txns: Uint8Array[], signerIndices: number[]) => Promise<Uint8Array[]>) | null,
) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!walletAddress || !walletSigner) return;

    const token = localStorage.getItem('access_token');
    const socket: Socket = io(`${WS_URL}/settlement`, {
      transports: ['websocket'],
      auth: { token },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Issuer Settlement WS] connected');
      socket.emit('subscribe:settlement');
    });

    socket.on('disconnect', () => {
      console.log('[Issuer Settlement WS] disconnected');
    });

    socket.on('settlement:sign_request', async (payload: SignRequestPayload) => {
      try {
        console.log(`[Issuer Settlement] Sign request for trade ${payload.tradeId}`);

        const txns = payload.unsignedTxnGroup.map((b64) => Buffer.from(b64, 'base64'));

        // Sign only Txn 0 (token transfer: issuer → buyer)
        const signedTxns = await walletSigner(txns, [0]);
        const signed0 = signedTxns[0];
        if (!signed0) throw new Error('Failed to sign transaction');

        const signedGroup = payload.unsignedTxnGroup.map((b64, idx) =>
          idx === 0 ? Buffer.from(signed0).toString('base64') : b64,
        );

        socket.emit('settlement:sign_response', {
          tradeId: payload.tradeId,
          signedTxnGroup: signedGroup,
          signature: Buffer.from(signed0).toString('base64'),
        });

        console.log(`[Issuer Settlement] Sent sign response for trade ${payload.tradeId}`);
      } catch (err) {
        console.error('[Issuer Settlement] Sign error:', err);
        socket.emit('settlement:sign_error', {
          tradeId: payload.tradeId,
          error: (err as Error).message,
        });
      }
    });

    socket.on('settlement:sign_ack', (data: { tradeId: string; status: string }) => {
      console.log(`[Issuer Settlement] Ack for trade ${data.tradeId}: ${data.status}`);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [walletAddress, walletSigner]);

  return { isConnected: !!socketRef.current?.connected };
}
