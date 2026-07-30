import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Queue, QueueEvents } from 'bullmq';
import { DataSource } from 'typeorm';
import type { Repository } from 'typeorm';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';
import appConfig from '../config/app.config';
import databaseConfig from '../config/database.config';
import storageConfig from '../config/storage.config';
import queueConfig from '../config/queue.config';
import { envValidationSchema } from '../config/env.validation';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import { cleanAllTables } from '../test/create-test-data-source';
import { cleanVideoProcessingQueue } from '../test/clean-video-processing-queue';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { VideoQueueService } from '../queue/video-queue.service';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
  type ProcessVideoJobData,
} from '../queue/video-queue.constants';
import { VideoProcessingProcessor } from './video-processing.processor';

describe('Video processing queue (integration)', () => {
  let app: TestingModule;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let storageService: StorageService;
  let videoQueueService: VideoQueueService;
  let queue: Queue<ProcessVideoJobData>;
  let queueEvents: QueueEvents;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = '/tmp/video-processing-queue-test';
    await fs.mkdir(tmpDir, { recursive: true });

    app = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [appConfig, databaseConfig, storageConfig, queueConfig],
          validationSchema: envValidationSchema,
          validationOptions: { allowUnknown: true, abortEarly: false },
        }),
        TypeOrmModule.forRootAsync({
          imports: [ConfigModule],
          inject: [databaseConfig.KEY],
          useFactory: (dbConfig: ConfigType<typeof databaseConfig>) => ({
            type: 'postgres',
            host: dbConfig.host,
            port: dbConfig.port,
            username: dbConfig.username,
            password: dbConfig.password,
            database: dbConfig.name,
            autoLoadEntities: true,
            synchronize: false,
          }),
        }),
        TypeOrmModule.forFeature([User, Channel, Video]),
        BullModule.forRootAsync({
          imports: [ConfigModule.forFeature(queueConfig)],
          inject: [queueConfig.KEY],
          useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
            connection: {
              host: cfg.redisHost,
              port: cfg.redisPort,
            },
          }),
        }),
        BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
        StorageModule,
      ],
      providers: [VideoQueueService, VideoProcessingProcessor],
    }).compile();

    await app.init();

    dataSource = app.get(DataSource);
    videoRepository = app.get(getRepositoryToken(Video));
    userRepository = app.get(getRepositoryToken(User));
    channelRepository = app.get(getRepositoryToken(Channel));
    storageService = app.get(StorageService);
    videoQueueService = app.get(VideoQueueService);
    queue = app.get<Queue<ProcessVideoJobData>>(
      getQueueToken(VIDEO_PROCESSING_QUEUE),
    );
    const cfg = queueConfig();
    queueEvents = new QueueEvents(VIDEO_PROCESSING_QUEUE, {
      connection: { host: cfg.redisHost, port: cfg.redisPort },
    });
    await queueEvents.waitUntilReady();
  }, 30000);

  afterAll(async () => {
    // Must precede queue.close(): leftover jobs here become permanent orphans
    // once cleanAllTables has removed the rows they point at.
    await cleanVideoProcessingQueue(queue);
    await queueEvents.close();
    await queue.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
    await app.close();
  }, 30000);

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    // drain(true) alone leaves terminal-state jobs behind; the helper also
    // clears completed/failed, so a previous test's orphans cannot be counted
    // by this one.
    await cleanVideoProcessingQueue(queue);
  });

  it('consumes an enqueued process-video job and marks the video ready', async () => {
    const user = await userRepository.save(
      userRepository.create({
        email: `queue-flow-${randomUUID()}@example.com`,
        password: 'hashedpassword',
        is_confirmed: true,
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        user_id: user.id,
        name: 'Queue Flow Channel',
        nickname: `queue-${randomUUID().slice(0, 8)}`,
      }),
    );

    const testVideoPath = join(tmpDir, `queue-${randomUUID()}.mp4`);
    execSync(
      `${ffmpegPath} -f lavfi -i testsrc=s=320x240:d=1 -y "${testVideoPath}" -loglevel quiet`,
    );
    const videoBuffer = await fs.readFile(testVideoPath);

    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        title: 'Queue Consumed Video',
        slug: `q${randomUUID().replace(/-/g, '').slice(0, 10)}`,
        status: VideoStatus.PROCESSING,
        storage_key: `videos/${channel.id}/${randomUUID()}/original.mp4`,
        original_filename: 'queue.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: videoBuffer.length.toString(),
      }),
    );
    await storageService.putObject(video.storage_key, videoBuffer, 'video/mp4');

    await videoQueueService.enqueueProcessing(video.id);
    const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
    const job = jobs.find(
      (candidate) =>
        candidate.name === PROCESS_VIDEO_JOB &&
        candidate.data.videoId === video.id,
    );
    expect(job).toBeDefined();

    await job!.waitUntilFinished(queueEvents, 60000);

    const updatedVideo = await videoRepository.findOneByOrFail({
      id: video.id,
    });
    expect(updatedVideo.status).toBe(VideoStatus.READY);
    expect(updatedVideo.duration_seconds).toBeGreaterThan(0);
    expect(updatedVideo.thumbnail_key).toBe(
      `videos/${channel.id}/${video.id}/thumbnail.jpg`,
    );
    expect(updatedVideo.metadata).toMatchObject({
      width: 320,
      height: 240,
    });
  }, 90000);
});
