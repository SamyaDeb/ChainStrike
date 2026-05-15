import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import { sumsubConfig } from '@chainstrike/config';

// ─────────────────────────────────────────────────────────────────────────────
// Sumsub API Client
//
// Every request is signed with HMAC-SHA256 using the app token and secret.
// PII never passes through ChainStrike servers — the frontend WebSDK talks
// directly to Sumsub. This service only manages: applicant creation,
// access token generation, and webhook verification.
//
// Reference: https://developers.sumsub.com/api-reference/
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class SumsubService {
  private readonly logger = new Logger(SumsubService.name);
  private readonly http: AxiosInstance;
  private readonly cfg = sumsubConfig();

  constructor() {
    this.http = axios.create({ baseURL: this.cfg.baseUrl });

    // Intercept every request to add HMAC signature
    this.http.interceptors.request.use((config) => {
      const ts = Math.floor(Date.now() / 1000).toString();
      const method = config.method!.toUpperCase();
      const url = config.url!;
      const body = config.data ? JSON.stringify(config.data) : '';

      const signature = this.sign(ts, method, url, body);

      config.headers['X-App-Token'] = this.cfg.appToken;
      config.headers['X-App-Access-Ts'] = ts;
      config.headers['X-App-Access-Sig'] = signature;
      config.headers['Content-Type'] = 'application/json';

      return config;
    });
  }

  // ─── Create Applicant ─────────────────────────────────────────────────────────
  // Returns the Sumsub applicantId for this user.
  // externalUserId = ChainStrike user UUID — used to link Sumsub records to our DB.

  async createApplicant(
    userId: string,
    levelName: string,
    jurisdiction: string,
  ): Promise<string> {
    const response = await this.http.post('/resources/applicants', {
      externalUserId: userId,
      lang: 'en',
      requiredIdDocs: {
        docSets: [
          {
            idDocSetType: 'IDENTITY',
            types: ['PASSPORT', 'ID_CARD', 'DRIVERS'],
            country: jurisdiction,
          },
          { idDocSetType: 'SELFIE', types: ['SELFIE'] },
        ],
      },
    }, {
      params: { levelName },
    });

    return response.data.id as string;
  }

  // ─── Generate SDK Access Token ────────────────────────────────────────────────
  // Short-lived token (10 minutes) for the frontend Sumsub WebSDK.
  // The frontend passes this to the embedded widget to start verification.

  async generateAccessToken(
    applicantId: string,
    userId: string,
    levelName: string,
  ): Promise<string> {
    const response = await this.http.post(
      `/resources/accessTokens`,
      {},
      { params: { userId: applicantId, levelName, ttlInSecs: 600 } },
    );
    return response.data.token as string;
  }

  // ─── Get Applicant Level ──────────────────────────────────────────────────────

  async getApplicantLevel(applicantId: string): Promise<string> {
    try {
      const response = await this.http.get(`/resources/applicants/${applicantId}/one`);
      return response.data.review?.levelName ?? 'basic-kyc-level';
    } catch {
      return 'basic-kyc-level';
    }
  }

  // ─── Verify Webhook Signature ─────────────────────────────────────────────────
  // Sumsub signs its webhook payloads with HMAC-SHA256.
  // We verify the signature before processing any webhook to prevent spoofing.

  verifyWebhookSignature(rawBody: Buffer, receivedSignature: string): boolean {
    if (!this.cfg.webhookSecret) {
      this.logger.warn('SUMSUB_WEBHOOK_SECRET not configured — skipping signature verification');
      return true;
    }

    const expectedSignature = crypto
      .createHmac('sha256', this.cfg.webhookSecret)
      .update(rawBody)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'hex'),
      Buffer.from(receivedSignature, 'hex'),
    );
  }

  // ─── Request Signing ──────────────────────────────────────────────────────────

  private sign(ts: string, method: string, url: string, body: string): string {
    const stringToSign = ts + method + url + body;
    return crypto.createHmac('sha256', this.cfg.secretKey).update(stringToSign).digest('hex');
  }
}
