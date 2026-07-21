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
import { generateSlug } from './slug.util';
import { VideoNotFoundException } from './exceptions/video-not-found.exception';

const PG_UNIQUE_VIOLATION = '23505';
const MAX_SLUG_RETRIES = 5;

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
    @Inject(storageConfig.KEY)
    private readonly storage: ConfigType<typeof storageConfig>,
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
        if (
          err instanceof QueryFailedError &&
          (err as unknown as { code?: string }).code === PG_UNIQUE_VIOLATION &&
          err.message.includes('slug')
        ) {
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

  async findBySlugOrFail(slug: string): Promise<Video> {
    const video = await this.videoRepository.findOneBy({ slug });
    if (!video) {
      throw new VideoNotFoundException();
    }
    return video;
  }
}
