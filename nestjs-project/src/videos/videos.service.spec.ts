import { QueryFailedError, Repository } from 'typeorm';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { ConfigType } from '@nestjs/config';
import { VideosService } from './videos.service';
import { Video, VideoStatus } from './entities/video.entity';
import { StorageService } from '../storage/storage.service';
import storageConfig from '../config/storage.config';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import type { PresignedPart } from '../storage/storage.service';
import { VideoQueueService } from '../queue/video-queue.service';
import { VideoNotFoundException } from './exceptions/video-not-found.exception';
import { UploadAlreadyCompletedException } from './exceptions/upload-already-completed.exception';
import { MultipartUploadFailedException } from './exceptions/multipart-upload-failed.exception';

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

      const mockVideo: Video = {
        id: 'video-123',
        channel_id: channelId,
        title: dto.title,
        slug: 'abc123def',
        status: VideoStatus.DRAFT,
        storage_key: '',
        thumbnail_key: null,
        upload_id: null,
        original_filename: dto.originalFilename,
        mime_type: dto.mimeType,
        file_size_bytes: String(dto.fileSizeBytes),
        duration_seconds: null,
        metadata: null,
        error_message: null,
        channel: undefined as any,
        created_at: new Date(),
        updated_at: new Date(),
      };

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
      jest
        .spyOn(storageService, 'getPresignedUploadPartUrls')
        .mockResolvedValue(mockParts);

      const result = await service.initiateUpload(channelId, dto);

      // Verify partCount: Math.max(1, Math.ceil(314572800 / 104857600)) = Math.max(1, 3) = 3
      expect(storageService.getPresignedUploadPartUrls).toHaveBeenCalledWith(
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

      const mockVideo: Video = {
        id: 'video-123',
        channel_id: channelId,
        title: dto.title,
        slug: 'abc123def',
        status: VideoStatus.DRAFT,
        storage_key: '',
        thumbnail_key: null,
        upload_id: null,
        original_filename: dto.originalFilename,
        mime_type: dto.mimeType,
        file_size_bytes: String(dto.fileSizeBytes),
        duration_seconds: null,
        metadata: null,
        error_message: null,
        channel: undefined as any,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const callOrder: string[] = [];
      jest.spyOn(videoRepository, 'create').mockReturnValue(mockVideo);
      jest.spyOn(videoRepository, 'save').mockImplementation(async () => {
        callOrder.push('save');
        return mockVideo;
      });
      jest
        .spyOn(storageService, 'createMultipartUpload')
        .mockImplementation(async () => {
          callOrder.push('createMultipartUpload');
          return 'upload-id-123';
        });
      jest
        .spyOn(storageService, 'getPresignedUploadPartUrls')
        .mockImplementation(async () => {
          callOrder.push('getPresignedUploadPartUrls');
          return [{ partNumber: 1, url: 'https://s3.example.com/part1' }];
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

      const mockVideo: Video = {
        id: 'video-123',
        channel_id: channelId,
        title: dto.title,
        slug: 'abc123def',
        status: VideoStatus.DRAFT,
        storage_key: '',
        thumbnail_key: null,
        upload_id: null,
        original_filename: dto.originalFilename,
        mime_type: dto.mimeType,
        file_size_bytes: String(dto.fileSizeBytes),
        duration_seconds: null,
        metadata: null,
        error_message: null,
        channel: undefined as any,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const callOrder: string[] = [];
      jest.spyOn(videoRepository, 'create').mockReturnValue(mockVideo);
      jest.spyOn(videoRepository, 'save').mockResolvedValue(mockVideo);
      jest
        .spyOn(storageService, 'createMultipartUpload')
        .mockResolvedValue('upload-id-123');
      jest
        .spyOn(storageService, 'getPresignedUploadPartUrls')
        .mockImplementation(async () => {
          throw new Error('Presign failed');
        });
      jest
        .spyOn(storageService, 'abortMultipartUpload')
        .mockImplementation(async () => {
          callOrder.push('abortMultipartUpload');
        });
      jest.spyOn(videoRepository, 'delete').mockImplementation(async () => {
        callOrder.push('delete');
        return { affected: 1 } as any;
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

      const mockVideo: Video = {
        id: 'video-123',
        channel_id: channelId,
        title: dto.title,
        slug: 'abc123def',
        status: VideoStatus.DRAFT,
        storage_key: '',
        thumbnail_key: null,
        upload_id: null,
        original_filename: dto.originalFilename,
        mime_type: dto.mimeType,
        file_size_bytes: String(dto.fileSizeBytes),
        duration_seconds: null,
        metadata: null,
        error_message: null,
        channel: undefined as any,
        created_at: new Date(),
        updated_at: new Date(),
      };

      jest.spyOn(videoRepository, 'create').mockReturnValue(mockVideo);
      jest.spyOn(videoRepository, 'save').mockResolvedValue(mockVideo);
      jest
        .spyOn(storageService, 'createMultipartUpload')
        .mockImplementation(async () => {
          throw new Error('S3 connection failed');
        });
      jest
        .spyOn(storageService, 'abortMultipartUpload')
        .mockResolvedValue(undefined);
      jest
        .spyOn(videoRepository, 'delete')
        .mockResolvedValue({ affected: 1 } as any);

      await expect(service.initiateUpload(channelId, dto)).rejects.toThrow(
        'S3 connection failed',
      );

      // Verify abort was not called
      expect(storageService.abortMultipartUpload).not.toHaveBeenCalled();
      // But delete should still be called
      expect(videoRepository.delete).toHaveBeenCalledWith('video-123');
    });

    it('on slug collision (QueryFailedError code 23505), retries and eventually succeeds', async () => {
      const channelId = 'channel-123';
      const dto: InitiateUploadDto = {
        title: 'My Video',
        originalFilename: 'video.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 104857600,
      };

      const mockVideo: Video = {
        id: 'video-123',
        channel_id: channelId,
        title: dto.title,
        slug: 'abc123def',
        status: VideoStatus.DRAFT,
        storage_key: '',
        thumbnail_key: null,
        upload_id: null,
        original_filename: dto.originalFilename,
        mime_type: dto.mimeType,
        file_size_bytes: String(dto.fileSizeBytes),
        duration_seconds: null,
        metadata: null,
        error_message: null,
        channel: undefined as any,
        created_at: new Date(),
        updated_at: new Date(),
      };

      let saveCallCount = 0;
      jest.spyOn(videoRepository, 'create').mockReturnValue(mockVideo);
      jest.spyOn(videoRepository, 'save').mockImplementation(async () => {
        saveCallCount += 1;
        if (saveCallCount <= 2) {
          // First 2 saves fail with slug collision
          const err = Object.create(QueryFailedError.prototype);
          err.code = '23505';
          err.message =
            'duplicate key value violates unique constraint "UQ_5dbcc1ee100f853490582eccc71"';
          err.detail = 'Key (slug)=(abc123def) already exists.';
          throw err;
        }
        // Third save succeeds
        return mockVideo;
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
      expect(videoRepository.save).toHaveBeenCalledTimes(4);
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

      const mockVideo: Video = {
        id: 'video-123',
        channel_id: channelId,
        title: dto.title,
        slug: 'abc123def',
        status: VideoStatus.DRAFT,
        storage_key: '',
        thumbnail_key: null,
        upload_id: null,
        original_filename: dto.originalFilename,
        mime_type: dto.mimeType,
        file_size_bytes: String(dto.fileSizeBytes),
        duration_seconds: null,
        metadata: null,
        error_message: null,
        channel: undefined as any,
        created_at: new Date(),
        updated_at: new Date(),
      };

      jest.spyOn(videoRepository, 'create').mockReturnValue(mockVideo);
      jest.spyOn(videoRepository, 'save').mockImplementation(async () => {
        // Always fail with slug collision
        const err = Object.create(QueryFailedError.prototype);
        err.code = '23505';
        err.message =
          'duplicate key value violates unique constraint "UQ_5dbcc1ee100f853490582eccc71"';
        err.detail = 'Key (slug)=(abc123def) already exists.';
        throw err;
      });

      await expect(service.initiateUpload(channelId, dto)).rejects.toThrow(
        'Failed to allocate a unique video slug after 5 attempts',
      );

      // Verify exactly 5 save attempts
      expect(videoRepository.save).toHaveBeenCalledTimes(5);
    });

    it('re-throws non-collision errors from the slug retry loop', async () => {
      const channelId = 'channel-123';
      const dto: InitiateUploadDto = {
        title: 'My Video',
        originalFilename: 'video.mp4',
        mimeType: 'video/mp4',
        fileSizeBytes: 104857600,
      };

      const mockVideo: Video = {
        id: 'video-123',
        channel_id: channelId,
        title: dto.title,
        slug: 'abc123def',
        status: VideoStatus.DRAFT,
        storage_key: '',
        thumbnail_key: null,
        upload_id: null,
        original_filename: dto.originalFilename,
        mime_type: dto.mimeType,
        file_size_bytes: String(dto.fileSizeBytes),
        duration_seconds: null,
        metadata: null,
        error_message: null,
        channel: undefined as any,
        created_at: new Date(),
        updated_at: new Date(),
      };

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
      jest.spyOn(videoRepository, 'findOneBy').mockResolvedValue(null);

      const dto: CompleteUploadDto = {
        parts: [{ partNumber: 1, etag: 'etag-1' }],
      };

      const error = await service
        .completeUpload('channel-123', 'video-123', dto)
        .catch((err) => err);

      expect(error).toBeInstanceOf(VideoNotFoundException);
      expect(error.errorCode).toBe('VIDEO_NOT_FOUND');
      expect(videoRepository.findOneBy).toHaveBeenCalledWith({
        id: 'video-123',
        channel_id: 'channel-123',
      });
    });

    it('throws UploadAlreadyCompletedException when video status is not DRAFT', async () => {
      const mockVideo: Video = {
        id: 'video-123',
        channel_id: 'channel-123',
        title: 'Test Video',
        slug: 'test-slug',
        status: VideoStatus.PROCESSING,
        storage_key: 'videos/channel-123/video-123/original.mp4',
        thumbnail_key: null,
        upload_id: 'upload-123',
        original_filename: 'video.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: '104857600',
        duration_seconds: null,
        metadata: null,
        error_message: null,
        channel: undefined as any,
        created_at: new Date(),
        updated_at: new Date(),
      };

      jest.spyOn(videoRepository, 'findOneBy').mockResolvedValue(mockVideo);

      const dto: CompleteUploadDto = {
        parts: [{ partNumber: 1, etag: 'etag-1' }],
      };

      const error = await service
        .completeUpload('channel-123', 'video-123', dto)
        .catch((err) => err);

      expect(error).toBeInstanceOf(UploadAlreadyCompletedException);
      expect(error.errorCode).toBe('UPLOAD_ALREADY_COMPLETED');
    });

    it('throws MultipartUploadFailedException when storage service fails', async () => {
      const mockVideo: Video = {
        id: 'video-123',
        channel_id: 'channel-123',
        title: 'Test Video',
        slug: 'test-slug',
        status: VideoStatus.DRAFT,
        storage_key: 'videos/channel-123/video-123/original.mp4',
        thumbnail_key: null,
        upload_id: 'upload-123',
        original_filename: 'video.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: '104857600',
        duration_seconds: null,
        metadata: null,
        error_message: null,
        channel: undefined as any,
        created_at: new Date(),
        updated_at: new Date(),
      };

      jest.spyOn(videoRepository, 'findOneBy').mockResolvedValue(mockVideo);
      jest
        .spyOn(storageService, 'completeMultipartUpload')
        .mockRejectedValue(new Error('S3 error'));

      const dto: CompleteUploadDto = {
        parts: [{ partNumber: 1, etag: 'etag-1' }],
      };

      const error = await service
        .completeUpload('channel-123', 'video-123', dto)
        .catch((err) => err);

      expect(error).toBeInstanceOf(MultipartUploadFailedException);
      expect(error.errorCode).toBe('MULTIPART_UPLOAD_FAILED');
      // Verify status was not changed
      expect(videoRepository.save).not.toHaveBeenCalled();
    });

    it('succeeds and sets status to PROCESSING, clears upload_id, and enqueues job', async () => {
      const mockVideo: Video = {
        id: 'video-123',
        channel_id: 'channel-123',
        title: 'Test Video',
        slug: 'test-slug',
        status: VideoStatus.DRAFT,
        storage_key: 'videos/channel-123/video-123/original.mp4',
        thumbnail_key: null,
        upload_id: 'upload-123',
        original_filename: 'video.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: '104857600',
        duration_seconds: null,
        metadata: null,
        error_message: null,
        channel: undefined as any,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const updatedVideo: Video = {
        ...mockVideo,
        status: VideoStatus.PROCESSING,
        upload_id: null,
      };

      jest.spyOn(videoRepository, 'findOneBy').mockResolvedValue(mockVideo);
      jest
        .spyOn(storageService, 'completeMultipartUpload')
        .mockResolvedValue(undefined);
      jest.spyOn(videoRepository, 'save').mockResolvedValue(updatedVideo);
      jest
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

      expect(storageService.completeMultipartUpload).toHaveBeenCalledWith(
        'videos/channel-123/video-123/original.mp4',
        'upload-123',
        dto.parts,
      );

      expect(videoRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: VideoStatus.PROCESSING,
          upload_id: null,
        }),
      );

      expect(videoQueueService.enqueueProcessing).toHaveBeenCalledWith(
        'video-123',
      );
      expect(videoQueueService.enqueueProcessing).toHaveBeenCalledTimes(1);
    });
  });

  describe('findBySlugOrFail', () => {
    it('returns the video when found by slug', async () => {
      const mockVideo: Video = {
        id: 'video-123',
        channel_id: 'channel-123',
        title: 'Test Video',
        slug: 'test-slug',
        status: VideoStatus.DRAFT,
        storage_key: 'videos/channel-123/video-123/original.mp4',
        thumbnail_key: null,
        upload_id: 'upload-123',
        original_filename: 'video.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: '104857600',
        duration_seconds: null,
        metadata: null,
        error_message: null,
        channel: undefined as any,
        created_at: new Date(),
        updated_at: new Date(),
      };

      jest.spyOn(videoRepository, 'findOneBy').mockResolvedValue(mockVideo);

      const result = await service.findBySlugOrFail('test-slug');

      expect(result).toEqual(mockVideo);
      expect(videoRepository.findOneBy).toHaveBeenCalledWith({
        slug: 'test-slug',
      });
    });

    it('throws VideoNotFoundException when video not found', async () => {
      jest.spyOn(videoRepository, 'findOneBy').mockResolvedValue(null);

      const error = await service
        .findBySlugOrFail('nonexistent')
        .catch((err) => err);
      expect(error.errorCode).toBe('VIDEO_NOT_FOUND');
    });
  });
});
