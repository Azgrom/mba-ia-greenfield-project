import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { join } from 'path';
import type { Job } from 'bullmq';
import appConfig from '../config/app.config';
import databaseConfig from '../config/database.config';
import storageConfig from '../config/storage.config';
import queueConfig from '../config/queue.config';
import { envValidationSchema } from '../config/env.validation';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import {
  VideoProcessingProcessor,
  resolveVideoWorkerConcurrency,
} from './video-processing.processor';
import type { ProcessVideoJobData } from '../queue/video-queue.constants';
import ffmpegPath from 'ffmpeg-static';

describe('VideoProcessingProcessor (integration)', () => {
  let app: TestingModule;
  let processor: VideoProcessingProcessor;
  let videoRepository: Repository<Video>;
  let channelRepository: Repository<Channel>;
  let userRepository: Repository<User>;
  let storageService: StorageService;
  let testChannelId: string;
  let tmpDir: string;
  let testCounter = 0;

  beforeAll(async () => {
    tmpDir = '/tmp/video-processor-test';
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
        TypeOrmModule.forFeature([Video, Channel, User]),
        StorageModule,
      ],
      providers: [VideoProcessingProcessor],
    }).compile();

    processor = app.get(VideoProcessingProcessor);
    videoRepository = app.get(getRepositoryToken(Video));
    channelRepository = app.get(getRepositoryToken(Channel));
    userRepository = app.get(getRepositoryToken(User));
    storageService = app.get(StorageService);

    // Create a test user
    const user = userRepository.create({
      id: randomUUID(),
      email: `test-user-${Date.now()}@example.com`,
      password: 'hashedpassword',
      is_confirmed: true,
    });
    await userRepository.save(user);

    // Create a test channel
    const channel = channelRepository.create({
      id: randomUUID(),
      user_id: user.id,
      name: 'Test Channel',
      nickname: `test-ch-${randomUUID().substring(0, 8)}`,
      description: 'Test channel for video processing',
    });
    await channelRepository.save(channel);
    testChannelId = channel.id;
  }, 30000);

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    if (app) {
      await app.close();
    }
  }, 30000);

  describe('resolveVideoWorkerConcurrency', () => {
    it('uses a positive integer environment value', () => {
      expect(resolveVideoWorkerConcurrency('4')).toBe(4);
    });

    it('falls back to 2 for missing or invalid values', () => {
      expect(resolveVideoWorkerConcurrency(undefined)).toBe(2);
      expect(resolveVideoWorkerConcurrency('0')).toBe(2);
      expect(resolveVideoWorkerConcurrency('-1')).toBe(2);
      expect(resolveVideoWorkerConcurrency('not-a-number')).toBe(2);
    });
  });

  describe('process', () => {
    it('should extract metadata, generate thumbnail, and update video to ready', async () => {
      // Arrange: Generate a small synthetic test video using ffmpeg directly
      const testVideoPath = join(tmpDir, `test-fixture-${randomUUID()}.mp4`);
      const cmd = `${ffmpegPath} -f lavfi -i testsrc=s=320x240:d=1 -y "${testVideoPath}" -loglevel quiet`;
      execSync(cmd);

      const videoBuffer = await fs.readFile(testVideoPath);
      const videoId = randomUUID();

      // Create a video record in the database with processing status
      const video = videoRepository.create({
        id: videoId,
        channel_id: testChannelId,
        title: 'Test Video',
        slug: `ts-${testCounter++}-${Date.now().toString().slice(-4)}`,
        status: VideoStatus.PROCESSING,
        storage_key: `videos/${testChannelId}/${videoId}/original.mp4`,
        original_filename: 'test.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: videoBuffer.length.toString(),
      });
      await videoRepository.save(video);

      // Upload the test video to MinIO
      await storageService.putObject(
        video.storage_key,
        videoBuffer,
        'video/mp4',
      );

      // Act: Process the video
      const job: Partial<Job<ProcessVideoJobData>> = {
        data: { videoId: video.id },
        attemptsMade: 1,
        opts: { attempts: 3 },
      };

      await processor.process(job as Job<ProcessVideoJobData>);

      // Assert: Verify the video was updated
      const updatedVideo = await videoRepository.findOneByOrFail({
        id: video.id,
      });

      expect(updatedVideo.status).toBe(VideoStatus.READY);
      expect(updatedVideo.duration_seconds).toBeGreaterThan(0);
      expect(updatedVideo.thumbnail_key).toBe(
        `videos/${testChannelId}/${videoId}/thumbnail.jpg`,
      );
      expect(updatedVideo.metadata).toBeDefined();
      expect(updatedVideo.metadata?.width).toBeGreaterThan(0);
      expect(updatedVideo.metadata?.height).toBeGreaterThan(0);
      expect(updatedVideo.metadata?.codec).toBeDefined();

      // Verify thumbnail exists in storage
      const thumbnailObject = await storageService.getObjectRange(
        updatedVideo.thumbnail_key!,
      );
      expect(thumbnailObject.statusCode).toBe(200);
      expect(thumbnailObject.contentLength).toBeGreaterThan(0);
    }, 60000);

    it('should handle corrupt video files by throwing an error and setting status to error after retries', async () => {
      // Arrange: Create a video with a corrupt file (non-video bytes)
      const videoId = randomUUID();
      const video = videoRepository.create({
        id: videoId,
        channel_id: testChannelId,
        title: 'Corrupt Video',
        slug: `cr-${testCounter++}-${Date.now().toString().slice(-4)}`,
        status: VideoStatus.PROCESSING,
        storage_key: `videos/${testChannelId}/${videoId}/original.txt`,
        original_filename: 'corrupt.txt',
        mime_type: 'text/plain',
        file_size_bytes: '100',
      });
      await videoRepository.save(video);

      // Upload corrupt data
      const corruptBuffer = Buffer.from('This is not a valid video file');
      await storageService.putObject(
        video.storage_key,
        corruptBuffer,
        'text/plain',
      );

      // Act & Assert: Processing should fail
      const job: Partial<Job<ProcessVideoJobData>> = {
        data: { videoId: video.id },
        attemptsMade: 3,
        opts: { attempts: 3 },
        failedReason: 'ffprobe error: invalid format',
      };

      await expect(
        processor.process(job as Job<ProcessVideoJobData>),
      ).rejects.toThrow();

      // Call onFailed manually since we're not using the full queue
      await processor.onFailed(job as Job<ProcessVideoJobData>);

      // Verify the video was marked as error
      const errorVideo = await videoRepository.findOneByOrFail({
        id: video.id,
      });
      expect(errorVideo.status).toBe(VideoStatus.ERROR);
      expect(errorVideo.error_message).toBeDefined();
    }, 30000);

    it('should not set video to error on transient failure if retries remain', async () => {
      // Arrange: Create a video
      const videoId = randomUUID();
      const video = videoRepository.create({
        id: videoId,
        channel_id: testChannelId,
        title: 'Retry Video',
        slug: `rt-${testCounter++}-${Date.now().toString().slice(-4)}`,
        status: VideoStatus.PROCESSING,
        storage_key: `videos/${testChannelId}/${videoId}/original.mp4`,
        original_filename: 'retry.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: '0',
      });
      await videoRepository.save(video);

      const job: Partial<Job<ProcessVideoJobData>> = {
        data: { videoId: video.id },
        attemptsMade: 1,
        opts: { attempts: 3 },
        failedReason: 'Transient error',
      };

      // Act: Call onFailed with retries remaining
      await processor.onFailed(job as Job<ProcessVideoJobData>);

      // Assert: Video should NOT be marked as error (retries still available)
      const stillProcessingVideo = await videoRepository.findOneByOrFail({
        id: video.id,
      });
      expect(stillProcessingVideo.status).toBe(VideoStatus.PROCESSING);
    }, 10000);
  });
});
