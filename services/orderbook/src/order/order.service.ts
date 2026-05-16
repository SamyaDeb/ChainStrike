import {
  Injectable, Logger, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { OrderRepository } from './order.repository';
import { ComplianceCheckService } from '../compliance/compliance-check.service';
import { MarketRepository } from '../market/market.repository';
import { EscrowService } from '../escrow/escrow.service';
import { MatchingService } from '../matching/matching.service';
import { InMemoryOrderBookStore } from '../orderbook/in-memory-order-book.store';
import { PlaceOrderDto, OrderType } from './dto/place-order.dto';
import { PlatformConstants } from '@chainstrike/config';
import { getAlgodClient } from '@chainstrike/algorand';
import { algorandConfig } from '@chainstrike/config';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly marketRepo: MarketRepository,
    private readonly complianceCheck: ComplianceCheckService,
    private readonly escrowService: EscrowService,
    private readonly matchingService: MatchingService,
    private readonly bookStore: InMemoryOrderBookStore,
  ) {}

  async placeOrder(userId: string, kycTier: number, dto: PlaceOrderDto) {
    const market = await this.marketRepo.findByAssetId(dto.assetId);
    if (!market) throw new BadRequestException('Market not found');
    if (market.status !== 'ACTIVE') {
      throw new BadRequestException(`Market is ${market.status} — trading not available`);
    }

    if (market.circuitBreakerActive && market.circuitBreakerUntil && market.circuitBreakerUntil > new Date()) {
      throw new BadRequestException('Circuit breaker active — trading temporarily paused');
    }

    const quantity = BigInt(dto.quantity);
    const price = dto.price ? BigInt(dto.price) : undefined;

    if (dto.orderType === OrderType.LIMIT && !price) {
      throw new BadRequestException('Limit orders require a price');
    }

    // Price band check for limit orders
    const skipPriceBand = process.env['DEV_SKIP_PRICE_BAND'] === 'true';
    if (price && market.referencePriceUsdc && !skipPriceBand) {
      const refPrice = BigInt(market.referencePriceUsdc);
      const bandPct = BigInt(Math.floor(PlatformConstants.PRICE_BAND_PCT * 100));
      const upper = refPrice + (refPrice * bandPct) / 100n;
      const lower = refPrice - (refPrice * bandPct) / 100n;
      if (price > upper || price < lower) {
        throw new BadRequestException('Order price outside 20% band of reference price');
      }
    }

    // ─── Algorand opt-in pre-checks ──────────────────────────────────────────────
    // Fail early with a clear message rather than letting settlement discover it later.
    const skipCompliance = process.env['DEV_SKIP_COMPLIANCE'] === 'true';
    if (!skipCompliance) {
      const algoCfg = algorandConfig();
      const algod = getAlgodClient({
        host: algoCfg.algodHost,
        port: algoCfg.algodPort,
        token: algoCfg.algodToken,
        network: algoCfg.network,
      });
      if (dto.side === 'BUY') {
        const buyerAsaInfo = await algod
          .accountAssetInformation(dto.walletAddress, market.asaId)
          .do()
          .catch(() => null);
        if (!buyerAsaInfo) {
          throw new BadRequestException(
            `Wallet must opt in to ASA ${market.asaId} before placing a BUY order`,
          );
        }
      }
      if (dto.side === 'SELL') {
        const sellerUsdcInfo = await algod
          .accountAssetInformation(dto.walletAddress, algoCfg.usdcAssetId)
          .do()
          .catch(() => null);
        if (!sellerUsdcInfo) {
          throw new BadRequestException(
            `Wallet must opt in to USDC (ASA ${algoCfg.usdcAssetId}) before placing a SELL order`,
          );
        }
      }
    }

    // ─── Escrow verification for BUY orders ──────────────────────────────────────
    let escrowTxId: string | undefined;
    if (dto.side === 'BUY') {
      if (!dto.escrowTxId) {
        throw new BadRequestException('BUY orders require an escrow lock transaction ID');
      }
      const referencePrice = price ?? market.lastTradedPrice ?? market.referencePriceUsdc;
      if (!referencePrice) {
        throw new BadRequestException('Cannot place market order: no reference price available');
      }
      const expectedUsdc = (referencePrice * quantity) / 1_000_000n;
      const verified = await this.escrowService.verifyEscrowLock(
        dto.escrowTxId,
        dto.walletAddress,
        expectedUsdc,
      );
      if (!verified) {
        throw new BadRequestException('Escrow lock verification failed — ensure USDC was sent to escrow contract');
      }
      escrowTxId = dto.escrowTxId;
    }

    // Pre-trade compliance check (calls Compliance Service via HTTP)
    const complianceResult = await this.complianceCheck.runPreTradeChecks({
      userId,
      walletAddress: dto.walletAddress,
      assetId: dto.assetId,
      asaId: market.asaId,
      side: dto.side,
      price,
      quantity,
      kycTier,
    });

    if (!complianceResult.approved) {
      const reason = complianceResult.failureCode ?? 'Compliance check failed';
      this.logger.log(`Order rejected: userId=${userId}, reason=${reason}`);
      throw new ForbiddenException(reason);
    }

    const order = await this.orderRepo.create({
      marketId: market.id,
      userId,
      walletAddress: dto.walletAddress,
      side: dto.side,
      type: dto.orderType,
      timeInForce: dto.timeInForce,
      price,
      quantity,
      remainingQuantity: quantity,
      filledQuantity: 0n,
      status: 'ACCEPTED',
      escrowTxId,
    });

    // Record escrow lock on contract for buy orders
    if (dto.side === 'BUY' && escrowTxId) {
      try {
        const expectedUsdc = ((price ?? market.lastTradedPrice ?? 0n) * quantity) / 1_000_000n;
        await this.escrowService.recordEscrowLock(order.id, dto.walletAddress, expectedUsdc);
      } catch (err) {
        this.logger.error(`Failed to record escrow lock for order ${order.id}: ${(err as Error).message}`);
      }
    }

    // Inline matching (replaces Kafka ORDER_PLACED event)
    const bookEntry = {
      orderId: order.id,
      userId,
      assetId: dto.assetId,
      asaId: market.asaId,
      marketId: market.id,
      side: dto.side.toLowerCase() as 'buy' | 'sell',
      type: dto.orderType.toLowerCase() as 'limit' | 'market',
      timeInForce: (dto.timeInForce ?? 'GTC') as 'GTC' | 'IOC' | 'FOK',
      price,
      quantity,
      remainingQuantity: quantity,
      walletAddress: dto.walletAddress,
      timestamp: Date.now(),
    };

    // Run matching asynchronously so order response returns immediately
    this.matchingService.processOrder(bookEntry).then((matches) => {
      if (matches.length > 0) {
        this.logger.log(`Order ${order.id} matched: ${matches.length} trade(s)`);
      }
    }).catch((err) => {
      this.logger.error(`Matching error for order ${order.id}: ${(err as Error).message}`);
    });

    this.logger.log(`Order placed: ${order.id} ${dto.side} ${quantity} @ ${price}`);
    return order;
  }

  async cancelOrder(orderId: string, userId: string) {
    const order = await this.orderRepo.findById(orderId);
    if (!order) throw new BadRequestException('Order not found');
    if (order.userId !== userId) throw new ForbiddenException('Not your order');
    if (!['ACCEPTED', 'PARTIALLY_FILLED'].includes(order.status)) {
      throw new BadRequestException(`Cannot cancel order in status ${order.status}`);
    }

    // Return escrow to buyer for buy orders
    if (order.side === 'BUY' && order.escrowTxId) {
      try {
        await this.escrowService.returnToBuyer(orderId);
      } catch (err) {
        this.logger.error(`Failed to return escrow for order ${orderId}: ${(err as Error).message}`);
      }
    }

    // Remove from in-memory book
    const market = await this.marketRepo.findById(order.marketId);
    if (market) {
      this.matchingService.cancelOrder(market.assetId, orderId);
    }

    await this.orderRepo.updateStatus(orderId, 'CANCELLED');
    return { orderId, status: 'CANCELLED' };
  }

  async getActiveOrdersForUser(userId: string) {
    return this.orderRepo.findActiveByUser(userId);
  }

  async getDepthSnapshot(assetId: string, levels: number) {
    // Read from in-memory store for live data; fall back to DB if store is empty
    const depth = this.bookStore.getDepth(assetId, levels);
    if (depth.bids.length > 0 || depth.asks.length > 0) {
      return { assetId, bids: depth.bids, asks: depth.asks };
    }
    // Fall back to DB-backed depth (for restart recovery)
    return this.marketRepo.getDepthSnapshot(assetId, levels);
  }
}
