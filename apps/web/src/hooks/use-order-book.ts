'use client';

import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { api } from '@/lib/api';

interface OrderBookLevel {
  price: string;
  quantity: string;
}

interface OrderBookSnapshot {
  assetId: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  lastTrade?: { price: string; quantity: string; side: 'BUY' | 'SELL'; timestamp: string };
}

export function useOrderBook(assetId: string | null) {
  const [snapshot, setSnapshot] = useState<OrderBookSnapshot | null>(null);
  const [connected, setConnected] = useState(false);

  const fetchDepth = useCallback(async () => {
    if (!assetId) return;
    try {
      const { data } = await api.get(`/orders/${assetId}/depth?levels=20`);
      if (data) {
        setSnapshot((prev) => ({
          assetId,
          bids: data.bids ?? [],
          asks: data.asks ?? [],
          lastTrade: prev?.lastTrade,
        }));
      }
    } catch {
      // silently ignore — stale data is fine
    }
  }, [assetId]);

  // Poll HTTP depth every 3 seconds (works without Kafka/WS)
  useEffect(() => {
    fetchDepth();
    const interval = setInterval(fetchDepth, 3000);
    return () => clearInterval(interval);
  }, [fetchDepth]);

  // WebSocket overlay: when connected it pushes live deltas on top of polling
  useEffect(() => {
    if (!assetId) return;

    const socket: Socket = io(process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3003', {
      transports: ['websocket'],
      query: { assetId },
      reconnectionAttempts: 3,
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    socket.on('orderbook:snapshot', (data: OrderBookSnapshot) => {
      setSnapshot(data);
    });

    socket.on('orderbook:update', () => {
      // On any live update, re-fetch from DB for accuracy
      fetchDepth();
    });

    socket.on('trade:executed', (trade: OrderBookSnapshot['lastTrade']) => {
      setSnapshot((prev) =>
        prev ? { ...prev, lastTrade: trade } : null,
      );
      // Also refresh depth after a trade
      fetchDepth();
    });

    socket.emit('subscribe', { assetId });

    return () => {
      socket.emit('unsubscribe', { assetId });
      socket.disconnect();
    };
  }, [assetId, fetchDepth]);

  return { snapshot, connected };
}
