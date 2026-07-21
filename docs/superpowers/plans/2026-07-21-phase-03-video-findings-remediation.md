# Phase 03 Video Findings Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the validation gaps found in the `dev` vs `main` Phase 03 video upload and processing branch so the branch can be revalidated against the project Definition of Done.

**Architecture:** Keep the upload/processing runtime design intact: API-owned metadata and presigned multipart upload, MinIO/S3 storage, BullMQ/Redis queue, and separate NestJS video worker. The remediation is intentionally narrow: fix broken validation gates, add one missing end-to-end queue-consumption proof, wire or remove dead configuration, and complete the missing phase artifacts.

**Tech Stack:** NestJS 11, TypeScript, TypeORM, PostgreSQL 17, MinIO/S3 via AWS SDK v3, Redis, BullMQ, `@nestjs/bullmq`, FFmpeg/ffprobe via `fluent-ffmpeg`.

## Global Constraints

- Run every `npm`, `npx`, `node`, `tsc`, and Jest command inside Docker, not on the host, per `nestjs-project/CLAUDE.md`.
- Use one-off Compose containers from `nestjs-project/` when existing containers are stale: `docker compose run --rm --workdir /home/node/app ...`.
- Supply required app environment variables for validation commands when `.env` is absent: `DB_HOST=db DB_USERNAME=streamtube DB_PASSWORD=streamtube DB_NAME=streamtube JWT_SECRET=test-access-secret JWT_REFRESH_SECRET=test-refresh-secret STORAGE_ACCESS_KEY=streamtube STORAGE_SECRET_KEY=streamtube123`.
- Do not change the upload strategy: the API must not receive video bytes; clients upload directly to storage through presigned multipart URLs.
- Do not change public route contracts: `/videos/:slug`, `/videos/:slug/stream`, and `/videos/:slug/download` stay slug-based and public, with stream/download requiring `status = ready`.
- Keep commits small: one commit per task.
- Current docs checked with Context7 on 2026-07-21: `/nestjs/bull` confirms `@Processor(queueName, workerOptions)` accepts worker options such as `concurrency`; `/taskforcesh/bullmq` confirms BullMQ `WorkerOptions.concurrency` defaults to `1` and `Job.waitUntilFinished(queueEvents, ttl)` can wait for queue-driven completion.

---

## File Structure

- Modify `nestjs-project/src/database/migrations.integration-spec.ts`
  - Responsibility: deterministic migration test cleanup and migration verification.
- Modify `nestjs-project/src/videos/videos.service.ts`
  - Responsibility: video upload orchestration and slug collision handling without lint violations.
- Modify `nestjs-project/test/videos.e2e-spec.ts`
  - Responsibility: HTTP-level video endpoint coverage without new lint debt.
- Create `nestjs-project/src/video-worker/video-processing.queue.integration-spec.ts`
  - Responsibility: prove a real BullMQ job enqueued through `VideoQueueService` is consumed by `VideoProcessingProcessor` and transitions a real video to `ready`.
- Modify `nestjs-project/src/video-worker/video-processing.processor.ts`
  - Responsibility: worker processing behavior and configured local concurrency.
- Modify `nestjs-project/src/video-worker/video-processing.processor.integration-spec.ts`
  - Responsibility: keep direct processor coverage compatible with the concurrency helper.
- Create `docs/phases/phase-03-videos/context.md`
  - Responsibility: concise implementation context for Phase 03.
- Create `docs/phases/phase-03-videos/validation.md`
  - Responsibility: final validation evidence for Phase 03.
- Modify `docs/phases/phase-03-videos/progress.md`
  - Responsibility: remove stale contradictions and record remediation results.

---

### Task 1: Fix Migration Suite Cleanup Ordering

**Files:**
- Modify: `nestjs-project/src/database/migrations.integration-spec.ts:34-42`

**Interfaces:**
- Consumes: existing `DataSource` from `createTestDataSource(...)`.
- Produces: deterministic cleanup before migration tests, with no concurrent enum/table drop race.

- [ ] **Step 1: Reproduce the existing validation failure**

Run:

```bash
docker compose run --rm --workdir /home/node/app \
  --env DB_HOST=db \
  --env DB_USERNAME=streamtube \
  --env DB_PASSWORD=streamtube \
  --env DB_NAME=streamtube \
  --env JWT_SECRET=test-access-secret \
  --env JWT_REFRESH_SECRET=test-refresh-secret \
  --env STORAGE_ACCESS_KEY=streamtube \
  --env STORAGE_SECRET_KEY=streamtube123 \
  nestjs-api npm test -- --runInBand src/database/migrations.integration-spec.ts
```

Expected before the fix on a polluted shared DB: FAIL with either `cannot drop type verification_tokens_type_enum because other objects depend on it` or `type "verification_tokens_type_enum" already exists`.

