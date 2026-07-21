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
