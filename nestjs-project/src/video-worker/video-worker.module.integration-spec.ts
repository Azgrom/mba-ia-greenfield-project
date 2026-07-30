import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { VideoWorkerModule } from './video-worker.module';
import { VideoProcessingProcessor } from './video-processing.processor';
import { WorkerHealthService } from './worker-health.service';
import { VIDEO_PROCESSING_QUEUE } from '../queue/video-queue.constants';
import { Video } from '../videos/entities/video.entity';
import { Channel } from '../channels/entities/channel.entity';

/**
 * Boots the REAL VideoWorkerModule — the same graph that
 * `npm run start:worker:dev` boots via
 * NestFactory.createApplicationContext(VideoWorkerModule).
 *
 * The sibling processor/queue integration specs each rebuild the module graph by
 * hand (their own ConfigModule + TypeOrmModule + forFeature list), so none of
 * them exercises VideoWorkerModule's own entity registration. That missing seam
 * let the worker ship in a state where it crashed on every single boot while all
 * 200 unit/integration tests stayed green.
 *
 * The boot timeout is generous on purpose: TypeOrmModule wraps a failed
 * metadata build in 10 connection retries (~30s) before it rejects, so a short
 * timeout would report "exceeded timeout" instead of the real cause.
 */
describe('VideoWorkerModule (integration)', () => {
  let app: TestingModule;

  // Pinned to a free high port rather than the .env value: this suite boots the
  // real module inside the api container, where the worker's own 3001 may be
  // taken, and a bind clash would fail the health assertion for the wrong reason.
  const healthPort = '38102';
  let previousHealthPort: string | undefined;

  beforeAll(async () => {
    previousHealthPort = process.env.VIDEO_WORKER_HEALTH_PORT;
    process.env.VIDEO_WORKER_HEALTH_PORT = healthPort;

    app = await Test.createTestingModule({
      imports: [VideoWorkerModule],
    }).compile();

    await app.init();
  }, 90_000);

  afterAll(async () => {
    if (!app) return;

    // app.close() runs BullModule's shutdown hooks, which close the real Worker
    // and Queue this module starts, but it does not drop the underlying ioredis
    // socket: bull.providers.js calls disconnect() only for queues registered
    // with `forceDisconnectOnShutdown`, which production does not set. So the
    // socket this spec opened is closed here rather than left to the GC.
    //
    // Jest still prints "did not exit" after this suite. That is cosmetic —
    // `--detectOpenHandles` attributes no handle, the exit code is 0, and the
    // run takes the same wall-clock time either way (the ~30s is container
    // startup, not a hang). Booting a real BullMQ worker in-process is the
    // cause; it is the price of testing the module's actual composition root.
    const queue = app.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE));
    await app.close();
    await queue.disconnect();

    if (previousHealthPort === undefined) {
      delete process.env.VIDEO_WORKER_HEALTH_PORT;
    } else {
      process.env.VIDEO_WORKER_HEALTH_PORT = previousHealthPort;
    }
  });

  it('initializes the database connection', () => {
    expect(app.get(DataSource).isInitialized).toBe(true);
  });

  it('resolves the Video.channel relation to the Channel entity', () => {
    const relation = app
      .get(DataSource)
      .getRepository(Video)
      .metadata.findRelationWithPropertyPath('channel');

    expect(relation).toBeDefined();
    expect(relation?.inverseEntityMetadata.target).toBe(Channel);
  });

  it('registers the queue consumer so enqueued jobs have a processor', () => {
    expect(app.get(VideoProcessingProcessor)).toBeInstanceOf(
      VideoProcessingProcessor,
    );
  });

  /**
   * The Compose healthcheck for video-worker probes exactly this endpoint. It is
   * the thing that would have surfaced WORKER-1 in minutes instead of a week, so
   * it is asserted against a really-booted module, with the real BullMQ worker
   * and real Redis — not against a mocked processor (that is the unit spec's job).
   */
  it('serves a healthy liveness signal on the port the Compose healthcheck probes', async () => {
    const response = await fetch(`http://127.0.0.1:${healthPort}/`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
  });

  it('reports the consumer as live through the health service itself', async () => {
    await expect(app.get(WorkerHealthService).isConsuming()).resolves.toBe(
      true,
    );
  });
});
