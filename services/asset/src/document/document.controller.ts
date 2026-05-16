import {
  Controller, Post, Get, Param, Req, UseGuards,
  UseInterceptors, UploadedFile, ParseFilePipe, MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { DocumentService } from './document.service';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

@ApiTags('asset-documents')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('assets/:assetId/documents')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Post()
  @ApiOperation({ summary: 'Upload asset document (prospectus, legal, valuation)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('assetId') assetId: string,
    @Req() req: { user: { id: string }; body: { documentType: string } },
    @UploadedFile(new ParseFilePipe({ validators: [new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE })] }))
    file: Express.Multer.File,
  ) {
    return this.documentService.uploadDocument(assetId, req.body.documentType, file);
  }

  @Get()
  @ApiOperation({ summary: 'List documents for an asset' })
  async list(@Param('assetId') assetId: string) {
    return this.documentService.listByAsset(assetId);
  }

  @Get(':documentId/download')
  @ApiOperation({ summary: 'Get presigned download URL for document' })
  async download(
    @Param('documentId') documentId: string,
    @Req() req: { user: { id: string } },
  ) {
    const url = await this.documentService.getPresignedDownloadUrl(documentId, req.user.id);
    return { url };
  }
}
