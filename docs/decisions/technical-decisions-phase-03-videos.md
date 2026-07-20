---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-07-20
scope_description: "Backend video pipeline: object storage (MinIO), background queue (Redis/BullMQ), video worker, and videos module for upload, processing, and streaming."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend that delivers video upload endpoints, presigned-URL generation, video metadata extraction, thumbnail generation, job queuing, and streaming/download proxies.
- `next-frontend/` — Frontend deferred: video upload UI, player, and channel management will be addressed in a future phase when `next-frontend/` is initialized. No open decision in this document.

---

## TD-01: Background Processing Queue

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** PROJECT_INSTRUCTIONS.md leaves the queue technology explicitly TBD. It must support reliable job delivery, retries with backoff, and a worker that can run as its own process/container.

**Options:**

### Option A: BullMQ + Redis
Redis-backed job queue, official `@nestjs/bullmq` integration (`BullModule.registerQueue`, `@Processor`/`WorkerHost`, `@InjectQueue`). Supports a `Worker` running in a fully separate process against the same Redis instance and queue name.
- **Pros:** One lightweight new infra dependency (Redis, already the natural cache/session choice for later phases). First-class NestJS module. Built-in retries/backoff/concurrency/job-events out of the box — no hand-rolled retry logic. Large ecosystem (Bull Board for observability, if ever needed).
- **Cons:** Redis is at-most-a-cache by default (needs `appendonly yes` for durability across restarts — acceptable for a dev/course Compose setup, called out explicitly below). Not a message broker in the AMQP/pub-sub sense — fine here since we need a job queue, not routing.

### Option B: RabbitMQ (amqplib / `@nestjs/microservices` RMQ transport)
AMQP broker with `@nestjs/microservices`.
- **Pros:** Battle-tested broker, native `@nestjs/microservices` transport, richer routing (exchanges/topics) than needed here.
- **Cons:** Heavier operationally (its own management UI, exchange/queue/binding setup) for a single job type (`process-video`). `@nestjs/microservices` RMQ transport does not give retry/backoff/job-state tracking for free — that logic would be hand-rolled on top, duplicating what BullMQ ships natively.

**Recommendation:** **Option A (BullMQ + Redis).** A single job type with built-in retry/backoff is exactly BullMQ's design center; RabbitMQ's extra routing power isn't needed and its extra operational surface isn't justified for a course-scoped Phase 03.

**Decision:** A (BullMQ + Redis)

---

## TD-02: 10GB Upload Strategy

**Scope:** Backend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** Passing a 10GB file through the NestJS process (buffered or even streamed through Express/Multer) ties up a request handler and Node process memory/IO for the whole transfer — explicitly called out as the wrong approach in PROJECT_INSTRUCTIONS.md.

**Options:**

### Option A: Direct-to-storage upload via S3 multipart presigned URLs
API creates the draft `Video` row and an S3 `CreateMultipartUpload`, then returns one presigned `UploadPart` URL per part (100MiB parts) computed from the client-declared file size. The client (or, for this backend-only phase, the test harness) `PUT`s each part directly to MinIO. The client then calls `POST /videos/:id/complete-upload` with the returned ETags; the API calls `CompleteMultipartUpload` and enqueues processing.
- **Pros:** Zero video bytes ever pass through the NestJS process — the API's job is 100% metadata (create row, presign URLs, mark complete). Resumable/parallelizable per-part on the client side. Matches the S3/MinIO API the project already commits to.
- **Cons:** More moving parts than a single presigned PUT (multipart create/complete/abort lifecycle). Client is responsible for tracking part ETags.

### Option B: Single presigned PUT (no multipart)
One presigned `PutObject` URL for the whole file.
- **Pros:** Simpler API surface (one URL, one PUT).
- **Cons:** A single 10GB PUT over one TCP connection has no resumability — any interruption restarts the entire transfer. Real S3 caps a single PUT at 5GB, so this doesn't even reach the 10GB requirement on real S3 (MinIO is more lenient, but the plan must not assume a MinIO-only production target since PROJECT_INSTRUCTIONS says S3 in production).

**Recommendation:** **Option A (multipart presigned upload).** It is the only option that actually satisfies "up to 10GB" against real S3 semantics and gives per-part resumability.

**Decision:** A (S3 multipart presigned upload, 100MiB parts)

