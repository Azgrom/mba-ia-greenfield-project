import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { extname } from 'path';
import storageConfig from '../config/storage.config';
import { Video, VideoStatus } from './entities/video.entity';
import { StorageService } from '../storage/storage.service';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import type {
  InitiateUploadResponseDto,
  PresignedPartDto,
} from './dto/initiate-upload-response.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { generateSlug } from './slug.util';
import { VideoNotFoundException } from './exceptions/video-not-found.exception';
import { UploadAlreadyCompletedException } from './exceptions/upload-already-completed.exception';
import { MultipartUploadFailedException } from './exceptions/multipart-upload-failed.exception';
import { VideoQueueService } from '../queue/video-queue.service';

const PG_UNIQUE_VIOLATION = '23505';
const SLUG_COLUMN = 'slug';
const MAX_SLUG_RETRIES = 5;

function isPgUniqueViolationOnColumn(err: unknown, column: string): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const e = err as any;
  return (
    e.code === PG_UNIQUE_VIOLATION &&
    typeof e.detail === 'string' &&
    e.detail.includes(column)
  );
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    @Inject(storageConfig.KEY)
    private readonly storage: ConfigType<typeof storageConfig>,
    private readonly videoQueueService: VideoQueueService,
  ) {}

  async initiateUpload(
    channelId: string,
    dto: InitiateUploadDto,
  ): Promise<InitiateUploadResponseDto> {
    const extension = extname(dto.originalFilename) || '';
    let video: Video | undefined;

    // Retry loop: NOT wrapped in a transaction to allow individual saves to succeed
    // after unique constraint violations. See architecture audit findings F-001/F-002.
    for (let attempt = 0; attempt < MAX_SLUG_RETRIES && !video; attempt += 1) {
      try {
        video = await this.videoRepository.save(
          this.videoRepository.create({
            channel_id: channelId,
            title: dto.title,
            slug: generateSlug(),
            status: VideoStatus.DRAFT,
            storage_key: '',
            original_filename: dto.originalFilename,
            mime_type: dto.mimeType,
            file_size_bytes: String(dto.fileSizeBytes),
          }),
        );
      } catch (err) {
        if (isPgUniqueViolationOnColumn(err, SLUG_COLUMN)) {
          // Slug collision; retry with a new slug
          continue;
        }
        throw err;
      }
    }

    if (!video) {
      throw new Error(
        'Failed to allocate a unique video slug after 5 attempts',
      );
    }

    const key = `videos/${channelId}/${video.id}/original${extension}`;
    let uploadId: string | undefined;

    try {
      uploadId = await this.storageService.createMultipartUpload(
        key,
        dto.mimeType,
      );

      const partSize = this.storage.uploadPartSizeBytes;
      const partCount = Math.max(1, Math.ceil(dto.fileSizeBytes / partSize));

      const parts = await this.storageService.getPresignedUploadPartUrls(
        key,
        uploadId,
        partCount,
      );

      video.storage_key = key;
      video.upload_id = uploadId;
      await this.videoRepository.save(video);

      return {
        id: video.id,
        slug: video.slug,
        uploadId,
        parts: parts as PresignedPartDto[],
      };
    } catch (err) {
      // Compensating action: clean up S3 and the draft row if anything failed
      if (uploadId) {
        await this.storageService.abortMultipartUpload(key, uploadId);
      }
      await this.videoRepository.delete(video.id);
      throw err;
    }
  }

  async completeUpload(
    channelId: string,
    videoId: string,
    dto: CompleteUploadDto,
  ): Promise<Video> {
    const video = await this.videoRepository.findOneBy({
      id: videoId,
      channel_id: channelId,
    });
    if (!video) throw new VideoNotFoundException();
    if (video.status !== VideoStatus.DRAFT) {
      throw new UploadAlreadyCompletedException();
    }
    try {
      await this.storageService.completeMultipartUpload(
        video.storage_key,
        video.upload_id as string,
        dto.parts,
      );
    } catch {
      throw new MultipartUploadFailedException();
    }
    video.status = VideoStatus.PROCESSING;
    video.upload_id = null;
    await this.videoRepository.save(video);
    await this.videoQueueService.enqueueProcessing(video.id);
    return video;
  }

  async findBySlugOrFail(slug: string): Promise<Video> {
    const video = await this.videoRepository.findOneBy({ slug });
    if (!video) {
      throw new VideoNotFoundException();
    }
    return video;
  }
}
