# Phase 03 — Remaining Improvements (fresh-context handoff)

> **EXECUTED 2026-07-30** on `bugfix/phase-03-remaining-improvements` (off `f760c23`). S1, S2, L1, L2, L3 are all closed — see "Execution record" at the end for the evidence and for the three things that did not go as this document predicted. The pre-existing follow-ups and `GIT-2` are untouched, as intended. Nothing has been pushed or merged; both release actions still await authorization.

> **Written for a fresh context.** Everything needed is inline; no prior conversation required.
> **Repo root:** `/run/media/rafael/master_backup/Repos/AI Works/FullCycle-IA-MBA/challenge/StreamTubeContinuation`
> **Written:** 2026-07-30, after the acceptance-criteria verification pass.
> **Companion docs:** `ac-verification-plan.md` (the plan that was executed), `acceptance-validation.md` (the verdicts + post-mortem), `validation.md` (gate results, `status: clean`).

## Read this first — why these items exist

The 2026-07-29 verification pass found that Phase 03 looked complete on inspection but was **broken in the running stack**: `video-worker` crashed on every boot, so four AC bullets and one Reprova clause were failing while all 200 tests passed. That is fixed (see `acceptance-validation.md` finding `WORKER-1`).

The items below are what is left. **The two structural ones (S1, S2) matter most** — they close the *class* of failure that produced both that bug and the earlier week-long false lint claim, rather than its instances. Everything else is genuine but lower-stakes.

Nothing here is a blocker on Phase 03's acceptance.

## Current state — verify before starting

```bash
cd '/run/media/rafael/master_backup/Repos/AI Works/FullCycle-IA-MBA/challenge/StreamTubeContinuation'
git branch --show-current
git log --oneline main..dev
```

At the time of writing:

| Ref | SHA | Note |
|---|---|---|
| `main` / `origin/main` | `5b98d43` | verification work **not** on `main` yet |
| `dev` | `0e5e61f` | merge of `bugfix/phase-03-ac-verification`, **not pushed** |
| `origin/dev` | `f32fc58` | behind local `dev` by 5 commits |
| `bugfix/phase-03-ac-verification` | `48e4cf6` | merged into local `dev` |

So there are two outstanding release actions, both requiring the human's authorization:

- **`git push origin dev`** — local `dev` is 5 commits ahead of `origin/dev`.
- **`dev` → `main`** — ask before merging. Per the root `CLAUDE.md`, `main` is merged from `dev` only when `dev` is stable.

**Do not** `rebase`, `push --force`, or `reset` any shared branch. See `GIT-2` below for why that rule is load-bearing in this repo specifically.

## Environment (all commands run in Docker, never on the host)

```bash
cd nestjs-project
docker compose up -d                       # db, redis, minio, minio-init, mailpit, nestjs-api, video-worker
docker compose ps --all                    # video-worker MUST show "running" — it silently died for a week
```

`nestjs-api`'s image command is `tail -f /dev/null`, so the API does not serve until you start it:

```bash
docker compose exec -d nestjs-api npm run start:dev
docker compose exec nestjs-api curl -sI http://localhost:3000/    # expect 200
```

Gate commands (the exact set the DoD requires):

```bash
docker compose exec nestjs-api npx tsc --noEmit                          # expect 0
docker compose exec nestjs-api npx eslint "{src,apps,libs,test}/**/*.ts" # expect 0 — NO --fix; see S1
docker compose run --rm --workdir /home/node/app \
  --env DB_HOST=db --env DB_USERNAME=streamtube --env DB_PASSWORD=streamtube --env DB_NAME=streamtube \
  --env JWT_SECRET=test-access-secret --env JWT_REFRESH_SECRET=test-refresh-secret \
  --env STORAGE_ACCESS_KEY=streamtube --env STORAGE_SECRET_KEY=streamtube123 \
  nestjs-api npm test -- --runInBand                                     # expect 33 suites / 203 tests
# same env block with: nestjs-api npm run test:e2e                       # expect 4 suites / 92 tests
```

**Write these flags out literally.** Do not put them in a shell variable — this session's shell is `nu`, which does not word-split unquoted variables, and `$ENVS` silently collapses into one argument. That produced `unknown flag: --env DB_HOST` and made two differential measurements no-op while *looking* like they ran. Put multi-step command sequences in a `bash` script instead.

