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
  This debt was already documented pre-remediation (`docs/phases/phase-03-videos/progress.md`'s 2026-07-20 handoff notes recorded 264 pre-existing repo-wide problems on `dev`, human-scoped as "no NEW debt beyond matching an already-established codebase pattern" — the current 260 count is consistent with that baseline, not a regression). Human decision (2026-07-21): accepted as pre-existing out-of-scope baseline debt, consistent with the SI-03.4 precedent — Phase 03's own gate is the targeted lint pass above, not the repo-wide command. Full-repo lint cleanup remains a separate out-of-scope follow-up task.

  **Correction (2026-07-28).** The claim above that the `216` errors were "all in files outside Phase 03's touched set" was **wrong**, and the sentence contradicts itself: it lists `src/videos/videos.service.spec.ts`, `src/videos/videos.service.integration-spec.ts` and `src/queue/video-queue.service.spec.ts` — three files Phase 03 itself created. The targeted lint command above exits `0` only because it omits those three spec files; it lints `src/videos/videos.service.ts` but none of the specs written alongside it. `66` of the `216` errors were Phase 03's own, so the phase's lint gate never genuinely closed. Fixed on `fix/phase-03-lint-errors` (`8dfa167`), which cleans all `66` at the source rather than rescoping the criterion. Post-fix repo-wide count: `190` problems (`150` errors, `40` warnings), with **zero** in `src/videos/` and `src/queue/`. The remaining `150` errors are genuinely Phase 01/02 files (`test/auth.e2e-spec.ts`, `src/auth/`, `src/mail/`, `src/channels/`, `src/common/filters/`, `src/config/`, `src/test/`, `src/users/`) and still make the unscoped `npm run lint` exit `1` — see the open follow-up below.
- Docker services: passed — `docker compose config --services` includes `nestjs-api`, `db`, `mailpit`, `redis`, `minio`, `minio-init`, `video-worker`

## Final Whole-Branch Review (2026-07-21)

After Tasks 1-6, a final whole-branch review (`473f97e..59cf5d3`) found the six tasks compose cleanly with no cross-task integration issues, both Task 2 deviations verified as genuine improvements, and all global constraints (upload strategy, public route contracts) upheld. One Important finding: the `VIDEO_WORKER_CONCURRENCY` wiring added in Task 4 passed its unit test but did not actually take effect in the real deployed worker — the `@Processor` decorator's `concurrency` option is evaluated at import time, before NestJS's `ConfigModule.forRoot()` loads `.env`, so the env var was always `undefined` at that point in `npm run start:worker:dev` (masked in tests by Jest's own `dotenv/config` preload). Fixed in `45114b6` by adding the same `-r dotenv/config` preload to the `start:worker:dev` script; verified with a before/after test (`undefined` → `7`) against the real startup command, and re-reviewed clean.

## Open Blocker (2026-07-28)

- **`npm run lint` still exits `1`** with `150` errors in Phase 01/02 files. `PROJECT_INSTRUCTIONS.md` states the Definition of Done unconditionally ("a fase só está pronta quando … `npm run lint` passa") and lists "lint quebrado" under **Reprova automática** — it grants no scoped-to-the-diff exemption. The 2026-07-21 human decision to scope the gate to changed files, and the matching edit to `CLAUDE.md`'s DoD (commit `fdccc8e`), therefore do not satisfy the challenge's stated criterion. Phase 03's own contribution is now clean; closing the DoD requires clearing the remaining `150` Phase 01/02 errors. Tracked as a separate task — it is out of scope for `fix/phase-03-lint-errors`, which was deliberately limited to Phase 03's own files.

## Known Non-Blocking Follow-Ups

- Stream error handler does not log the underlying storage stream error.
- `completeUpload` still has no reconciliation job for videos left in `processing` after enqueue exhaustion; current behavior intentionally fails loudly with `VIDEO_PROCESSING_ENQUEUE_FAILED`.
- `dotenv` is relied on via `-r dotenv/config` in both Jest's `setupFiles` and now `start:worker:dev`, but is not declared as an explicit `dependency`/`devDependency` in `nestjs-project/package.json` — it currently resolves only because it's hoisted as a transitive dependency of `@nestjs/config`/`typeorm`. Recommend declaring it explicitly.
- `queueConfig.videoWorkerConcurrency` (`src/config/queue.config.ts`) is now dead config — the worker reads `process.env.VIDEO_WORKER_CONCURRENCY` directly via `resolveVideoWorkerConcurrency`, not through this config field, and the two disagree on how `'0'` resolves. Consider removing the unused field or routing through it instead.
- `isPgUniqueViolationOnColumn` remains duplicated between `videos.service.ts` and `channels.service.ts` with slightly different typings; a shared extraction to `src/common/` was correctly out of scope for this remediation.
