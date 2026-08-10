---
kind: phase
name: phase-03-videos
status: clean
issue_count: 0
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-07-24T20:21:57-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-07-24T20:21:57-03:00"
issues:
  - id: LINT-1
    status: resolved
    summary: "Phase 03's own 66 lint errors in src/videos/ and src/queue/ specs; the 2026-07-21 'all outside Phase 03' claim was false"
    resolved_by: "8dfa167 (bugfix/phase-03-lint-errors) — cleaned all 66 at the source"
  - id: LINT-2
    status: resolved
    summary: "Repo-wide npm run lint still exited 1 with 150 remaining Phase 01/02 errors"
    resolved_by: "d86322a (bugfix/phase-01-02-lint-errors) — cleared all 150; DoD restored to the unconditional repo-wide gate in e4f6c06"
  - id: LINT-3
    status: resolved
    summary: "Last @typescript-eslint/no-unsafe-argument warning at src/auth/auth.service.integration-spec.ts:479"
    resolved_by: "f32fc58 — IsNull() for the refresh-token grace-period assertion; eslint now reports 0 errors AND 0 warnings across 111 files"
  - id: WORKER-1
    status: resolved
    summary: "video-worker Compose service crashed on every boot — VideoWorkerModule registered forFeature([Video]) only, so TypeORM could not resolve Video.channel -> Channel.user and failed metadata build; queue accumulated jobs with zero consumers"
    resolved_by: "bugfix/phase-03-ac-verification — forFeature([Video, Channel, User]) + video-worker.module.integration-spec.ts as the missing boot seam"
  - id: TEST-1
    status: resolved
    summary: "videos.service.integration-spec.ts assumed no live queue consumer; once video-worker actually ran it failed with 'Job could not be removed because it is locked by another worker'"
    resolved_by: "bugfix/phase-03-ac-verification — queue.pause()/resume() around the enqueue assertion; verified green with the worker both up and down"
advisories:
  - id: ADV-2
    status: open
    summary: "npm run lint carries --fix, so the DoD gate mutates the tree while measuring it; a truthful measurement needs npx eslint without --fix"
  - id: ADV-3
    status: open
    summary: "dotenv is relied on via -r dotenv/config but is not a declared dependency in package.json (resolves only as a transitive hoist)"
  - id: ADV-4
    status: open
    summary: "queueConfig.videoWorkerConcurrency is dead config — the worker reads process.env.VIDEO_WORKER_CONCURRENCY directly"
---

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

  **Correction (2026-07-28).** The claim above that the `216` errors were "all in files outside Phase 03's touched set" was **wrong**, and the sentence contradicts itself: it lists `src/videos/videos.service.spec.ts`, `src/videos/videos.service.integration-spec.ts` and `src/queue/video-queue.service.spec.ts` — three files Phase 03 itself created. The targeted lint command above exits `0` only because it omits those three spec files; it lints `src/videos/videos.service.ts` but none of the specs written alongside it. `66` of the `216` errors were Phase 03's own, so the phase's lint gate never genuinely closed. Fixed on `bugfix/phase-03-lint-errors` (`8dfa167`), which cleans all `66` at the source rather than rescoping the criterion. Post-fix repo-wide count: `190` problems (`150` errors, `40` warnings), with **zero** in `src/videos/` and `src/queue/`. The remaining `150` errors were genuinely Phase 01/02 files (`test/auth.e2e-spec.ts`, `src/auth/`, `src/mail/`, `src/channels/`, `src/common/filters/`, `src/config/`, `src/test/`, `src/users/`) and kept the unscoped `npm run lint` at exit `1` until they were cleared on `bugfix/phase-01-02-lint-errors` — see the resolved blocker below.
- Docker services: passed — `docker compose config --services` includes `nestjs-api`, `db`, `mailpit`, `redis`, `minio`, `minio-init`, `video-worker`

## Final Whole-Branch Review (2026-07-21)

