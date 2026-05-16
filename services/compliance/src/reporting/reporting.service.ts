import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportingService {
  private readonly logger = new Logger(ReportingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async fileSar(data: {
    alertId: string;
    filingJurisdiction: string;
    narrativeText?: string;
    filedBy: string;
  }) {
    const report = await this.prisma.sarReport.create({
      data: {
        alertId: data.alertId,
        filingJurisdiction: data.filingJurisdiction,
        narrativeText: data.narrativeText,
        filedBy: data.filedBy,
        status: 'DRAFT',
      },
    });

    this.logger.warn(`SAR filed: ${report.id} by ${data.filedBy} for alert ${data.alertId}`);
    return report;
  }

  async submitSar(sarId: string, approverId: string) {
    const report = await this.prisma.sarReport.update({
      where: { id: sarId },
      data: { status: 'FILED', filedAt: new Date(), filedBy: approverId },
    });
    this.logger.warn(`SAR submitted: ${sarId}`);
    return report;
  }

  async getComplianceDashboard() {
    const [openAlerts, pendingDrafts, recentEvents] = await Promise.all([
      this.prisma.amlAlert.count({ where: { status: 'OPEN' } }),
      this.prisma.sarReport.count({ where: { status: 'DRAFT' } }),
      this.prisma.complianceEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return { openAlerts, pendingSars: pendingDrafts, recentEvents };
  }

  async getAmlAlerts() {
    return this.prisma.amlAlert.findMany({
      where: { status: 'OPEN' },
      orderBy: { detectedAt: 'desc' },
      take: 50,
    });
  }

  async exportAuditLog(startDate: Date, endDate: Date) {
    return this.prisma.complianceEvent.findMany({
      where: { createdAt: { gte: startDate, lte: endDate } },
      orderBy: { createdAt: 'asc' },
    });
  }
}
