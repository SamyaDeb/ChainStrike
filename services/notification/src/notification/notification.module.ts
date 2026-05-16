import { Module } from '@nestjs/common';
import { NotificationConsumer } from './notification.consumer';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';

@Module({
  controllers: [NotificationConsumer, NotificationController],
  providers: [NotificationService],
})
export class NotificationModule {}
