# phase-03-videos — Progress

**Status:** REMEDIATION IN PROGRESS. The core Phase 03 upload and processing implementation exists, but post-implementation validation found merge-blocking gaps: migration-suite cleanup race, Phase 03 lint debt, missing real queue-consumption coverage, unwired worker concurrency config, and missing `context.md`/`validation.md` artifacts.
**SIs:** 9/9 implemented; remediation plan: `docs/superpowers/plans/2026-07-21-phase-03-video-findings-remediation.md`

## Remediation Findings (2026-07-21)

1. `npm test -- --runInBand` failed in `src/database/migrations.integration-spec.ts` because cleanup dropped enum/table dependencies concurrently.
2. No-fix ESLint reported repo-wide debt plus Phase 03-specific errors that must be removed from touched video files.
3. Existing tests prove enqueue and worker processing separately, but not a real BullMQ consume path from `VideoQueueService` to `VideoProcessingProcessor`.
4. `VIDEO_WORKER_CONCURRENCY` exists in config but is not wired into the BullMQ worker, so the worker uses BullMQ's default concurrency of 1.
5. `docs/phases/phase-03-videos/context.md` and `validation.md` are missing.

Full detail and the complete per-SI Minor-finding triage is in `.superpowers/sdd/progress.md` (gitignored SDD ledger) and the final reviewer's transcript.

## Handoff Notes (2026-07-20)

This section exists to let a future session (or a different controller) pick this phase up cold — read it before dispatching anything.

### What's done

- **Architecture audit** of the pre-existing `nestjs-project/` codebase: `docs/decisions/architecture-audit-nestjs-pre-phase-03.md` (`sha256:b59dcd6ec55e1c0fdc43a8e9a166345dc1db434e2e3c62b7640ad478ea052e8c`). Five findings; two (F-001, F-002 — transaction/retry-loop patterns) are load-bearing for how SI-03.4 must be implemented and are already folded into the plan.
- **Implementation plan**: `docs/phases/phase-03-videos/phase-03-videos.md` — Overview, embedded Technical Decisions (TD-01–05, ready to transcribe into `docs/decisions/technical-decisions-phase-03-videos.md` as part of SI-03.1), 9 fully-specified Step Implementations (SI-03.1–03.9), Technical Specifications (Data Model, API Contracts, Authorization Matrix, Error Catalog, Events/Messages), Dependency Map, Deliverables. This is the single source of truth for the feature — do not re-derive requirements from `PROJECT_INSTRUCTIONS.md` directly, the plan already did that synthesis.
- Library choices (BullMQ/`@nestjs/bullmq`, `@aws-sdk/client-s3` + `s3-request-presigner`, `fluent-ffmpeg` + `ffmpeg-static`/`@ffprobe-installer/ffprobe`) were checked against current docs via context7 — exact versions are still **not pinned**; that's SI-03.1's first sub-step.

### What's NOT done yet