- [ ] **Step 2: Replace concurrent cleanup with ordered cleanup**

In `nestjs-project/src/database/migrations.integration-spec.ts`, replace the `Promise.all([...])` block in `beforeAll` with this exact ordered sequence:

```typescript
    for (const table of MANAGED_TABLES) {
      await dataSource.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
    await dataSource.query(`DROP TABLE IF EXISTS "migrations" CASCADE`);
    await dataSource.query(
      `DROP TYPE IF EXISTS "public"."verification_tokens_type_enum"`,
    );
```

Rationale: the previous `Promise.all` made Postgres execute table drops and enum drop concurrently. The enum can still be depended on by `verification_tokens` if that table drop has not completed yet.

- [ ] **Step 3: Run the migration spec**

Run:

```bash
docker compose run --rm --workdir /home/node/app \
  --env DB_HOST=db \
  --env DB_USERNAME=streamtube \
  --env DB_PASSWORD=streamtube \
  --env DB_NAME=streamtube \
  --env JWT_SECRET=test-access-secret \
  --env JWT_REFRESH_SECRET=test-refresh-secret \
  --env STORAGE_ACCESS_KEY=streamtube \
  --env STORAGE_SECRET_KEY=streamtube123 \
  nestjs-api npm test -- --runInBand src/database/migrations.integration-spec.ts
```

Expected: PASS, `1 passed` suite.

- [ ] **Step 4: Commit**

```bash
git add nestjs-project/src/database/migrations.integration-spec.ts
git commit -m "test: make migration cleanup deterministic"
```

---

### Task 2: Remove New Phase 03 Lint Debt

**Files:**
- Modify: `nestjs-project/src/videos/videos.service.ts:10-33`
- Modify: `nestjs-project/test/videos.e2e-spec.ts`

**Interfaces:**
- Consumes: existing `VideosService` public methods and existing Supertest response bodies.
- Produces: Phase 03 files that pass ESLint without relying on the pre-existing baseline debt elsewhere.

- [ ] **Step 1: Run targeted lint to capture the current Phase 03 failures**

Run:

```bash
docker compose run --rm --workdir /home/node/app \
  --env DB_HOST=db \
  --env DB_USERNAME=streamtube \
  --env DB_PASSWORD=streamtube \
  --env DB_NAME=streamtube \
  --env JWT_SECRET=test-access-secret \
  --env JWT_REFRESH_SECRET=test-refresh-secret \
  --env STORAGE_ACCESS_KEY=streamtube \
  --env STORAGE_SECRET_KEY=streamtube123 \
  nestjs-api npx eslint \
  src/videos/videos.service.ts \
  test/videos.e2e-spec.ts
```

Expected before the fix: FAIL, including `PresignedPartDto is defined but never used` and unsafe `res.body` member access in `test/videos.e2e-spec.ts`.

- [ ] **Step 2: Fix `videos.service.ts` imports and Postgres error typing**

In `nestjs-project/src/videos/videos.service.ts`, replace the typed import block:

```typescript
import type {
  InitiateUploadResponseDto,
  PresignedPartDto,
} from './dto/initiate-upload-response.dto';
```

with:

```typescript
import type { InitiateUploadResponseDto } from './dto/initiate-upload-response.dto';
```

Then replace `isPgUniqueViolationOnColumn` with:

```typescript
type PgDriverError = {
  code?: unknown;
  detail?: unknown;
};

function isPgUniqueViolationOnColumn(err: unknown, column: string): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const driverError = err.driverError as PgDriverError;
  return (
    driverError.code === PG_UNIQUE_VIOLATION &&
    typeof driverError.detail === 'string' &&
    driverError.detail.includes(column)
  );
}
```

- [ ] **Step 3: Add typed Supertest body helpers in `test/videos.e2e-spec.ts`**

Add these interfaces and helper immediately after the imports in `nestjs-project/test/videos.e2e-spec.ts`:

```typescript
interface AuthTokensBody {
  access_token: string;
  refresh_token: string;
}

interface InitiateVideoBody {
  id: string;
  slug: string;
  uploadId: string;
  parts: Array<{ partNumber: number; url: string }>;
}

interface CompleteUploadBody {
  id: string;
  slug: string;
  status: string;
}

interface VideoDetailBody {
  id: string;
  slug: string;
  title: string;
  status: string;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  createdAt: string;
}

interface ErrorBody {
  error: string;
}

function responseBody<T>(res: request.Response): T {
  return res.body as unknown as T;
}
```

- [ ] **Step 4: Replace unsafe response-body usage**

In `registerConfirmAndLogin`, replace direct `res.body` access:

