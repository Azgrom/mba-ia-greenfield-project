# Phase 03 — Upload e Processamento de Vídeos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan SI-by-SI. Every SI is sized and specified for a haiku-4.5, medium-effort subagent to implement standalone — it only needs its own SI section plus the Global Constraints and the referenced Technical Specifications below. Steps inside "Technical actions" are the checklist; check them off as completed.

**Goal:** Deliver the StreamTube video pipeline — object storage, background queue, video worker, and the `videos` module — so a channel owner can upload a video up to 10GB without blocking the API, have it processed automatically (duration/metadata + thumbnail), and have it streamed/downloaded via a unique URL.

**Architecture:** Client uploads directly to MinIO via S3 multipart presigned URLs (API never sees the file bytes). On completion the API flips the video to `processing` and enqueues a BullMQ job. A separate `video-worker` process (own container, same NestJS codebase, different bootstrap entrypoint) consumes the job, runs `ffprobe`/`ffmpeg` against the object pulled from storage, uploads a thumbnail, and flips the video to `ready`/`error`. Playback reads back through the API (range-aware streaming proxy + presigned-redirect download) so the API stays the single access-control point.

**Tech Stack:** NestJS 11 / TypeORM / PostgreSQL 17 (existing) + MinIO (S3-compatible object storage) + `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` + Redis + BullMQ (`bullmq` + `@nestjs/bullmq`) + `fluent-ffmpeg` (+ `ffmpeg-static`, `@ffprobe-installer/ffprobe`).

## Global Constraints

- All `npm`/`npx`/`node`/test commands run inside the `nestjs-api` (or `video-worker`) container, never on the host — see `nestjs-project/CLAUDE.md`.
- Docker networking: always use the Compose service name as host (`minio`, `redis`, `db`), never `localhost`.
- Definition of Done for every SI: its own tests green, `npx tsc --noEmit` exits 0, `npm run lint` passes. Definition of Done for the whole phase additionally requires the full suite green (`npm test -- --runInBand`, `npm run test:e2e`) — see root `CLAUDE.md`.
- Test suffix contract: `*.spec.ts` unit (no I/O), `*.integration-spec.ts` integration (real DB/MinIO/Redis, no mocks), `*.e2e-spec.ts` in `nestjs-project/test/` (full HTTP via supertest). Integration/e2e suites run with `--runInBand`.
- Before installing any new dependency, confirm its current version/API via the context7 MCP tool per the project's Library Documentation Lookup rule; pin the resolved version in `package.json` and record it in `docs/phases/phase-03-videos/library-refs.md` (not produced by this plan — first thing the implementer of SI-03.1 should do).
- Follow existing conventions: `registerAs` config namespaces (`src/config/*.config.ts`), Joi validation (`src/config/env.validation.ts`), kebab-case filenames / PascalCase classes / pluralized modules / singular entities (`.claude/rules/nestjs-common-conventions.md`), `import type` for type-only imports, `ConfigType<typeof x>` not `ReturnType` (`.claude/rules/typescript-strict.md`).
- Git Flow: this phase's work happens on `feature/*` branches cut from `dev`, merged back into `dev` — never commit to `main`.
- Max upload size: **10 GiB** (`10737418240` bytes). Multipart part size: **100 MiB** (`104857600` bytes) — keeps a 10GB upload under 103 parts, well inside S3's 10,000-part ceiling and above its 5MB-per-part minimum.

---

## Overview

Phase 03 adds three new runtime pieces to a working auth/users/channels backend: **object storage** (MinIO, S3 API), a **job queue** (Redis + BullMQ), and a **video worker** (separate process, same codebase, FFmpeg). The API never touches raw video bytes — the client uploads directly to MinIO via presigned multipart-upload URLs generated at draft-creation time, and playback reads back either as a range-aware streaming proxy or a presigned-redirect download.

This plan replaces the project's own `research → plan-context → plan-validate → plan-resolve → plan-build` skill pipeline for **this phase's planning stage only** — it was produced instead via the generic `superpowers:writing-plans` workflow (per explicit instruction), with `refactor-arch` run against the existing `nestjs-project/` codebase to surface technical debt that constitutes real dependencies for the new `videos` module (see "Technical Debt Dependencies" below). It does **not** by itself produce `context.md`, `validation.md`, `progress.md`, or `library-refs.md` — those remain follow-up artifacts: `library-refs.md` gets written as part of SI-03.1 (first context7 lookups), and `progress.md` should be started the moment SI-03.1 execution begins and updated SI-by-SI, mirroring `docs/phases/phase-02-auth/progress.md`.

Nine Step Implementations (SI-03.1 – SI-03.9), each independently testable and scoped for a single haiku-4.5 medium-effort subagent. Four of them (SI-03.5, SI-03.7, SI-03.8, SI-03.9) become parallelizable once their shared dependency (SI-03.4) lands — see the Dependency Map.

---

## Technical Debt Dependencies (refactor-arch audit)

`refactor-arch` was run against `nestjs-project/` (Project Analysis + Architecture Audit only, no mutation) before this plan was finalized. Full report: `docs/decisions/architecture-audit-nestjs-pre-phase-03.md` (`sha256:b59dcd6ec55e1c0fdc43a8e9a166345dc1db434e2e3c62b7640ad478ea052e8c`). Two of its five findings are load-bearing dependencies for how the `videos` module must be built; the rest are noted for completeness but don't change this plan.

