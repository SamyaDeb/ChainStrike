import {
  Injectable, Logger, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { OrderRepository } from './order.repository';
import { ComplianceCheckService } from '../compliance/compliance-check.service';
import { MarketRepository } from '../market/market.repository';
import { EventProducerService } from '../events/event-producer.service';
import { EscrowService } from '../escrow/escrow.service';
import { Topics } from '@chainstrike/events';
import { PlaceOrderDto, OrderType } from './dto/place-order.dto';
import { PlatformConstants } from '@chainstrike/config';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly marketRepo: MarketRepository,
    private readonly complianceCheck: ComplianceCheckService,
    private readonly events: EventProducerService,
    private readonly escrowService: EscrowService,
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

    // Price band check for limit orders (skipped in dev mode)
    const skipPriceBand = process.env['NODE_ENV'] === 'development' || process.env['DEV_SKIP_PRICE_BAND'] === 'true';
    if (price && market.referencePriceUsdc && !skipPriceBand) {
      const refPrice = BigInt(market.referencePriceUsdc);
      const bandPct = BigInt(Math.floor(PlatformConstants.PRICE_BAND_PCT * 100));
      const upper = refPrice + (refPrice * bandPct) / 100n;
      const lower = refPrice - (refPrice * bandPct) / 100n;
      if (price > upper || price < lower) {
        throw new BadRequestException('Order price outside 20% band of reference price');
      }
    }

    // ─── Escrow verification for BUY orders ──────────────────────────────────────
    let escrowTxId: string | undefined;
    if (dto.side === 'BUY') {
      const skipEscrow = process.env['DEV_SKIP_USDC_PAYMENT'] === 'true';
      if (!skipEscrow) {
        if (!dto.escrowTxId) {
          throw new BadRequestException('BUY orders require an escrow lock transaction ID');
        }
        const expectedUsdc = (price ?? market.lastTradedPrice ?? 0n) * quantity;
        const verified = await this.escrowService.verifyEscrowLock(
          dto.escrowTxId,
          dto.walletAddress,
          expectedUsdc,
        );
        if (!verified) {
          throw new BadRequestException('Escrow lock verification failed — ensure USDC was sent to escrow contract');
        }
        escrowTxId = dto.escrowTxId;
      } else {
        this.logger.log(`DEV_SKIP_USDC_PAYMENT: skipping escrow verification for BUY order`);
      }
    }

    // Pre-trade compliance check
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
        const expectedUsdc = (price ?? market.lastTradedPrice ?? 0n) * quantity;
        await this.escrowService.recordEscrowLock(order.id, dto.walletAddress, expectedUsdc);
      } catch (err) {
        this.logger.error(`Failed to record escrow lock for order ${order.id}: ${(err as Error).message}`);
        // Don't fail the order - the escrow TX is already on-chain
      }
    }

    await this.events.emit(Topics.ORDER_PLACED, {
      orderId: order.id,
      userId,
      assetId: dto.assetId,
      asaId: market.asaId,
      side: dto.side,
      orderType: dto.orderType,
      price: price?.toString(),
      quantity: quantity.toString(),
      walletAddress: dto.walletAddress,
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
        // Continue with cancellation even if escrow return fails
      }
    }

    await this.orderRepo.updateStatus(orderId, 'CANCELLED');
    await this.events.emit(Topics.ORDER_CANCELLED, { orderId, userId, reason: 'User cancelled' });

    return { orderId, status: 'CANCELLED' };
  }

  async getActiveOrdersForUser(userId: string) {
    return this.orderRepo.findActiveByUser(userId);
  }

  async getDepthSnapshot(assetId: string, levels: number) {
    return this.marketRepo.getDepthSnapshot(assetId, levels);
  }
}
