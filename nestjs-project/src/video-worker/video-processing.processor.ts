import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Repository } from 'typeorm';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import { path as ffprobePath } from '@ffprobe-installer/ffprobe';
import { createWriteStream, promises as fs } from 'fs';
import { extname, join } from 'path';
import { pipeline } from 'stream/promises';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import { StorageService } from '../storage/storage.service';
import { VIDEO_PROCESSING_QUEUE } from '../queue/video-queue.constants';
import type { ProcessVideoJobData } from '../queue/video-queue.constants';

if (ffmpegPath) {
  ffmpeg.setFfmpegPath(ffmpegPath);
}
if (ffprobePath) {
  ffmpeg.setFfprobePath(ffprobePath);
}

interface FfprobeData {
  format: {
    duration?: number;
    bit_rate?: number;
  };
  streams: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
    codec_name?: string;
  }>;
}

@Injectable()
@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessingProcessor extends WorkerHost {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<ProcessVideoJobData>): Promise<void> {
    const video = await this.videoRepository.findOneByOrFail({
      id: job.data.videoId,
    });
    const tmpDir = '/tmp/video-processing';
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpVideoPath = join(
      tmpDir,
      `${video.id}${extname(video.storage_key)}`,
    );
    const thumbnailFilename = `${video.id}-thumbnail.jpg`;

    try {
      const { body } = await this.storageService.getObjectRange(
        video.storage_key,
      );
      await pipeline(body, createWriteStream(tmpVideoPath));

      const metadata = await new Promise<FfprobeData>((resolve, reject) => {
        ffmpeg.ffprobe(tmpVideoPath, (err: Error | null, data: FfprobeData) => {
          if (err) {
            reject(err);
          } else {
            resolve(data);
          }
        });
      });

      await new Promise<void>((resolve, reject) => {
        ffmpeg(tmpVideoPath)
          .on('end', () => resolve())
          .on('error', (err: Error) => reject(err))
          .screenshots({
            timestamps: ['25%'],
            filename: thumbnailFilename,
            folder: tmpDir,
          });
      });

      const thumbnailBuffer = await fs.readFile(
        join(tmpDir, thumbnailFilename),
      );
      const thumbnailKey = `videos/${video.channel_id}/${video.id}/thumbnail.jpg`;
      await this.storageService.putObject(
        thumbnailKey,
        thumbnailBuffer,
        'image/jpeg',
      );

      video.status = VideoStatus.READY;
      video.duration_seconds = metadata.format.duration ?? null;
      video.thumbnail_key = thumbnailKey;
      const videoStream = metadata.streams.find(
        (s) => s.codec_type === 'video',
      );
      video.metadata = {
        width: videoStream?.width,
        height: videoStream?.height,
        codec: videoStream?.codec_name,
        bitRate: metadata.format.bit_rate,
      };
      await this.videoRepository.save(video);
    } finally {
      await fs.rm(tmpVideoPath, { force: true });
      await fs.rm(join(tmpDir, thumbnailFilename), { force: true });
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ProcessVideoJobData>): Promise<void> {
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= attempts) {
      await this.videoRepository.update(job.data.videoId, {
        status: VideoStatus.ERROR,
        error_message: job.failedReason ?? 'Video processing failed',
      });
    }
  }
}
