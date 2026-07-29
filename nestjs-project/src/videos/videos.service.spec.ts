import { QueryFailedError, Repository } from 'typeorm';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { ConfigType } from '@nestjs/config';
import { VideosService } from './videos.service';
import { Video, VideoStatus } from './entities/video.entity';
import type { Channel } from '../channels/entities/channel.entity';
import { StorageService } from '../storage/storage.service';
import storageConfig from '../config/storage.config';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import type { PresignedPart } from '../storage/storage.service';
import { VideoQueueService } from '../queue/video-queue.service';
import { VideoNotFoundException } from './exceptions/video-not-found.exception';
import { UploadAlreadyCompletedException } from './exceptions/upload-already-completed.exception';
import { MultipartUploadFailedException } from './exceptions/multipart-upload-failed.exception';
import { VideoProcessingEnqueueFailedException } from './exceptions/video-processing-enqueue-failed.exception';

/**
 * The `channel` relation is never loaded by the code paths under test, so the
 * mocks leave it unset. The cast keeps the fixture typed as a real `Video`
 * without widening the whole literal to `any`.
 */
const UNLOADED_CHANNEL = undefined as unknown as Channel;

function buildVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'video-123',
    channel_id: 'channel-123',
    title: 'My Video',
    slug: 'abc123def',
    status: VideoStatus.DRAFT,
    storage_key: '',
    thumbnail_key: null,
    upload_id: null,
    original_filename: 'video.mp4',
    mime_type: 'video/mp4',
    file_size_bytes: '104857600',
    duration_seconds: null,
    metadata: null,
    error_message: null,
    channel: UNLOADED_CHANNEL,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

/**
 * Builds the error PostgreSQL raises on a `slug` unique-constraint violation.
 * `QueryFailedError` copies the driver error's own properties (`code`,
 * `detail`) onto itself, which is exactly what `videos.service.ts` reads.
 */
function buildSlugCollisionError(): QueryFailedError {
  const driverError = Object.assign(
    new Error(
      'duplicate key value violates unique constraint "UQ_5dbcc1ee100f853490582eccc71"',
    ),
    {
      code: '23505',
      detail: 'Key (slug)=(abc123def) already exists.',
    },
  );
  return new QueryFailedError('INSERT INTO "videos" ...', [], driverError);
}