Baseline as of 2026-07-29, worker running: `tsc` 0 · eslint **0 errors / 0 warnings / 111 files** · `npm run lint` 0 with the tree byte-identical before/after · **33 suites / 203 tests** · **4 e2e suites / 92 tests** · all services `running` (`minio-init` `exited 0` is its correct terminal state as a one-shot bucket creator).

---

## S1 — Split the lint script so the gate cannot mutate what it measures

**Priority: highest.** Recorded as `ADV-2` in both `acceptance-validation.md` and `validation.md`.

`nestjs-project/package.json:15`:

```json
"lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
```

The Definition of Done's literal command auto-fixes while it measures. A green `npm run lint` can therefore mean "green *after* rewriting the working tree", and running the gate dirties the tree. This is the mechanism behind the 2026-07-21 → 2026-07-28 window in which the record held a false lint claim.

**Change to:**

```json
"lint": "eslint \"{src,apps,libs,test}/**/*.ts\"",
"lint:fix": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
```

Then grep for consumers of `npm run lint` that *expect* fixing behaviour (CI configs, git hooks, the DoD text in the root `CLAUDE.md`, `PROJECT_INSTRUCTIONS.md`) and update the wording where it describes the gate.

**Verify:** `npm run lint` exits 0 and `git status --short` is byte-identical before and after. Capture both snapshots — that comparison is the whole point.

Note: measured on 2026-07-29, `--fix` mutated *nothing*, because the tree was already clean. That is a property of the current tree, not of the command. Do not let a green run talk you out of this.

## S2 — Give `video-worker` a healthcheck

**Priority: highest.** Recorded as `ADV-5`.

`nestjs-project/compose.yaml:78` — `video-worker` is the **only** service with no `healthcheck` (`db` has one at `:28`, `redis` at `:44`, `minio` at `:59`). It is also the only service that merely *runs* rather than *serves*, so nothing ever asserted it was alive. It sat in `exited (1)` while the suite reported 200 passing tests.

Add a liveness signal. The worker is a plain Node process with no HTTP surface, so the check has to be indirect — options, in rough order of preference:

1. Have the worker expose a trivial health endpoint or write a heartbeat (e.g. a Redis key with a TTL it refreshes), and healthcheck against that. Most honest signal: it proves the consumer loop is alive, not just that the process exists.
2. A process check (`pgrep -f video-worker/main` or similar) — cheap, catches the hard-crash case that actually happened, proves nothing about consumer liveness.

Also consider asserting service state as part of the DoD, so "green tests over a dead service" cannot recur.

**Verify:** with the fix in place, deliberately reintroduce the `WORKER-1` bug (drop `Channel` from `forFeature` in `src/video-worker/video-worker.module.ts`), run `docker compose up -d`, and confirm the service reports unhealthy rather than silently exiting. Then revert. `src/video-worker/video-worker.module.integration-spec.ts` should fail in that state too — if it does not, that spec has regressed.

---

## L1 — Declare `dotenv` explicitly

Recorded as `ADV-3`; also `validation.md:163`.

`dotenv` is relied on via `-r dotenv/config` in **both** Jest's `setupFiles` (`package.json` `jest.setupFiles`) and `start:worker:dev` (`package.json:28`), but is not a declared `dependency` or `devDependency`. It resolves only because it is hoisted as a transitive dependency of `@nestjs/config`/`typeorm`.

This is load-bearing, not theoretical — verified live on 2026-07-29 inside the worker container:

```bash
docker compose exec --workdir /home/node/app video-worker node -r dotenv/config -e 'console.log(process.env.VIDEO_WORKER_CONCURRENCY)'  # "2"
docker compose exec --workdir /home/node/app video-worker node                -e 'console.log(process.env.VIDEO_WORKER_CONCURRENCY)'  # undefined
```

`compose.yaml`'s `video-worker` declares no `environment:`/`env_file:`, so that preload is the *only* thing supplying its config. A dependency bump that drops the transitive hoist breaks the worker's env loading silently.

