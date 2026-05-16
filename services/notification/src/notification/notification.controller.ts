import { Controller, Get } from '@nestjs/common';
import { NotificationService } from './notification.service';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get('recent')
  getRecent() {
    return this.notifications.getRecent();
  }
}
