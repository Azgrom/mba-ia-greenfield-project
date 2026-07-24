import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.STORAGE_ENDPOINT || 'http://minio:9000',
  region: process.env.STORAGE_REGION || 'us-east-1',
  accessKeyId: process.env.STORAGE_ACCESS_KEY || 'streamtube',
  secretAccessKey: process.env.STORAGE_SECRET_KEY || 'streamtube123',
  bucket: process.env.STORAGE_BUCKET || 'streamtube',
  presignedUrlExpirationSeconds: parseInt(
    process.env.STORAGE_PRESIGNED_URL_EXPIRATION_SECONDS || '3600',
    10,
  ),
  uploadPartSizeBytes: parseInt(
    process.env.VIDEO_UPLOAD_PART_SIZE_BYTES || '104857600',
    10,
  ),
  maxFileSizeBytes: parseInt(
    process.env.VIDEO_MAX_FILE_SIZE_BYTES || '10737418240',
    10,
  ),
}));