- No code written, no dependencies installed, no migration generated.
- `docs/decisions/technical-decisions-phase-03-videos.md` does not exist yet (SI-03.1 deliverable — content is already fully drafted inside the plan's "Technical Decisions" section, just needs transcribing).
- `docs/phases/phase-03-videos/context.md`, `validation.md` do not exist — out of scope for the planning pass that produced the plan; `library-refs.md` is produced during SI-03.1.

### Worktree setup log (2026-07-20)

- No `dev` branch existed in this repo (only `main`) — created `dev` from `main` and pushed it (per Git Flow convention, user-approved), then cut `feature/phase-03-videos` from `dev` via `git worktree add .worktrees/feature-phase-03-videos`. `.worktrees/` added to `.gitignore` (committed to `dev`).
- The planning docs referenced by this handoff (`phase-03-videos.md`, this file, the architecture audit) were **untracked** in the original checkout and did not carry into the new worktree automatically — copied manually into the worktree; now tracked on `feature/phase-03-videos`.
- Docker infra brought up (`docker compose up -d`): host port 1025 (mailpit SMTP) collided with an unrelated pre-existing host process (`bridge`, pid 6506) — remapped mailpit's host-side port to `11025:1025` in `compose.yaml` (internal container-to-container traffic, which is all the app/tests actually use, stays on `1025` — no code changes needed). Checked SI-03.1's new ports (`6379` redis, `9000`/`9001` minio) for the same class of conflict — none found.
- `.env` created from `.env.example`, fixing the shell-quoting bug the architecture audit flagged but excluded from findings (`.env.example`'s `MAIL_FROM="StreamTube" <noreply@streamtube.com>` only quotes the name, not the `<>` address — corrected to `MAIL_FROM="StreamTube <noreply@streamtube.com>"` per `nestjs-project/CLAUDE.md`'s own documented convention).
- **Found and fixed a pre-existing, reproducible baseline bug** (user-approved, isolated one-line fix, unrelated to phase-03 scope): `src/database/migrations.integration-spec.ts`'s `beforeAll` dropped the managed tables but never the `verification_tokens_type_enum` Postgres enum type created by the `CreateAuthTokens` migration. Any other integration suite that creates that type first (via a `synchronize: true` test DataSource) leaves it behind after `DROP TABLE ... CASCADE`, so this spec's own `runMigrations()` then collided with `type "verification_tokens_type_enum" already exists`. Reproduced on a fully fresh DB (`docker compose down -v` + up), not caused by anything upstream. Fix: added `DROP TYPE IF EXISTS "public"."verification_tokens_type_enum"` alongside the table drops in `beforeAll`.
- **Baseline verified clean after the fix**: `npm test -- --runInBand` → 23/23 suites, 144/144 tests. `npm run test:e2e` → 3/3 suites, 52/52 tests. `npx tsc --noEmit` → exits 0.
- **Pre-existing lint debt** (not fixed, out of phase-03 scope, not introduced by this work) — **corrected figure, see 2026-07-20 SI-03.4 entry below**: the "150/40 in 3 files" count recorded here at setup time undercounted significantly. Full-repo `npm run lint` is actually 264 problems (223 errors, 41 warnings) spread across many more files never touched by phase-03 (e.g. `auth.service.spec.ts`, `channels.service.spec.ts`, `mail.service.integration-spec.ts`), confirmed pre-existing on `dev`. Human-approved scoping decision (made during SI-03.4's fix round): the phase's lint bar is "no NEW debt beyond matching an already-established codebase pattern," not a fully clean `npm run lint`. Full-repo cleanup is a separate out-of-scope follow-up task.
- The skill's own **Pre-Flight Plan Review** (scan the plan once for conflicts before dispatching Task 1) has been run: no internal contradictions found — SI dependency lines match the Dependency Map, the F-001/F-002 tech-debt callouts in SI-03.4 are consistent with the audit, and the SI-03.7/03.8/03.9 shared-file risk is already flagged by both the plan (line 1217) and this file's "Known risks" section below.

### Execution model — decided 2026-07-20

Use `superpowers:subagent-driven-development`, **sequential dispatch in a single worktree** — not parallel implementers. This overrides the "parallel agents" framing from the phase's original kickoff request: the skill has a hard rule against dispatching multiple implementer subagents concurrently in one workspace (shared git state → conflicts), and the user explicitly chose the sequential/single-worktree reconciliation over splitting parallel-eligible SIs into separate worktrees. The plan's Dependency Map "Round 4" grouping (SI-03.5/03.7/03.8/03.9) is a statement about the *absence of a logical blocking dependency* between those SIs, not an instruction to dispatch them concurrently.

**Before dispatching SI-03.1:**
1. `superpowers:using-git-worktrees` — create/verify an isolated workspace on a `feature/*` branch cut from `dev` (never `main`, never committing to `dev` directly — see root `CLAUDE.md` Git Flow).
2. Run the Pre-Flight Plan Review pass over `phase-03-videos.md` (scan for internal contradictions or plan-mandated review-rubric conflicts) and surface any findings before Task 1.
3. Create todos for all 9 SIs.

**Dispatch order** (topological, satisfies every SI's `Dependencies:` line in the plan — walking-skeleton-first: gets a working upload→process→ready pipeline live before adding the read-side endpoints):

```
SI-03.1 → SI-03.2 → SI-03.3 → SI-03.4 → SI-03.5 → SI-03.6 → SI-03.7 → SI-03.8 → SI-03.9
```

(SI-03.1 and SI-03.2 have no dependencies and could theoretically go in either order or even swap position — kept in numeric order since it doesn't matter and avoids inventing a reason to deviate.)

**Model:** haiku-4.5, medium effort, for every implementer dispatch — this was the explicit original directive and the plan's SIs were written complete enough (full code, not prose descriptions) to make that tier viable. The skill requires the model to be specified explicitly on every dispatch (an omitted model silently inherits the controller's own, more expensive model) — whoever resumes this must not forget that flag. Reviewer tier is a separate call per the skill's model-selection guidance (judgment task, scale to diff risk) — not necessarily haiku.

### Known risks to watch during execution

- SI-03.7, SI-03.8, SI-03.9 all add a method to the same `videos.controller.ts` — harmless sequentially (each is its own task/commit), but would conflict if anyone later decides to parallelize them across worktrees without splitting that file.
- SI-03.4's slug-collision retry loop must stay as independent, unwrapped `save()` calls (see the plan's "Tech-debt dependency (refactor-arch F-001, F-002)" callout) — do not "clean up" by wrapping it in a single transaction without adding `SAVEPOINT`s.
- `library-refs.md` must actually get written during SI-03.1 with context7-confirmed versions, not skipped because the plan already names the packages.

### Execution log (2026-07-20, continued) — resume point for a fresh session

**Working directory for all execution:** `.worktrees/feature-phase-03-videos/` (this worktree). `git log --oneline` on branch `feature/phase-03-videos` is the ground truth for what's actually landed — read it before trusting prose below. As of this write-up, HEAD is `ab8aac0` (SI-03.3's commit); SI-03.4 has not landed any commit yet.

**SDD machine ledger:** `.superpowers/sdd/progress.md` (gitignored, worktree-local scratch — not in git history) has the per-task base/head SHAs and review status. If that file is missing (e.g. `git clean -fdx` was run, or a fresh worktree), reconstruct from `git log --oneline feature/phase-03-videos` — commit subjects are tagged with `SI-03.N` / `feat(videos):` / `fix(videos):` prefixes.

**Completed and review-approved (each went through implementer → task-reviewer → fix round → re-review):**
- **SI-03.1** (commits `422bd03`..`b776842`): deps, storage/queue config, MinIO+Redis compose services, TD doc, library-refs.md. Fix round: TD-03's "Rejected alternative" paragraph was dropped in transcription — restored verbatim.
- **SI-03.2** (commits `f2dca35`..`52de5f1`): `Video` entity, 4 exception classes, `CreateVideos` migration. Fix round: `slug` had a redundant double-unique (both `@Column({unique:true})` and a separate `@Index({unique:true})`) — removed the explicit `@Index`, regenerated the migration via CLI (old migration file deleted + fresh one generated, not hand-edited, since it had already been executed against the local dev DB — see `.claude/rules/typeorm-migrations.md` immutability rule). **Note:** during this fix, a `migration:revert` command was run against the wrong assumption about DB state and reverted `CreateAuthTokens` instead of `CreateVideos` — recovered via full `docker compose down -v && up -d` + `migration:run` from scratch. If you ever see `refresh_tokens`/`verification_tokens` tables missing unexpectedly, that class of mistake is why; the fix is always the same: fresh volume + `migration:run`, never patch forward from a confused state.
- **SI-03.3** (commit `ab8aac0`): `StorageService` (multipart lifecycle, range GET, presigned GET, plain PUT) + `StorageModule`, both real-MinIO integration tests. Approved with zero fix round — only Minor polish findings deferred to the final whole-branch review (deprecated `.substr()` in the integration spec, a loose error-type assertion in the abort test, repeated stream-draining boilerplate — see `.superpowers/sdd/progress.md` for exact line numbers, or the review transcript is gone if that file was cleaned — not blocking, low priority).

**SI-03.4 — complete (commits `61c7cde`..`1d09f62`), review-approved, no fix round needed on re-review.**

SI-03.4 (VideosModule + `POST /videos` upload initiation) was implemented and committed at `113b4b1` (base `61c7cde`). The transaction-boundary constraint (must NOT wrap the slug-retry loop in `dataSource.transaction()`, per F-002) was verified correct both directly and independently by the task reviewer, both on the first review and the re-review. The first review found two Important findings:

1. **Slug-collision detection bug (plan-mandated — copied verbatim from the plan's own template code).** `videos.service.ts`'s retry-loop `catch` block checked `err.message.includes('slug')`, but Postgres puts the column name in `.detail`, not `.message`. Fixed with a local `isPgUniqueViolationOnColumn(err, column)` helper matching `channels.service.ts`'s established pattern exactly.
2. **`videos.service.integration-spec.ts` fully mocked `StorageService`**, contradicting the project's testing rules (integration specs require real external I/O). Fixed by rewriting it to boot a real `StorageService` via `Test.createTestingModule()` + `StorageModule`, following the exact pattern in `src/storage/storage.service.integration-spec.ts` (`jest.spyOn` pass-through where a specific call needed asserting or forcing to fail).

Both fixes landed in commit `1d09f62`. Re-review confirmed both are technically correct (not just cosmetically similar) — see `.superpowers/sdd/progress.md` Task 4 entry for the reviewer's TypeORM-source-level verification of Finding 1, and the Minor findings deferred to the final whole-branch review (orphaned MinIO multipart uploads in two integration tests, `isPgUniqueViolationOnColumn` duplication, a compensation-of-compensation edge case, a redundant type cast).

**Unrelated baseline bug found and fixed during this SI's verification pass** (commit `5a4bf98`, separate from the SI-03.4 fixes above): `package.json`'s `test:e2e` script was missing `--runInBand`. Without it, Jest ran the (now 4, previously 1-2) e2e spec files in parallel workers against the same live Postgres DB, racing DELETE/INSERT across suites and intermittently tripping FK violations in `cleanAllTables` — only started manifesting once SI-03.4 added a second e2e file (`videos.e2e-spec.ts`) alongside `auth.e2e-spec.ts`. Root-caused via systematic debugging (reproduced identically with SI-03.4's fixes stashed out, confirming it wasn't caused by this work); fixed and verified 64/64 e2e tests pass consistently.

**SI-03.5 — implemented (commit `a4966ba`, base `4a7df38`), reviewed, fix round committed (`b5c2b45`) — PAUSED before re-review, resume here.**

SI-03.5 (`QueueModule` + `POST /videos/:id/complete-upload`) was implemented and committed at `a4966ba`. The task reviewer found 1 Critical + 2 Important findings:

1. **Critical: `videos.service.integration-spec.ts`'s `completeUpload` test mocked away the exact two collaborators it existed to verify** — `jest.spyOn(storageService, 'completeMultipartUpload').mockResolvedValue(undefined)` and the same for `videoQueueService.enqueueProcessing`, so no real MinIO completion and no real Redis job ever happened, and the brief's own acceptance criterion ("job visible in the video-processing Redis queue via `queue.getJobCounts()`") was never actually checked anywhere.
2. **Important (plan-mandated code — copied verbatim from the brief's own template): `completeUpload` had no handling if `enqueueProcessing` failed** after the video was already saved as `processing` — no compensation, no visible failure, just an unhandled rejection propagating up, with no way to retry via the API since the video was no longer `draft`. Confirmed via context7 lookup against the AWS SDK v3 docs that `CompleteMultipartUpload` is not documented as safely re-callable after a successful completion, so rolling back to `draft` and letting the client retry the whole flow isn't a safe option — the compensating action has to be at the enqueue step itself, not by undoing the S3 completion.
3. A third Important finding (never asserting the "3 attempts + exponential backoff" acceptance criterion) is resolved as a side effect of fixing #1.

**Human decision on #2 (asked because it's plan-mandated, not an implementer bug — same reasoning as SI-03.4's F-001/F-002 pattern):** fix it now, don't defer. Chosen fix: `VideoQueueService.enqueueProcessing` gets a bounded retry (3 attempts, 500ms delay) for transient Redis blips; if still failing, `completeUpload` catches it and throws a new `VideoProcessingEnqueueFailedException` (502) so the failure is loud, not silent. The video legitimately stays `processing` (S3-side completion is final and correct) — this is a "fail loudly, don't roll back the unrollable" design, not a queue-backed reconciliation system (out of scope for this SI).

**A fix subagent addressed both findings and it is FULLY DONE, verified, and committed** at `b5c2b45` (base `a4966ba`):
- `videos.service.integration-spec.ts`'s `completeUpload` test rewritten: real PUT of 6MB part data to the presigned URL, real ETag captured from the response header, real `completeMultipartUpload` call (no mock), real `Queue` instance fetched via `getQueueToken(VIDEO_PROCESSING_QUEUE)` from `@nestjs/bullmq`, asserts a real job landed with `attempts: 3` and `backoff: { type: 'exponential', delay: 5000 }`, cleans up the test job via `job.remove()` afterward.
- `video-queue.service.ts`: bounded retry added (3 attempts, 500ms), new `video-queue.service.spec.ts` unit-tests the retry/exhaustion behavior directly.
- `videos.service.ts` + new `video-processing-enqueue-failed.exception.ts` (502) + `videos.controller.ts`'s Swagger docs updated to document the new 502 response.
- Independently re-verified by the controller (not just trusting the fix subagent's report, per this session's established practice): 189/189 unit+integration, 71/71 e2e, tsc clean, no new lint debt.

**What is NOT done yet — this is the actual resume point:** the fix commit `b5c2b45` has **not been re-reviewed**. Per `superpowers:subagent-driven-development`, a fix round always needs a re-review before the task is marked complete — do not skip straight to SI-03.6.

**To resume:**
1. Generate the review package: from this worktree, run the `subagent-driven-development` skill's `scripts/review-package a4966ba b5c2b45` (or `4a7df38 b5c2b45` for the whole-SI diff including the original implementation — prefer the whole-SI range since the original review already covered `a4966ba` once and a re-review conventionally re-reads the full task diff, not just the delta; see this skill's own guidance on re-review scope).
2. Dispatch a task-reviewer subagent (model: `sonnet` or equivalent — this SI involved judgment-heavy test-infrastructure changes, not a mechanical fix) using `.superpowers/sdd/task-5-brief.md` as the brief, `.superpowers/sdd/task-5-report.md` + `.superpowers/sdd/tmp/si-03.5-fix-report.md` as the implementer/fixer reports, and the generated diff file. Carry forward the same lint-debt scoping note used in SI-03.4/03.5's first review (264 pre-existing repo-wide problems, not this task's concern).
3. If clean: mark SI-03.5 complete in both `.superpowers/sdd/progress.md` and this file (mirroring how SI-03.4's completion was recorded above), then proceed to SI-03.6 per the Dispatch order.
4. If the re-review finds anything: same fix-loop process as before — Critical/Important get fixed and re-reviewed again; anything plan-mandated goes back to the human for a decision before deviating.

**Docker state:** containers (`db`, `mailpit`, `minio`, `redis`, `nestjs-api`) up and healthy. `.env` (gitignored) has all vars needed through SI-03.5.

**Bash timeout hook:** this session also added a project-wide 5-minute `timeout` wrapper on all Bash commands via `.claude/settings.json`'s `PreToolUse`/`Bash` hook (committed, unrelated to phase-03 but affects command execution in this repo going forward — background/already-`timeout`-wrapped commands are skipped).

### Artifact map

| Artifact | Path | Status |
|---|---|---|
| Architecture audit | `docs/decisions/architecture-audit-nestjs-pre-phase-03.md` | done |
| Implementation plan | `docs/phases/phase-03-videos/phase-03-videos.md` | done |
| Technical decisions doc | `docs/decisions/technical-decisions-phase-03-videos.md` | pending (SI-03.1) |
| context.md | `docs/phases/phase-03-videos/context.md` | not produced |
| validation.md | `docs/phases/phase-03-videos/validation.md` | not produced |
| library-refs.md | `docs/phases/phase-03-videos/library-refs.md` | pending (SI-03.1) |
| This file | `docs/phases/phase-03-videos/progress.md` | live — update per-SI as execution proceeds |

---

## Step Implementations

### SI-03.1 — Dependencies, Config Namespaces, and Docker Compose Infra (MinIO + Redis)
- **Status:** done (commits `422bd03`..`b776842`)

### SI-03.2 — Video Entity, Domain Exceptions, and Migration
- **Status:** done (commits `f2dca35`..`52de5f1`)

### SI-03.3 — StorageService (MinIO/S3 Wrapper)
- **Status:** done (commit `ab8aac0`)

### SI-03.4 — VideosModule and Upload Initiation
- **Status:** done (commits `61c7cde`..`1d09f62`)

### SI-03.5 — QueueModule and Upload Completion
- **Status:** done (commits `4a7df38`..`b5c2b45`, review clean after 1 fix round; re-review approved 2026-07-21, zero Critical/Important findings)

### SI-03.6 — Video Worker (Metadata Extraction, Thumbnail, Status Update)
- **Status:** done (commits `bc18876`..`74a4603`, review clean after 1 fix round — temp-file cleanup on error path)

### SI-03.7 — Video Detail Endpoint
- **Status:** done (commit `88085a8`, base `ef0a37d`, review clean, no fix round)

### SI-03.8 — Streaming Endpoint (Range Requests)
- **Status:** done (commits `246bf9f`..`5579e9d`, review clean after 1 fix round — unhandled stream-error listener)

### SI-03.9 — Download Endpoint
- **Status:** done (commits `8c4dc7a`..`3c4eb30`, review clean after 1 fix round — missing real-MinIO test + Content-Disposition filename escaping)
