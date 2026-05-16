import { Controller, Post, Body, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { OrderbookGateway } from '../gateway/orderbook.gateway';
import { MarketService } from '../market/market.service';
import { MarketRepository } from '../market/market.repository';
import { PrismaService } from '../prisma/prisma.service';
import { InMemoryOrderBookStore } from '../orderbook/in-memory-order-book.store';

interface SignRequestPayload {
  tradeId: string;
  sellerWalletAddress: string;
  unsignedTxnGroup: string[];
  expiresAt: number;
}

@Controller('internal')
export class InternalController {
  private readonly logger = new Logger(InternalController.name);

  constructor(
    private readonly gateway: OrderbookGateway,
    private readonly marketService: MarketService,
    private readonly marketRepo: MarketRepository,
    private readonly prisma: PrismaService,
    private readonly bookStore: InMemoryOrderBookStore,
  ) {}

  // ─── Called by Asset Service when ASA is deployed ────────────────────────────

  @Post('markets')
  async createMarket(@Body() payload: { assetId: string; asaId: number; ticker: string; referencePriceUsdc?: string }) {
    this.logger.log(`Creating market for asset ${payload.assetId} (ASA ${payload.asaId})`);
    try {
      const refPrice = payload.referencePriceUsdc ? BigInt(payload.referencePriceUsdc) : undefined;
      await this.marketService.openMarket(payload.assetId, payload.asaId, payload.ticker, refPrice);
      return { success: true };
    } catch (err) {
      this.logger.error(`Failed to create market: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message };
    }
  }

  // ─── Called by Asset Service after distributing tokens to seed initial liquidity ─

  @Post('orders/seed')
  async seedOrder(@Body() payload: {
    assetId: string;
    userId: string;
    walletAddress: string;
    quantity: string;
    priceUsdc: string;
  }) {
    this.logger.log(`Seeding SELL order: asset=${payload.assetId} qty=${payload.quantity} price=${payload.priceUsdc}`);
    try {
      const market = await this.marketRepo.findByAssetId(payload.assetId);
      if (!market) throw new Error(`No market for asset ${payload.assetId}`);

      const quantity = BigInt(payload.quantity);
      const price = BigInt(payload.priceUsdc);

      const order = await this.prisma.order.create({
        data: {
          id: randomUUID(),
          marketId: market.id,
          userId: payload.userId,
          walletAddress: payload.walletAddress,
          side: 'SELL',
          type: 'LIMIT',
          timeInForce: 'GTC',
          price,
          quantity,
          remainingQuantity: quantity,
          filledQuantity: 0n,
          status: 'ACCEPTED',
        } as any,
      });

      // Add to in-memory order book so inline matching can find it
      this.bookStore.addOrder({
        orderId: order.id,
        userId: payload.userId,
        assetId: payload.assetId,
        asaId: market.asaId,
        marketId: market.id,
        side: 'sell',
        type: 'limit',
        timeInForce: 'GTC',
        price,
        quantity,
        remainingQuantity: quantity,
        walletAddress: payload.walletAddress,
        timestamp: Date.now(),
      });

      // Update market reference price so price band checks work
      if (!market.referencePriceUsdc) {
        await this.prisma.market.update({
          where: { id: market.id },
          data: { referencePriceUsdc: price } as any,
        });
      }

      // Broadcast updated depth to connected clients
      const depth = this.bookStore.getDepth(payload.assetId, 20);
      this.gateway.broadcastOrderbookUpdate(payload.assetId, { assetId: payload.assetId, ...depth });

      this.logger.log(`Seed order created: ${order.id} SELL ${quantity} @ ${price}`);
      return { success: true, orderId: order.id };
    } catch (err) {
      this.logger.error(`Failed to seed order: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message };
    }
  }

  // ─── Called by Asset Service when asset status changes ───────────────────────

  @Post('markets/status')
  async updateMarketStatus(@Body() payload: { assetId: string; newStatus: string }) {
    this.logger.log(`Market status update: asset=${payload.assetId} newStatus=${payload.newStatus}`);
    try {
      if (payload.newStatus === 'ACTIVE') {
        await this.marketService.activateMarket(payload.assetId);
      }
      return { success: true };
    } catch (err) {
      this.logger.error(`Failed to update market status: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message };
    }
  }

  // ─── Called by Settlement Service when a trade is settled ────────────────────

  @Post('trades/settled')
  async tradeSettled(@Body() payload: { tradeId: string; onChainTxId?: string }) {
    this.logger.log(`Trade settled: ${payload.tradeId}`);
    try {
      await this.prisma.trade.update({
        where: { id: payload.tradeId },
        data: { status: 'SETTLED', onChainTxId: payload.onChainTxId, settledAt: new Date() } as any,
      });
      return { success: true };
    } catch (err) {
      this.logger.error(`Failed to update trade settled: ${(err as Error).message}`);
      return { success: false };
    }
  }

  // ─── Called by Settlement Service when settlement fails ──────────────────────

  @Post('trades/failed')
  async tradeFailed(@Body() payload: { tradeId: string; reason?: string }) {
    this.logger.log(`Trade settlement failed: ${payload.tradeId}`);
    try {
      await this.prisma.trade.update({
        where: { id: payload.tradeId },
        data: { status: 'FAILED', failureReason: payload.reason } as any,
      });
      return { success: true };
    } catch (err) {
      this.logger.error(`Failed to update trade failed: ${(err as Error).message}`);
      return { success: false };
    }
  }

  // ─── Called by Settlement Service to forward sign request ────────────────────

  @Post('settlement/forward-sign-request')
  async forwardSignRequest(@Body() payload: SignRequestPayload) {
    const connected = await this.gateway.getWalletConnectionCount(payload.sellerWalletAddress);
    if (connected === 0) {
      this.logger.warn(`No WebSocket connection for ${payload.sellerWalletAddress}`);
      return { success: false, error: 'Seller not connected' };
    }

    this.gateway.forwardSettlementSignRequest(payload.sellerWalletAddress, {
      tradeId: payload.tradeId,
      unsignedTxnGroup: payload.unsignedTxnGroup,
      expiresAt: payload.expiresAt,
    });

    return { success: true, message: 'Sign request forwarded' };
  }
}
