import { Test, TestingModule } from '@nestjs/testing';
import { VideoProcessingProcessor } from './video-processing.processor';
import {
  WORKER_HEALTH_DEFAULT_PORT,
  WORKER_HEALTH_TIMEOUT_MS,
  WorkerHealthService,
  resolveVideoWorkerHealthPort,
} from './worker-health.service';

/**
 * Unit coverage for the liveness probe's branch logic. The processor (and the
 * BullMQ worker it owns) is mocked here; the real end-to-end signal — a booted
 * VideoWorkerModule answering 200 on the port Compose probes — is asserted in
 * video-worker.module.integration-spec.ts.
 *
 * The point of these branches is that "the process is up" must NOT be enough to
 * report healthy. Each `false` case below is a state in which the container
 * still exists but no enqueued job would ever be picked up.
 */
describe('resolveVideoWorkerHealthPort (unit)', () => {
  it('falls back to the default port when unset', () => {
    expect(resolveVideoWorkerHealthPort(undefined)).toBe(
      WORKER_HEALTH_DEFAULT_PORT,
    );
  });

  it('honors an explicit port', () => {
    expect(resolveVideoWorkerHealthPort('4321')).toBe(4321);
  });

  it.each(['', 'not-a-port', '0', '-1'])(
    'falls back to the default for the unusable value %p',
    (value) => {
      expect(resolveVideoWorkerHealthPort(value)).toBe(
        WORKER_HEALTH_DEFAULT_PORT,
      );
    },
  );
});

describe('WorkerHealthService (unit)', () => {
  let service: WorkerHealthService;
  let processor: { worker: unknown };

  const buildWorker = (
    isRunning: boolean,
    client: Promise<{ status: string }>,
  ) => ({ isRunning: () => isRunning, client });

  beforeEach(async () => {
    processor = { worker: undefined };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkerHealthService,
        { provide: VideoProcessingProcessor, useValue: processor },
      ],
    }).compile();

    service = module.get(WorkerHealthService);
  });

  describe('isConsuming', () => {
    it('is false before the BullMQ worker has been attached', async () => {
      processor.worker = undefined;

      await expect(service.isConsuming()).resolves.toBe(false);
    });

    it('is false when the worker exists but is not running', async () => {
      processor.worker = buildWorker(
        false,
        Promise.resolve({ status: 'ready' }),
      );

      await expect(service.isConsuming()).resolves.toBe(false);
    });

    it('is false when the worker runs but its Redis link is not ready', async () => {
      processor.worker = buildWorker(
        true,
        Promise.resolve({ status: 'reconnecting' }),
      );

      await expect(service.isConsuming()).resolves.toBe(false);
    });

    it('is false when the worker exists but resolving its client rejects', async () => {
      processor.worker = buildWorker(
        true,
        Promise.reject(new Error('ECONNREFUSED')),
      );

      await expect(service.isConsuming()).resolves.toBe(false);
    });

    it('is true only when the worker runs with a ready Redis link', async () => {
      processor.worker = buildWorker(
        true,
        Promise.resolve({ status: 'ready' }),
      );

      await expect(service.isConsuming()).resolves.toBe(true);
    });

    it('reports false rather than hanging when the client never resolves', async () => {
      jest.useFakeTimers();
      try {
        processor.worker = buildWorker(true, new Promise<never>(() => {}));

        const pending = service.isConsuming();
        await jest.advanceTimersByTimeAsync(WORKER_HEALTH_TIMEOUT_MS);

        await expect(pending).resolves.toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('http surface', () => {
    // A free high port: the worker container's real one is in use by the
    // container itself, and suites run --runInBand so this cannot collide.
    const port = '38101';
    let previous: string | undefined;

    beforeEach(() => {
      previous = process.env.VIDEO_WORKER_HEALTH_PORT;
      process.env.VIDEO_WORKER_HEALTH_PORT = port;
    });

    afterEach(async () => {
      await service.onApplicationShutdown();
      if (previous === undefined) {
        delete process.env.VIDEO_WORKER_HEALTH_PORT;
      } else {
        process.env.VIDEO_WORKER_HEALTH_PORT = previous;
      }
    });

    const probe = async (): Promise<number> => {
      service.onApplicationBootstrap();
      // Give the listener a tick to bind before probing it.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const response = await fetch(`http://127.0.0.1:${port}/`);
      return response.status;
    };

    it('answers 200 when the consumer is live', async () => {
      processor.worker = buildWorker(
        true,
        Promise.resolve({ status: 'ready' }),
      );

      await expect(probe()).resolves.toBe(200);
    });

    it('answers 503 when the consumer is dead', async () => {
      processor.worker = undefined;

      await expect(probe()).resolves.toBe(503);
    });

    it('stops listening after shutdown, so a dead process cannot report healthy', async () => {
      processor.worker = buildWorker(
        true,
        Promise.resolve({ status: 'ready' }),
      );
      await probe();

      await service.onApplicationShutdown();

      await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    });
  });
});
