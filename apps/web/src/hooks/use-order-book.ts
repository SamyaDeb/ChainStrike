'use client';

import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

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

  useEffect(() => {
    if (!assetId) return;

    const socket: Socket = io(process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3003', {
      transports: ['websocket'],
      query: { assetId },
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('orderbook:snapshot', (data: OrderBookSnapshot) => {
      setSnapshot(data);
    });

    socket.on('orderbook:update', (delta: Partial<OrderBookSnapshot>) => {
      setSnapshot((prev) => prev ? { ...prev, ...delta } : null);
    });

    socket.on('trade:executed', (trade: OrderBookSnapshot['lastTrade']) => {
      setSnapshot((prev) => prev ? { ...prev, lastTrade: trade } : null);
    });

    socket.emit('subscribe', { assetId });

    return () => {
      socket.emit('unsubscribe', { assetId });
      socket.disconnect();
    };
  }, [assetId]);

  return { snapshot, connected };
}