After Tasks 1-6, a final whole-branch review (`473f97e..59cf5d3`) found the six tasks compose cleanly with no cross-task integration issues, both Task 2 deviations verified as genuine improvements, and all global constraints (upload strategy, public route contracts) upheld. One Important finding: the `VIDEO_WORKER_CONCURRENCY` wiring added in Task 4 passed its unit test but did not actually take effect in the real deployed worker — the `@Processor` decorator's `concurrency` option is evaluated at import time, before NestJS's `ConfigModule.forRoot()` loads `.env`, so the env var was always `undefined` at that point in `npm run start:worker:dev` (masked in tests by Jest's own `dotenv/config` preload). Fixed in `45114b6` by adding the same `-r dotenv/config` preload to the `start:worker:dev` script; verified with a before/after test (`undefined` → `7`) against the real startup command, and re-reviewed clean.

## Lint Blocker — Resolved (2026-07-29)

- **Opened 2026-07-28.** After Phase 03's own `66` errors were cleared, `npm run lint` still exited `1` with `150` errors in Phase 01/02 files. `PROJECT_INSTRUCTIONS.md` states the Definition of Done unconditionally ("a fase só está pronta quando … `npm run lint` passa") and lists "lint quebrado" under **Reprova automática** — it grants no scoped-to-the-diff exemption. The 2026-07-21 human decision to scope the gate to changed files, and the matching edit to `CLAUDE.md`'s DoD (commit `fdccc8e`), therefore did not satisfy the challenge's stated criterion.
- **Closed 2026-07-29** on `bugfix/phase-01-02-lint-errors` (`d86322a`), which cleared all `150` at the source. The errors came from the same two patterns as Phase 03: `as any` fixtures leaking through downstream assertions, and unbound method references inside `expect()`. Only one production file was touched (`channels.service.ts`, adopting the `PgDriverError` shape already used by `videos.service.ts` — no behaviour change); everything else is test code. No assertion was dropped or weakened — the matcher census and `it()` count are identical before and after in every rewritten file.
- **Current state:** `npm run lint` exits `0` (`0` errors, `1` warning), `npx tsc --noEmit` exits `0`, `32` suites / `200` tests and `4` e2e suites / `92` tests pass. `CLAUDE.md`'s DoD item 4 was restored to the unconditional repo-wide gate in the same branch.
- The single remaining warning is `@typescript-eslint/no-unsafe-argument` at `src/auth/auth.service.integration-spec.ts:479`. Warnings do not fail `npm run lint`; left as a non-blocking follow-up.

## Worker Boot Blocker — Resolved (2026-07-29)

- **Found 2026-07-29** during the acceptance-criteria verification pass (see `acceptance-validation.md`, finding `WORKER-1`). `docker compose ps --all` showed `video-worker` in state `exited` with exit code `1`. Every boot died with `TypeORMError: Entity metadata for Video#channel was not found`, 10 TypeORM retries then process death — reproduced across two independent boots ~10 h apart.
- **Root cause.** `src/video-worker/video-worker.module.ts` used `autoLoadEntities: true` with `TypeOrmModule.forFeature([Video])`. `autoLoadEntities` registers only what `forFeature` declares, so `Channel` (and transitively `User`, via `Channel.user`) were never registered, and TypeORM cannot build `Video`'s metadata without the target of its `@ManyToOne(() => Channel)`. A missing relation target fails the **entire** boot, not just channel access. `src/videos/videos.module.ts` registers `[Video, Channel]`, which is why `nestjs-api` booted fine — the same DataSource config, a different entity set.
- **Impact while broken.** Zero consumers on `video-processing`: Redis held `5` jobs in `bull:video-processing:wait` with `0` active. Videos reached `processing` on `complete-upload` and stayed there permanently — `duration_seconds`, `metadata`, and `thumbnail_key` all stayed `null`, and `/stream` and `/download` answered `409` because the video never became `ready`. The `error` branch was equally unreachable. Four AC bullets and one Reprova clause were failing in the real stack while all 200 tests stayed green.
- **Why the suite missed it.** No test booted `VideoWorkerModule`. `video-processing.processor.integration-spec.ts` and `video-processing.queue.integration-spec.ts` each rebuild the module graph by hand with their own `ConfigModule` + `TypeOrmModule` + entity list, so they exercised the processor while bypassing the module's own registration — the exact seam that was broken.
- **Fixed** on `bugfix/phase-03-ac-verification`: `forFeature([Video, Channel, User])`, plus `src/video-worker/video-worker.module.integration-spec.ts`, which boots the real `VideoWorkerModule` the way `NestFactory.createApplicationContext` does. Red-green verified: `3 failed` with the production `TypeORMError` before the fix, `3 passed` in `1.9 s` after.
- **Follow-on `TEST-1`.** With the worker finally alive, `videos.service.integration-spec.ts` began failing — `Job 38 could not be removed because it is locked by another worker`. The spec assumed no live consumer existed on the queue. Confirmed by differential: worker stopped → `7 passed`; worker running → `1 failed`. Fixed with `queue.pause()` before the enqueue assertion and `queue.resume()` in a `finally`; verified green in both worker states, and Redis confirmed not left paused.

### Live verification (2026-07-29, worker running)

| Gate | Command | Result |
|---|---|---|
| TypeScript | `docker compose exec nestjs-api npx tsc --noEmit` | exit `0` |
| Lint (true gate) | `docker compose exec nestjs-api npx eslint "{src,apps,libs,test}/**/*.ts"` | exit `0` — **0 errors, 0 warnings, 111 files** |
| Lint (DoD literal) | `docker compose exec nestjs-api npm run lint` | exit `0`; `git status --short` byte-identical before and after, so `--fix` mutated nothing |
| Unit + integration | `docker compose run --rm … nestjs-api npm test -- --runInBand` | exit `0` — **33 suites / 203 tests** |
| E2E | `docker compose run --rm … nestjs-api npm run test:e2e` | exit `0` — **4 suites / 92 tests** |
| Compose | `docker compose ps --all` | `db`, `redis`, `minio`, `mailpit`, `nestjs-api`, `video-worker` all `running`; `minio-init` `exited 0` (one-shot bucket create) |
| Real pipeline | scratchpad probe against the live stack | **17/17** checks — draft-before-bytes, direct-to-MinIO PUT, `processing` → `ready` in 1 s, `duration_seconds=3`, `metadata` present, `thumbnail.jpg` (9.5 KiB) in bucket `streamtube`, `Range: bytes=0-1023` → `206` `bytes 0-1023/99208` exactly 1024 bytes, `/download` → `302` serving all 99208 bytes, distinct slugs, and `error` + `error_message` on an unparseable object |
| Non-blocking API | 20 idle samples vs. continuous polling under 6 × 64 MiB concurrent presigned PUTs | idle median `1.3 ms` / p95 `3.8 ms`; under 384 MiB of load median `1.1 ms` / p95 `7.8 ms` (`0.85×`) — no queue backing up |

## Known Non-Blocking Follow-Ups

- Stream error handler does not log the underlying storage stream error.
- `completeUpload` still has no reconciliation job for videos left in `processing` after enqueue exhaustion; current behavior intentionally fails loudly with `VIDEO_PROCESSING_ENQUEUE_FAILED`.
- `dotenv` is relied on via `-r dotenv/config` in both Jest's `setupFiles` and now `start:worker:dev`, but is not declared as an explicit `dependency`/`devDependency` in `nestjs-project/package.json` — it currently resolves only because it's hoisted as a transitive dependency of `@nestjs/config`/`typeorm`. Recommend declaring it explicitly.
- `queueConfig.videoWorkerConcurrency` (`src/config/queue.config.ts`) is now dead config — the worker reads `process.env.VIDEO_WORKER_CONCURRENCY` directly via `resolveVideoWorkerConcurrency`, not through this config field, and the two disagree on how `'0'` resolves. Consider removing the unused field or routing through it instead.
- `isPgUniqueViolationOnColumn` remains duplicated between `videos.service.ts` and `channels.service.ts` — the two now share identical typings (aligned on 2026-07-29), but a shared extraction to `src/common/` was correctly out of scope for both remediations.
