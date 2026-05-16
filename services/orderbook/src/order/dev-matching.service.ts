import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';
import axios from 'axios';

// Dev-mode synchronous matching engine.
// Runs price-time priority matching directly in the DB, bypassing Kafka.
// Called via POST /orders/:assetId/dev/trigger-match when Kafka is unavailable.
@Injectable()
export class DevMatchingService {
  private readonly logger = new Logger(DevMatchingService.name);
  private readonly settlementUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.settlementUrl = this.config.get<string>('SETTLEMENT_SERVICE_URL', 'http://localhost:3005');
  }

  async triggerMatch(assetId: string): Promise<{ trades: number; settled: boolean }> {
    const market = await this.prisma.market.findUnique({ where: { assetId } });
    if (!market) return { trades: 0, settled: false };

    // Fetch best ask (lowest sell price, earliest time)
    const asks = await this.prisma.order.findMany({
      where: { marketId: market.id, side: 'SELL', status: { in: ['ACCEPTED', 'PARTIALLY_FILLED'] } },
      orderBy: [{ price: 'asc' }, { createdAt: 'asc' }],
    });

    // Fetch best bid (highest buy price, earliest time)
    const bids = await this.prisma.order.findMany({
      where: { marketId: market.id, side: 'BUY', status: { in: ['ACCEPTED', 'PARTIALLY_FILLED'] } },
      orderBy: [{ price: 'desc' }, { createdAt: 'asc' }],
    });

    let tradesExecuted = 0;

    for (const bid of bids) {
      for (const ask of asks) {
        // Price-time priority: match if bid price >= ask price
        const bidPrice = BigInt(bid.price ?? 0);
        const askPrice = BigInt(ask.price ?? 0);
        if (bidPrice < askPrice) break; // No more matches possible

        // Remaining qty on each side
        const bidQty = BigInt(bid.remainingQuantity);
        const askQty = BigInt(ask.remainingQuantity);
        if (bidQty === 0n || askQty === 0n) continue;

        const matchQty = bidQty < askQty ? bidQty : askQty;
        const tradePrice = askPrice; // Maker price (ask was first)

        const tradeId = randomUUID();

        const totalValue = tradePrice * matchQty / 1_000_000n; // price × qty in micro-USDC
        const feeRate = 0.0025; // taker fee
        const platformFee = BigInt(Math.floor(Number(totalValue) * feeRate));

        // Create trade record
        await this.prisma.trade.create({
          data: {
            id: tradeId,
            marketId: market.id,
            buyOrderId: bid.id,
            sellOrderId: ask.id,
            buyerUserId: bid.userId,
            sellerUserId: ask.userId,
            buyerWalletAddress: bid.walletAddress,
            sellerWalletAddress: ask.walletAddress,
            price: tradePrice,
            quantity: matchQty,
            totalValue,
            platformFee,
            feeRate,
            status: 'MATCHED',
            matchedAt: new Date(),
          } as any,
        });

        // Update buy order
        const newBidFilled = BigInt(bid.filledQuantity) + matchQty;
        const newBidRemaining = bidQty - matchQty;
        await this.prisma.order.update({
          where: { id: bid.id },
          data: {
            filledQuantity: newBidFilled,
            remainingQuantity: newBidRemaining,
            status: newBidRemaining === 0n ? 'FILLED' : 'PARTIALLY_FILLED',
          } as any,
        });

        // Update sell order
        const newAskFilled = BigInt(ask.filledQuantity) + matchQty;
        const newAskRemaining = askQty - matchQty;
        await this.prisma.order.update({
          where: { id: ask.id },
          data: {
            filledQuantity: newAskFilled,
            remainingQuantity: newAskRemaining,
            status: newAskRemaining === 0n ? 'FILLED' : 'PARTIALLY_FILLED',
          } as any,
        });

        // Update market last traded price and volume
        await this.prisma.market.update({
          where: { id: market.id },
          data: { lastTradedPrice: tradePrice } as any,
        });

        tradesExecuted++;
        this.logger.log(
          `[DEV MATCH] Trade ${tradeId}: ${matchQty} @ ${tradePrice} | bid=${bid.id} ask=${ask.id}`,
        );

        // Directly call settlement service (bypasses Kafka)
        const settleTotalValue = tradePrice * matchQty / 1_000_000n;
        const settlePlatformFee = BigInt(Math.floor(Number(settleTotalValue) * 0.0025));
        axios.post(`${this.settlementUrl}/internal/settle`, {
          tradeId,
          assetId,
          asaId: market.asaId,
          buyOrderId: bid.id,
          sellOrderId: ask.id,
          buyerUserId: bid.userId,
          sellerUserId: ask.userId,
          buyerWalletAddress: bid.walletAddress,
          sellerWalletAddress: ask.walletAddress,
          tokenAmount: matchQty.toString(),
          usdcAmount: settleTotalValue.toString(),
          platformFee: settlePlatformFee.toString(),
          price: tradePrice.toString(),
        }, { timeout: 10_000 }).then(() => {
          this.logger.log(`[DEV MATCH] Settlement triggered for trade ${tradeId}`);
        }).catch((err: Error) => {
          this.logger.error(`[DEV MATCH] Settlement call failed for trade ${tradeId}: ${err.message}`);
        });

        // Update remaining qty in loop variables for next iteration
        (ask as any).remainingQuantity = newAskRemaining.toString();
        (ask as any).filledQuantity = newAskFilled.toString();
        (ask as any).status = newAskRemaining === 0n ? 'FILLED' : 'PARTIALLY_FILLED';
        break; // re-fetch asks next bid iteration for correctness
      }
    }

    return { trades: tradesExecuted, settled: false };
  }
}
