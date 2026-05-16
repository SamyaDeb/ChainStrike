import { Global, Module } from '@nestjs/common';
import { InMemoryOrderBookStore } from './in-memory-order-book.store';

@Global()
@Module({
  providers: [InMemoryOrderBookStore],
  exports: [InMemoryOrderBookStore],
})
export class OrderBookStoreModule {}
