import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.s3 = new S3Client({
      region: this.config.get<string>('AWS_REGION', 'us-east-1'),
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('AWS_ACCESS_KEY_ID'),
        secretAccessKey: this.config.getOrThrow<string>('AWS_SECRET_ACCESS_KEY'),
      },
    });
    this.bucket = this.config.getOrThrow<string>('AWS_S3_BUCKET_DOCUMENTS');
  }

  async uploadDocument(
    assetId: string,
    documentType: string,
    file: Express.Multer.File,
  ) {
    const key = `assets/${assetId}/documents/${randomUUID()}-${file.originalname}`;

    await this.s3.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ServerSideEncryption: 'AES256',
    }));

    const hash = require('crypto').createHash('sha256').update(file.buffer).digest('hex');
    const doc = await this.prisma.assetDocument.create({
      data: {
        assetId,
        type: documentType as any,
        fileName: file.originalname,
        storageKey: key,
        documentHash: hash,
      },
    });

    this.logger.log(`Document uploaded: ${doc.id} for asset ${assetId}`);
    return doc;
  }

  async getPresignedDownloadUrl(documentId: string, requestingUserId: string): Promise<string> {
    const doc = await this.prisma.assetDocument.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Document not found');

    const command = new GetObjectCommand({ Bucket: this.bucket, Key: doc.storageKey });
    return getSignedUrl(this.s3, command, { expiresIn: 900 }); // 15 min
  }

  async listByAsset(assetId: string) {
    return this.prisma.assetDocument.findMany({
      where: { assetId },
      select: { id: true, type: true, fileName: true, storageKey: true, createdAt: true },
    });
  }
}
