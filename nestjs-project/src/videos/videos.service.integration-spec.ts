import { DataSource, Repository } from 'typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import storageConfig from '../config/storage.config';
import queueConfig from '../config/queue.config';
import { StorageModule } from '../storage/storage.module';
import { QueueModule } from '../queue/queue.module';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { Video, VideoStatus } from './entities/video.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { VideosService } from './videos.service';
import { StorageService } from '../storage/storage.service';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { VideoQueueService } from '../queue/video-queue.service';

const ALL_ENTITIES = [User, Channel, Video, RefreshToken, VerificationToken];

describe('VideosService (integration)', () => {
  let dataSource: DataSource;
  let storageTestingModule: TestingModule;
  let storageService: StorageService;
  let videoQueueService: VideoQueueService;
  let videosService: VideosService;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();

    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);

    // Create a real StorageService and QueueService instance
    storageTestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, queueConfig],
        }),
        StorageModule,
        QueueModule,
      ],
    }).compile();
    storageService = storageTestingModule.get(StorageService);
    videoQueueService = storageTestingModule.get(VideoQueueService);

    // Create the service with the real repository and real services
    const config = storageConfig();
    videosService = new VideosService(
      videoRepository,
      storageService,
      config,
      videoQueueService,
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
    await storageTestingModule.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    jest.restoreAllMocks();
  });

  let userCounter = 0;
  async function createUser(): Promise<User> {
    return userRepository.save(
      userRepository.create({
        email: `video_svc_${++userCounter}@example.com`,
        password: 'hashed',
      }),
    );
  }

  async function createUserWithChannel(): Promise<{
    user: User;
    channel: Channel;
  }> {
    const user = await createUser();
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Test Channel',
        nickname: `channel_${user.id.slice(0, 8)}`,
        user_id: user.id,
      }),
    );
    return { user, channel };
  }

  describe('initiateUpload', () => {
    it('persists a draft video with correct fields', async () => {
      const { channel } = await createUserWithChannel();

      const dto: InitiateUploadDto = {
        title: 'My Test Video',
        originalFilename: 'video.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 104857600, // 100 MiB
      };

      const result = await videosService.initiateUpload(channel.id, dto);

      expect(result.id).toBeDefined();
      expect(result.slug).toBeDefined();
      expect(result.uploadId).toBeDefined();
      expect(typeof result.uploadId).toBe('string');
      expect(result.uploadId.length).toBeGreaterThan(0);
      expect(result.parts).toBeDefined();
      expect(result.parts.length).toBeGreaterThan(0);

      const persisted = await videoRepository.findOneBy({ id: result.id });
      expect(persisted).not.toBeNull();
      expect(persisted!.channel_id).toBe(channel.id);
      expect(persisted!.title).toBe(dto.title);
      expect(persisted!.status).toBe(VideoStatus.DRAFT);
      expect(persisted!.storage_key).toBe(
        `videos/${channel.id}/${persisted!.id}/original.mp4`,
      );
      expect(persisted!.upload_id).toBe(result.uploadId);
      expect(persisted!.original_filename).toBe(dto.originalFilename);
      expect(persisted!.mime_type).toBe(dto.mimeType);
      expect(persisted!.file_size_bytes).toBe(String(dto.fileSizeBytes));
    });

    it('returns parts array with correct length based on fileSizeBytes', async () => {
      const { channel } = await createUserWithChannel();

      const dto: InitiateUploadDto = {
        title: 'Large Video',
        originalFilename: 'video.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 314572800, // 300 MiB
      };

      const spy = jest.spyOn(storageService, 'getPresignedUploadPartUrls');

      const result = await videosService.initiateUpload(channel.id, dto);

      // 314572800 / 104857600 = 3, so partCount should be 3
      expect(result.parts.length).toBe(3);
      expect(spy).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        3,
      );
    });

    it('generates unique slugs on multiple calls (no collision in normal case)', async () => {
      const { channel } = await createUserWithChannel();

      const dto: InitiateUploadDto = {
        title: 'Video 1',
        originalFilename: 'video1.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 104857600,
      };

      const result1 = await videosService.initiateUpload(channel.id, dto);

      const result2 = await videosService.initiateUpload(channel.id, {
        ...dto,
        title: 'Video 2',
      });

      expect(result1.slug).not.toBe(result2.slug);

      const video1 = await videoRepository.findOneBy({ id: result1.id });
      const video2 = await videoRepository.findOneBy({ id: result2.id });
      expect(video1!.slug).not.toBe(video2!.slug);
    });

    it('on storage failure after createMultipartUpload, aborts upload and deletes draft row', async () => {
      const { channel } = await createUserWithChannel();

      const dto: InitiateUploadDto = {
        title: 'Video with Failure',
        originalFilename: 'video.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 104857600,
      };

      jest
        .spyOn(storageService, 'getPresignedUploadPartUrls')
        .mockRejectedValueOnce(new Error('Presign failed'));
      const abortSpy = jest.spyOn(storageService, 'abortMultipartUpload');

      await expect(
        videosService.initiateUpload(channel.id, dto),
      ).rejects.toThrow('Presign failed');

      // Verify abort was called with the correct arguments
      expect(abortSpy).toHaveBeenCalledWith(
        expect.stringContaining('videos/'),
        expect.any(String),
      );

      // Verify no draft video was left behind
      const videos = await videoRepository.find({
        where: { channel_id: channel.id },
      });
      expect(videos.length).toBe(0);
    });
  });

  describe('completeUpload', () => {
    it('completes upload and enqueues processing job', async () => {
      const { channel } = await createUserWithChannel();

      // Step 1: Initiate upload
      const initiateDto: InitiateUploadDto = {
        title: 'Test Video Upload',
        originalFilename: 'video.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 104857600, // 100 MiB
      };

      const initiateResult = await videosService.initiateUpload(
        channel.id,
        initiateDto,
      );

      expect(initiateResult.id).toBeDefined();
      expect(initiateResult.uploadId).toBeDefined();

      let video = await videoRepository.findOneBy({ id: initiateResult.id });
      expect(video!.status).toBe(VideoStatus.DRAFT);
      expect(video!.upload_id).toBe(initiateResult.uploadId);

      // Mock the completeMultipartUpload to avoid needing real S3 parts
      jest
        .spyOn(storageService, 'completeMultipartUpload')
        .mockResolvedValue(undefined);

      // Mock the enqueueProcessing to verify it's called
      const enqueueSpy = jest
        .spyOn(videoQueueService, 'enqueueProcessing')
        .mockResolvedValue(undefined);

      // Step 2: Complete upload
      const completeDto: CompleteUploadDto = {
        parts: [{ partNumber: 1, etag: 'etag-abc123' }],
      };

      const completeResult = await videosService.completeUpload(
        channel.id,
        initiateResult.id,
        completeDto,
      );

      expect(completeResult.id).toBe(initiateResult.id);
      expect(completeResult.status).toBe(VideoStatus.PROCESSING);
      expect(completeResult.upload_id).toBeNull();

      // Step 3: Verify video was updated in DB
      video = await videoRepository.findOneBy({ id: initiateResult.id });
      expect(video!.status).toBe(VideoStatus.PROCESSING);
      expect(video!.upload_id).toBeNull();

      // Step 4: Verify enqueueProcessing was called
      expect(enqueueSpy).toHaveBeenCalledWith(initiateResult.id);
      expect(enqueueSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('findBySlugOrFail', () => {
    it('finds and returns video by slug', async () => {
      const { channel } = await createUserWithChannel();

      const video = await videoRepository.save(
        videoRepository.create({
          channel_id: channel.id,
          title: 'Test Video',
          slug: 'testslug123', // 11 characters
          status: VideoStatus.DRAFT,
          storage_key: 'videos/channel/id/original.mp4',
          original_filename: 'video.mp4',
          mime_type: 'video/mp4',
          file_size_bytes: '104857600',
        }),
      );

      const found = await videosService.findBySlugOrFail('testslug123');

      expect(found.id).toBe(video.id);
      expect(found.slug).toBe('testslug123');
    });

    it('throws VideoNotFoundException when slug not found', async () => {
      const error = await videosService
        .findBySlugOrFail('nonexistent-slug')
        .catch((err) => err);
      expect(error.errorCode).toBe('VIDEO_NOT_FOUND');
    });
  });
});