| ID | Severity | Finding | Phase 03 impact |
|---|---|---|---|
| F-001 | HIGH | `UsersService.createUserWithChannel` commits the user row, then delegates to `ChannelsService.createChannel`'s own independent transaction, with only a manual compensating delete on failure — no single atomic boundary across the two writes. | **Does not recur as a DB-atomicity bug in this plan** — `VideosService.initiateUpload` (SI-03.4) pairs one DB write with one *external* S3 API call, which cannot share a DB transaction boundary regardless of design. The compensating-delete pattern SI-03.4 uses is the correct tool here, not a repeat of F-001's mistake (F-001's mistake was not sharing a transaction across two writes that *could* share one). Called out explicitly in SI-03.4 so a future implementer doesn't "fix" it by wrapping the S3 call in `dataSource.transaction()`, which would accomplish nothing. |
| F-002 | HIGH | `ChannelsService.createChannel`'s nickname-collision retry loop has no `SAVEPOINT`, so a real concurrent unique-violation aborts the whole enclosing transaction instead of retrying. | **Direct dependency for SI-03.4's slug-collision retry loop.** The loop in this plan deliberately performs each retry attempt as its own independent `videoRepository.save()` call — **not** inside a `dataSource.transaction()` — specifically so a `23505` collision on one attempt has nothing to abort and the next attempt proceeds normally. This must be preserved: do not refactor the retry loop into a single wrapping transaction without also adding `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` around each attempt, or it reproduces F-002 exactly. |
| F-003 | MEDIUM | Config defaults (DB host, mail host/port, JWT expirations, etc.) are duplicated between each `registerAs` factory and the Joi `envValidationSchema` — two sources of truth that can silently diverge. | **Inherited, not fixed, by design.** SI-03.1's `storage.config.ts`/`queue.config.ts` follow the exact same two-sources-of-truth pattern as every existing config namespace (`process.env.X || default` in the factory, `Joi....default(default)` in the schema) for consistency with the rest of the codebase. Unifying config defaults across the whole project is out of this phase's scope per `CLAUDE.md`'s Scope Limits ("if you identify a necessary change that is out of scope, create a new issue instead") — flagged here as a legitimate follow-up task, not silently absorbed into Phase 03. |
| F-004 | MEDIUM | `jwtExpirationToMs` silently returns `0` on a malformed TTL string; Joi validates `JWT_*_EXPIRATION` as a bare string with no format check. | Not applicable — Phase 03 has no duration-string config (`STORAGE_PRESIGNED_URL_EXPIRATION_SECONDS` etc. are all plain `Joi.number()`, no string-TTL parsing). No action needed. |
| F-005 | LOW | `src/database/seeds/seed.ts` (wired to `npm run seed`) opens/closes a DB connection but inserts nothing. | Not applicable to Phase 03 scope. No action needed. |

**Additional wiring note from the audit (not a scored finding):** `ThrottlerModule.forRoot(...)` and both `APP_GUARD` registrations (JWT auth + throttling) are wired inside `AuthModule`, not `AppModule`. Because `APP_GUARD` is a Nest-global provider token, this still applies to every route in the app regardless of which module registers it — so `VideosController`'s endpoints already inherit the existing global JWT guard (bypassed per-route via `@Public()`, exactly as used in SI-03.7–03.9) and the existing 10 req/min throttle with no new wiring required. No SI in this plan touches `ThrottlerModule` or guard registration.

**No finding** against the domain-exception/filter pattern (`DomainException` + `DomainExceptionFilter`) or the test-setup convention (`createTestDataSource`) — both are confirmed sound and reused as-is throughout this plan (SI-03.2's exception classes extend `DomainException`; every integration spec uses `createTestDataSource`).

---

## Technical Decisions (embedded — to be transcribed verbatim into `docs/decisions/technical-decisions-phase-03-videos.md` by SI-03.1)

### TD-01: Background Processing Queue

**Scope:** Backend
**Capability:** Serviço de processamento em segundo plano (filas)
**Context:** PROJECT_INSTRUCTIONS.md leaves the queue technology explicitly TBD. It must support reliable job delivery, retries with backoff, and a worker that can run as its own process/container.

**Options:**

#### Option A: BullMQ + Redis
Redis-backed job queue, official `@nestjs/bullmq` integration (`BullModule.registerQueue`, `@Processor`/`WorkerHost`, `@InjectQueue`). Supports a `Worker` running in a fully separate process against the same Redis instance and queue name.
- **Pros:** One lightweight new infra dependency (Redis, already the natural cache/session choice for later phases). First-class NestJS module. Built-in retries/backoff/concurrency/job-events out of the box — no hand-rolled retry logic. Large ecosystem (Bull Board for observability, if ever needed).
- **Cons:** Redis is at-most-a-cache by default (needs `appendonly yes` for durability across restarts — acceptable for a dev/course Compose setup, called out explicitly below). Not a message broker in the AMQP/pub-sub sense — fine here since we need a job queue, not routing.

#### Option B: RabbitMQ (amqplib / `@nestjs/microservices` RMQ transport)
AMQP broker with `@nestjs/microservices`.
- **Pros:** Battle-tested broker, native `@nestjs/microservices` transport, richer routing (exchanges/topics) than needed here.
- **Cons:** Heavier operationally (its own management UI, exchange/queue/binding setup) for a single job type (`process-video`). `@nestjs/microservices` RMQ transport does not give retry/backoff/job-state tracking for free — that logic would be hand-rolled on top, duplicating what BullMQ ships natively.

**Recommendation:** **Option A (BullMQ + Redis).** A single job type with built-in retry/backoff is exactly BullMQ's design center; RabbitMQ's extra routing power isn't needed and its extra operational surface isn't justified for a course-scoped Phase 03.

**Decision:** A (BullMQ + Redis)

---

### TD-02: 10GB Upload Strategy

**Scope:** Backend
**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
**Context:** Passing a 10GB file through the NestJS process (buffered or even streamed through Express/Multer) ties up a request handler and Node process memory/IO for the whole transfer — explicitly called out as the wrong approach in PROJECT_INSTRUCTIONS.md.

**Options:**

#### Option A: Direct-to-storage upload via S3 multipart presigned URLs
API creates the draft `Video` row and an S3 `CreateMultipartUpload`, then returns one presigned `UploadPart` URL per part (100MiB parts) computed from the client-declared file size. The client (or, for this backend-only phase, the test harness) `PUT`s each part directly to MinIO. The client then calls `POST /videos/:id/complete-upload` with the returned ETags; the API calls `CompleteMultipartUpload` and enqueues processing.
- **Pros:** Zero video bytes ever pass through the NestJS process — the API's job is 100% metadata (create row, presign URLs, mark complete). Resumable/parallelizable per-part on the client side. Matches the S3/MinIO API the project already commits to.
- **Cons:** More moving parts than a single presigned PUT (multipart create/complete/abort lifecycle). Client is responsible for tracking part ETags.

#### Option B: Single presigned PUT (no multipart)
One presigned `PutObject` URL for the whole file.
- **Pros:** Simpler API surface (one URL, one PUT).
- **Cons:** A single 10GB PUT over one TCP connection has no resumability — any interruption restarts the entire transfer. Real S3 caps a single PUT at 5GB, so this doesn't even reach the 10GB requirement on real S3 (MinIO is more lenient, but the plan must not assume a MinIO-only production target since PROJECT_INSTRUCTIONS says S3 in production).

**Recommendation:** **Option A (multipart presigned upload).** It is the only option that actually satisfies "up to 10GB" against real S3 semantics and gives per-part resumability.

**Decision:** A (S3 multipart presigned upload, 100MiB parts)

---

### TD-03: Worker Architecture and Metadata/Thumbnail Extraction

**Scope:** Backend
**Capability:** Processamento automático do vídeo (duração/metadados) + geração automática de thumbnail
**Context:** The worker must run as its own process/container (per PROJECT_INSTRUCTIONS.md) and needs FFmpeg to inspect and thumbnail the video.

**Decision:** The worker is a **second bootstrap entrypoint inside the same `nestjs-project` codebase** (`src/video-worker/main.ts`, `NestFactory.createApplicationContext`), not a separate package. It reuses the same `Video` TypeORM entity, the same `registerAs` config pattern, and the same `StorageService` as the API — this is the "continuity, not rework" principle from `CLAUDE.md` applied literally: one dependency tree, one migration history, one set of conventions. It runs as its own Compose service (`video-worker`) with its own `CMD`, consuming the `video-processing` BullMQ queue via `@Processor`/`WorkerHost`. FFmpeg/ffprobe come from the npm-vendored static binaries `ffmpeg-static` + `@ffprobe-installer/ffprobe` (glibc-linked, compatible with the existing `node:25.6.0-slim` — Debian, not Alpine — base image) driven through `fluent-ffmpeg`, avoiding any Dockerfile/apt changes. Metadata comes from `ffmpeg.ffprobe()` (duration, width, height, codec, bitrate); the thumbnail comes from `.screenshots({ timestamps: ['25%'] })` (a frame 25% into the video, per the "generate from a frame" requirement — picked over `0%`/`00:00` to avoid black opening frames/intro cards being common at true start).

**Rejected alternative:** running the worker as a fully separate Node project/package was considered and rejected — it would duplicate the `Video` entity, TypeORM DataSource config, and env/config loading with no benefit, directly working against "Continuidade, não retrabalho."

---

### TD-04: Unique URL and Streaming Strategy

**Scope:** Backend
**Capability:** URL única por vídeo, sem conflito + reprodução via streaming
**Context:** Every video needs a short, collision-free public identifier, and playback must start without downloading the whole file.

**Decision:** Every `Video` gets a `slug` column: `crypto.randomBytes(8).toString('base64url')` (11 URL-safe characters, no new dependency — reuses the same `crypto.randomBytes` primitive already used for `verification_tokens`). Collision handling mirrors the existing `ChannelsService.createChannel` pattern from SI-02.15: attempt the insert, and on a Postgres unique-violation (`QueryFailedError`, code `23505`, detail mentioning `slug`) regenerate and retry (max 5 attempts) rather than pre-checking then racing. All public-facing routes key off the slug (`/videos/:slug`, `/videos/:slug/stream`, `/videos/:slug/download`); mutation routes (initiate/complete upload) key off the internal `id` (uuid), which only the owner ever sees in the creation response.

Streaming is a **range-aware proxy through the API**, not a redirect to a presigned MinIO URL: the API parses the `Range` header, issues an S3 `GetObjectCommand` with the same `Range`, and pipes the returned body back with `206 Partial Content` (or `200` + `Accept-Ranges: bytes` when no `Range` header is sent). This keeps the API as the single access-control point (needed once Phase 04 adds draft/unlisted visibility) and keeps the public URL stable regardless of the underlying storage backend (MinIO in dev, S3 in prod).

Download uses a **302 redirect to a short-lived presigned GET URL** (`ResponseContentDisposition: attachment`) instead of proxying — a full-file download has no access-control nuance beyond "is this video ready," so there's no reason to double the bandwidth through the API for what is, by definition, the entire file.

**Decision:** slug = `crypto.randomBytes(8).toString('base64url')` with insert-then-retry collision handling; stream = API range-proxy; download = presigned-redirect.

---

### TD-05: Video Status Lifecycle

**Scope:** Backend
**Capability:** Ciclo de status do vídeo e comportamento em caso de falha
**Context:** PROJECT_INSTRUCTIONS.md specifies the cycle literally as "rascunho → processando → pronto/erro."

**Decision:** Four states, modeled as a Postgres enum on `videos.status`:

| Status | Meaning | Entered when |
|---|---|---|
| `draft` | Row exists, multipart upload created, no bytes confirmed yet | `POST /videos` succeeds |
| `processing` | Upload confirmed complete, job enqueued or running | `POST /videos/:id/complete-upload` succeeds |
| `ready` | Worker finished: duration/metadata + thumbnail persisted | Worker `process()` completes successfully |
| `error` | Worker exhausted all retry attempts | BullMQ `failed` event fires with `attemptsMade >= attempts` |

No separate "uploaded" state — upload-completion and the transition into `processing` are the same atomic step, matching the literal 4-state cycle from the brief instead of inventing a 5th state.

---

## Step Implementations

### SI-03.1 — Dependencies, Config Namespaces, and Docker Compose Infra (MinIO + Redis)

**Description:** Install all Phase 03 production dependencies, create `storage` and `queue` config namespaces following the existing `registerAs` pattern, extend the Joi validation schema, and add MinIO (+ bucket-init) and Redis to Docker Compose. Also write `docs/decisions/technical-decisions-phase-03-videos.md` transcribing the five TDs above verbatim (frontmatter + structure matching `docs/decisions/technical-decisions-phase-02-auth.md`: `scope_type: phase`, `related_phases: [3]`, `status: decided`, `date:` today, `scope_description:` one sentence).

**Tech-debt dependency (refactor-arch F-003):** the new config namespaces intentionally reuse the existing two-sources-of-truth pattern (default in the `registerAs` factory *and* in the Joi schema) for consistency with `app.config.ts`/`database.config.ts`/`mail.config.ts`. This is inherited debt, not something to fix here — see "Technical Debt Dependencies" above.

**Files:**
- Create: `nestjs-project/src/config/storage.config.ts`
- Create: `nestjs-project/src/config/queue.config.ts`
- Modify: `nestjs-project/src/config/env.validation.ts`
- Modify: `nestjs-project/src/app.module.ts` (add `storageConfig`, `queueConfig` to `ConfigModule.load`)
- Modify: `nestjs-project/.env.example`
- Modify: `nestjs-project/compose.yaml`
- Modify: `nestjs-project/package.json` (dependencies + `start:worker:dev` script, added now so later SIs don't touch this file again)
- Create: `docs/decisions/technical-decisions-phase-03-videos.md`

**Technical actions:**

- Install production dependencies: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `bullmq`, `@nestjs/bullmq`, `fluent-ffmpeg`, `ffmpeg-static`, `@ffprobe-installer/ffprobe` — confirm exact current versions via context7 before pinning (see Global Constraints). Install dev dependency `@types/fluent-ffmpeg`.
- Create `src/config/storage.config.ts`:

```typescript
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
```

- Create `src/config/queue.config.ts`:

```typescript
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
```

- Update `src/config/env.validation.ts` — add to the `Joi.object({...})`: `STORAGE_ENDPOINT: Joi.string().default('http://minio:9000')`, `STORAGE_REGION: Joi.string().default('us-east-1')`, `STORAGE_ACCESS_KEY: Joi.string().required()`, `STORAGE_SECRET_KEY: Joi.string().required()`, `STORAGE_BUCKET: Joi.string().default('streamtube')`, `STORAGE_PRESIGNED_URL_EXPIRATION_SECONDS: Joi.number().default(3600)`, `VIDEO_UPLOAD_PART_SIZE_BYTES: Joi.number().default(104857600)`, `VIDEO_MAX_FILE_SIZE_BYTES: Joi.number().default(10737418240)`, `REDIS_HOST: Joi.string().default('redis')`, `REDIS_PORT: Joi.number().default(6379)`, `VIDEO_PROCESSING_ATTEMPTS: Joi.number().default(3)`, `VIDEO_WORKER_CONCURRENCY: Joi.number().default(2)`.
- Update `src/app.module.ts` — add `storageConfig` and `queueConfig` imports and include both in `ConfigModule.forRoot({ load: [...] })` alongside the existing five.
- Update `.env.example` — append a `# Object Storage (MinIO)` block with `STORAGE_ENDPOINT=http://minio:9000`, `STORAGE_REGION=us-east-1`, `STORAGE_ACCESS_KEY=streamtube`, `STORAGE_SECRET_KEY=streamtube123`, `STORAGE_BUCKET=streamtube`, `STORAGE_PRESIGNED_URL_EXPIRATION_SECONDS=3600`, `VIDEO_UPLOAD_PART_SIZE_BYTES=104857600`, `VIDEO_MAX_FILE_SIZE_BYTES=10737418240`, and a `# Queue (Redis/BullMQ)` block with `REDIS_HOST=redis`, `REDIS_PORT=6379`, `VIDEO_PROCESSING_ATTEMPTS=3`, `VIDEO_WORKER_CONCURRENCY=2`.
- Update `compose.yaml` — add three services and one named volume:

```yaml
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

  minio:
    image: minio/minio:latest
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      - MINIO_ROOT_USER=streamtube
      - MINIO_ROOT_PASSWORD=streamtube123
    command: server /data --console-address ":9001"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 5s
      timeout: 5s
      retries: 5
    volumes:
      - minio-data:/data

  minio-init:
    image: minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 streamtube streamtube123 &&
      mc mb --ignore-existing local/streamtube
      "
```

  and append `minio-data:` under a top-level `volumes:` key (create it if it doesn't exist yet). Update the existing `nestjs-api` service's `depends_on` to add `redis: { condition: service_healthy }`, `minio-init: { condition: service_completed_successfully }`.
- Add to `package.json` `scripts`: `"start:worker:dev": "ts-node --compiler-options '{\"module\":\"CommonJS\"}' -r tsconfig-paths/register src/video-worker/main.ts"` (mirrors the existing `seed` script's ts-node invocation pattern).
- Create `docs/decisions/technical-decisions-phase-03-videos.md` transcribing TD-01 through TD-05 above verbatim, in the exact section structure of `docs/decisions/technical-decisions-phase-02-auth.md` (frontmatter, `## TD-0N: <title>`, `**Scope:**`, `**Capability:**`, `**Context:**`, `**Options:**` with `### Option A/B`, `**Recommendation:**`, `**Decision:**`).

**Dependencies:** None

**Acceptance criteria:**

- `docker compose up -d` brings up `redis`, `minio`, and `minio-init` (which exits 0) alongside the existing services — `docker compose ps` shows `redis` and `minio` as `running`/healthy
- `docker compose exec nestjs-api curl -sf http://minio:9000/minio/health/live` succeeds from inside the network
- The `streamtube` bucket exists in MinIO after `minio-init` runs (verify via `docker compose run --rm minio-init` re-run is idempotent, or MinIO console at `localhost:9001`)
- Application starts without errors with all new environment variables provided; starting without `STORAGE_ACCESS_KEY` or `STORAGE_SECRET_KEY` causes a Joi validation error at bootstrap
- `docs/decisions/technical-decisions-phase-03-videos.md` exists with all 5 TDs, each with a `**Decision:**` line
- `npx tsc --noEmit` exits 0, `npm run lint` passes

---

### SI-03.2 — Video Entity, Domain Exceptions, and Migration

**Description:** Create the `Video` entity (status enum, storage keys, slug, metadata) linked to `Channel`, its domain exception classes, and generate the migration.

**Files:**
- Create: `nestjs-project/src/videos/entities/video.entity.ts`
- Create: `nestjs-project/src/videos/entities/video.entity.integration-spec.ts`
- Create: `nestjs-project/src/videos/exceptions/video-not-found.exception.ts`
- Create: `nestjs-project/src/videos/exceptions/video-not-ready.exception.ts`
- Create: `nestjs-project/src/videos/exceptions/upload-already-completed.exception.ts`
- Create: `nestjs-project/src/videos/exceptions/multipart-upload-failed.exception.ts`
- Create: `nestjs-project/src/database/migrations/<timestamp>-CreateVideos.ts`

**Technical actions:**

- Create `src/videos/entities/video.entity.ts`:

```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

export enum VideoStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  READY = 'ready',
  ERROR = 'error',
}

@Entity('videos')
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  channel_id: string;

  @ManyToOne(() => Channel)
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 11, unique: true })
  slug: string;

  @Column({ type: 'enum', enum: VideoStatus, default: VideoStatus.DRAFT })
  status: VideoStatus;

  @Column({ type: 'varchar' })
  storage_key: string;

  @Column({ type: 'varchar', nullable: true })
  thumbnail_key: string | null;

  @Column({ type: 'varchar', nullable: true })
  upload_id: string | null;

  @Column({ type: 'varchar' })
  original_filename: string;

  @Column({ type: 'varchar' })
  mime_type: string;

  @Column({ type: 'bigint' })
  file_size_bytes: string;

  @Column({ type: 'float', nullable: true })
  duration_seconds: number | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
```

  (`file_size_bytes` is typed `string` on the entity because TypeORM maps Postgres `bigint` to JS `string` by default to avoid precision loss above `Number.MAX_SAFE_INTEGER`; parse with `BigInt()` where arithmetic is needed.)
- Create `src/videos/exceptions/video-not-found.exception.ts` — `VideoNotFoundException extends DomainException` (same base class as `src/common/exceptions/domain.exception.ts`), `errorCode = 'VIDEO_NOT_FOUND'`, `httpStatus = 404`.
- Create `src/videos/exceptions/video-not-ready.exception.ts` — `VideoNotReadyException`, `errorCode = 'VIDEO_NOT_READY'`, `httpStatus = 409`.
- Create `src/videos/exceptions/upload-already-completed.exception.ts` — `UploadAlreadyCompletedException`, `errorCode = 'UPLOAD_ALREADY_COMPLETED'`, `httpStatus = 409`.
- Create `src/videos/exceptions/multipart-upload-failed.exception.ts` — `MultipartUploadFailedException`, `errorCode = 'MULTIPART_UPLOAD_FAILED'`, `httpStatus = 422`.
- Generate migration via `npm run migration:generate -- src/database/migrations/CreateVideos` and review the generated SQL — it must create the `videos_status_enum` type, the `videos` table with a unique index on `slug`, a plain index on `channel_id`, and an `FK` to `channels(id)`.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/entities/video.entity.integration-spec.ts` | Integration | Unique `slug` constraint; `status` defaults to `draft`; `status` enum rejects invalid values; FK to `channels` enforced (inserting with a non-existent `channel_id` fails); `thumbnail_key`/`upload_id`/`duration_seconds`/`metadata`/`error_message` all nullable |

**Dependencies:** None

**Acceptance criteria:**

- `npm run migration:run` creates the `videos` table with all columns, the `videos_status_enum` type, unique index on `slug`, index on `channel_id`, and FK to `channels`
- Inserting a video with a duplicate `slug` fails with a unique constraint violation
- Inserting a video with `status` outside `('draft','processing','ready','error')` fails
- A newly created video has `status = 'draft'` by default
- Each exception class extends `DomainException` and carries the correct `errorCode`/`httpStatus` pair listed above

---

### SI-03.3 — StorageService (MinIO/S3 Wrapper)

**Description:** Wrap `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` behind a `StorageService` that owns every storage operation the rest of the module needs: multipart lifecycle, range-aware GET, presigned GET, and plain PUT (for thumbnails).

**Files:**
- Create: `nestjs-project/src/storage/storage.module.ts`
- Create: `nestjs-project/src/storage/storage.service.ts`
- Create: `nestjs-project/src/storage/storage.service.integration-spec.ts`

**Technical actions:**

- Create `src/storage/storage.service.ts`:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'stream';
import storageConfig from '../config/storage.config';

export interface PresignedPart {
  partNumber: number;
  url: string;
}

export interface RangeObject {
  body: Readable;
  contentLength: number;
  contentRange?: string;
  statusCode: 200 | 206;
}

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async createMultipartUpload(key: string, contentType: string): Promise<string> {
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!result.UploadId) {
      throw new Error('S3 did not return an UploadId for multipart upload');
    }
    return result.UploadId;
  }

  async getPresignedUploadPartUrls(
    key: string,
    uploadId: string,
    partCount: number,
  ): Promise<PresignedPart[]> {
    const parts: PresignedPart[] = [];
    for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
      const command = new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      });
      const url = await getSignedUrl(this.client, command, {
        expiresIn: this.config.presignedUrlExpirationSeconds,
      });
      parts.push({ partNumber, url });
    }
    return parts;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
  ): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async getObjectRange(key: string, range?: string): Promise<RangeObject> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range }),
    );
    return {
      body: result.Body as Readable,
      contentLength: result.ContentLength ?? 0,
      contentRange: result.ContentRange,
      statusCode: range ? 206 : 200,
    };
  }

  async getPresignedGetUrl(
    key: string,
    responseContentDisposition?: string,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: responseContentDisposition,
    });
    return getSignedUrl(this.client, command, {
      expiresIn: this.config.presignedUrlExpirationSeconds,
    });
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

}
```

- Create `src/storage/storage.module.ts` — `StorageModule` with `providers: [StorageService]`, `exports: [StorageService]`. No `TypeOrmModule.forFeature` — this module has no entities.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/storage/storage.service.integration-spec.ts` | Integration | Against the real `minio` Compose service: full multipart lifecycle (create → presigned part URL → `fetch(url, {method:'PUT', body})` from the test itself → complete) results in a retrievable object; `getObjectRange` with a `Range` header returns `statusCode 206` and a body shorter than the full object; `getObjectRange` without a range returns `statusCode 200` with the full object; `getPresignedGetUrl` returns a URL that a plain `fetch` can download; `abortMultipartUpload` leaves no object at the key |

**Dependencies:** SI-03.1

**Acceptance criteria:**

- A file uploaded through the full multipart flow (create → presigned PUT per part → complete) is byte-identical when read back via `getObjectRange`
- `getObjectRange(key, 'bytes=0-99')` returns exactly 100 bytes and `statusCode: 206`
- `getPresignedGetUrl` produces a URL that works without any additional auth header
- `abortMultipartUpload` cleans up the incomplete upload — no partial object is left behind

---

### SI-03.4 — VideosModule and Upload Initiation

**Description:** Scaffold the `videos` module and implement `POST /videos`: creates the draft `Video` row (with collision-safe slug), opens the S3 multipart upload, and returns presigned part URLs sized from the client-declared file size.

**Tech-debt dependency (refactor-arch F-001, F-002):** see "Technical Debt Dependencies" above before touching `initiateUpload` — the slug-retry loop must stay as independent, unwrapped `save()` calls (never put inside a single `dataSource.transaction()` without adding `SAVEPOINT`s, or it reproduces F-002's bug), and the post-insert compensating delete on storage failure is intentional, not a placeholder for "real" transactional atomicity (an S3 call cannot join a Postgres transaction, so this does not repeat F-001's mistake).

**Files:**
- Create: `nestjs-project/src/videos/videos.module.ts`
- Create: `nestjs-project/src/videos/videos.service.ts`
- Create: `nestjs-project/src/videos/videos.service.spec.ts`
- Create: `nestjs-project/src/videos/videos.service.integration-spec.ts`
- Create: `nestjs-project/src/videos/videos.controller.ts`
- Create: `nestjs-project/src/videos/slug.util.ts`
- Create: `nestjs-project/src/videos/slug.util.spec.ts`
- Create: `nestjs-project/src/videos/dto/initiate-upload.dto.ts`
- Create: `nestjs-project/src/videos/dto/initiate-upload-response.dto.ts`
- Modify: `nestjs-project/src/app.module.ts` (register `VideosModule`)

**Technical actions:**

- Create `src/videos/slug.util.ts`:

```typescript
import { randomBytes } from 'crypto';

export function generateSlug(): string {
  return randomBytes(8).toString('base64url');
}
```

- Create `src/videos/dto/initiate-upload.dto.ts` — `InitiateUploadDto` with `@IsString() @MinLength(1) @MaxLength(150)` title (required), `@IsString() @IsNotEmpty()` originalFilename (required), `@IsString() @Matches(/^video\//)` mimeType (required), `@IsInt() @Min(1) @Max(10737418240)` fileSizeBytes (required).
- Create `src/videos/dto/initiate-upload-response.dto.ts` — `InitiateUploadResponseDto` with `id: string`, `slug: string`, `uploadId: string`, `parts: { partNumber: number; url: string }[]`.
- Create `src/videos/videos.service.ts` — `VideosService` injecting `@InjectRepository(Video) private readonly videoRepository: Repository<Video>` and `private readonly storageService: StorageService`. Implement:

```typescript
async initiateUpload(
  channelId: string,
  dto: InitiateUploadDto,
): Promise<InitiateUploadResponseDto> {
  const extension = extname(dto.originalFilename) || '';
  let video: Video | undefined;
  for (let attempt = 0; attempt < 5 && !video; attempt += 1) {
    try {
      video = await this.videoRepository.save(
        this.videoRepository.create({
          channel_id: channelId,
          title: dto.title,
          slug: generateSlug(),
          status: VideoStatus.DRAFT,
          storage_key: '',
          original_filename: dto.originalFilename,
          mime_type: dto.mimeType,
          file_size_bytes: String(dto.fileSizeBytes),
        }),
      );
    } catch (err) {
      if (
        err instanceof QueryFailedError &&
        (err as unknown as { code?: string }).code === '23505' &&
        err.message.includes('slug')
      ) {
        continue;
      }
      throw err;
    }
  }
  if (!video) {
    throw new Error('Failed to allocate a unique video slug after 5 attempts');
  }

  const key = `videos/${channelId}/${video.id}/original${extension}`;
  let uploadId: string | undefined;
  try {
    uploadId = await this.storageService.createMultipartUpload(key, dto.mimeType);
    const partSize = this.storageConfig.uploadPartSizeBytes;
    const partCount = Math.max(1, Math.ceil(dto.fileSizeBytes / partSize));
    const parts = await this.storageService.getPresignedUploadPartUrls(
      key,
      uploadId,
      partCount,
    );
    video.storage_key = key;
    video.upload_id = uploadId;
    await this.videoRepository.save(video);
    return { id: video.id, slug: video.slug, uploadId, parts };
  } catch (err) {
    if (uploadId) {
      await this.storageService.abortMultipartUpload(key, uploadId);
    }
    await this.videoRepository.delete(video.id);
    throw err;
  }
}
```

  (inject `@Inject(storageConfig.KEY) private readonly storageConfig: ConfigType<typeof storageConfig>` in the constructor for `uploadPartSizeBytes`; import `extname` from `path`, `QueryFailedError` from `typeorm`.) Also implement `async findBySlugOrFail(slug: string): Promise<Video>` — `findOneBy({ slug })`, throw `VideoNotFoundException` if not found — reused by SI-03.7/03.8/03.9.
- Create `src/videos/videos.controller.ts` — `VideosController` with route prefix `'videos'`. Implement `@Post()` calling `videosService.initiateUpload(currentUser's channel id, dto)`, returning 201. Resolve the caller's channel via `@InjectRepository(Channel)` lookup by `user_id = currentUser.sub` inside the controller method (or a small `channelId` resolution passed to the service) — throw a plain `NotFoundException('Channel not found for user')` in the near-impossible case a JWT-valid user has no channel (every registered user gets one per Phase 02, so this is a defensive guard, not a real user-facing flow).
- Create `src/videos/videos.module.ts` — `VideosModule` with `imports: [TypeOrmModule.forFeature([Video, Channel]), StorageModule]`, `controllers: [VideosController]`, `providers: [VideosService]`, `exports: [VideosService]`.
- Register `VideosModule` in `src/app.module.ts` imports.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/slug.util.spec.ts` | Unit | `generateSlug()` returns an 11-character URL-safe string; two calls produce different values |
| `src/videos/videos.service.spec.ts` | Unit | `initiateUpload`: computes `partCount` correctly from `fileSizeBytes`/`uploadPartSizeBytes` (mocked); calls storage in order (create → presign → save); on a failure after `createMultipartUpload` succeeded, calls `storageService.abortMultipartUpload` before deleting the draft row and rethrowing; on a failure before `createMultipartUpload` (e.g. presign never reached), does not call abort; slug collision (mocked `QueryFailedError` code `23505`) retries and eventually succeeds |
| `src/videos/videos.service.integration-spec.ts` | Integration | Against real DB + MinIO: `initiateUpload` persists a `draft` video with `storage_key`/`upload_id` populated and returns a `parts` array whose length matches the expected part count for a given `fileSizeBytes` |
| `test/videos.e2e-spec.ts` | E2E | `POST /videos` with a valid body returns 201 with `{ id, slug, uploadId, parts }`; 400 on missing/invalid fields (e.g. `fileSizeBytes` over 10GB, non-`video/*` mimeType); 401 without an access token |

**Dependencies:** SI-03.2, SI-03.3

**Acceptance criteria:**

- `POST /videos` with a valid body returns 201 with `{ id, slug, uploadId, parts }`; a `draft` video row exists in the DB with `channel_id` set to the caller's channel
- `parts.length` equals `Math.ceil(fileSizeBytes / 104857600)`, minimum 1
- `POST /videos` with `fileSizeBytes` above 10GiB or `mimeType` not starting with `video/` returns 400 with a validation error
- `POST /videos` without an `Authorization` header returns 401
- If any step after `createMultipartUpload` fails, both the S3-side multipart upload is aborted and the `draft` video row is deleted — no orphaned row and no orphaned incomplete upload remain

---

### SI-03.5 — QueueModule and Upload Completion

**Description:** Register the BullMQ producer for the `video-processing` queue and implement `POST /videos/:id/complete-upload`: finalizes the S3 multipart upload, transitions the video to `processing`, and enqueues the processing job.

**Files:**
- Create: `nestjs-project/src/queue/queue.module.ts`
- Create: `nestjs-project/src/queue/video-queue.service.ts`
- Create: `nestjs-project/src/queue/video-queue.constants.ts`
- Modify: `nestjs-project/src/videos/videos.service.ts`
- Modify: `nestjs-project/src/videos/videos.controller.ts`
- Modify: `nestjs-project/src/videos/videos.module.ts`
- Create: `nestjs-project/src/videos/dto/complete-upload.dto.ts`

**Technical actions:**

- Create `src/queue/video-queue.constants.ts`:

```typescript
export const VIDEO_PROCESSING_QUEUE = 'video-processing' as const;
export const PROCESS_VIDEO_JOB = 'process-video' as const;

export interface ProcessVideoJobData {
  videoId: string;
}
```

- Create `src/queue/video-queue.service.ts` — `VideoQueueService` injecting `@InjectQueue(VIDEO_PROCESSING_QUEUE) private readonly queue: Queue<ProcessVideoJobData>`. Implement `async enqueueProcessing(videoId: string): Promise<void>` — `await this.queue.add(PROCESS_VIDEO_JOB, { videoId }, { attempts: this.queueConfig.videoProcessingAttempts, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: false })` (inject `queueConfig` the same `ConfigType` way as elsewhere).
- Create `src/queue/queue.module.ts` — `QueueModule` with `imports: [BullModule.forRootAsync({ inject: [queueConfig.KEY], useFactory: (cfg) => ({ connection: { host: cfg.redisHost, port: cfg.redisPort } }) }), BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE })]`, `providers: [VideoQueueService]`, `exports: [VideoQueueService, BullModule]`.
- Create `src/videos/dto/complete-upload.dto.ts` — `CompleteUploadDto` with `@IsArray() @ValidateNested({ each: true }) @Type(() => CompletedPartDto)` parts (required, min length 1), where `CompletedPartDto` has `@IsInt() @Min(1)` partNumber and `@IsString() @IsNotEmpty()` etag.
- Update `src/videos/videos.service.ts` — inject `VideoQueueService`. Implement:

```typescript
async completeUpload(
  channelId: string,
  videoId: string,
  dto: CompleteUploadDto,
): Promise<Video> {
  const video = await this.videoRepository.findOneBy({
    id: videoId,
    channel_id: channelId,
  });
  if (!video) throw new VideoNotFoundException();
  if (video.status !== VideoStatus.DRAFT) {
    throw new UploadAlreadyCompletedException();
  }
  try {
    await this.storageService.completeMultipartUpload(
      video.storage_key,
      video.upload_id as string,
      dto.parts,
    );
  } catch (err) {
    throw new MultipartUploadFailedException();
  }
  video.status = VideoStatus.PROCESSING;
  video.upload_id = null;
  await this.videoRepository.save(video);
  await this.videoQueueService.enqueueProcessing(video.id);
  return video;
}
```

- Update `src/videos/videos.controller.ts` — add `@Post(':id/complete-upload')`, resolving the caller's channel the same way as `initiateUpload`, calling `videosService.completeUpload(channelId, id, dto)`, returning 200 with the updated video's `{ id, slug, status }`.
- Update `src/videos/videos.module.ts` — add `QueueModule` to `imports`.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/videos/videos.service.spec.ts` | Unit | `completeUpload`: not-found video throws `VideoNotFoundException`; non-`draft` status throws `UploadAlreadyCompletedException`; storage failure throws `MultipartUploadFailedException` and leaves status unchanged; success path sets `status = processing`, clears `upload_id`, and calls `videoQueueService.enqueueProcessing` exactly once |
| `src/videos/videos.service.integration-spec.ts` | Integration | Against real MinIO + Redis: full flow — `initiateUpload` → `PUT` each part via `fetch` → `completeUpload` — results in a `processing` video and a job visible in the `video-processing` Redis queue (`queue.getJobCounts()`) |
| `test/videos.e2e-spec.ts` | E2E | `POST /videos/:id/complete-upload` with correct parts returns 200 with `status: 'processing'`; calling it twice returns 409 `UPLOAD_ALREADY_COMPLETED` on the second call; calling it for another channel's video returns 404 `VIDEO_NOT_FOUND` |

**Dependencies:** SI-03.1, SI-03.4

**Acceptance criteria:**

- `POST /videos/:id/complete-upload` with valid part ETags returns 200, the video's `status` becomes `processing`, and `upload_id` is cleared
- A job is enqueued on the `video-processing` queue with `{ videoId }` as payload and 3 retry attempts with exponential backoff
- Calling complete-upload on an already-`processing` (or `ready`/`error`) video returns 409 `UPLOAD_ALREADY_COMPLETED`
- Calling complete-upload on a video belonging to a different channel returns 404 `VIDEO_NOT_FOUND`

---

### SI-03.6 — Video Worker (Metadata Extraction, Thumbnail, Status Update)

**Description:** Build the standalone worker process: a second bootstrap entrypoint that consumes the `video-processing` queue, downloads the original from storage, runs `ffprobe` for metadata and `ffmpeg` for a thumbnail, uploads the thumbnail, and flips the video to `ready` or (after exhausting retries) `error`. Add the `video-worker` Compose service.

**Files:**
- Create: `nestjs-project/src/video-worker/main.ts`
- Create: `nestjs-project/src/video-worker/video-worker.module.ts`
- Create: `nestjs-project/src/video-worker/video-processing.processor.ts`
- Create: `nestjs-project/src/video-worker/video-processing.processor.integration-spec.ts`
- Modify: `nestjs-project/compose.yaml`

**Technical actions:**

- Create `src/video-worker/video-processing.processor.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Repository } from 'typeorm';
import * as ffmpeg from 'fluent-ffmpeg';
import * as ffmpegPath from 'ffmpeg-static';
import { path as ffprobePath } from '@ffprobe-installer/ffprobe';
import { createWriteStream, promises as fs } from 'fs';
import { extname, join } from 'path';
import { pipeline } from 'stream/promises';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import { StorageService } from '../storage/storage.service';
import { VIDEO_PROCESSING_QUEUE, ProcessVideoJobData } from '../queue/video-queue.constants';

ffmpeg.setFfmpegPath(ffmpegPath as unknown as string);
ffmpeg.setFfprobePath(ffprobePath);

@Injectable()
@Processor(VIDEO_PROCESSING_QUEUE)
export class VideoProcessingProcessor extends WorkerHost {
  constructor(
    @InjectRepository(Video) private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<ProcessVideoJobData>): Promise<void> {
    const video = await this.videoRepository.findOneByOrFail({
      id: job.data.videoId,
    });
    const tmpDir = '/tmp/video-processing';
    await fs.mkdir(tmpDir, { recursive: true });
    const tmpVideoPath = join(tmpDir, `${video.id}${extname(video.storage_key)}`);

    const { body } = await this.storageService.getObjectRange(video.storage_key);
    await pipeline(body, createWriteStream(tmpVideoPath));

    const metadata = await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
      ffmpeg.ffprobe(tmpVideoPath, (err, data) => (err ? reject(err) : resolve(data)));
    });

    const thumbnailFilename = `${video.id}-thumbnail.jpg`;
    await new Promise<void>((resolve, reject) => {
      ffmpeg(tmpVideoPath)
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .screenshots({
          timestamps: ['25%'],
          filename: thumbnailFilename,
          folder: tmpDir,
        });
    });

    const thumbnailBuffer = await fs.readFile(join(tmpDir, thumbnailFilename));
    const thumbnailKey = `videos/${video.channel_id}/${video.id}/thumbnail.jpg`;
    await this.storageService.putObject(thumbnailKey, thumbnailBuffer, 'image/jpeg');

    video.status = VideoStatus.READY;
    video.duration_seconds = Number(metadata.format.duration) || null;
    video.thumbnail_key = thumbnailKey;
    video.metadata = {
      width: metadata.streams.find((s) => s.codec_type === 'video')?.width,
      height: metadata.streams.find((s) => s.codec_type === 'video')?.height,
      codec: metadata.streams.find((s) => s.codec_type === 'video')?.codec_name,
      bitRate: metadata.format.bit_rate,
    };
    await this.videoRepository.save(video);

    await fs.rm(tmpVideoPath, { force: true });
    await fs.rm(join(tmpDir, thumbnailFilename), { force: true });
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<ProcessVideoJobData>): Promise<void> {
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= attempts) {
      await this.videoRepository.update(job.data.videoId, {
        status: VideoStatus.ERROR,
        error_message: job.failedReason ?? 'Video processing failed',
      });
    }
  }
}
```

- Create `src/video-worker/video-worker.module.ts` — `VideoWorkerModule` with `imports: [ConfigModule.forRoot({ isGlobal: true, load: [appConfig, databaseConfig, storageConfig, queueConfig], validationSchema: envValidationSchema, validationOptions: { allowUnknown: true, abortEarly: false } }), TypeOrmModule.forRootAsync({ ...same factory as AppModule... }), TypeOrmModule.forFeature([Video]), BullModule.forRootAsync({ ...same as QueueModule... }), BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE, ...concurrency from queueConfig via a WorkerOptions override if needed... })]`, `providers: [VideoProcessingProcessor, StorageService]`. Reuse the exact `TypeOrmModule.forRootAsync` factory body from `src/app.module.ts` (same `databaseConfig` injection) — do not duplicate connection logic differently.
- Create `src/video-worker/main.ts`:

```typescript
import { NestFactory } from '@nestjs/core';
import { VideoWorkerModule } from './video-worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(VideoWorkerModule);
  app.enableShutdownHooks();
}
bootstrap();
```

- Update `compose.yaml` — add:

```yaml
  video-worker:
    build:
      context: .
      dockerfile: Dockerfile.dev
    command: npm run start:worker:dev
    volumes:
      - .:/home/node/app
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
      minio-init:
        condition: service_completed_successfully
```

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `src/video-worker/video-processing.processor.integration-spec.ts` | Integration | Against real DB + MinIO + Redis: seed a `processing` video whose `storage_key` points at a real small test video fixture uploaded to MinIO beforehand; run `processor.process(job)` directly (not through the full queue) and assert the video becomes `ready` with `duration_seconds > 0`, `metadata.width`/`height` populated, and `thumbnail_key` set to an object that exists in MinIO; a second run with a corrupt/non-video file at the storage key results in `process()` throwing, and simulating `attemptsMade >= attempts` via `onFailed` sets `status = 'error'` with `error_message` populated |

**Dependencies:** SI-03.2, SI-03.3, SI-03.5

**Acceptance criteria:**

- `docker compose up -d video-worker` starts and stays running (`docker compose ps` shows `running`)
- Enqueuing a real job for a video whose `storage_key` is a valid small MP4 in MinIO results — within a few seconds — in that video's DB row reaching `status = 'ready'` with `duration_seconds`, `metadata`, and `thumbnail_key` all populated, and a thumbnail object retrievable from MinIO at `thumbnail_key`
- A video whose `storage_key` points at a non-video file reaches `status = 'error'` with a non-empty `error_message` after all retry attempts are exhausted
- `npx tsc --noEmit` exits 0 across both the API and worker entrypoints (single `tsconfig.json`, single compile)

---

### SI-03.7 — Video Detail Endpoint

**Description:** Public endpoint returning a video's current status and metadata by slug — used by the uploader to poll processing progress and, later phases, by any public video page.

**Files:**
- Create: `nestjs-project/src/videos/dto/video-detail.dto.ts`
- Modify: `nestjs-project/src/videos/videos.controller.ts`
- Modify: `nestjs-project/src/videos/videos.service.ts` (reuses `findBySlugOrFail` from SI-03.4)

**Technical actions:**

- Create `src/videos/dto/video-detail.dto.ts` — `VideoDetailDto` with `id: string`, `slug: string`, `title: string`, `status: VideoStatus`, `durationSeconds: number | null`, `thumbnailUrl: string | null`, `createdAt: Date`. Static `static async fromEntity(video: Video, storageService: StorageService): Promise<VideoDetailDto>` — `thumbnailUrl` is `null` unless `video.thumbnail_key` is set, in which case it's `await storageService.getPresignedGetUrl(video.thumbnail_key)`.
- Update `src/videos/videos.controller.ts` — add `@Public() @Get(':slug')` calling `videosService.findBySlugOrFail(slug)` then `VideoDetailDto.fromEntity(video, storageService)`, returning 200.

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `test/videos.e2e-spec.ts` | E2E | `GET /videos/:slug` for an existing video (any status) returns 200 with the full `VideoDetailDto` shape, no `Authorization` header required; `thumbnailUrl` is `null` for a `draft`/`processing` video and a working presigned URL for a `ready` one; unknown slug returns 404 `VIDEO_NOT_FOUND` |

**Dependencies:** SI-03.3, SI-03.4

**Acceptance criteria:**

- `GET /videos/:slug` is publicly accessible (no token) and returns 200 for any known slug regardless of status
- The response body matches `VideoDetailDto` exactly — `thumbnailUrl` is `null` until the worker sets `thumbnail_key`
- `GET /videos/:unknown-slug` returns 404 with `VIDEO_NOT_FOUND`

---

### SI-03.8 — Streaming Endpoint (Range Requests)

**Description:** Public range-aware streaming endpoint — proxies `GetObject` from storage with `Range` support so playback can start without downloading the whole file.

**Files:**
- Modify: `nestjs-project/src/videos/videos.controller.ts`

**Technical actions:**

- Add to `src/videos/videos.controller.ts`:

```typescript
@Public()
@Get(':slug/stream')
async stream(
  @Param('slug') slug: string,
  @Headers('range') range: string | undefined,
  @Res() res: Response,
): Promise<void> {
  const video = await this.videosService.findBySlugOrFail(slug);
  if (video.status !== VideoStatus.READY) {
    throw new VideoNotReadyException();
  }
  const { body, contentLength, contentRange, statusCode } =
    await this.storageService.getObjectRange(video.storage_key, range);
  res.status(statusCode);
  res.set({
    'Accept-Ranges': 'bytes',
    'Content-Type': video.mime_type,
    'Content-Length': String(contentLength),
    ...(contentRange && { 'Content-Range': contentRange }),
  });
  body.pipe(res);
}
```

  (import `Response` type-only from `express`, `Headers`/`Res` from `@nestjs/common`.)

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `test/videos.e2e-spec.ts` | E2E | `GET /videos/:slug/stream` with `Range: bytes=0-999` on a `ready` video returns 206 with `Content-Range` and exactly 1000 bytes of body; without a `Range` header returns 200 with the full object and `Accept-Ranges: bytes`; on a `draft`/`processing`/`error` video returns 409 `VIDEO_NOT_READY`; unknown slug returns 404 |

**Dependencies:** SI-03.3, SI-03.4

**Acceptance criteria:**

- Requesting with `Range: bytes=0-999` on a ready video returns `206 Partial Content` with `Content-Range: bytes 0-999/<total>` and a body of exactly 1000 bytes
- Requesting without a `Range` header returns `200 OK` with `Accept-Ranges: bytes` and the full file body
- Requesting a video that is not `ready` returns `409 VIDEO_NOT_READY`
- No authentication is required

---

### SI-03.9 — Download Endpoint

**Description:** Public download endpoint — redirects to a short-lived presigned GET URL with `Content-Disposition: attachment`.

**Files:**
- Modify: `nestjs-project/src/videos/videos.controller.ts`

**Technical actions:**

- Add to `src/videos/videos.controller.ts`:

```typescript
@Public()
@Get(':slug/download')
async download(
  @Param('slug') slug: string,
  @Res() res: Response,
): Promise<void> {
  const video = await this.videosService.findBySlugOrFail(slug);
  if (video.status !== VideoStatus.READY) {
    throw new VideoNotReadyException();
  }
  const url = await this.storageService.getPresignedGetUrl(
    video.storage_key,
    `attachment; filename="${video.original_filename}"`,
  );
  res.redirect(302, url);
}
```

**Tests:**

| File | Layer | Verifies |
|------|-------|----------|
| `test/videos.e2e-spec.ts` | E2E | `GET /videos/:slug/download` on a `ready` video returns 302 with a `Location` header pointing at a MinIO presigned URL that itself resolves (via `fetch`, `redirect: 'manual'`) to a `Content-Disposition: attachment` response; on a non-`ready` video returns 409 `VIDEO_NOT_READY` |

**Dependencies:** SI-03.3, SI-03.4

**Acceptance criteria:**

- `GET /videos/:slug/download` on a ready video returns 302 with a `Location` header; fetching that URL directly downloads the original file with the original filename in `Content-Disposition`
- Requesting download of a non-ready video returns 409 `VIDEO_NOT_READY`
- No authentication is required

---

## Technical Specifications

### Data Model

#### Video

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, generated | |
| channel_id | uuid | FK → channels.id, not null | Owning channel |
| title | varchar(150) | not null | |
| slug | varchar(11) | unique, not null | `crypto.randomBytes(8).toString('base64url')`; public identifier |
| status | enum | not null, default `'draft'` | `draft` \| `processing` \| `ready` \| `error` |
| storage_key | varchar | not null | Object key of the original video in the bucket |
| thumbnail_key | varchar | nullable | Set by the worker on success |
| upload_id | varchar | nullable | S3 multipart UploadId; cleared once completed |
| original_filename | varchar | not null | |
| mime_type | varchar | not null | Must start with `video/` |
| file_size_bytes | bigint | not null | Client-declared at initiation |
| duration_seconds | float | nullable | Set by the worker from `ffprobe` |
| metadata | jsonb | nullable | `{ width, height, codec, bitRate }` from `ffprobe` |
| error_message | text | nullable | Set by the worker on final failure |
| created_at | timestamp | not null, auto-generated | |
| updated_at | timestamp | not null, auto-generated | |

**Relations:** Video → Channel (many-to-one)
**Indexes:** `(slug)` — unique, `(channel_id)` — FK

---

### API Contracts

#### POST /videos (SI-03.4)

**Request headers:** `Authorization: Bearer <access_token>`, `Content-Type: application/json`

**Request body:** `title` (string, 1–150 chars, required), `originalFilename` (string, required), `mimeType` (string, must match `/^video\//`, required), `fileSizeBytes` (integer, 1–10737418240, required)

**Response 201:** `id` (uuid), `slug` (string), `uploadId` (string), `parts` (array of `{ partNumber: number, url: string }`)

**Error responses:** 400 validation error; 401 missing/invalid token

---

#### POST /videos/:id/complete-upload (SI-03.5)

**Request headers:** `Authorization: Bearer <access_token>`, `Content-Type: application/json`

**Request body:** `parts` (array of `{ partNumber: number, etag: string }`, min 1 item, required)

**Response 200:** `id`, `slug`, `status: 'processing'`

**Error responses:** 404 `VIDEO_NOT_FOUND` (unknown id or not owned by caller); 409 `UPLOAD_ALREADY_COMPLETED` (video not in `draft`); 422 `MULTIPART_UPLOAD_FAILED` (S3 complete call failed); 400 validation error; 401

---

#### GET /videos/:slug (SI-03.7)

**Response 200:** `id`, `slug`, `title`, `status`, `durationSeconds` (nullable), `thumbnailUrl` (nullable), `createdAt`

**Error responses:** 404 `VIDEO_NOT_FOUND`

---

#### GET /videos/:slug/stream (SI-03.8)

**Request headers:** `Range: bytes=<start>-<end>` (optional)

**Response 200 or 206:** video bytes, `Accept-Ranges: bytes`, `Content-Type`, `Content-Length`, `Content-Range` (only on 206)

**Error responses:** 404 `VIDEO_NOT_FOUND`; 409 `VIDEO_NOT_READY`

---

#### GET /videos/:slug/download (SI-03.9)

**Response 302:** `Location` header — presigned GET URL with `Content-Disposition: attachment`

**Error responses:** 404 `VIDEO_NOT_FOUND`; 409 `VIDEO_NOT_READY`

---

### Authorization Matrix

| Endpoint | Public | Authenticated | Notes |
|----------|--------|----------------|-------|
| POST /videos | | ✓ | Draft created for the caller's own channel |
| POST /videos/:id/complete-upload | | ✓ | Must own the video (404 if not) |
| GET /videos/:slug | ✓ | | Any status, any caller |
| GET /videos/:slug/stream | ✓ | | Requires `status = ready` |
| GET /videos/:slug/download | ✓ | | Requires `status = ready` |

---

### Error Catalog

| Code | HTTP | Message | Trigger |
|------|------|---------|---------|
| VIDEO_NOT_FOUND | 404 | Video not found | Unknown slug/id, or id not owned by the requesting channel |
| VIDEO_NOT_READY | 409 | Video is not ready for playback | `GET .../stream` or `.../download` when `status != ready` |
| UPLOAD_ALREADY_COMPLETED | 409 | Upload has already been completed for this video | `complete-upload` called when `status != draft` |
| MULTIPART_UPLOAD_FAILED | 422 | Failed to complete the multipart upload | S3 `CompleteMultipartUpload` call fails (e.g. mismatched ETags) |

(Validation errors continue to use the existing `VALIDATION_ERROR` / 400 contract from Phase 02.)

---

### Events/Messages

**Queue:** `video-processing` (BullMQ, Redis-backed)
**Job name:** `process-video`
**Payload:** `{ videoId: string }` — the worker re-reads the video row for all storage keys/metadata rather than carrying them in the payload, avoiding stale-job-data bugs.
**Producer:** `VideoQueueService.enqueueProcessing(videoId)`, called from `VideosService.completeUpload` immediately after the video transitions to `processing`.
**Consumer:** `VideoProcessingProcessor` (`@Processor('video-processing')`, `WorkerHost.process()`), running in the separate `video-worker` process/container.
**Retry policy:** `attempts: 3` (configurable via `VIDEO_PROCESSING_ATTEMPTS`), `backoff: { type: 'exponential', delay: 5000 }`.
**Terminal failure:** `@OnWorkerEvent('failed')` checks `job.attemptsMade >= job.opts.attempts`; on the final attempt it sets `video.status = 'error'` and `video.error_message = job.failedReason`.
**Success:** the processor itself sets `video.status = 'ready'` plus `duration_seconds`/`metadata`/`thumbnail_key` before returning — no separate "completed" event is needed since worker and API share one database.

---

## Dependency Map

```
SI-03.1 (no deps)
SI-03.2 (no deps — parallel with SI-03.1)

SI-03.1
└── SI-03.3

SI-03.2 + SI-03.3
└── SI-03.4
    ├── SI-03.7 (+ SI-03.3)
    ├── SI-03.8 (+ SI-03.3)
    ├── SI-03.9 (+ SI-03.3)
    └── SI-03.5 (+ SI-03.1)
        └── SI-03.6 (+ SI-03.2, SI-03.3)
```

Linearized/parallel execution order for `subagent-driven-development`:
1. **Round 1 (parallel):** SI-03.1, SI-03.2
2. **Round 2:** SI-03.3
3. **Round 3:** SI-03.4
4. **Round 4 (parallel):** SI-03.5, SI-03.7, SI-03.8, SI-03.9
5. **Round 5:** SI-03.6

Round 4 is where haiku-4.5 parallel subagents pay off most — four independent SIs, all blocked only on SI-03.4, none touching the same files (SI-03.5 adds new files + edits `videos.service.ts`/`videos.controller.ts`/`videos.module.ts`; SI-03.7/03.8/03.9 each add one controller method to `videos.controller.ts` — **run these three sequentially against the same file, or split each into its own branch/worktree and merge**, since three subagents editing `videos.controller.ts` concurrently will conflict).

---

## Deliverables

- [ ] `docs/decisions/technical-decisions-phase-03-videos.md` with TD-01–TD-05 resolved and justified
- [ ] MinIO + Redis + `video-worker` all reachable via `docker compose up -d`
- [ ] `videos` table created by migration, FK to `channels`
- [ ] Upload initiation returns presigned multipart-upload URLs sized from a client-declared file size, up to 10GiB, without the API ever touching video bytes
- [ ] Upload completion transitions `draft → processing` and enqueues a `video-processing` job
- [ ] Worker extracts duration + metadata via `ffprobe` and a thumbnail via `ffmpeg` screenshot, transitioning `processing → ready`
- [ ] Worker transitions `processing → error` with a stored `error_message` after retries are exhausted
- [ ] Every video has a unique, collision-free `slug` used in all public routes
- [ ] Streaming endpoint supports HTTP Range requests (206 Partial Content)
- [ ] Download endpoint issues a presigned redirect with the original filename
- [ ] `nestjs-project/CLAUDE.md` updated with a "Videos" section (module layout, endpoints, queue, storage, worker bootstrap/compose command) — not covered by this plan; do as the phase's closing task, mirroring how Phase 02 additions were documented
- [ ] All SI tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] `npx tsc --noEmit` exits 0 (API and worker share one `tsconfig.json`)
- [ ] `npm run lint` passes
- [ ] `docs/phases/phase-03-videos/progress.md` maintained SI-by-SI during execution (not produced by this plan — start it when SI-03.1 execution begins)
- [ ] `docs/phases/phase-03-videos/library-refs.md` produced during SI-03.1 execution, recording the context7-confirmed versions of every new dependency
