import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { ConfigType } from '@nestjs/config';
import queueConfig from '../config/queue.config';
import {
  VIDEO_PROCESSING_QUEUE,
  PROCESS_VIDEO_JOB,
  FAILED_JOB_RETENTION,
  type ProcessVideoJobData,
} from './video-queue.constants';

@Injectable()
export class VideoQueueService {
  constructor(
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly queue: Queue<ProcessVideoJobData>,
    @Inject(queueConfig.KEY)
    private readonly queueConfiguration: ConfigType<typeof queueConfig>,
  ) {}

  async enqueueProcessing(videoId: string): Promise<void> {
    const maxAttempts = 3;
    const retryDelayMs = 500;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.queue.add(
          PROCESS_VIDEO_JOB,
          { videoId },
          {
            attempts: this.queueConfiguration.videoProcessingAttempts,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
            removeOnFail: FAILED_JOB_RETENTION,
          },
        );
        return;
      } catch (err) {
        if (attempt === maxAttempts) throw err;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
}
