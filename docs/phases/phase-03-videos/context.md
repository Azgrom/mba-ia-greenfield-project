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