**Fix:** add `dotenv` to `devDependencies` (test + dev-script use only) at the version currently resolved. **Verify:** `npm ls dotenv` shows it as a direct dependency, and both commands above still behave as shown.

## L2 — Audit the remaining consumer-race risk in the queue spec

**Status: a risk I did not observe failing — not a known defect.** Do not report it as broken without reproducing it.

`TEST-1` (see `acceptance-validation.md`) fixed `src/videos/videos.service.integration-spec.ts`, which assumed no live queue consumer existed and broke with `Job … could not be removed because it is locked by another worker` once `video-worker` actually ran. Proven by differential: worker stopped → 7 passed; worker running → 1 failed. Fixed with `queue.pause()` / `queue.resume()` in a `finally`.

Four specs touch the real queue:

```
src/videos/videos.service.integration-spec.ts            # fixed (TEST-1)
src/video-worker/video-worker.module.integration-spec.ts # new; boots the real module
src/video-worker/video-processing.queue.integration-spec.ts  # <-- the remaining risk
src/queue/video-queue.service.spec.ts                    # unit, mocked
```

`video-processing.queue.integration-spec.ts` is the only one that **waits on job completion** via `QueueEvents`. It boots its own processor while the `video-worker` container is also consuming the same queue, so its job can be claimed by the container's worker instead of its own — which would make its assertions about processing effects flaky or wrong.

It **passed** in the full suite with the worker running (33/33), so either the race does not bite in practice or it is timing-dependent. To settle it, loop it against a live worker rather than reasoning about it:

```bash
# with docker compose ps showing video-worker "running"
for i in $(seq 1 10); do  # in a bash script, not nu
  docker compose run --rm --workdir /home/node/app <env flags> \
    nestjs-api npm test -- --runInBand src/video-worker/video-processing.queue.integration-spec.ts \
    | grep -E '^Tests:'
done
```

If any run fails, apply the same isolation `TEST-1` used, or give the spec its own queue name. If all ten pass, record that as the evidence and close the item.

## L3 — Stop orphaned BullMQ jobs accumulating in Redis

Discovered during this pass; not previously recorded.

`bull:video-processing:failed` had grown to **25** entries, all failing with:

```
Could not find any entity of type "Video" matching: { "id": "…" }
```

`cleanAllTables` (`src/test/create-test-data-source.ts`) deletes the `videos` rows between suites but leaves the enqueued jobs in Redis, so every suite run leaves jobs pointing at rows that no longer exist. Harmless to correctness — but unbounded growth, and it buries real failures in noise. When diagnosing the worker, these had to be manually distinguished from genuine processing failures.

```bash
docker compose exec redis redis-cli ZCARD 'bull:video-processing:failed'
docker compose exec redis redis-cli LLEN  'bull:video-processing:wait'
```

**Options:** drain the queue in test teardown alongside `cleanAllTables`; use a per-run queue prefix so test jobs are namespaced; or set `removeOnFail`/`removeOnComplete` retention on the queue registration. The prefix approach also happens to fix L2.

---

## Pre-existing code follow-ups (carried in `validation.md:159-165`, deliberately untouched)

Out of scope for the verification pass; listed here so they are not lost.

- **`validation.md:161`** — the stream error handler does not log the underlying storage stream error.
- **`validation.md:162`** — `completeUpload` has no reconciliation job for videos left in `processing` after enqueue exhaustion; current behaviour intentionally fails loudly with `VIDEO_PROCESSING_ENQUEUE_FAILED`. Worth revisiting now that a stuck-in-`processing` state has been seen for real.
- **`validation.md:164`** (`ADV-4`) — `queueConfig.videoWorkerConcurrency` (`src/config/queue.config.ts:10`) is dead config: the worker reads `process.env.VIDEO_WORKER_CONCURRENCY` directly via `resolveVideoWorkerConcurrency`, and the two disagree on how `'0'` resolves. Remove the field or route through it. No doc points at it, so this is not a doc-coherence issue.
- **`validation.md:165`** — `isPgUniqueViolationOnColumn` is duplicated between `videos.service.ts` and `channels.service.ts`; typings were aligned 2026-07-29 but a shared extraction to `src/common/` was left out of scope.

## Cosmetic — no action required, do not "fix" by guessing

