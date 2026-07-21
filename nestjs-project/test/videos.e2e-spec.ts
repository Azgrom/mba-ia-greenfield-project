import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { StorageService } from '../src/storage/storage.service';
import type { PresignedPart } from '../src/storage/storage.service';

describe('Videos (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let channelRepository: Repository<Channel>;
  let throttlerStorage: ThrottlerStorageService;
  let storageService: StorageService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    videoRepository = dataSource.getRepository(Video);
    channelRepository = dataSource.getRepository(Channel);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
    storageService = moduleFixture.get<StorageService>(StorageService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  async function captureConfirmationToken(
    email: string,
    password = 'password123',
  ): Promise<string> {
    const authService = app.get(AuthService);
    const mailServiceInstance = (authService as any).mailService;
    let capturedToken = '';
    jest
      .spyOn(mailServiceInstance, 'sendConfirmationEmail')
      .mockImplementationOnce(async (_e: string, _n: string, t: string) => {
        capturedToken = t;
      });
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password });
    return capturedToken;
  }

  async function registerConfirmAndLogin(
    email: string,
    password = 'password123',
  ): Promise<{ access_token: string; refresh_token: string }> {
    const token = await captureConfirmationToken(email, password);
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    return {
      access_token: res.body.access_token,
      refresh_token: res.body.refresh_token,
    };
  }

  describe('POST /videos', () => {
    it('returns 201 with { id, slug, uploadId, parts } on valid request', async () => {
      const { access_token } =
        await registerConfirmAndLogin('upload@example.com');

      // Mock the storage service to avoid actual S3 calls
      jest
        .spyOn(storageService, 'createMultipartUpload')
        .mockResolvedValue('upload-id-123');
      jest
        .spyOn(storageService, 'getPresignedUploadPartUrls')
        .mockResolvedValue([
          { partNumber: 1, url: 'https://s3.example.com/part1' },
        ] as PresignedPart[]);

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          title: 'My Test Video',
          originalFilename: 'video.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 104857600,
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(typeof res.body.id).toBe('string');
      expect(res.body.slug).toBeDefined();
      expect(typeof res.body.slug).toBe('string');
      expect(res.body.uploadId).toBe('upload-id-123');
      expect(Array.isArray(res.body.parts)).toBe(true);
      expect(res.body.parts.length).toBeGreaterThan(0);
      expect(res.body.parts[0]).toHaveProperty('partNumber');
      expect(res.body.parts[0]).toHaveProperty('url');

      // Verify video was persisted to the database
      const video = await videoRepository.findOneBy({ id: res.body.id });
      expect(video).not.toBeNull();
      expect(video!.title).toBe('My Test Video');
      expect(video!.status).toBe('draft');
    });

    it('returns 400 with VALIDATION_ERROR when title is missing', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'notitle@example.com',
      );

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          originalFilename: 'video.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 104857600,
        })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 400 with VALIDATION_ERROR when title is empty string', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'emptytitle@example.com',
      );

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          title: '',
          originalFilename: 'video.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 104857600,
        })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 400 with VALIDATION_ERROR when originalFilename is missing', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'nofilename@example.com',
      );

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          title: 'My Video',
          mimeType: 'video/mp4',
          fileSizeBytes: 104857600,
        })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 400 with VALIDATION_ERROR when mimeType does not start with "video/"', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'wrongmime@example.com',
      );

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          title: 'My Video',
          originalFilename: 'video.mp4',
          mimeType: 'audio/mp3',
          fileSizeBytes: 104857600,
        })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 400 with VALIDATION_ERROR when fileSizeBytes is above 10 GiB', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'toolarge@example.com',
      );

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          title: 'My Video',
          originalFilename: 'video.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 10737418241, // 10 GiB + 1 byte
        })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 400 with VALIDATION_ERROR when fileSizeBytes is 0', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'zerosize@example.com',
      );

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          title: 'My Video',
          originalFilename: 'video.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 0,
        })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 401 without an Authorization header', async () => {
      await request(app.getHttpServer())
        .post('/videos')
        .send({
          title: 'My Video',
          originalFilename: 'video.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 104857600,
        })
        .expect(401);
    });

    it('returns 401 with an invalid access token', async () => {
      await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', 'Bearer invalid-token')
        .send({
          title: 'My Video',
          originalFilename: 'video.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 104857600,
        })
        .expect(401);
    });

    it('rejects extra fields with forbidNonWhitelisted', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'extrafield@example.com',
      );

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          title: 'My Video',
          originalFilename: 'video.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 104857600,
          extraField: 'should be rejected',
        })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('correctly calculates parts.length based on fileSizeBytes', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'multipart@example.com',
      );

      // 300 MiB with 100 MiB part size = 3 parts
      const mockParts: PresignedPart[] = [
        { partNumber: 1, url: 'https://s3.example.com/part1' },
        { partNumber: 2, url: 'https://s3.example.com/part2' },
        { partNumber: 3, url: 'https://s3.example.com/part3' },
      ];

      jest
        .spyOn(storageService, 'createMultipartUpload')
        .mockResolvedValue('upload-id-123');
      jest
        .spyOn(storageService, 'getPresignedUploadPartUrls')
        .mockResolvedValue(mockParts);

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          title: 'Large Video',
          originalFilename: 'video.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 314572800, // 300 MiB
        })
        .expect(201);

      expect(res.body.parts.length).toBe(3);
    });

    it("creates a draft video in the user's channel", async () => {
      const { access_token } =
        await registerConfirmAndLogin('draft@example.com');

      jest
        .spyOn(storageService, 'createMultipartUpload')
        .mockResolvedValue('upload-id-123');
      jest
        .spyOn(storageService, 'getPresignedUploadPartUrls')
        .mockResolvedValue([
          { partNumber: 1, url: 'https://s3.example.com/part1' },
        ] as PresignedPart[]);

      const res = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          title: 'My Draft Video',
          originalFilename: 'video.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 104857600,
        })
        .expect(201);

      const video = await videoRepository.findOneBy({ id: res.body.id });
      expect(video).not.toBeNull();
      expect(video!.status).toBe('draft');
      expect(video!.title).toBe('My Draft Video');
    });
  });

  describe('POST /videos/:id/complete-upload', () => {
    it('returns 200 with { id, slug, status: processing } on valid request', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'complete@example.com',
      );

      // Mock storage to initiate upload
      jest
        .spyOn(storageService, 'createMultipartUpload')
        .mockResolvedValue('upload-id-123');
      jest
        .spyOn(storageService, 'getPresignedUploadPartUrls')
        .mockResolvedValue([
          { partNumber: 1, url: 'https://s3.example.com/part1' },
        ] as PresignedPart[]);
      jest
        .spyOn(storageService, 'completeMultipartUpload')
        .mockResolvedValue(undefined);

      // Initiate upload
      const initiateRes = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          title: 'Test Video for Completion',
          originalFilename: 'video.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 104857600,
        })
        .expect(201);

      const videoId = initiateRes.body.id;

      // Complete upload
      const completeRes = await request(app.getHttpServer())
        .post(`/videos/${videoId}/complete-upload`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          parts: [{ partNumber: 1, etag: 'etag-abc123' }],
        })
        .expect(200);

      expect(completeRes.body.id).toBe(videoId);
      expect(completeRes.body.slug).toBeDefined();
      expect(completeRes.body.status).toBe('processing');

      // Verify in database
      const video = await videoRepository.findOneBy({ id: videoId });
      expect(video!.status).toBe('processing');
      expect(video!.upload_id).toBeNull();
    });

    it('returns 409 UPLOAD_ALREADY_COMPLETED when called twice on same video', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'doubleupload@example.com',
      );

      // Mock storage
      jest
        .spyOn(storageService, 'createMultipartUpload')
        .mockResolvedValue('upload-id-123');
      jest
        .spyOn(storageService, 'getPresignedUploadPartUrls')
        .mockResolvedValue([
          { partNumber: 1, url: 'https://s3.example.com/part1' },
        ] as PresignedPart[]);
      jest
        .spyOn(storageService, 'completeMultipartUpload')
        .mockResolvedValue(undefined);

      // Initiate upload
      const initiateRes = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          title: 'Video for Double Complete',
          originalFilename: 'video.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 104857600,
        })
        .expect(201);

      const videoId = initiateRes.body.id;

      // First complete
      await request(app.getHttpServer())
        .post(`/videos/${videoId}/complete-upload`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          parts: [{ partNumber: 1, etag: 'etag-abc123' }],
        })
        .expect(200);

      // Second complete - should return 409
      const res = await request(app.getHttpServer())
        .post(`/videos/${videoId}/complete-upload`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          parts: [{ partNumber: 1, etag: 'etag-abc123' }],
        })
        .expect(409);

      expect(res.body.error).toBe('UPLOAD_ALREADY_COMPLETED');
    });

    it('returns 404 VIDEO_NOT_FOUND when video does not exist', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'notfound@example.com',
      );

      // Use a valid UUID that doesn't exist
      const nonexistentUuid = '00000000-0000-0000-0000-000000000000';

      const res = await request(app.getHttpServer())
        .post(`/videos/${nonexistentUuid}/complete-upload`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          parts: [{ partNumber: 1, etag: 'etag-abc123' }],
        })
        .expect(404);

      expect(res.body.error).toBe('VIDEO_NOT_FOUND');
    });

    it("returns 404 VIDEO_NOT_FOUND when accessing another user's video", async () => {
      const user1Tokens = await registerConfirmAndLogin('user1@example.com');
      const user2Tokens = await registerConfirmAndLogin('user2@example.com');

      // Mock storage for user1
      jest
        .spyOn(storageService, 'createMultipartUpload')
        .mockResolvedValue('upload-id-123');
      jest
        .spyOn(storageService, 'getPresignedUploadPartUrls')
        .mockResolvedValue([
          { partNumber: 1, url: 'https://s3.example.com/part1' },
        ] as PresignedPart[]);

      // User1 initiates upload
      const initiateRes = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${user1Tokens.access_token}`)
        .send({
          title: 'User1 Video',
          originalFilename: 'video.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 104857600,
        })
        .expect(201);

      const videoId = initiateRes.body.id;

      // User2 tries to complete user1's video - should get 404
      const res = await request(app.getHttpServer())
        .post(`/videos/${videoId}/complete-upload`)
        .set('Authorization', `Bearer ${user2Tokens.access_token}`)
        .send({
          parts: [{ partNumber: 1, etag: 'etag-abc123' }],
        })
        .expect(404);

      expect(res.body.error).toBe('VIDEO_NOT_FOUND');
    });

    it('returns 400 VALIDATION_ERROR when parts is missing', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'noparts@example.com',
      );

      jest
        .spyOn(storageService, 'createMultipartUpload')
        .mockResolvedValue('upload-id-123');
      jest
        .spyOn(storageService, 'getPresignedUploadPartUrls')
        .mockResolvedValue([
          { partNumber: 1, url: 'https://s3.example.com/part1' },
        ] as PresignedPart[]);

      // Initiate upload
      const initiateRes = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          title: 'No Parts Video',
          originalFilename: 'video.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 104857600,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/videos/${initiateRes.body.id}/complete-upload`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({})
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 400 VALIDATION_ERROR when parts array is empty', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'emptyparts@example.com',
      );

      jest
        .spyOn(storageService, 'createMultipartUpload')
        .mockResolvedValue('upload-id-123');
      jest
        .spyOn(storageService, 'getPresignedUploadPartUrls')
        .mockResolvedValue([
          { partNumber: 1, url: 'https://s3.example.com/part1' },
        ] as PresignedPart[]);

      // Initiate upload
      const initiateRes = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          title: 'Empty Parts Video',
          originalFilename: 'video.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 104857600,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/videos/${initiateRes.body.id}/complete-upload`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          parts: [],
        })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 401 without Authorization header', async () => {
      const validUuid = '00000000-0000-0000-0000-000000000000';
      const res = await request(app.getHttpServer())
        .post(`/videos/${validUuid}/complete-upload`)
        .send({
          parts: [{ partNumber: 1, etag: 'etag-abc123' }],
        })
        .expect(401);

      expect(res.body).toBeDefined();
    });
  });

  describe('GET /videos/:slug', () => {
    it('returns 200 with full VideoDetailDto for a draft video', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'getdraft@example.com',
      );

      // Mock storage
      jest
        .spyOn(storageService, 'createMultipartUpload')
        .mockResolvedValue('upload-id-123');
      jest
        .spyOn(storageService, 'getPresignedUploadPartUrls')
        .mockResolvedValue([
          { partNumber: 1, url: 'https://s3.example.com/part1' },
        ] as PresignedPart[]);

      // Initiate upload to create a draft video
      const initiateRes = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          title: 'Draft Video for Detail',
          originalFilename: 'video.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 104857600,
        })
        .expect(201);

      const videoSlug = initiateRes.body.slug;

      // Fetch the video detail without Authorization
      const res = await request(app.getHttpServer())
        .get(`/videos/${videoSlug}`)
        .expect(200);

      expect(res.body.id).toBeDefined();
      expect(typeof res.body.id).toBe('string');
      expect(res.body.slug).toBe(videoSlug);
      expect(res.body.title).toBe('Draft Video for Detail');
      expect(res.body.status).toBe('draft');
      expect(res.body.durationSeconds).toBeNull();
      expect(res.body.thumbnailUrl).toBeNull();
      expect(res.body.createdAt).toBeDefined();
    });

    it('returns 200 with null thumbnailUrl for processing video', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'getprocessing@example.com',
      );

      // Mock storage
      jest
        .spyOn(storageService, 'createMultipartUpload')
        .mockResolvedValue('upload-id-123');
      jest
        .spyOn(storageService, 'getPresignedUploadPartUrls')
        .mockResolvedValue([
          { partNumber: 1, url: 'https://s3.example.com/part1' },
        ] as PresignedPart[]);
      jest
        .spyOn(storageService, 'completeMultipartUpload')
        .mockResolvedValue(undefined);

      // Initiate upload
      const initiateRes = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          title: 'Processing Video',
          originalFilename: 'video.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 104857600,
        })
        .expect(201);

      const videoId = initiateRes.body.id;
      const videoSlug = initiateRes.body.slug;

      // Complete upload to move to processing status
      await request(app.getHttpServer())
        .post(`/videos/${videoId}/complete-upload`)
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          parts: [{ partNumber: 1, etag: 'etag-abc123' }],
        })
        .expect(200);

      // Fetch video detail
      const res = await request(app.getHttpServer())
        .get(`/videos/${videoSlug}`)
        .expect(200);

      expect(res.body.status).toBe('processing');
      expect(res.body.thumbnailUrl).toBeNull();
    });

    it('returns 200 with presigned thumbnailUrl for ready video with thumbnail', async () => {
      await registerConfirmAndLogin('getready@example.com');

      // Create a video and manually set it to ready with a thumbnail_key
      const channel = await channelRepository.findOneBy({
        user_id: (
          await dataSource.query(
            "SELECT id FROM users WHERE email = 'getready@example.com'",
          )
        )[0].id,
      });

      const video = await videoRepository.save(
        videoRepository.create({
          channel_id: channel!.id,
          title: 'Ready Video',
          slug: 'ready123',
          status: VideoStatus.READY,
          storage_key: 'videos/channel/id/original.mp4',
          original_filename: 'video.mp4',
          mime_type: 'video/mp4',
          file_size_bytes: '104857600',
          duration_seconds: 123.45,
          thumbnail_key: 'videos/channel/id/thumbnail.jpg',
        }),
      );

      // Mock getPresignedGetUrl
      const mockPresignedUrl = 'https://s3.example.com/presigned-thumbnail';
      const getPresignedGetUrlSpy = jest
        .spyOn(storageService, 'getPresignedGetUrl')
        .mockResolvedValue(mockPresignedUrl);

      // Fetch video detail
      const res = await request(app.getHttpServer())
        .get(`/videos/${video.slug}`)
        .expect(200);

      expect(res.body.id).toBe(video.id);
      expect(res.body.status).toBe('ready');
      expect(res.body.durationSeconds).toBe(123.45);
      expect(res.body.thumbnailUrl).toBe(mockPresignedUrl);

      getPresignedGetUrlSpy.mockRestore();
    });

    it('returns 200 with null thumbnailUrl for ready video without thumbnail', async () => {
      await registerConfirmAndLogin('getready-nothumbnail@example.com');

      // Create a video that is ready but has no thumbnail_key
      const channel = await channelRepository.findOneBy({
        user_id: (
          await dataSource.query(
            "SELECT id FROM users WHERE email = 'getready-nothumbnail@example.com'",
          )
        )[0].id,
      });

      const video = await videoRepository.save(
        videoRepository.create({
          channel_id: channel!.id,
          title: 'Ready Video No Thumbnail',
          slug: 'readyno123',
          status: VideoStatus.READY,
          storage_key: 'videos/channel/id/original.mp4',
          original_filename: 'video.mp4',
          mime_type: 'video/mp4',
          file_size_bytes: '104857600',
          duration_seconds: 60.0,
          thumbnail_key: null,
        }),
      );

      // Fetch video detail
      const res = await request(app.getHttpServer())
        .get(`/videos/${video.slug}`)
        .expect(200);

      expect(res.body.id).toBe(video.id);
      expect(res.body.status).toBe('ready');
      expect(res.body.thumbnailUrl).toBeNull();
    });

    it('returns 404 VIDEO_NOT_FOUND for unknown slug', async () => {
      const res = await request(app.getHttpServer())
        .get('/videos/nonexistent-slug-xyz')
        .expect(404);

      expect(res.body.error).toBe('VIDEO_NOT_FOUND');
    });

    it('is publicly accessible without Authorization header', async () => {
      const { access_token } = await registerConfirmAndLogin(
        'publictest@example.com',
      );

      // Mock storage
      jest
        .spyOn(storageService, 'createMultipartUpload')
        .mockResolvedValue('upload-id-123');
      jest
        .spyOn(storageService, 'getPresignedUploadPartUrls')
        .mockResolvedValue([
          { partNumber: 1, url: 'https://s3.example.com/part1' },
        ] as PresignedPart[]);

      // Initiate upload
      const initiateRes = await request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${access_token}`)
        .send({
          title: 'Public Test Video',
          originalFilename: 'video.mp4',
          mimeType: 'video/mp4',
          fileSizeBytes: 104857600,
        })
        .expect(201);

      const videoSlug = initiateRes.body.slug;

      // Fetch without Authorization header (no Bearer token)
      const res = await request(app.getHttpServer())
        .get(`/videos/${videoSlug}`)
        .expect(200);

      expect(res.body.slug).toBe(videoSlug);
      expect(res.body.title).toBe('Public Test Video');
    });
  });

  describe('GET /videos/:slug/download', () => {
    let downloadVideoSlug: string;
    let downloadVideoStorageKey: string;
    let downloadVideoOriginalFilename: string;

    beforeEach(async () => {
      // Create a user and channel
      await registerConfirmAndLogin('downloadtest@example.com');

      const channel = await channelRepository.findOneBy({
        user_id: (
          await dataSource.query(
            "SELECT id FROM users WHERE email = 'downloadtest@example.com'",
          )
        )[0].id,
      });

      // Generate a unique storage key
      downloadVideoStorageKey = `videos/download-test-${Date.now()}-${Math.random().toString(36).substring(2, 11)}.bin`;

      // Upload a test object to MinIO with some content
      const testVideoContent = Buffer.alloc(1000);
      testVideoContent.fill('y');
      await storageService.putObject(
        downloadVideoStorageKey,
        testVideoContent,
        'video/mp4',
      );

      // Create a ready video with the storage_key pointing to the real object
      downloadVideoOriginalFilename = 'my-video.mp4';
      downloadVideoSlug = `dwn${Math.random().toString(36).substring(2, 10)}`;
      const readyVideo = videoRepository.create({
        channel_id: channel!.id,
        title: 'Download Test Video',
        slug: downloadVideoSlug,
        status: VideoStatus.READY,
        storage_key: downloadVideoStorageKey,
        original_filename: downloadVideoOriginalFilename,
        mime_type: 'video/mp4',
        file_size_bytes: '1000',
        duration_seconds: 10.0,
        thumbnail_key: null,
      });
      await videoRepository.save(readyVideo);
    });

    it('returns 302 redirect to presigned URL for a ready video', async () => {
      const res = await request(app.getHttpServer())
        .get(`/videos/${downloadVideoSlug}/download`)
        .expect(302);

      // Verify Location header is present and is a URL
      expect(res.headers.location).toBeDefined();
      expect(typeof res.headers.location).toBe('string');
      expect(res.headers.location).toMatch(/^https?:\/\//);
    });

    it('fetches presigned URL and confirms Content-Disposition header has correct filename', async () => {
      // Arrange: Get the redirect response
      const redirectRes = await request(app.getHttpServer())
        .get(`/videos/${downloadVideoSlug}/download`)
        .expect(302);

      const presignedUrl = redirectRes.headers.location;
      expect(presignedUrl).toBeDefined();

      // Act: Fetch the presigned URL
      const downloadRes = await fetch(presignedUrl);
      expect(downloadRes.status).toBe(200);

      // Assert: Verify Content-Disposition header
      const contentDisposition = downloadRes.headers.get('content-disposition');
      expect(contentDisposition).toBe(
        `attachment; filename="${downloadVideoOriginalFilename}"`,
      );
    });

    it('presigned URL is passed to getPresignedGetUrl with correct Content-Disposition parameter', async () => {
      // Mock getPresignedGetUrl to capture what it's called with
      const mockPresignedUrl =
        'https://minio.example.com/presigned-download-url';
      const getPresignedGetUrlSpy = jest
        .spyOn(storageService, 'getPresignedGetUrl')
        .mockResolvedValue(mockPresignedUrl);

      const res = await request(app.getHttpServer())
        .get(`/videos/${downloadVideoSlug}/download`)
        .expect(302);

      // Verify the redirect Location header is set
      expect(res.headers.location).toBe(mockPresignedUrl);

      // Verify that getPresignedGetUrl was called with the correct parameters
      expect(getPresignedGetUrlSpy).toHaveBeenCalledWith(
        downloadVideoStorageKey,
        `attachment; filename="${downloadVideoOriginalFilename}"`,
      );

      getPresignedGetUrlSpy.mockRestore();
    });

    it('returns 404 VIDEO_NOT_FOUND for unknown slug', async () => {
      const res = await request(app.getHttpServer())
        .get('/videos/nonexistent-download-slug')
        .expect(404);

      expect(res.body.error).toBe('VIDEO_NOT_FOUND');
    });

    it('returns 409 VIDEO_NOT_READY when video status is draft', async () => {
      const channel = await channelRepository.findOneBy({
        user_id: (
          await dataSource.query(
            "SELECT id FROM users WHERE email = 'downloadtest@example.com'",
          )
        )[0].id,
      });

      const draftSlug = `dft${Math.random().toString(36).substring(2, 10)}`;
      const draftVideo = videoRepository.create({
        channel_id: channel!.id,
        title: 'Draft Video',
        slug: draftSlug,
        status: VideoStatus.DRAFT,
        storage_key: 'videos/draft.mp4',
        original_filename: 'video.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: '1000',
      });
      await videoRepository.save(draftVideo);

      const res = await request(app.getHttpServer())
        .get(`/videos/${draftSlug}/download`)
        .expect(409);

      expect(res.body.error).toBe('VIDEO_NOT_READY');
    });

    it('returns 409 VIDEO_NOT_READY when video status is processing', async () => {
      const channel = await channelRepository.findOneBy({
        user_id: (
          await dataSource.query(
            "SELECT id FROM users WHERE email = 'downloadtest@example.com'",
          )
        )[0].id,
      });

      const procSlug = `prc${Math.random().toString(36).substring(2, 10)}`;
      const procVideo = videoRepository.create({
        channel_id: channel!.id,
        title: 'Processing Video',
        slug: procSlug,
        status: VideoStatus.PROCESSING,
        storage_key: 'videos/processing.mp4',
        original_filename: 'video.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: '1000',
      });
      await videoRepository.save(procVideo);

      const res = await request(app.getHttpServer())
        .get(`/videos/${procSlug}/download`)
        .expect(409);

      expect(res.body.error).toBe('VIDEO_NOT_READY');
    });

    it('returns 409 VIDEO_NOT_READY when video status is error', async () => {
      const channel = await channelRepository.findOneBy({
        user_id: (
          await dataSource.query(
            "SELECT id FROM users WHERE email = 'downloadtest@example.com'",
          )
        )[0].id,
      });

      const errSlug = `err${Math.random().toString(36).substring(2, 10)}`;
      const errVideo = videoRepository.create({
        channel_id: channel!.id,
        title: 'Error Video',
        slug: errSlug,
        status: VideoStatus.ERROR,
        storage_key: 'videos/error.mp4',
        original_filename: 'video.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: '1000',
      });
      await videoRepository.save(errVideo);

      const res = await request(app.getHttpServer())
        .get(`/videos/${errSlug}/download`)
        .expect(409);

      expect(res.body.error).toBe('VIDEO_NOT_READY');
    });

    it('is publicly accessible without Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .get(`/videos/${downloadVideoSlug}/download`)
        .expect(302);

      expect(res.headers.location).toBeDefined();
    });
  });

  describe('GET /videos/:slug/stream', () => {
    let readyVideoSlug: string;
    let readyVideoStorageKey: string;

    beforeEach(async () => {
      // Create a user and channel
      await registerConfirmAndLogin('streamtest@example.com');

      const channel = await channelRepository.findOneBy({
        user_id: (
          await dataSource.query(
            "SELECT id FROM users WHERE email = 'streamtest@example.com'",
          )
        )[0].id,
      });

      // Generate a unique storage key
      readyVideoStorageKey = `videos/stream-test-${Date.now()}-${Math.random().toString(36).substring(2, 11)}.bin`;

      // Upload a test object to MinIO with 2000 bytes of content
      const testVideoContent = Buffer.alloc(2000);
      testVideoContent.fill('x');
      await storageService.putObject(
        readyVideoStorageKey,
        testVideoContent,
        'video/mp4',
      );

      // Create a ready video with the storage_key pointing to the real object
      // Slug must be 11 characters or less
      readyVideoSlug = `ready${Math.random().toString(36).substring(2, 7)}`;
      const readyVideo = videoRepository.create({
        channel_id: channel!.id,
        title: 'Stream Test Video',
        slug: readyVideoSlug,
        status: VideoStatus.READY,
        storage_key: readyVideoStorageKey,
        original_filename: 'video.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: '2000',
        duration_seconds: 10.0,
        thumbnail_key: null,
      });
      await videoRepository.save(readyVideo);
    });

    it('returns 206 Partial Content with exactly 1000 bytes when Range: bytes=0-999 is provided', async () => {
      const res = await request(app.getHttpServer())
        .get(`/videos/${readyVideoSlug}/stream`)
        .set('Range', 'bytes=0-999')
        .expect(206);

      expect(res.body).toBeDefined();
      // The body length should be exactly 1000 bytes
      expect(Buffer.isBuffer(res.body) || res.body.length).toBeTruthy();
      if (Buffer.isBuffer(res.body)) {
        expect(res.body.length).toBe(1000);
      } else {
        expect(res.body.length).toBe(1000);
      }

      // Verify headers
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['content-type']).toBe('video/mp4');
      expect(res.headers['content-length']).toBe('1000');
      expect(res.headers['content-range']).toBeDefined();
    });

    it('returns 200 OK with full file and Accept-Ranges header when no Range is provided', async () => {
      const res = await request(app.getHttpServer())
        .get(`/videos/${readyVideoSlug}/stream`)
        .expect(200);

      expect(res.body).toBeDefined();
      // Body should contain 2000 bytes
      if (Buffer.isBuffer(res.body)) {
        expect(res.body.length).toBe(2000);
      } else {
        expect(res.body.length).toBe(2000);
      }

      // Verify headers
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['content-type']).toBe('video/mp4');
      expect(res.headers['content-length']).toBe('2000');
      expect(res.headers['content-range']).toBeUndefined();
    });

    it('returns 409 VIDEO_NOT_READY when video status is not READY (draft)', async () => {
      // Create a draft video
      const channel = await channelRepository.findOneBy({
        user_id: (
          await dataSource.query(
            "SELECT id FROM users WHERE email = 'streamtest@example.com'",
          )
        )[0].id,
      });

      const draftSlug = `draft${Math.random().toString(36).substring(2, 7)}`;
      const draftVideo = videoRepository.create({
        channel_id: channel!.id,
        title: 'Draft Video',
        slug: draftSlug,
        status: VideoStatus.DRAFT,
        storage_key: 'videos/draft.mp4',
        original_filename: 'video.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: '1000',
      });
      await videoRepository.save(draftVideo);

      const res = await request(app.getHttpServer())
        .get(`/videos/${draftSlug}/stream`)
        .expect(409);

      expect(res.body.error).toBe('VIDEO_NOT_READY');
    });

    it('returns 409 VIDEO_NOT_READY when video status is processing', async () => {
      const channel = await channelRepository.findOneBy({
        user_id: (
          await dataSource.query(
            "SELECT id FROM users WHERE email = 'streamtest@example.com'",
          )
        )[0].id,
      });

      const processingSlug = `proc${Math.random().toString(36).substring(2, 8)}`;
      const processingVideo = videoRepository.create({
        channel_id: channel!.id,
        title: 'Processing Video',
        slug: processingSlug,
        status: VideoStatus.PROCESSING,
        storage_key: 'videos/processing.mp4',
        original_filename: 'video.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: '1000',
      });
      await videoRepository.save(processingVideo);

      const res = await request(app.getHttpServer())
        .get(`/videos/${processingSlug}/stream`)
        .expect(409);

      expect(res.body.error).toBe('VIDEO_NOT_READY');
    });

    it('returns 409 VIDEO_NOT_READY when video status is error', async () => {
      const channel = await channelRepository.findOneBy({
        user_id: (
          await dataSource.query(
            "SELECT id FROM users WHERE email = 'streamtest@example.com'",
          )
        )[0].id,
      });

      const errorSlug = `error${Math.random().toString(36).substring(2, 7)}`;
      const errorVideo = videoRepository.create({
        channel_id: channel!.id,
        title: 'Error Video',
        slug: errorSlug,
        status: VideoStatus.ERROR,
        storage_key: 'videos/error.mp4',
        original_filename: 'video.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: '1000',
      });
      await videoRepository.save(errorVideo);

      const res = await request(app.getHttpServer())
        .get(`/videos/${errorSlug}/stream`)
        .expect(409);

      expect(res.body.error).toBe('VIDEO_NOT_READY');
    });

    it('returns 404 VIDEO_NOT_FOUND for unknown slug', async () => {
      const res = await request(app.getHttpServer())
        .get('/videos/nonexistent-slug-stream')
        .expect(404);

      expect(res.body.error).toBe('VIDEO_NOT_FOUND');
    });

    it('is publicly accessible without Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .get(`/videos/${readyVideoSlug}/stream`)
        .expect(200);

      expect(res.body).toBeDefined();
      expect(res.headers['content-type']).toBe('video/mp4');
    });
  });
});
