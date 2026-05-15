import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MarketRepository } from '../market/market.repository';
import axios from 'axios';

// ─────────────────────────────────────────────────────────────────────────────
// Orderbook Gateway — Socket.IO server for real-time data + settlement relay
//
// Namespaces:
//   /orderbook   → Real-time orderbook depth, trades, ticker
//   /settlement  → Settlement signature collection
//
// Rooms:
//   orderbook:{assetId}  → Investors subscribed to a market
//   wallet:{address}     → Settlement sign requests for a specific wallet
// ─────────────────────────────────────────────────────────────────────────────

@WebSocketGateway({
  namespace: '/',
  cors: { origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'] },
  transports: ['websocket'],
})
export class OrderbookGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(OrderbookGateway.name);
  private readonly settlementUrl: string;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly marketRepo: MarketRepository,
  ) {
    this.settlementUrl = process.env.SETTLEMENT_SERVICE_URL ?? 'http://localhost:3005';
  }

  // ─── Connection handling ─────────────────────────────────────────────────────
  // Market data (depth, trades) is public — no token required.
  // Settlement sign requests require a JWT to associate the wallet address.

  async handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;
    if (token) {
      try {
        const payload = this.jwtService.verify(token, {
          secret: process.env.JWT_SECRET,
          ignoreExpiration: false,
        });
        client.data.userId = payload.sub;
        client.data.walletAddress = payload.walletAddress;
        this.logger.log(`Socket connected (auth): ${client.id}, user=${payload.sub}`);
      } catch {
        this.logger.warn(`Socket JWT invalid for ${client.id} — connected as anonymous`);
      }
    } else {
      this.logger.log(`Socket connected (anon): ${client.id}`);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Socket disconnected: ${client.id}`);
  }

  // ─── Orderbook namespace handlers ────────────────────────────────────────────

  // Accept both 'subscribe' (frontend hook) and 'subscribe:orderbook' (explicit)
  @SubscribeMessage('subscribe')
  async handleSubscribe(client: Socket, payload: { assetId: string }) {
    return this.handleSubscribeOrderbook(client, payload);
  }

  @SubscribeMessage('subscribe:orderbook')
  async handleSubscribeOrderbook(client: Socket, payload: { assetId: string }) {
    const room = `orderbook:${payload.assetId}`;
    client.join(room);
    this.logger.debug(`Client ${client.id} subscribed to ${room}`);

    // Push current depth snapshot immediately so the client sees data without waiting for the next trade
    try {
      const snapshot = await this.marketRepo.getDepthSnapshot(payload.assetId, 20);
      if (snapshot) {
        client.emit('orderbook:snapshot', snapshot);
      }
    } catch (err) {
      this.logger.error(`Failed to send initial snapshot: ${(err as Error).message}`);
    }
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(client: Socket, payload: { assetId: string }) {
    return this.handleUnsubscribeOrderbook(client, payload);
  }

  @SubscribeMessage('unsubscribe:orderbook')
  handleUnsubscribeOrderbook(client: Socket, payload: { assetId: string }) {
    const room = `orderbook:${payload.assetId}`;
    client.leave(room);
  }

  // ─── Settlement namespace handlers ───────────────────────────────────────────

  @SubscribeMessage('subscribe:settlement')
  handleSubscribeSettlement(client: Socket) {
    const wallet = client.data.walletAddress as string;
    if (!wallet) {
      client.emit('settlement:error', { message: 'Wallet not connected' });
      return;
    }
    const room = `wallet:${wallet}`;
    client.join(room);
    this.logger.debug(`Client ${client.id} subscribed to settlement for ${wallet}`);
    client.emit('settlement:subscribed', { walletAddress: wallet });
  }

  @SubscribeMessage('settlement:sign_response')
  async handleSignResponse(
    client: Socket,
    payload: { tradeId: string; signedTxnGroup: string[]; signature: string },
  ) {
    const wallet = client.data.walletAddress as string;
    this.logger.log(`Received sign response for trade ${payload.tradeId} from ${wallet}`);

    try {
      // Forward signed transaction to Settlement Service
      await axios.post(`${this.settlementUrl}/internal/settlement/signature-response`, {
        tradeId: payload.tradeId,
        signedTxnGroup: payload.signedTxnGroup,
        sellerWalletAddress: wallet,
      });

      client.emit('settlement:sign_ack', { tradeId: payload.tradeId, status: 'forwarded' });
    } catch (err) {
      this.logger.error(`Failed to forward signature: ${(err as Error).message}`);
      client.emit('settlement:sign_error', {
        tradeId: payload.tradeId,
        error: 'Failed to forward signature to settlement service',
      });
    }
  }

  // ─── Broadcasting helpers ────────────────────────────────────────────────────

  broadcastOrderbookSnapshot(assetId: string, snapshot: unknown) {
    this.server.to(`orderbook:${assetId}`).emit('orderbook:snapshot', snapshot);
  }

  broadcastOrderbookUpdate(assetId: string, delta: unknown) {
    this.server.to(`orderbook:${assetId}`).emit('orderbook:update', delta);
  }

  broadcastTrade(assetId: string, trade: unknown) {
    this.server.to(`orderbook:${assetId}`).emit('trade:executed', trade);
  }

  /** Forward a settlement sign request to a specific wallet's room */
  forwardSettlementSignRequest(
    walletAddress: string,
    payload: { tradeId: string; unsignedTxnGroup: string[]; expiresAt: number },
  ) {
    const room = `wallet:${walletAddress}`;
    this.server.to(room).emit('settlement:sign_request', payload);
    this.logger.debug(`Forwarded sign request to ${walletAddress} for trade ${payload.tradeId}`);
  }

  /** Get count of connected clients in a wallet room */
  async getWalletConnectionCount(walletAddress: string): Promise<number> {
    const sockets = await this.server.in(`wallet:${walletAddress}`).fetchSockets();
    return sockets.length;
  }
}
