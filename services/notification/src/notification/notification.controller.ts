import { Controller, Get, Post, Body } from '@nestjs/common';
import { NotificationService } from './notification.service';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get('recent')
  getRecent() {
    return this.notifications.getRecent();
  }

  @Post('push')
  push(@Body() body: { topic: string; payload: unknown; timestamp: string }) {
    this.notifications.handle(body.topic, { payload: body.payload, timestamp: body.timestamp } as any);
    return { received: true };
  }
}
