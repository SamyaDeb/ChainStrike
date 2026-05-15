import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env['JWT_SECRET']!,
      algorithms: ['HS256'],
    });
  }

  validate(payload: { sub: string; email: string; role: string; kycTier: number }) {
    return { id: payload.sub, email: payload.email, role: payload.role, kycTier: payload.kycTier };
  }
}
