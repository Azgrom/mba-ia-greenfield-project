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

Run 2026-07-21 (Task 6, final branch verification):

- Unit and integration suite: passed, `32` suites / `200` tests
- E2E suite: passed, `4` suites / `92` tests
- TypeScript compile: passed, exit `0`
- `npx eslint "{src,apps,libs,test}/**/*.ts"`: failed, exit `1`, blocker: `260` pre-existing problems (`216` errors, `44` warnings) — all in files outside Phase 03's touched set (e.g. `@typescript-eslint/no-unsafe-assignment`, `@typescript-eslint/unbound-method`, `@typescript-eslint/no-unsafe-member-access`, `@typescript-eslint/require-await` in `src/auth/auth.service.spec.ts`, `src/auth/auth.service.integration-spec.ts`, `src/channels/channels.service.ts`, `src/channels/channels.service.spec.ts`, `src/common/filters/domain-exception.filter.spec.ts`, `src/common/filters/validation-exception.filter.spec.ts`, `src/config/env.validation.integration-spec.ts`, `src/mail/mail.service.integration-spec.ts`, `src/queue/video-queue.service.spec.ts`, `src/test/create-test-data-source.ts`, `src/users/users.service.integration-spec.ts`, `src/videos/videos.service.spec.ts`, `src/videos/videos.service.integration-spec.ts`, `test/auth.e2e-spec.ts`). Confirmed pre-existing and not introduced by Tasks 1-5: a targeted lint run against only the files those tasks actually changed (`src/database/migrations.integration-spec.ts`, `src/video-worker/video-processing.processor.ts`, `src/video-worker/video-processing.processor.integration-spec.ts`, `src/video-worker/video-processing.queue.integration-spec.ts`, `src/videos/videos.service.ts`, `test/videos.e2e-spec.ts`) exits `0`:
  ```bash
  docker compose run --rm --workdir /home/node/app \
    --env DB_HOST=db --env DB_USERNAME=streamtube --env DB_PASSWORD=streamtube --env DB_NAME=streamtube \
    --env JWT_SECRET=test-access-secret --env JWT_REFRESH_SECRET=test-refresh-secret \
    --env STORAGE_ACCESS_KEY=streamtube --env STORAGE_SECRET_KEY=streamtube123 \
    nestjs-api npx eslint \
      "src/database/migrations.integration-spec.ts" \
      "src/video-worker/video-processing.processor.integration-spec.ts" \
      "src/video-worker/video-processing.processor.ts" \
      "src/video-worker/video-processing.queue.integration-spec.ts" \
      "src/videos/videos.service.ts" \
      "test/videos.e2e-spec.ts"
  ```
  This debt was already documented pre-remediation (`docs/phases/phase-03-videos/progress.md`'s 2026-07-20 handoff notes recorded 264 pre-existing repo-wide problems on `dev`, human-scoped as "no NEW debt beyond matching an already-established codebase pattern" — the current 260 count is consistent with that baseline, not a regression). Because the repo-wide command is the required gate and it did not exit `0`, this remains an open blocker per the letter of the Definition of Done, even though no Phase 03 remediation file is implicated.
- Docker services: passed — `docker compose config --services` includes `nestjs-api`, `db`, `mailpit`, `redis`, `minio`, `minio-init`, `video-worker`

## Known Non-Blocking Follow-Ups

- Stream error handler does not log the underlying storage stream error.
- `completeUpload` still has no reconciliation job for videos left in `processing` after enqueue exhaustion; current behavior intentionally fails loudly with `VIDEO_PROCESSING_ENQUEUE_FAILED`.
