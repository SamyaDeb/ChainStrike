import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { Request } from 'express';

// NestJS/Express strips the matched route prefix from req.url before middleware sees it.
// We use req.originalUrl to reconstruct the correct upstream path.

@Module({})
export class ProxyModule implements NestModule {
  constructor(private readonly config: ConfigService) {}

  configure(consumer: MiddlewareConsumer) {
    const services: Record<string, string> = {
      '/api/v1/auth': this.config.get('IDENTITY_SERVICE_URL', 'http://localhost:3001'),
      '/api/v1/kyc': this.config.get('IDENTITY_SERVICE_URL', 'http://localhost:3001'),
      '/api/v1/users': this.config.get('IDENTITY_SERVICE_URL', 'http://localhost:3001'),
      '/api/v1/wallets': this.config.get('IDENTITY_SERVICE_URL', 'http://localhost:3001'),
      '/api/v1/assets': this.config.get('ASSET_SERVICE_URL', 'http://localhost:3002'),
      '/api/v1/orders': this.config.get('ORDERBOOK_SERVICE_URL', 'http://localhost:3003'),
      '/api/v1/orderbook': this.config.get('ORDERBOOK_SERVICE_URL', 'http://localhost:3003'),
      '/api/v1/markets': this.config.get('ORDERBOOK_SERVICE_URL', 'http://localhost:3003'),
      '/api/v1/compliance': this.config.get('COMPLIANCE_SERVICE_URL', 'http://localhost:3004'),
      '/api/v1/settlements': this.config.get('SETTLEMENT_SERVICE_URL', 'http://localhost:3005'),
    };

    for (const [path, target] of Object.entries(services)) {
      consumer
        .apply(
          createProxyMiddleware({
            target,
            changeOrigin: true,
            // req.url is stripped by Express; use originalUrl to get the full path
            pathRewrite: (_path: string, req: Request) => {
              const orig = (req.originalUrl ?? req.url) as string;
              const [pathname, qs] = orig.split('?');
              const rewritten = pathname.replace('/api/v1', '');
              return qs ? `${rewritten}?${qs}` : rewritten;
            },
            on: {
              error: (_err: Error, _req: Request, res: any) => {
                res.status(502).json({ error: 'Service temporarily unavailable' });
              },
            },
          }),
        )
        .forRoutes(path);
    }
  }
}
