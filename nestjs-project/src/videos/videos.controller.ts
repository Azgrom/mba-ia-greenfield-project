import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { Channel } from '../channels/entities/channel.entity';
import { VideosService } from './videos.service';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { InitiateUploadResponseDto } from './dto/initiate-upload-response.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { VideoDetailDto } from './dto/video-detail.dto';
import { VideoStatus } from './entities/video.entity';
import { VideoNotReadyException } from './exceptions/video-not-ready.exception';
import { StorageService } from '../storage/storage.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly storageService: StorageService,
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Initiate video upload',
    description:
      'Creates a draft video and initiates an S3/MinIO multipart upload, returning presigned part URLs.',
  })
  @ApiResponse({
    status: 201,
    description: 'Video upload initiated successfully',
    schema: { $ref: getSchemaPath(InitiateUploadResponseDto) },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Channel not found for user',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async initiateUpload(
    @CurrentUser() currentUser: JwtPayload,
    @Body() dto: InitiateUploadDto,
  ): Promise<InitiateUploadResponseDto> {
    const channel = await this.channelRepository.findOneBy({
      user_id: currentUser.sub,
    });

    if (!channel) {
      throw new NotFoundException('Channel not found for user');
    }

    return this.videosService.initiateUpload(channel.id, dto);
  }

  @Post(':id/complete-upload')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete video upload',
    description:
      'Finalizes the S3/MinIO multipart upload, transitions the video to processing, and enqueues the processing job.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video upload completed successfully',
    schema: {
      properties: {
        id: { type: 'string', format: 'uuid' },
        slug: { type: 'string' },
        status: {
          type: 'string',
          enum: ['draft', 'processing', 'ready', 'error'],
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found or channel not found for user',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Upload has already been completed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 422,
    description: 'Multipart upload failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 502,
    description: 'Failed to enqueue video for processing',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @CurrentUser() currentUser: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<{ id: string; slug: string; status: string }> {
    const channel = await this.channelRepository.findOneBy({
      user_id: currentUser.sub,
    });

    if (!channel) {
      throw new NotFoundException('Channel not found for user');
    }

    const video = await this.videosService.completeUpload(channel.id, id, dto);

    return {
      id: video.id,
      slug: video.slug,
      status: video.status,
    };
  }

  @Get(':slug')
  @Public()
  @ApiOperation({
    summary: 'Get video detail by slug',
    description: "Retrieve a video's current status and metadata by slug.",
  })
  @ApiResponse({
    status: 200,
    description: 'Video details retrieved successfully',
    schema: { $ref: getSchemaPath(VideoDetailDto) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getVideoBySlug(@Param('slug') slug: string): Promise<VideoDetailDto> {
    const video = await this.videosService.findBySlugOrFail(slug);
    return VideoDetailDto.fromEntity(video, this.storageService);
  }

  @Get(':slug/stream')
  @Public()
  @ApiOperation({
    summary: 'Stream video file with range support',
    description:
      'Proxies the video file from storage with HTTP 206 Partial Content support for range requests.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video stream (full content)',
    schema: {
      type: 'string',
      format: 'binary',
    },
  })
  @ApiResponse({
    status: 206,
    description: 'Video stream (partial content)',
    schema: {
      type: 'string',
      format: 'binary',
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready for streaming',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async stream(
    @Param('slug') slug: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const video = await this.videosService.findBySlugOrFail(slug);
    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }
    const { body, contentLength, contentRange, statusCode } =
      await this.storageService.getObjectRange(video.storage_key, range);
    res.status(statusCode);
    res.set({
      'Accept-Ranges': 'bytes',
      'Content-Type': video.mime_type,
      'Content-Length': String(contentLength),
      ...(contentRange && { 'Content-Range': contentRange }),
    });
    body.on('error', () => {
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.destroy();
      }
    });
    body.pipe(res);
  }

  @Get(':slug/download')
  @Public()
  @ApiOperation({
    summary: 'Download video file',
    description:
      'Redirects to a short-lived presigned URL for downloading the video with the original filename.',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirect to presigned download URL',
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready for download',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async download(
    @Param('slug') slug: string,
    @Res() res: Response,
  ): Promise<void> {
    const video = await this.videosService.findBySlugOrFail(slug);
    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }
    const url = await this.storageService.getPresignedGetUrl(
      video.storage_key,
      `attachment; filename="${video.original_filename}"`,
    );
    res.redirect(302, url);
  }
}