`src/video-worker/video-worker.module.integration-spec.ts` leaves Jest printing *"Jest did not exit one second after the test run has completed"*. The pre-fix baseline did not.

**Established as cosmetic by measurement, not assumption:** `jest --detectOpenHandles` attributes **no** handle and prints no warning, and both variants take the **same** wall clock (35 s vs 35 s, three repetitions each) — that time is container startup, not a wait. Exit code is `0`; the suite completes.

Teardown already closes the queue's ioredis socket explicitly, because `@nestjs/bullmq`'s `bull.providers.js` calls `disconnect()` only for queues registered with `forceDisconnectOnShutdown`, which production does not set. Booting a real BullMQ worker in-process is the cause — the price of testing the module's actual composition root, which is what caught `WORKER-1`.

Two things already tried and rejected: an explicit `worker.close()` + `queue.close()` before `app.close()` (no effect on the warning), and a 250 ms teardown drain (no effect; removed rather than left in as a sleep that buys nothing). **If you attack this, measure first** — during the original pass a lingering container was briefly misread as an intermittent hang, and the timing comparison above is what falsified it.

## GIT-2 — permanently open, by design

`acceptance-validation.md`'s `status` stays `dirty` with `issue_count: 1` because of this, and that is the correct terminal state — not a gap to close.

Three commits were authored directly on `main` (`a970086`, `8e4af55`, `824faa4`), violating the Reprova clause at `PROJECT_INSTRUCTIONS.md:182`. `main` was then **reset twice** to `1ee5f4d` and rebuilt via merge commits, so `git log --first-parent main` now reads as Git-Flow-compliant and the violation survives only in the local reflog — which is not part of a clone.

**Do not attempt to resolve this.** Resolving means rewriting shared history. The fix already applied was to the *description* (the prior `GIT-1` write-up claimed only two commits, that rewriting was "rejected", and that only a fast-forward occurred — all three contradicted by `git reflog show main`). The historical violation is real and is disclosed rather than erased.

## Definition of done for this handoff

- `npm run lint` cannot modify the tree; the DoD wording matches the split scripts (S1)
- `docker compose ps` reports `video-worker` unhealthy when it cannot boot (S2)
- `npm ls dotenv` shows a direct dependency (L1)
- L2 either closed with a 10-run green loop or fixed with real isolation
- `bull:video-processing:failed` no longer grows across suite runs (L3)
- Full gates still green: `tsc` 0, eslint 0/0, 33 suites / 203 tests, 4 e2e suites / 92 tests, **with `video-worker` running** — that last condition is what `TEST-1` was about
- `git status --short` shows no unintended changes; work on a `bugfix/*` branch off `dev`, never on `main`

---

# Execution record — 2026-07-30

Branch `bugfix/phase-03-remaining-improvements`, four commits off `f760c23`:

| Commit | Item |
|---|---|
| `578a4f2` | S1 — split the lint script |
| `f73a8ee` | L1 — declare `dotenv` |
| `85cc7dd` | S2 — video-worker healthcheck |
| `01aa6c3` | L3 — bounded job retention + Redis-side test cleanup |

Branched off the docs branch rather than bare `dev`, so the plan travels with the work; merging to `dev` later brings both.

## Final gates — all with `video-worker` running and healthy

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit `0` |
| `npx eslint "{src,apps,libs,test}/**/*.ts"` (no `--fix`) | exit `0` |
| `npm run lint` (DoD literal) | exit `0`, `git status --short` **byte-identical** before/after |
| `npm test -- --runInBand` | **34 suites / 220 tests** (was 33 / 203) |
| `npm run test:e2e` | **4 suites / 92 tests** (unchanged) |
| `bull:video-processing:*` across the full run | `failed=0 wait=0 completed=0 delayed=0` **before and after** |
| `docker compose ps` | all services running; `video-worker` `Up (healthy)` |

## Per-item evidence

**S1.** `lint` is read-only, `lint:fix` carries `--fix`. No CI configs and no git hooks exist in this repo, so the only consumers were docs; the DoD wording in the root `CLAUDE.md` and the command table in `nestjs-project/CLAUDE.md` were updated. Historical records (`validation.md`, `acceptance-validation.md`, `progress.md`) were deliberately **not** rewritten — they describe what was true when written. The split immediately paid for itself: the first gate run after the S2 work reported a real prettier error instead of silently fixing it.

