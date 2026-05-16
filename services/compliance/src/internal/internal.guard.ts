import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class InternalGuard implements CanActivate {
  private readonly secret: string;

  constructor(private readonly config: ConfigService) {
    this.secret = this.config.get<string>('INTERNAL_SECRET', '');
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const provided = req.headers['x-internal-secret'];
    if (!this.secret || !provided || provided !== this.secret) {
      throw new UnauthorizedException('Missing or invalid x-internal-secret');
    }
    return true;
  }
}
