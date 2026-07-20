# Phase 03 Library References

This document records the exact versions of all new dependencies installed during Phase 03 (Video Upload & Processing), confirmed via npm installation and `package.json`.

## Production Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@aws-sdk/client-s3` | ^3.1090.0 | S3-compatible object storage client (MinIO/S3) for video upload/download operations |
| `@aws-sdk/s3-request-presigner` | ^3.1090.0 | Presigned URL generator for S3 multipart uploads and downloads |
| `bullmq` | ^5.80.9 | Redis-backed job queue for background video processing |
| `@nestjs/bullmq` | ^11.0.4 | NestJS integration module for BullMQ (decorators, DI support) |
| `fluent-ffmpeg` | ^2.1.3 | Node.js wrapper around FFmpeg CLI for video processing (extraction, transcoding, thumbnailing) |
| `ffmpeg-static` | ^5.3.0 | Vendored FFmpeg static binary (glibc-linked, compatible with Debian base image) |
| `@ffprobe-installer/ffprobe` | ^2.1.2 | Vendored ffprobe static binary for video metadata extraction (duration, codec, dimensions) |

## Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@types/fluent-ffmpeg` | ^2.1.28 | TypeScript type definitions for fluent-ffmpeg |

## Notes

- All versions use npm semver caret syntax (`^`), allowing minor and patch updates within the major version.
- AWS SDK v3 (modular) is used instead of v2 (monolithic) for smaller bundle size and first-class TypeScript support.
- FFmpeg/ffprobe are sourced from npm-vendored static binaries (`ffmpeg-static`, `@ffprobe-installer/ffprobe`) to avoid Dockerfile/APK changes and ensure compatibility with the existing `node:25.6.0-slim` (Debian) base image.
- BullMQ is paired with Redis (infrastructure-only, no npm package here) for reliable job delivery, built-in retries, and concurrency control.
- `fluent-ffmpeg` is flagged deprecated on the npm registry ("Package no longer supported"). Kept per the plan's explicit TD-03 decision (Phase 03 plan, SI-03.1 Technical actions) — no actively maintained alternative wrapper was substituted. Whoever implements SI-03.6 (the worker) should be aware they're depending on an unmaintained wrapper around FFmpeg CLI calls; if this becomes a real problem, replace it with direct `child_process` calls to the vendored `ffmpeg-static`/`@ffprobe-installer/ffprobe` binaries rather than swapping in a different wrapper library.
