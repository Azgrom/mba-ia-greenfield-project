import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import { VideoQueueService } from './video-queue.service';
import {
  VIDEO_PROCESSING_QUEUE,
  PROCESS_VIDEO_JOB,
  type ProcessVideoJobData,
} from './video-queue.constants';

describe('VideoQueueService', () => {
  let service: VideoQueueService;
  let mockQueue: jest.Mocked<Queue<ProcessVideoJobData>>;

  beforeEach(async () => {
    mockQueue = {
      add: jest.fn(),
    } as any;

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] })],
      providers: [
        VideoQueueService,
        {
          provide: getQueueToken(VIDEO_PROCESSING_QUEUE),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = moduleRef.get<VideoQueueService>(VideoQueueService);
  });

  describe('enqueueProcessing', () => {
    it('succeeds on first attempt and resolves immediately', async () => {
      mockQueue.add.mockResolvedValue({ id: 'job-1' } as any);

      await service.enqueueProcessing('video-123');

      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      expect(mockQueue.add).toHaveBeenCalledWith(
        PROCESS_VIDEO_JOB,
        { videoId: 'video-123' },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    });

    it('retries on transient failure and succeeds on 3rd attempt', async () => {
      const transientError = new Error('Redis connection timeout');
      mockQueue.add
        .mockRejectedValueOnce(transientError)
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce({ id: 'job-1' } as any);

      await service.enqueueProcessing('video-123');

      expect(mockQueue.add).toHaveBeenCalledTimes(3);
    });

    it('throws when all 3 attempts fail', async () => {
      const persistentError = new Error('Redis unreachable');
      mockQueue.add.mockRejectedValue(persistentError);

      await expect(service.enqueueProcessing('video-123')).rejects.toThrow(
        'Redis unreachable',
      );

      expect(mockQueue.add).toHaveBeenCalledTimes(3);
    });

    it('passes correct job options to queue.add', async () => {
      mockQueue.add.mockResolvedValue({ id: 'job-1' } as any);

      await service.enqueueProcessing('video-456');

      const callArgs = mockQueue.add.mock.calls[0];
      expect(callArgs[0]).toBe(PROCESS_VIDEO_JOB);
      expect(callArgs[1]).toEqual({ videoId: 'video-456' });
      expect(callArgs[2]).toEqual({
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      });
    });
  });
});