---

## TD-03: Worker Architecture and Metadata/Thumbnail Extraction

**Scope:** Backend

**Capability:** Processamento automático do vídeo (duração/metadados) + geração automática de thumbnail

**Context:** The worker must run as its own process/container (per PROJECT_INSTRUCTIONS.md) and needs FFmpeg to inspect and thumbnail the video.

**Decision:** The worker is a **second bootstrap entrypoint inside the same `nestjs-project` codebase** (`src/video-worker/main.ts`, `NestFactory.createApplicationContext`), not a separate package. It reuses the same `Video` TypeORM entity, the same `registerAs` config pattern, and the same `StorageService` as the API — this is the "continuity, not rework" principle from `CLAUDE.md` applied literally: one dependency tree, one migration history, one set of conventions. It runs as its own Compose service (`video-worker`) with its own `CMD`, consuming the `video-processing` BullMQ queue via `@Processor`/`WorkerHost`. FFmpeg/ffprobe come from the npm-vendored static binaries `ffmpeg-static` + `@ffprobe-installer/ffprobe` (glibc-linked, compatible with the existing `node:25.6.0-slim` — Debian, not Alpine — base image) driven through `fluent-ffmpeg`, avoiding any Dockerfile/apt changes. Metadata comes from `ffmpeg.ffprobe()` (duration, width, height, codec, bitrate); the thumbnail comes from `.screenshots({ timestamps: ['25%'] })` (a frame 25% into the video, per the "generate from a frame" requirement — picked over `0%`/`00:00` to avoid black opening frames/intro cards being common at true start).

---

## TD-04: Unique URL and Streaming Strategy

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito + reprodução via streaming

**Context:** Every video needs a short, collision-free public identifier, and playback must start without downloading the whole file.

**Decision:** Every `Video` gets a `slug` column: `crypto.randomBytes(8).toString('base64url')` (11 URL-safe characters, no new dependency — reuses the same `crypto.randomBytes` primitive already used for `verification_tokens`). Collision handling mirrors the existing `ChannelsService.createChannel` pattern from SI-02.15: attempt the insert, and on a Postgres unique-violation (`QueryFailedError`, code `23505`, detail mentioning `slug`) regenerate and retry (max 5 attempts) rather than pre-checking then racing. All public-facing routes key off the slug (`/videos/:slug`, `/videos/:slug/stream`, `/videos/:slug/download`); mutation routes (initiate/complete upload) key off the internal `id` (uuid), which only the owner ever sees in the creation response.

Streaming is a **range-aware proxy through the API**, not a redirect to a presigned MinIO URL: the API parses the `Range` header, issues an S3 `GetObjectCommand` with the same `Range`, and pipes the returned body back with `206 Partial Content` (or `200` + `Accept-Ranges: bytes` when no `Range` header is sent). This keeps the API as the single access-control point (needed once Phase 04 adds draft/unlisted visibility) and keeps the public URL stable regardless of the underlying storage backend (MinIO in dev, S3 in prod).

Download uses a **302 redirect to a short-lived presigned GET URL** (`ResponseContentDisposition: attachment`) instead of proxying — a full-file download has no access-control nuance beyond "is this video ready," so there's no reason to double the bandwidth through the API for what is, by definition, the entire file.

**Decision:** slug = `crypto.randomBytes(8).toString('base64url')` with insert-then-retry collision handling; stream = API range-proxy; download = presigned-redirect.

---

## TD-05: Video Status Lifecycle

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

## Decisions Summary

| ID | Decision | Related Capability |
|----|----------|-------------------|
| TD-01 | BullMQ + Redis | Serviço de processamento em segundo plano (filas) |
| TD-02 | S3 multipart presigned upload, 100MiB parts | Upload de vídeos com suporte a arquivos de até 10GB |
| TD-03 | Worker as second entrypoint in same codebase; FFmpeg/ffprobe from npm static binaries; 25% frame for thumbnail | Processamento automático do vídeo (duração/metadados) + geração automática de thumbnail |
| TD-04 | slug = `crypto.randomBytes(8).toString('base64url')`; stream = API range-proxy; download = presigned-redirect | URL única por vídeo, sem conflito + reprodução via streaming |
| TD-05 | Four states: draft → processing → ready/error | Ciclo de status do vídeo e comportamento em caso de falha |
