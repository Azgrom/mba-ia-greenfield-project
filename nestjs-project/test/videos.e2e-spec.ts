import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { Video } from '../src/videos/entities/video.entity';
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
});
