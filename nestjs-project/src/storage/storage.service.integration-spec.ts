import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

describe('StorageService (integration)', () => {
  let app: TestingModule;
  let storageService: StorageService;

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();
    storageService = app.get(StorageService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('multipart upload lifecycle', () => {
    it('should create a multipart upload, presign part URLs, upload parts, and complete', async () => {
      // Arrange
      const testKey = `test-multipart-${Date.now()}.bin`;
      const contentType = 'application/octet-stream';
      // MinIO requires each part (except last) to be at least 5MB. Use 6MB for safety.
      const part1Data = Buffer.alloc(6 * 1024 * 1024);
      part1Data.fill('a');
      const part2Data = Buffer.from('This is the final part'); // Last part can be smaller
      const expectedContent = Buffer.concat([part1Data, part2Data]);

      // Act 1: Create multipart upload
      const uploadId = await storageService.createMultipartUpload(
        testKey,
        contentType,
      );
      expect(uploadId).toBeDefined();
      expect(uploadId.length).toBeGreaterThan(0);

      // Act 2: Get presigned URLs for 2 parts
      const presignedParts = await storageService.getPresignedUploadPartUrls(
        testKey,
        uploadId,
        2,
      );
      expect(presignedParts).toHaveLength(2);
      expect(presignedParts[0].partNumber).toBe(1);
      expect(presignedParts[1].partNumber).toBe(2);

      // Act 3: Upload each part using the presigned URL
      const uploadedParts: { partNumber: number; etag: string }[] = [];

      for (const part of presignedParts) {
        const response = await fetch(part.url, {
          method: 'PUT',
          body: part.partNumber === 1 ? part1Data : part2Data,
        });
        expect(response.status).toBe(200);
        const etag = response.headers.get('etag');
        expect(etag).toBeDefined();
        uploadedParts.push({ partNumber: part.partNumber, etag: etag! });
      }

      // Act 4: Complete the multipart upload
      await storageService.completeMultipartUpload(
        testKey,
        uploadId,
        uploadedParts,
      );

      // Assert: Verify the file is retrievable and byte-identical
      const retrievedObject = await storageService.getObjectRange(testKey);
      expect(retrievedObject.statusCode).toBe(200);

      const chunks: Buffer[] = [];
      for await (const chunk of retrievedObject.body) {
        chunks.push(chunk as Buffer);
      }
      const retrievedContent = Buffer.concat(chunks);

      expect(retrievedContent).toEqual(expectedContent);
      expect(retrievedContent.length).toBe(expectedContent.length);
    });
  });

  describe('getObjectRange', () => {
    let testKey: string;

    beforeEach(async () => {
      testKey = `test-range-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.bin`;
      // Upload a test file to use for range tests
      const testData = Buffer.from('0123456789'.repeat(20)); // 200 bytes
      await storageService.putObject(
        testKey,
        testData,
        'application/octet-stream',
      );
    });

    it('should return full object with statusCode 200 when no range is specified', async () => {
      // Act
      const result = await storageService.getObjectRange(testKey);

      // Assert
      expect(result.statusCode).toBe(200);
      expect(result.contentLength).toBe(200);
      expect(result.contentRange).toBeUndefined();

      const chunks: Buffer[] = [];
      for await (const chunk of result.body) {
        chunks.push(chunk as Buffer);
      }
      const content = Buffer.concat(chunks);
      expect(content.length).toBe(200);
    });

    it('should return partial object with statusCode 206 when range is specified', async () => {
      // Act
      const result = await storageService.getObjectRange(testKey, 'bytes=0-99');

      // Assert
      expect(result.statusCode).toBe(206);
      expect(result.contentLength).toBe(100);
      expect(result.contentRange).toBeDefined();

      const chunks: Buffer[] = [];
      for await (const chunk of result.body) {
        chunks.push(chunk as Buffer);
      }
      const content = Buffer.concat(chunks);
      expect(content.length).toBe(100);
    });

    it('should return exactly 100 bytes for range=bytes=0-99', async () => {
      // Act
      const result = await storageService.getObjectRange(testKey, 'bytes=0-99');
      const chunks: Buffer[] = [];
      for await (const chunk of result.body) {
        chunks.push(chunk as Buffer);
      }
      const content = Buffer.concat(chunks);

      // Assert
      expect(content.length).toBe(100);
      expect(result.statusCode).toBe(206);
    });
  });

  describe('getPresignedGetUrl', () => {
    let testKey: string;

    beforeEach(async () => {
      testKey = `test-presigned-get-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.bin`;
      // Upload a test file
      const testData = Buffer.from('Test content for presigned GET');
      await storageService.putObject(
        testKey,
        testData,
        'application/octet-stream',
      );
    });

    it('should return a valid presigned URL that can be used to download the object', async () => {
      // Act 1: Get presigned URL
      const presignedUrl = await storageService.getPresignedGetUrl(testKey);
      expect(presignedUrl).toBeDefined();
      expect(presignedUrl).toContain('http://minio:9000');

      // Act 2: Fetch using the presigned URL (no auth headers needed)
      const response = await fetch(presignedUrl);
      expect(response.status).toBe(200);
      const content = await response.text();

      // Assert
      expect(content).toBe('Test content for presigned GET');
    });

    it('should return a presigned URL with responseContentDisposition parameter', async () => {
      // Act
      const presignedUrl = await storageService.getPresignedGetUrl(
        testKey,
        'attachment; filename="test.bin"',
      );

      // Assert
      expect(presignedUrl).toBeDefined();
      expect(presignedUrl).toContain('http://minio:9000');
      expect(presignedUrl).toContain('response-content-disposition');
    });
  });

  describe('abortMultipartUpload', () => {
    it('should clean up incomplete upload and leave no partial object', async () => {
      // Arrange: Start a multipart upload
      const testKey = `test-abort-${Date.now()}.bin`;
      const contentType = 'application/octet-stream';
      const uploadId = await storageService.createMultipartUpload(
        testKey,
        contentType,
      );

      // Get presigned URLs and upload the first part
      const presignedParts = await storageService.getPresignedUploadPartUrls(
        testKey,
        uploadId,
        2,
      );
      // MinIO requires parts to be at least 5MB (except last part)
      const part1Data = Buffer.alloc(5 * 1024 * 1024);
      part1Data.fill('x');
      const uploadResponse = await fetch(presignedParts[0].url, {
        method: 'PUT',
        body: part1Data,
      });
      expect(uploadResponse.status).toBe(200);

      // Act: Abort the multipart upload
      await storageService.abortMultipartUpload(testKey, uploadId);

      // Assert: Verify no object exists at the key
      let objectExists = false;
      try {
        await storageService.getObjectRange(testKey);
        objectExists = true;
      } catch {
        // Expected: object should not exist after abort
        // The S3 client throws a NoSuchKey error which results in an exception
        objectExists = false;
      }
      expect(objectExists).toBe(false);
    });
  });

  describe('putObject', () => {
    let testKey: string;

    beforeEach(() => {
      testKey = `test-put-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.bin`;
    });

    it('should upload an object directly via PUT', async () => {
      // Arrange
      const testData = Buffer.from('Direct PUT object content');
      const contentType = 'application/octet-stream';

      // Act
      await storageService.putObject(testKey, testData, contentType);

      // Assert
      const result = await storageService.getObjectRange(testKey);
      expect(result.statusCode).toBe(200);

      const chunks: Buffer[] = [];
      for await (const chunk of result.body) {
        chunks.push(chunk as Buffer);
      }
      const retrievedContent = Buffer.concat(chunks);

      expect(retrievedContent).toEqual(testData);
    });
  });
});
