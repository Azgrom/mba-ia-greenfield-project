import { registerAs } from '@nestjs/config';

export default registerAs('queue', () => ({
  redisHost: process.env.REDIS_HOST || 'redis',
  redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
  videoProcessingAttempts: parseInt(
    process.env.VIDEO_PROCESSING_ATTEMPTS || '3',
    10,
  ),
  videoWorkerConcurrency: parseInt(
    process.env.VIDEO_WORKER_CONCURRENCY || '2',
    10,
  ),
}));