describe('VideosService', () => {
  let service: VideosService;
  let videoRepository: Repository<Video>;
  let storageService: StorageService;
  let videoQueueService: VideoQueueService;

  const mockStorageConfig: ConfigType<typeof storageConfig> = {
    endpoint: 'http://minio:9000',
    region: 'us-east-1',
    accessKeyId: 'streamtube',
    secretAccessKey: 'streamtube123',
    bucket: 'streamtube',
    presignedUrlExpirationSeconds: 3600,
    uploadPartSizeBytes: 104857600, // 100 MiB
    maxFileSizeBytes: 10737418240,
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        VideosService,
        {
          provide: getRepositoryToken(Video),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOneBy: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: StorageService,
          useValue: {
            createMultipartUpload: jest.fn(),
            getPresignedUploadPartUrls: jest.fn(),
            abortMultipartUpload: jest.fn(),
            completeMultipartUpload: jest.fn(),
          },
        },
        {
          provide: VideoQueueService,
          useValue: {
            enqueueProcessing: jest.fn(),
          },
        },
        {
          provide: storageConfig.KEY,
          useValue: mockStorageConfig,
        },
      ],
    }).compile();

    service = moduleRef.get<VideosService>(VideosService);
    videoRepository = moduleRef.get<Repository<Video>>(
      getRepositoryToken(Video),
    );
    storageService = moduleRef.get<StorageService>(StorageService);
    videoQueueService = moduleRef.get<VideoQueueService>(VideoQueueService);
  });

  describe('initiateUpload', () => {
    it('computes partCount correctly from fileSizeBytes and uploadPartSizeBytes', async () => {
      const channelId = 'channel-123';
      const dto: InitiateUploadDto = {
        title: 'My Video',
        originalFilename: 'video.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 314572800, // 300 MiB
      };

      const mockVideo = buildVideo({
        channel_id: channelId,
        file_size_bytes: String(dto.fileSizeBytes),
      });

      const mockParts: PresignedPart[] = [
        { partNumber: 1, url: 'https://s3.example.com/part1' },
        { partNumber: 2, url: 'https://s3.example.com/part2' },
        { partNumber: 3, url: 'https://s3.example.com/part3' },
      ];

      jest.spyOn(videoRepository, 'create').mockReturnValue(mockVideo);
      jest.spyOn(videoRepository, 'save').mockResolvedValue(mockVideo);
      jest
        .spyOn(storageService, 'createMultipartUpload')
        .mockResolvedValue('upload-id-123');
      const getPresignedUploadPartUrlsSpy = jest
        .spyOn(storageService, 'getPresignedUploadPartUrls')
        .mockResolvedValue(mockParts);

      const result = await service.initiateUpload(channelId, dto);

      // Verify partCount: Math.max(1, Math.ceil(314572800 / 104857600)) = Math.max(1, 3) = 3
      expect(getPresignedUploadPartUrlsSpy).toHaveBeenCalledWith(
        expect.any(String),
        'upload-id-123',
        3,
      );
      expect(result.parts.length).toBe(3);
    });

    it('calls storage in order: create → presign → save', async () => {
      const channelId = 'channel-123';
      const dto: InitiateUploadDto = {
        title: 'My Video',
        originalFilename: 'video.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 104857600,
      };

      const mockVideo = buildVideo({ channel_id: channelId });

      const callOrder: string[] = [];
      jest.spyOn(videoRepository, 'create').mockReturnValue(mockVideo);
      jest.spyOn(videoRepository, 'save').mockImplementation(() => {
        callOrder.push('save');
        return Promise.resolve(mockVideo);
      });
      jest
        .spyOn(storageService, 'createMultipartUpload')
        .mockImplementation(() => {
          callOrder.push('createMultipartUpload');
          return Promise.resolve('upload-id-123');
        });
      jest
        .spyOn(storageService, 'getPresignedUploadPartUrls')
        .mockImplementation(() => {
          callOrder.push('getPresignedUploadPartUrls');
          return Promise.resolve([
            { partNumber: 1, url: 'https://s3.example.com/part1' },
          ]);
        });

      await service.initiateUpload(channelId, dto);

      expect(callOrder).toEqual([
        'save', // slug retry loop
        'createMultipartUpload', // S3 multipart upload
        'getPresignedUploadPartUrls', // presigned URLs
        'save', // update video with storage_key and upload_id
      ]);
    });

    it('on failure after createMultipartUpload, calls abortMultipartUpload before deleting the draft row', async () => {
      const channelId = 'channel-123';
      const dto: InitiateUploadDto = {
        title: 'My Video',
        originalFilename: 'video.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 104857600,
      };

      const mockVideo = buildVideo({ channel_id: channelId });

      const callOrder: string[] = [];
      jest.spyOn(videoRepository, 'create').mockReturnValue(mockVideo);
      jest.spyOn(videoRepository, 'save').mockResolvedValue(mockVideo);
      jest
        .spyOn(storageService, 'createMultipartUpload')
        .mockResolvedValue('upload-id-123');
      jest
        .spyOn(storageService, 'getPresignedUploadPartUrls')
        .mockRejectedValue(new Error('Presign failed'));
      jest
        .spyOn(storageService, 'abortMultipartUpload')
        .mockImplementation(() => {
          callOrder.push('abortMultipartUpload');
          return Promise.resolve();
        });
      jest.spyOn(videoRepository, 'delete').mockImplementation(() => {
        callOrder.push('delete');
        return Promise.resolve({ raw: [], affected: 1 });
      });

      await expect(service.initiateUpload(channelId, dto)).rejects.toThrow(
        'Presign failed',
      );

      // Verify abort happens before delete
      expect(callOrder).toEqual(['abortMultipartUpload', 'delete']);
    });

    it('on failure before createMultipartUpload, does not call abortMultipartUpload', async () => {
      const channelId = 'channel-123';
      const dto: InitiateUploadDto = {
        title: 'My Video',
        originalFilename: 'video.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 104857600,
      };

      const mockVideo = buildVideo({ channel_id: channelId });

      jest.spyOn(videoRepository, 'create').mockReturnValue(mockVideo);
      jest.spyOn(videoRepository, 'save').mockResolvedValue(mockVideo);
      jest
        .spyOn(storageService, 'createMultipartUpload')
        .mockRejectedValue(new Error('S3 connection failed'));
      const abortMultipartUploadSpy = jest
        .spyOn(storageService, 'abortMultipartUpload')
        .mockResolvedValue(undefined);
      const deleteSpy = jest
        .spyOn(videoRepository, 'delete')
        .mockResolvedValue({ raw: [], affected: 1 });

      await expect(service.initiateUpload(channelId, dto)).rejects.toThrow(
        'S3 connection failed',
      );

      // Verify abort was not called
      expect(abortMultipartUploadSpy).not.toHaveBeenCalled();
      // But delete should still be called
      expect(deleteSpy).toHaveBeenCalledWith('video-123');
    });

    it('on slug collision (QueryFailedError code 23505), retries and eventually succeeds', async () => {
      const channelId = 'channel-123';
      const dto: InitiateUploadDto = {
        title: 'My Video',
        originalFilename: 'video.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 104857600,
      };

      const mockVideo = buildVideo({ channel_id: channelId });

      let saveCallCount = 0;
      jest.spyOn(videoRepository, 'create').mockReturnValue(mockVideo);
      const saveSpy = jest
        .spyOn(videoRepository, 'save')
        .mockImplementation(() => {
          saveCallCount += 1;
          if (saveCallCount <= 2) {
            // First 2 saves fail with slug collision
            return Promise.reject(buildSlugCollisionError());
          }
          // Third save succeeds
          return Promise.resolve(mockVideo);
        });
      jest
        .spyOn(storageService, 'createMultipartUpload')
        .mockResolvedValue('upload-id-123');
      jest
        .spyOn(storageService, 'getPresignedUploadPartUrls')
        .mockResolvedValue([
          { partNumber: 1, url: 'https://s3.example.com/part1' },
        ]);

      const result = await service.initiateUpload(channelId, dto);

      // Verify 4 save calls: 2 failed collisions + 1 successful for slug + 1 for storage_key/upload_id
      expect(saveSpy).toHaveBeenCalledTimes(4);
      expect(result.id).toBe('video-123');
      expect(result.slug).toBe('abc123def');
    });

    it('throws after MAX_SLUG_RETRIES attempts if slug collision persists', async () => {
      const channelId = 'channel-123';
      const dto: InitiateUploadDto = {
        title: 'My Video',
        originalFilename: 'video.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 104857600,
      };

      const mockVideo = buildVideo({ channel_id: channelId });

      jest.spyOn(videoRepository, 'create').mockReturnValue(mockVideo);
      // Always fail with slug collision
      const saveSpy = jest
        .spyOn(videoRepository, 'save')
        .mockRejectedValue(buildSlugCollisionError());

      await expect(service.initiateUpload(channelId, dto)).rejects.toThrow(
        'Failed to allocate a unique video slug after 5 attempts',
      );

      // Verify exactly 5 save attempts
      expect(saveSpy).toHaveBeenCalledTimes(5);
    });

    it('re-throws non-collision errors from the slug retry loop', async () => {
      const channelId = 'channel-123';
      const dto: InitiateUploadDto = {
        title: 'My Video',
        originalFilename: 'video.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 104857600,
      };

      const mockVideo = buildVideo({ channel_id: channelId });

      jest.spyOn(videoRepository, 'create').mockReturnValue(mockVideo);
      jest
        .spyOn(videoRepository, 'save')
        .mockRejectedValue(new Error('Database connection failed'));

      await expect(service.initiateUpload(channelId, dto)).rejects.toThrow(
        'Database connection failed',
      );
    });
  });

  describe('completeUpload', () => {
    it('throws VideoNotFoundException when video not found', async () => {
      const findOneBySpy = jest
        .spyOn(videoRepository, 'findOneBy')
        .mockResolvedValue(null);

      const dto: CompleteUploadDto = {
        parts: [{ partNumber: 1, etag: 'etag-1' }],
      };

      const result = service.completeUpload('channel-123', 'video-123', dto);

      await expect(result).rejects.toBeInstanceOf(VideoNotFoundException);
      await expect(result).rejects.toMatchObject({
        errorCode: 'VIDEO_NOT_FOUND',
      });
      expect(findOneBySpy).toHaveBeenCalledWith({
        id: 'video-123',
        channel_id: 'channel-123',
      });
    });

    it('throws UploadAlreadyCompletedException when video status is not DRAFT', async () => {
      const mockVideo = buildVideo({
        title: 'Test Video',
        slug: 'test-slug',
        status: VideoStatus.PROCESSING,
        storage_key: 'videos/channel-123/video-123/original.mp4',
        upload_id: 'upload-123',
      });

      jest.spyOn(videoRepository, 'findOneBy').mockResolvedValue(mockVideo);

      const dto: CompleteUploadDto = {
        parts: [{ partNumber: 1, etag: 'etag-1' }],
      };

      const result = service.completeUpload('channel-123', 'video-123', dto);

      await expect(result).rejects.toBeInstanceOf(
        UploadAlreadyCompletedException,
      );
      await expect(result).rejects.toMatchObject({
        errorCode: 'UPLOAD_ALREADY_COMPLETED',
      });
    });

    it('throws MultipartUploadFailedException when storage service fails', async () => {
      const mockVideo = buildVideo({
        title: 'Test Video',
        slug: 'test-slug',
        storage_key: 'videos/channel-123/video-123/original.mp4',
        upload_id: 'upload-123',
      });

      jest.spyOn(videoRepository, 'findOneBy').mockResolvedValue(mockVideo);
      jest
        .spyOn(storageService, 'completeMultipartUpload')
        .mockRejectedValue(new Error('S3 error'));
      const saveSpy = jest.spyOn(videoRepository, 'save');

      const dto: CompleteUploadDto = {
        parts: [{ partNumber: 1, etag: 'etag-1' }],
      };

      const result = service.completeUpload('channel-123', 'video-123', dto);

      await expect(result).rejects.toBeInstanceOf(
        MultipartUploadFailedException,
      );
      await expect(result).rejects.toMatchObject({
        errorCode: 'MULTIPART_UPLOAD_FAILED',
      });
      // Verify status was not changed
      expect(saveSpy).not.toHaveBeenCalled();
    });

    it('succeeds and sets status to PROCESSING, clears upload_id, and enqueues job', async () => {
      const mockVideo = buildVideo({
        title: 'Test Video',
        slug: 'test-slug',
        storage_key: 'videos/channel-123/video-123/original.mp4',
        upload_id: 'upload-123',
      });

      const updatedVideo = buildVideo({
        ...mockVideo,
        status: VideoStatus.PROCESSING,
        upload_id: null,
      });

      jest.spyOn(videoRepository, 'findOneBy').mockResolvedValue(mockVideo);
      const completeMultipartUploadSpy = jest
        .spyOn(storageService, 'completeMultipartUpload')
        .mockResolvedValue(undefined);
      const saveSpy = jest
        .spyOn(videoRepository, 'save')
        .mockResolvedValue(updatedVideo);
      const enqueueProcessingSpy = jest
        .spyOn(videoQueueService, 'enqueueProcessing')
        .mockResolvedValue(undefined);

      const dto: CompleteUploadDto = {
        parts: [
          { partNumber: 1, etag: 'etag-1' },
          { partNumber: 2, etag: 'etag-2' },
        ],
      };

      const result = await service.completeUpload(
        'channel-123',
        'video-123',
        dto,
      );

      expect(result.status).toBe(VideoStatus.PROCESSING);
      expect(result.upload_id).toBeNull();

      expect(completeMultipartUploadSpy).toHaveBeenCalledWith(
        'videos/channel-123/video-123/original.mp4',
        'upload-123',
        dto.parts,
      );

      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: VideoStatus.PROCESSING,
          upload_id: null,
        }),
      );

      expect(enqueueProcessingSpy).toHaveBeenCalledWith('video-123');
      expect(enqueueProcessingSpy).toHaveBeenCalledTimes(1);
    });

    it('throws VideoProcessingEnqueueFailedException when enqueue fails, but video is already saved as PROCESSING', async () => {
      const mockVideo = buildVideo({
        title: 'Test Video',
        slug: 'test-slug',
        storage_key: 'videos/channel-123/video-123/original.mp4',
        upload_id: 'upload-123',
      });

      const updatedVideo = buildVideo({
        ...mockVideo,
        status: VideoStatus.PROCESSING,
        upload_id: null,
      });

      jest.spyOn(videoRepository, 'findOneBy').mockResolvedValue(mockVideo);
      jest
        .spyOn(storageService, 'completeMultipartUpload')
        .mockResolvedValue(undefined);
      const saveSpy = jest
        .spyOn(videoRepository, 'save')
        .mockResolvedValue(updatedVideo);
      jest
        .spyOn(videoQueueService, 'enqueueProcessing')
        .mockRejectedValue(new Error('Redis connection failed'));

      const dto: CompleteUploadDto = {
        parts: [{ partNumber: 1, etag: 'etag-1' }],
      };

      const result = service.completeUpload('channel-123', 'video-123', dto);

      await expect(result).rejects.toBeInstanceOf(
        VideoProcessingEnqueueFailedException,
      );
      await expect(result).rejects.toMatchObject({
        errorCode: 'VIDEO_PROCESSING_ENQUEUE_FAILED',
      });

      // Verify that videoRepository.save was called before the enqueue failure
      expect(saveSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: VideoStatus.PROCESSING,
          upload_id: null,
        }),
      );
    });
  });

  describe('findBySlugOrFail', () => {
    it('returns the video when found by slug', async () => {
      const mockVideo = buildVideo({
        title: 'Test Video',
        slug: 'test-slug',
        storage_key: 'videos/channel-123/video-123/original.mp4',
        upload_id: 'upload-123',
      });

      const findOneBySpy = jest
        .spyOn(videoRepository, 'findOneBy')
        .mockResolvedValue(mockVideo);

      const result = await service.findBySlugOrFail('test-slug');

      expect(result).toEqual(mockVideo);
      expect(findOneBySpy).toHaveBeenCalledWith({
        slug: 'test-slug',
      });
    });

    it('throws VideoNotFoundException when video not found', async () => {
      jest.spyOn(videoRepository, 'findOneBy').mockResolvedValue(null);

      await expect(
        service.findBySlugOrFail('nonexistent'),
      ).rejects.toMatchObject({ errorCode: 'VIDEO_NOT_FOUND' });
    });
  });
});
