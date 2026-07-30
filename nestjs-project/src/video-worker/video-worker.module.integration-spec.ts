import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { VideoWorkerModule } from './video-worker.module';
import { VideoProcessingProcessor } from './video-processing.processor';
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

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [VideoWorkerModule],
    }).compile();

    await app.init();
  }, 90_000);

  afterAll(async () => {
    if (!app) return;

    // Booting the real module starts a real BullMQ Worker and Queue, each with
    // its own Redis connection. app.close() alone leaves them open and Jest
    // reports "did not exit", so close them explicitly first.
    await app.get(VideoProcessingProcessor).worker?.close();
    await app.get<Queue>(getQueueToken(VIDEO_PROCESSING_QUEUE)).close();
    await app.close();
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
});
