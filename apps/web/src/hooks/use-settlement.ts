'use client';

import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import algosdk from 'algosdk';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3003';

interface SignRequestPayload {
  tradeId: string;
  unsignedTxnGroup: string[];
  expiresAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// useSettlement — WebSocket hook for settlement signature collection
//
// Connects to the /settlement namespace on the Orderbook Service WebSocket.
// Listens for `settlement:sign_request` events.
// When a sign request arrives, signs the first transaction (token transfer)
// with the provided wallet signer and sends back the signed group.
// ─────────────────────────────────────────────────────────────────────────────

export function useSettlement(walletAddress: string | null, walletSigner: algosdk.TransactionSigner | null) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!walletAddress) return;

    const token = localStorage.getItem('access_token');
    const socket: Socket = io(`${WS_URL}/settlement`, {
      transports: ['websocket'],
      auth: { token },
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Settlement WS] connected');
      socket.emit('subscribe:settlement');
    });

    socket.on('disconnect', () => {
      console.log('[Settlement WS] disconnected');
    });

    socket.on('settlement:sign_request', async (payload: SignRequestPayload) => {
      if (!walletSigner) {
        console.warn('[Settlement] No wallet signer available');
        return;
      }

      try {
        console.log(`[Settlement] Received sign request for trade ${payload.tradeId}`);

        // Decode the unsigned transaction group
        const txns = payload.unsignedTxnGroup.map((b64) =>
          algosdk.decodeUnsignedTransaction(Buffer.from(b64, 'base64')),
        );

        // Sign only the first transaction (token transfer) with the user's wallet
        // TransactionSigner returns Promise<Uint8Array[]>
        const signedTxns = await walletSigner(txns, [0]);
        const signed0 = signedTxns[0];
        if (!signed0) {
          throw new Error('Failed to sign transaction');
        }

        // Build the signed group: only Txn 0 is signed by user, rest returned unsigned for server to fill
        const signedGroup = payload.unsignedTxnGroup.map((b64, idx) => {
          if (idx === 0) {
            return Buffer.from(signed0).toString('base64');
          }
          return b64;
        });

        socket.emit('settlement:sign_response', {
          tradeId: payload.tradeId,
          signedTxnGroup: signedGroup,
          signature: Buffer.from(signed0).toString('base64'),
        });

        console.log(`[Settlement] Sent sign response for trade ${payload.tradeId}`);
      } catch (err) {
        console.error('[Settlement] Sign error:', err);
        socket.emit('settlement:sign_error', {
          tradeId: payload.tradeId,
          error: (err as Error).message,
        });
      }
    });

    socket.on('settlement:sign_ack', (data: { tradeId: string; status: string }) => {
      console.log(`[Settlement] Sign ack for trade ${data.tradeId}: ${data.status}`);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [walletAddress, walletSigner]);

  const isConnected = !!socketRef.current?.connected;

  return { isConnected };
}
