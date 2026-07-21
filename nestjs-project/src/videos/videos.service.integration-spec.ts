import { DataSource, Repository } from 'typeorm';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosService } from './videos.service';
import { StorageService } from '../storage/storage.service';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import type { PresignedPart } from '../storage/storage.service';

const ALL_ENTITIES = [User, Channel, Video];

describe('VideosService (integration)', () => {
  let dataSource: DataSource;
  let videosService: VideosService;
  let mockStorageService: jest.Mocked<StorageService>;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();

    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);

    // Create a mock storage service
    mockStorageService = {
      createMultipartUpload: jest.fn(),
      getPresignedUploadPartUrls: jest.fn(),
      abortMultipartUpload: jest.fn(),
    } as any;

    // Create the service with the real repository and mocked storage service
    videosService = new VideosService(videoRepository, mockStorageService, {
      uploadPartSizeBytes: 104857600, // 100 MiB
      maxFileSizeBytes: 10737418240,
    } as any);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    jest.clearAllMocks();
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

      const mockParts: PresignedPart[] = [
        { partNumber: 1, url: 'https://s3.example.com/part1' },
      ];

      mockStorageService.createMultipartUpload.mockResolvedValue(
        'upload-id-123',
      );
      mockStorageService.getPresignedUploadPartUrls.mockResolvedValue(
        mockParts,
      );

      const result = await videosService.initiateUpload(channel.id, dto);

      expect(result.id).toBeDefined();
      expect(result.slug).toBeDefined();
      expect(result.uploadId).toBe('upload-id-123');
      expect(result.parts).toEqual(mockParts);

      const persisted = await videoRepository.findOneBy({ id: result.id });
      expect(persisted).not.toBeNull();
      expect(persisted!.channel_id).toBe(channel.id);
      expect(persisted!.title).toBe(dto.title);
      expect(persisted!.status).toBe(VideoStatus.DRAFT);
      expect(persisted!.storage_key).toBe(
        `videos/${channel.id}/${persisted!.id}/original.mp4`,
      );
      expect(persisted!.upload_id).toBe('upload-id-123');
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

      const mockParts: PresignedPart[] = [
        { partNumber: 1, url: 'https://s3.example.com/part1' },
        { partNumber: 2, url: 'https://s3.example.com/part2' },
        { partNumber: 3, url: 'https://s3.example.com/part3' },
      ];

      mockStorageService.createMultipartUpload.mockResolvedValue(
        'upload-id-123',
      );
      mockStorageService.getPresignedUploadPartUrls.mockResolvedValue(
        mockParts,
      );

      const result = await videosService.initiateUpload(channel.id, dto);

      // 314572800 / 104857600 = 3, so partCount should be 3
      expect(result.parts.length).toBe(3);
      expect(
        mockStorageService.getPresignedUploadPartUrls,
      ).toHaveBeenCalledWith(expect.any(String), 'upload-id-123', 3);
    });

    it('generates unique slugs on multiple calls (no collision in normal case)', async () => {
      const { channel } = await createUserWithChannel();

      const dto: InitiateUploadDto = {
        title: 'Video 1',
        originalFilename: 'video1.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 104857600,
      };

      const mockParts: PresignedPart[] = [
        { partNumber: 1, url: 'https://s3.example.com/part1' },
      ];

      mockStorageService.createMultipartUpload.mockResolvedValue('upload-id-1');
      mockStorageService.getPresignedUploadPartUrls.mockResolvedValue(
        mockParts,
      );

      const result1 = await videosService.initiateUpload(channel.id, dto);

      mockStorageService.createMultipartUpload.mockResolvedValueOnce(
        'upload-id-2',
      );

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

      mockStorageService.createMultipartUpload.mockResolvedValue(
        'upload-id-123',
      );
      mockStorageService.getPresignedUploadPartUrls.mockRejectedValue(
        new Error('Presign failed'),
      );
      mockStorageService.abortMultipartUpload.mockResolvedValue(undefined);

      await expect(
        videosService.initiateUpload(channel.id, dto),
      ).rejects.toThrow('Presign failed');

      // Verify abort was called
      expect(mockStorageService.abortMultipartUpload).toHaveBeenCalledWith(
        expect.stringContaining('videos/'),
        'upload-id-123',
      );

      // Verify no draft video was left behind
      const videos = await videoRepository.find({
        where: { channel_id: channel.id },
      });
      expect(videos.length).toBe(0);
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
