import {
  Controller, Post, Get, Body, Req, UseGuards,
  HttpCode, HttpStatus, Headers, RawBodyRequest, Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { KycService } from './kyc.service';
import { InitiateKycDto } from './dto/initiate-kyc.dto';
import { SumsubService } from '../sumsub/sumsub.service';
import { SumsubWebhookPayload } from '@chainstrike/types';

@ApiTags('kyc')
@Controller('kyc')
export class KycController {
  constructor(
    private readonly kycService: KycService,
    private readonly sumsubService: SumsubService,
  ) {}

  @Post('initiate')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start KYC — returns Sumsub SDK token for frontend widget' })
  async initiate(
    @Req() req: { user: { id: string } },
    @Body() dto: InitiateKycDto,
  ) {
    return this.kycService.initiate(req.user.id, dto.jurisdiction);
  }

  @Get('status')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current KYC tier and status' })
  async getStatus(@Req() req: { user: { id: string } }) {
    return this.kycService.getProfile(req.user.id);
  }

  // ─── Sumsub Webhook (no auth — verified by HMAC signature) ───────────────────
  @Post('webhook/sumsub')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sumsub webhook receiver — do not call directly' })
  async sumsubWebhook(
    @Headers('x-payload-digest') signature: string,
    @Body() payload: SumsubWebhookPayload,
    @Req() req: RawBodyRequest<Request>,
  ) {
    // Verify HMAC-SHA256 signature to confirm the request is from Sumsub
    const rawBody = (req as any).rawBody as Buffer;
    const isValid = this.sumsubService.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      return { status: 'ignored' }; // Return 200 to prevent Sumsub retry storms
    }

    await this.kycService.handleWebhook(payload);
    return { status: 'processed' };
  }
}
