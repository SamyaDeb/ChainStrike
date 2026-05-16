import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../../../../node_modules/.prisma/compliance-client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasources: { db: { url: process.env.COMPLIANCE_DATABASE_URL } },
      log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
    });
  }

  async onModuleInit() {
    for (let attempt = 1; attempt <= 5; attempt++) {
      try { await this.$connect(); return; }
      catch (err) { if (attempt === 5) throw err; await new Promise(r => setTimeout(r, attempt * 1000)); }
    }
  }
  async onModuleDestroy() { await this.$disconnect(); }
}