```typescript
    return {
      access_token: res.body.access_token,
      refresh_token: res.body.refresh_token,
    };
```

with:

```typescript
    return responseBody<AuthTokensBody>(res);
```

In each test, assign the expected response shape once and assert against that typed object. Use these exact patterns:

```typescript
      const body = responseBody<InitiateVideoBody>(res);
      expect(body.id).toBeDefined();
      expect(typeof body.id).toBe('string');
      expect(body.slug).toBeDefined();
      expect(typeof body.slug).toBe('string');
      expect(body.uploadId).toBe('upload-id-123');
      expect(Array.isArray(body.parts)).toBe(true);
      expect(body.parts.length).toBeGreaterThan(0);
      expect(body.parts[0]).toHaveProperty('partNumber');
      expect(body.parts[0]).toHaveProperty('url');
```

```typescript
      const body = responseBody<CompleteUploadBody>(completeRes);
      expect(body.id).toBe(videoId);
      expect(body.slug).toBeDefined();
      expect(body.status).toBe('processing');
```

```typescript
      const body = responseBody<VideoDetailBody>(res);
      expect(body.slug).toBe(videoSlug);
      expect(body.title).toBe('Public Test Video');
```

```typescript
      const body = responseBody<ErrorBody>(res);
      expect(body.error).toBe('VALIDATION_ERROR');
```

Replace every direct `res.body.<property>`, `initiateRes.body.<property>`, and `completeRes.body.<property>` access in `test/videos.e2e-spec.ts` with one of these typed-body variables. For direct SQL result access, use a typed query result:

```typescript
      const users = await dataSource.query<Array<{ id: string }>>(
        "SELECT id FROM users WHERE email = 'getready@example.com'",
      );
      const channel = await channelRepository.findOneBy({
        user_id: users[0].id,
      });
```

- [ ] **Step 5: Run targeted lint again**

Run:

```bash
docker compose run --rm --workdir /home/node/app \
  --env DB_HOST=db \
  --env DB_USERNAME=streamtube \
  --env DB_PASSWORD=streamtube \
  --env DB_NAME=streamtube \
  --env JWT_SECRET=test-access-secret \
  --env JWT_REFRESH_SECRET=test-refresh-secret \
  --env STORAGE_ACCESS_KEY=streamtube \
  --env STORAGE_SECRET_KEY=streamtube123 \
  nestjs-api npx eslint \
  src/videos/videos.service.ts \
  test/videos.e2e-spec.ts
```

Expected: exit `0`.

- [ ] **Step 6: Run affected tests**

Run:

```bash
docker compose run --rm --workdir /home/node/app \
  --env DB_HOST=db \
  --env DB_USERNAME=streamtube \
  --env DB_PASSWORD=streamtube \
  --env DB_NAME=streamtube \
  --env JWT_SECRET=test-access-secret \
  --env JWT_REFRESH_SECRET=test-refresh-secret \
  --env STORAGE_ACCESS_KEY=streamtube \
  --env STORAGE_SECRET_KEY=streamtube123 \
  nestjs-api npm test -- --runInBand src/videos/videos.service.spec.ts
```

Expected: PASS.

Run:

```bash
docker compose run --rm --workdir /home/node/app \
  --env DB_HOST=db \
  --env DB_USERNAME=streamtube \
  --env DB_PASSWORD=streamtube \
  --env DB_NAME=streamtube \
  --env JWT_SECRET=test-access-secret \
  --env JWT_REFRESH_SECRET=test-refresh-secret \
  --env STORAGE_ACCESS_KEY=streamtube \
  --env STORAGE_SECRET_KEY=streamtube123 \
  nestjs-api npm run test:e2e -- videos.e2e-spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add nestjs-project/src/videos/videos.service.ts nestjs-project/test/videos.e2e-spec.ts
git commit -m "test: remove phase 03 video lint debt"
```

---

### Task 3: Add Real BullMQ Worker-Consumption Integration Coverage

**Files:**
- Create: `nestjs-project/src/video-worker/video-processing.queue.integration-spec.ts`

**Interfaces:**
- Consumes: `VideoQueueService.enqueueProcessing(videoId: string): Promise<void>`, `VideoProcessingProcessor` registered through `@Processor(VIDEO_PROCESSING_QUEUE)`, and real `StorageService.putObject(...)`.
- Produces: automated proof that a real BullMQ job is consumed by the worker and updates the video row to `ready`.

- [ ] **Step 1: Write the failing integration spec**

