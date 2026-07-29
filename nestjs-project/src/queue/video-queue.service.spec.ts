import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import { VideoQueueService } from './video-queue.service';
import {
  VIDEO_PROCESSING_QUEUE,
  PROCESS_VIDEO_JOB,
  type ProcessVideoJobData,
} from './video-queue.constants';

type QueueAdd = Queue<ProcessVideoJobData>['add'];

/**
 * The service only ever calls `add`, so the stub implements just that method.
 * `addMock` is held separately from the queue object: asserting on a standalone
 * function reference keeps the expectations free of unbound-method access.
 */
function buildJob(id: string): Job<ProcessVideoJobData> {
  return { id } as Job<ProcessVideoJobData>;
}

describe('VideoQueueService', () => {
  let service: VideoQueueService;
  let addMock: jest.MockedFunction<QueueAdd>;

  beforeEach(async () => {
    addMock = jest.fn<ReturnType<QueueAdd>, Parameters<QueueAdd>>();
    const mockQueue = {
      add: addMock,
    } as unknown as Queue<ProcessVideoJobData>;

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
      addMock.mockResolvedValue(buildJob('job-1'));

      await service.enqueueProcessing('video-123');

      expect(addMock).toHaveBeenCalledTimes(1);
      expect(addMock).toHaveBeenCalledWith(
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
      addMock
        .mockRejectedValueOnce(transientError)
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce(buildJob('job-1'));

      await service.enqueueProcessing('video-123');

      expect(addMock).toHaveBeenCalledTimes(3);
    });

    it('throws when all 3 attempts fail', async () => {
      const persistentError = new Error('Redis unreachable');
      addMock.mockRejectedValue(persistentError);

      await expect(service.enqueueProcessing('video-123')).rejects.toThrow(
        'Redis unreachable',
      );

      expect(addMock).toHaveBeenCalledTimes(3);
    });

    it('passes correct job options to queue.add', async () => {
      addMock.mockResolvedValue(buildJob('job-1'));

      await service.enqueueProcessing('video-456');

      const callArgs = addMock.mock.calls[0];
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
