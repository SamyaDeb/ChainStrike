import { Controller, Post, Get, Patch, Body, Param, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { KybService } from './kyb.service';

@ApiTags('kyb')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('kyb')
export class KybController {
  constructor(private readonly kybService: KybService) {}

  @Post('submit')
  @ApiOperation({ summary: 'Submit KYB application (issuer only)' })
  async submit(
    @Req() req: { user: { id: string } },
    @Body() dto: {
      legalName: string;
      businessType: string;
      registrationNumber: string;
      incorporationJurisdiction: string;
      incorporationDate: string;
      registeredAddress: Record<string, unknown>;
      primaryBusinessActivity: string;
      website?: string;
    },
  ) {
    return this.kybService.submitKyb(req.user.id, {
      ...dto,
      incorporationDate: new Date(dto.incorporationDate),
    });
  }

  @Get('status')
  @ApiOperation({ summary: 'Get KYB status for current issuer' })
  async status(@Req() req: { user: { id: string } }) {
    return this.kybService.getKybStatus(req.user.id);
  }

  @Get('pending')
  @ApiOperation({ summary: 'List pending KYB applications (admin only)' })
  async pending(@Req() req: { user: { role: string } }) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'COMPLIANCE_OFFICER') {
      throw new Error('Unauthorized');
    }
    return this.kybService.findPending();
  }

  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve KYB application (admin only)' })
  async approve(
    @Param('id') id: string,
    @Req() req: { user: { id: string; role: string } },
  ) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'COMPLIANCE_OFFICER') {
      throw new Error('Unauthorized');
    }
    return this.kybService.approveKyb(id, req.user.id);
  }

  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject KYB application (admin only)' })
  async reject(
    @Param('id') id: string,
    @Req() req: { user: { id: string; role: string } },
    @Body() body: { reason: string },
  ) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'COMPLIANCE_OFFICER') {
      throw new Error('Unauthorized');
    }
    return this.kybService.rejectKyb(id, req.user.id, body.reason);
  }
}