Create `nestjs-project/src/video-worker/video-processing.queue.integration-spec.ts` with this content:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Queue, QueueEvents } from 'bullmq';
import { DataSource } from 'typeorm';
import type { Repository } from 'typeorm';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import ffmpegPath from 'ffmpeg-static';
import appConfig from '../config/app.config';
import databaseConfig from '../config/database.config';
import storageConfig from '../config/storage.config';
import queueConfig from '../config/queue.config';
import { envValidationSchema } from '../config/env.validation';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import { cleanAllTables } from '../test/create-test-data-source';
import { StorageModule } from '../storage/storage.module';
import { StorageService } from '../storage/storage.service';
import { VideoQueueService } from '../queue/video-queue.service';
import {
  PROCESS_VIDEO_JOB,
  VIDEO_PROCESSING_QUEUE,
  type ProcessVideoJobData,
} from '../queue/video-queue.constants';
import { VideoProcessingProcessor } from './video-processing.processor';

describe('Video processing queue (integration)', () => {
  let app: TestingModule;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let storageService: StorageService;
  let videoQueueService: VideoQueueService;
  let queue: Queue<ProcessVideoJobData>;
  let queueEvents: QueueEvents;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = '/tmp/video-processing-queue-test';
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
        TypeOrmModule.forFeature([User, Channel, Video]),
        BullModule.forRootAsync({
          imports: [ConfigModule.forFeature(queueConfig)],
          inject: [queueConfig.KEY],
          useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
            connection: {
              host: cfg.redisHost,
              port: cfg.redisPort,
            },
          }),
        }),
        BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
        StorageModule,
      ],
      providers: [VideoQueueService, VideoProcessingProcessor],
    }).compile();

    await app.init();

    dataSource = app.get(DataSource);
    videoRepository = app.get(getRepositoryToken(Video));
    userRepository = app.get(getRepositoryToken(User));
    channelRepository = app.get(getRepositoryToken(Channel));
    storageService = app.get(StorageService);
    videoQueueService = app.get(VideoQueueService);
    queue = app.get<Queue<ProcessVideoJobData>>(
      getQueueToken(VIDEO_PROCESSING_QUEUE),
    );
    const cfg = queueConfig();
    queueEvents = new QueueEvents(VIDEO_PROCESSING_QUEUE, {
      connection: { host: cfg.redisHost, port: cfg.redisPort },
    });
    await queueEvents.waitUntilReady();
  }, 30000);

  afterAll(async () => {
    await queueEvents.close();
    await queue.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
    await app.close();
  }, 30000);

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    await queue.drain(true);
  });

  it('consumes an enqueued process-video job and marks the video ready', async () => {
    const user = await userRepository.save(
      userRepository.create({
        email: `queue-flow-${randomUUID()}@example.com`,
        password: 'hashedpassword',
        is_confirmed: true,
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        user_id: user.id,
        name: 'Queue Flow Channel',
        nickname: `queue-${randomUUID().slice(0, 8)}`,
      }),
    );

    const testVideoPath = join(tmpDir, `queue-${randomUUID()}.mp4`);
    execSync(
      `${ffmpegPath} -f lavfi -i testsrc=s=320x240:d=1 -y "${testVideoPath}" -loglevel quiet`,
    );
    const videoBuffer = await fs.readFile(testVideoPath);

    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        title: 'Queue Consumed Video',
        slug: `q${randomUUID().replace(/-/g, '').slice(0, 10)}`,
        status: VideoStatus.PROCESSING,
        storage_key: `videos/${channel.id}/${randomUUID()}/original.mp4`,
        original_filename: 'queue.mp4',
        mime_type: 'video/mp4',
        file_size_bytes: videoBuffer.length.toString(),
      }),
    );
    await storageService.putObject(video.storage_key, videoBuffer, 'video/mp4');

    await videoQueueService.enqueueProcessing(video.id);
    const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
    const job = jobs.find(
      (candidate) =>
        candidate.name === PROCESS_VIDEO_JOB &&
        candidate.data.videoId === video.id,
    );
    expect(job).toBeDefined();

    await job!.waitUntilFinished(queueEvents, 60000);

    const updatedVideo = await videoRepository.findOneByOrFail({
      id: video.id,
    });
    expect(updatedVideo.status).toBe(VideoStatus.READY);
    expect(updatedVideo.duration_seconds).toBeGreaterThan(0);
    expect(updatedVideo.thumbnail_key).toBe(
      `videos/${channel.id}/${video.id}/thumbnail.jpg`,
    );
    expect(updatedVideo.metadata).toMatchObject({
      width: 320,
      height: 240,
    });
  }, 90000);
});
```

- [ ] **Step 2: Run the new test to verify the seam**

Run:

```bash
docker compose run --rm --workdir /home/node/app \
  --env DB_HOST=db \
  --env DB_USERNAME=streamtube \
  --env DB_PASSWORD=streamtube \
  --env DB_NAME=streamtube \
  --env JWT_SECRET=test-access-secret \
  --env JWT_REFRESH_SECRET=test-refresh-secret \
  --env STORAGE_ACCESS_KEY=streamtube \
  --env STORAGE_SECRET_KEY=streamtube123 \
  nestjs-api npm test -- --runInBand src/video-worker/video-processing.queue.integration-spec.ts
