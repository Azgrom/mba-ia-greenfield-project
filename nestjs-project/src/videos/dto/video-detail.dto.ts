import { ApiProperty } from '@nestjs/swagger';
import type { Video } from '../entities/video.entity';
import { VideoStatus } from '../entities/video.entity';
import { StorageService } from '../../storage/storage.service';

export class VideoDetailDto {
  @ApiProperty({
    type: 'string',
    format: 'uuid',
    description: 'Unique ID of the video',
  })
  id: string;

  @ApiProperty({
    type: 'string',
    description: 'Unique, collision-safe slug for the video',
  })
  slug: string;

  @ApiProperty({
    type: 'string',
    description: 'Title of the video',
  })
  title: string;

  @ApiProperty({
    type: 'string',
    enum: ['draft', 'processing', 'ready', 'error'],
    description: 'Current processing status of the video',
  })
  status: VideoStatus;

  @ApiProperty({
    type: 'number',
    nullable: true,
    description: 'Duration of the video in seconds, null if not yet available',
  })
  durationSeconds: number | null;

  @ApiProperty({
    type: 'string',
    nullable: true,
    description: 'Presigned URL for the thumbnail, null if not yet available',
  })
  thumbnailUrl: string | null;

  @ApiProperty({
    type: 'string',
    format: 'date-time',
    description: 'Timestamp when the video was created',
  })
  createdAt: Date;

  static async fromEntity(
    video: Video,
    storageService: StorageService,
  ): Promise<VideoDetailDto> {
    let thumbnailUrl: string | null = null;

    if (video.thumbnail_key) {
      thumbnailUrl = await storageService.getPresignedGetUrl(
        video.thumbnail_key,
      );
    }

    return {
      id: video.id,
      slug: video.slug,
      title: video.title,
      status: video.status,
      durationSeconds: video.duration_seconds,
      thumbnailUrl,
      createdAt: video.created_at,
    };
  }
}