**S2.** Implemented as the doc's preferred option 1 — a real liveness endpoint, not a process check. It answers 200 only when the BullMQ consumer `isRunning()` **and** its Redis connection is `ready`. Verified by reintroducing `WORKER-1`, as instructed:

| | healthy | `WORKER-1` reintroduced |
|---|---|---|
| `docker compose ps` (default view) | `Up (healthy)` | `Up (unhealthy)` |
| probe | `200 {"status":"ok"}` | `503 {"status":"boot-failed"}` |
| `docker compose up -d --wait` | exit `0` | exit `1` |
| `video-worker.module.integration-spec.ts` | 5/5 pass | **5/5 fail** |

Then reverted; back to healthy. That spec has **not** regressed.

**L1.** `npm ls dotenv` now shows `+-- dotenv@16.6.1` as a direct entry. Both live commands still behave as documented (`2` with the preload, `undefined` without).

**L2 — closed as "not a defect", with evidence.** Ten consecutive runs of `video-processing.queue.integration-spec.ts` against a live, healthy `video-worker`: **10 passed / 0 failed**. The race does not bite in practice. No isolation change was made, so the spec keeps competing with the real container worker — which is the fidelity the project's "don't mock what you can run for real" rule wants. The per-run queue prefix was considered and rejected for that reason: it would have namespaced test jobs away from the real worker and quietly reduced what these specs prove.

**L3.** Fixed on both sides rather than only in tests: `removeOnFail: false` became `FAILED_JOB_RETENTION` (7 days / 100 jobs), and `cleanVideoProcessingQueue` is now the Redis-side counterpart to `cleanAllTables` in every suite that enqueues. The 25 pre-existing orphans were cleared by the new helper as a side effect of the L2 loop. Note `queue.drain()` alone is insufficient — it leaves terminal states — so the helper also calls `queue.clean`.

## Three things this document got wrong, or that it could not have known

1. **A crash is not "unhealthy" — it is invisible.** The doc's DoD asks that `docker compose ps` report `video-worker` unhealthy when it cannot boot. A healthcheck alone does not achieve that: a crashed container is `Exited (1)`, and **plain `docker compose ps` does not list stopped containers at all**. That, not the missing healthcheck, is the deeper reason `WORKER-1` stayed hidden for a week — the doc's own environment section had to say `ps --all` to see it. So `main.ts` now passes `abortOnError: false` (without which Nest exits 1 itself and the bootstrap `catch` never runs) and keeps the process alive answering 503. Only then does the failure appear in the default `ps` view, and only then do `up --wait` and `depends_on: service_healthy` fail on it.

2. **The "Jest did not exit" warning is gone.** The doc records it as cosmetic and warns against attacking it by guessing. It was not attacked — it simply no longer appears, in either the targeted run or the full 34-suite run. Flagged as an observation, not a claim of a fix: the cause was not investigated and this could be variance.

3. **`start_period: 90s` would have been wrong.** Measured boot-to-healthy is **~10s**, so it is set to 40s. A success during `start_period` marks the service healthy immediately; the only thing a long window delays is the *unhealthy* verdict — so "generous just to be safe" is actively harmful here.

## Process note, since this document is partly about how verification goes wrong

Two self-inflicted failures during this pass, both worth recording because they are the same class of error the doc exists to prevent:

- A verification script restored a deliberately-broken file with `git checkout --`. That file also held **uncommitted** work (the `WorkerHealthService` registration), which was silently discarded — after which the worker booted "successfully" with no health server and reported unhealthy for a reason that had nothing to do with the code under test. Roughly twenty minutes went into diagnosing framework behaviour that was not implicated at all. Destructive verification must snapshot with `cp`, never `git checkout`.
- The first attempt at splitting commits by hunk index used a default-context diff, in which the two adjacent lint hunks merge into one — so the S1 commit silently swallowed the S2 documentation. Caught by checking `git diff --cached` before committing rather than after. The commits were local and unpushed, so they were reset and redone; no shared history was touched.

Both were found by comparing measurements against expectations, not by re-reading the code.