```

Expected: PASS, proving `VideoQueueService.enqueueProcessing(...)` creates a real BullMQ job that `VideoProcessingProcessor` consumes.

- [ ] **Step 3: Run nearby worker tests**

Run:

```bash
docker compose run --rm --workdir /home/node/app \
  --env DB_HOST=db \
  --env DB_USERNAME=streamtube \
  --env DB_PASSWORD=streamtube \
  --env DB_NAME=streamtube \
  --env JWT_SECRET=test-access-secret \
  --env JWT_REFRESH_SECRET=test-refresh-secret \
  --env STORAGE_ACCESS_KEY=streamtube \
  --env STORAGE_SECRET_KEY=streamtube123 \
  nestjs-api npm test -- --runInBand \
  src/video-worker/video-processing.processor.integration-spec.ts \
  src/video-worker/video-processing.queue.integration-spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add nestjs-project/src/video-worker/video-processing.queue.integration-spec.ts
git commit -m "test: cover video queue worker consumption"
```

---

### Task 4: Wire Video Worker Concurrency Configuration

**Files:**
- Modify: `nestjs-project/src/video-worker/video-processing.processor.ts:17-39`
- Modify: `nestjs-project/src/video-worker/video-processing.processor.integration-spec.ts`

**Interfaces:**
- Consumes: `VIDEO_WORKER_CONCURRENCY` environment variable, defaulting to `2` per `queue.config.ts`.
- Produces: `resolveVideoWorkerConcurrency(value?: string): number` and `@Processor(VIDEO_PROCESSING_QUEUE, { concurrency: resolveVideoWorkerConcurrency() })`.

- [ ] **Step 1: Add a unit-level regression inside the processor integration spec**

In `nestjs-project/src/video-worker/video-processing.processor.integration-spec.ts`, update the import:

```typescript
import {
  VideoProcessingProcessor,
  resolveVideoWorkerConcurrency,
} from './video-processing.processor';
```

Add this `describe` block before `describe('process', () => {`:

```typescript
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
```

- [ ] **Step 2: Run the regression and verify it fails**

Run:

```bash
docker compose run --rm --workdir /home/node/app \
  --env DB_HOST=db \
  --env DB_USERNAME=streamtube \
  --env DB_PASSWORD=streamtube \
  --env DB_NAME=streamtube \
  --env JWT_SECRET=test-access-secret \
  --env JWT_REFRESH_SECRET=test-refresh-secret \
  --env STORAGE_ACCESS_KEY=streamtube \
  --env STORAGE_SECRET_KEY=streamtube123 \
  nestjs-api npm test -- --runInBand src/video-worker/video-processing.processor.integration-spec.ts
```

Expected before implementation: FAIL with `resolveVideoWorkerConcurrency` not exported.

- [ ] **Step 3: Implement concurrency resolution and wire it into `@Processor`**

In `nestjs-project/src/video-worker/video-processing.processor.ts`, add this helper after the `FfprobeData` interface:

```typescript
export function resolveVideoWorkerConcurrency(value?: string): number {
  const parsed = Number.parseInt(value ?? '2', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
}
```

Replace the processor decorator:

```typescript
@Processor(VIDEO_PROCESSING_QUEUE)
```

with:

```typescript
@Processor(VIDEO_PROCESSING_QUEUE, {
  concurrency: resolveVideoWorkerConcurrency(
    process.env.VIDEO_WORKER_CONCURRENCY,
  ),
})
```

Rationale: current `@nestjs/bullmq` docs expose worker options through the second `@Processor` argument, and BullMQ defaults `concurrency` to `1`. This uses the existing env/config contract while preserving the current default of `2`.

- [ ] **Step 4: Run worker tests**

Run:

```bash
docker compose run --rm --workdir /home/node/app \
  --env DB_HOST=db \
  --env DB_USERNAME=streamtube \
  --env DB_PASSWORD=streamtube \
  --env DB_NAME=streamtube \
  --env JWT_SECRET=test-access-secret \
  --env JWT_REFRESH_SECRET=test-refresh-secret \
  --env STORAGE_ACCESS_KEY=streamtube \
  --env STORAGE_SECRET_KEY=streamtube123 \
  --env VIDEO_WORKER_CONCURRENCY=4 \
  nestjs-api npm test -- --runInBand src/video-worker/video-processing.processor.integration-spec.ts
```

Expected: PASS.

- [ ] **Step 5: Run targeted lint**

Run:

```bash
docker compose run --rm --workdir /home/node/app \
  --env DB_HOST=db \
  --env DB_USERNAME=streamtube \
  --env DB_PASSWORD=streamtube \
  --env DB_NAME=streamtube \
  --env JWT_SECRET=test-access-secret \
  --env JWT_REFRESH_SECRET=test-refresh-secret \
  --env STORAGE_ACCESS_KEY=streamtube \
  --env STORAGE_SECRET_KEY=streamtube123 \
  nestjs-api npx eslint \
  src/video-worker/video-processing.processor.ts \
  src/video-worker/video-processing.processor.integration-spec.ts
```

Expected: exit `0`.

- [ ] **Step 6: Commit**

```bash
git add \
  nestjs-project/src/video-worker/video-processing.processor.ts \
  nestjs-project/src/video-worker/video-processing.processor.integration-spec.ts
git commit -m "fix: wire video worker concurrency"
```

---

### Task 5: Complete Phase 03 Documentation Artifacts

**Files:**
- Create: `docs/phases/phase-03-videos/context.md`
- Create: `docs/phases/phase-03-videos/validation.md`
- Modify: `docs/phases/phase-03-videos/progress.md:1-20`

**Interfaces:**
- Consumes: implemented Phase 03 code and final verification commands from Task 6.
- Produces: the missing challenge-required phase artifacts.

- [ ] **Step 1: Create `context.md`**

Create `docs/phases/phase-03-videos/context.md` with this content:

```markdown
# Phase 03 — Upload and Video Processing Context

## Scope

Phase 03 implements the backend video pipeline for StreamTube. It covers video persistence, direct multipart upload to object storage, background processing through a queue, thumbnail generation, public video detail lookup, range-aware streaming, and download redirects.

Frontend video UI, publication visibility, custom thumbnails, categories, comments, likes, subscriptions, and recommendation features remain out of scope for this phase.

## Runtime Components

- `nestjs-project/src/videos/` owns video API routes, DTOs, domain exceptions, slug generation, and upload orchestration.
- `nestjs-project/src/storage/` wraps S3-compatible storage through the AWS SDK v3 and is configured for MinIO locally.
- `nestjs-project/src/queue/` wraps BullMQ enqueue behavior for the `video-processing` queue.
- `nestjs-project/src/video-worker/` runs as a separate Nest application context and consumes video-processing jobs.
- `nestjs-project/compose.yaml` defines PostgreSQL, Mailpit, Redis, MinIO, MinIO bucket initialization, API, and video-worker services.

## Upload Flow

1. An authenticated user calls `POST /videos` with title, original filename, MIME type, and file size.
2. The API creates a `draft` video row linked to the caller's channel.
3. The API starts an S3 multipart upload and returns presigned upload-part URLs.
4. The client uploads file parts directly to MinIO/S3; the API does not receive file bytes.
5. The client calls `POST /videos/:id/complete-upload` with uploaded part ETags.
6. The API completes the multipart upload, transitions the video to `processing`, clears `upload_id`, and enqueues `process-video`.

## Processing Flow

1. The `video-worker` consumes `process-video` jobs from BullMQ/Redis.
2. The worker downloads the original object from storage to `/tmp/video-processing`.
3. `ffprobe` extracts duration and metadata.
4. `ffmpeg` captures a thumbnail frame at 25 percent of the video.
5. The worker uploads the thumbnail to storage.
6. On success, the worker sets `status = ready`, `duration_seconds`, `thumbnail_key`, and `metadata`.
7. On terminal failure, the worker sets `status = error` and stores `error_message`.

## Public Read Flow

- `GET /videos/:slug` returns the video status and metadata for polling.
- `GET /videos/:slug/stream` proxies storage reads through the API and supports HTTP range requests.
- `GET /videos/:slug/download` redirects to a short-lived presigned storage URL with attachment disposition.

## Important Constraints

- Maximum upload size is 10 GiB.
- Multipart upload part size is 100 MiB.
- Slugs are generated with `crypto.randomBytes(8).toString('base64url')`.
- Public routes use slug identifiers; owner mutation routes use video UUIDs.
- The queue name is `video-processing`; the job name is `process-video`; the payload is `{ videoId: string }`.
```

- [ ] **Step 2: Create `validation.md`**

Create `docs/phases/phase-03-videos/validation.md` with this content before final verification:

```markdown
# Phase 03 — Upload and Video Processing Validation

## Required Commands

All commands must run inside Docker from `nestjs-project/`.

```bash
docker compose run --rm --workdir /home/node/app \
  --env DB_HOST=db \
  --env DB_USERNAME=streamtube \
  --env DB_PASSWORD=streamtube \
  --env DB_NAME=streamtube \
  --env JWT_SECRET=test-access-secret \
  --env JWT_REFRESH_SECRET=test-refresh-secret \
  --env STORAGE_ACCESS_KEY=streamtube \
  --env STORAGE_SECRET_KEY=streamtube123 \
  nestjs-api npm test -- --runInBand
```

```bash
docker compose run --rm --workdir /home/node/app \
  --env DB_HOST=db \
  --env DB_USERNAME=streamtube \
  --env DB_PASSWORD=streamtube \
  --env DB_NAME=streamtube \
  --env JWT_SECRET=test-access-secret \
  --env JWT_REFRESH_SECRET=test-refresh-secret \
  --env STORAGE_ACCESS_KEY=streamtube \
  --env STORAGE_SECRET_KEY=streamtube123 \
  nestjs-api npm run test:e2e
```

```bash
docker compose run --rm --workdir /home/node/app \
  --env DB_HOST=db \
  --env DB_USERNAME=streamtube \
  --env DB_PASSWORD=streamtube \
  --env DB_NAME=streamtube \
  --env JWT_SECRET=test-access-secret \
  --env JWT_REFRESH_SECRET=test-refresh-secret \
  --env STORAGE_ACCESS_KEY=streamtube \
  --env STORAGE_SECRET_KEY=streamtube123 \
  nestjs-api npx tsc --noEmit
```

```bash
docker compose run --rm --workdir /home/node/app \
  --env DB_HOST=db \
  --env DB_USERNAME=streamtube \
  --env DB_PASSWORD=streamtube \
  --env DB_NAME=streamtube \
  --env JWT_SECRET=test-access-secret \
  --env JWT_REFRESH_SECRET=test-refresh-secret \
  --env STORAGE_ACCESS_KEY=streamtube \
  --env STORAGE_SECRET_KEY=streamtube123 \
  nestjs-api npx eslint "{src,apps,libs,test}/**/*.ts"
```

## Results

Update this section after Task 6 with exact command outputs:

- Unit and integration suite: pending
- E2E suite: pending
- TypeScript compile: pending
- ESLint: pending
- Docker services: pending

## Known Non-Blocking Follow-Ups

- Stream error handler does not log the underlying storage stream error.
- `completeUpload` still has no reconciliation job for videos left in `processing` after enqueue exhaustion; current behavior intentionally fails loudly with `VIDEO_PROCESSING_ENQUEUE_FAILED`.
```

- [ ] **Step 3: Update stale top section of `progress.md`**

In `docs/phases/phase-03-videos/progress.md`, replace lines 3-18 with:

```markdown
**Status:** REMEDIATION IN PROGRESS. The core Phase 03 upload and processing implementation exists, but post-implementation validation found merge-blocking gaps: migration-suite cleanup race, Phase 03 lint debt, missing real queue-consumption coverage, unwired worker concurrency config, and missing `context.md`/`validation.md` artifacts.
**SIs:** 9/9 implemented; remediation plan: `docs/superpowers/plans/2026-07-21-phase-03-video-findings-remediation.md`

## Remediation Findings (2026-07-21)

1. `npm test -- --runInBand` failed in `src/database/migrations.integration-spec.ts` because cleanup dropped enum/table dependencies concurrently.
2. No-fix ESLint reported repo-wide debt plus Phase 03-specific errors that must be removed from touched video files.
3. Existing tests prove enqueue and worker processing separately, but not a real BullMQ consume path from `VideoQueueService` to `VideoProcessingProcessor`.
4. `VIDEO_WORKER_CONCURRENCY` exists in config but is not wired into the BullMQ worker, so the worker uses BullMQ's default concurrency of 1.
5. `docs/phases/phase-03-videos/context.md` and `validation.md` are missing.
```

- [ ] **Step 4: Commit**

```bash
git add \
  docs/phases/phase-03-videos/context.md \
  docs/phases/phase-03-videos/validation.md \
  docs/phases/phase-03-videos/progress.md
git commit -m "docs: add phase 03 remediation artifacts"
```

---

### Task 6: Final Branch Verification

**Files:**
- Modify: `docs/phases/phase-03-videos/validation.md`
- Modify: `docs/phases/phase-03-videos/progress.md`

**Interfaces:**
- Consumes: fixes from Tasks 1-5.
- Produces: final validation evidence and merge-readiness status.

- [ ] **Step 1: Confirm Compose service definitions include the worker**

Run:

```bash
docker compose config --services
```

Expected output includes:

```text
nestjs-api
db
mailpit
redis
minio
minio-init
video-worker
```

- [ ] **Step 2: Run the full unit/integration suite**

Run:

```bash
docker compose run --rm --workdir /home/node/app \
  --env DB_HOST=db \
  --env DB_USERNAME=streamtube \
  --env DB_PASSWORD=streamtube \
  --env DB_NAME=streamtube \
  --env JWT_SECRET=test-access-secret \
  --env JWT_REFRESH_SECRET=test-refresh-secret \
  --env STORAGE_ACCESS_KEY=streamtube \
  --env STORAGE_SECRET_KEY=streamtube123 \
  nestjs-api npm test -- --runInBand
```

Expected: all suites pass. The expected count after Task 3 is at least `32` suites and at least `198` tests because the queue-consumption integration spec adds one suite and one test.

- [ ] **Step 3: Run the e2e suite**

Run:

```bash
docker compose run --rm --workdir /home/node/app \
  --env DB_HOST=db \
  --env DB_USERNAME=streamtube \
  --env DB_PASSWORD=streamtube \
  --env DB_NAME=streamtube \
  --env JWT_SECRET=test-access-secret \
  --env JWT_REFRESH_SECRET=test-refresh-secret \
  --env STORAGE_ACCESS_KEY=streamtube \
  --env STORAGE_SECRET_KEY=streamtube123 \
  nestjs-api npm run test:e2e
```

Expected: `4 passed` suites and `92 passed` tests, unless additional e2e tests were added during remediation.

- [ ] **Step 4: Run TypeScript compile**

Run:

```bash
docker compose run --rm --workdir /home/node/app \
  --env DB_HOST=db \
  --env DB_USERNAME=streamtube \
  --env DB_PASSWORD=streamtube \
  --env DB_NAME=streamtube \
  --env JWT_SECRET=test-access-secret \
  --env JWT_REFRESH_SECRET=test-refresh-secret \
  --env STORAGE_ACCESS_KEY=streamtube \
  --env STORAGE_SECRET_KEY=streamtube123 \
  nestjs-api npx tsc --noEmit
```

Expected: exit `0`.

- [ ] **Step 5: Run no-fix ESLint**

Run:

```bash
docker compose run --rm --workdir /home/node/app \
  --env DB_HOST=db \
  --env DB_USERNAME=streamtube \
  --env DB_PASSWORD=streamtube \
  --env DB_NAME=streamtube \
  --env JWT_SECRET=test-access-secret \
  --env JWT_REFRESH_SECRET=test-refresh-secret \
  --env STORAGE_ACCESS_KEY=streamtube \
  --env STORAGE_SECRET_KEY=streamtube123 \
  nestjs-api npx eslint "{src,apps,libs,test}/**/*.ts"
```

Expected: exit `0`. If pre-existing lint debt remains outside Phase 03 and the team explicitly accepts it, record the exact remaining count and the exact changed-file targeted lint commands that pass. Do not state "lint passes" unless this command exits `0`.

- [ ] **Step 6: Update `validation.md` with actual outputs**

Replace the `pending` result lines in `docs/phases/phase-03-videos/validation.md` with exact results. Use this format:

```markdown
- Unit and integration suite: passed, `<N>` suites / `<N>` tests
- E2E suite: passed, `4` suites / `92` tests
- TypeScript compile: passed, exit `0`
- ESLint: passed, exit `0`
- Docker services: `docker compose config --services` includes `video-worker`, `redis`, and `minio`
```

If a command fails, record:

```markdown
- `<command>`: failed, exit `<code>`, blocker: `<specific failing suite or lint rule>`
```

- [ ] **Step 7: Update `progress.md` final status**

If every required command exits `0`, replace the top status in `docs/phases/phase-03-videos/progress.md` with:

```markdown
**Status:** COMPLETE AFTER REMEDIATION. Phase 03 upload and video processing implementation has been revalidated after fixing the migration cleanup race, removing Phase 03 lint debt, adding real BullMQ worker-consumption coverage, wiring worker concurrency, and adding missing phase artifacts.
```

If any command fails, keep status as:

```markdown
**Status:** REMEDIATION BLOCKED. See `docs/phases/phase-03-videos/validation.md` for the latest failing command and blocker.
```

- [ ] **Step 8: Commit validation docs**

```bash
git add docs/phases/phase-03-videos/validation.md docs/phases/phase-03-videos/progress.md
git commit -m "docs: record phase 03 remediation validation"
```

---

## Self-Review

**Spec coverage:** This plan covers every missing finding from the `dev` vs `main` validation: failed migration suite, lint debt in Phase 03 files, missing queue-consumption proof, unwired worker concurrency, and missing phase artifacts.

**Placeholder scan:** No task contains `TBD`, `TODO`, or "implement later". Every code task contains the exact file path, intended code, command, and expected result.

**Type consistency:** The queue task uses existing exported constants `VIDEO_PROCESSING_QUEUE`, `PROCESS_VIDEO_JOB`, and `ProcessVideoJobData`. The concurrency task exports `resolveVideoWorkerConcurrency(value?: string): number` before importing it from the processor integration spec.
