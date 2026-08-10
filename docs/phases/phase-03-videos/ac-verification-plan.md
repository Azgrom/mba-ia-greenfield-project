# Phase 03 Acceptance-Criteria Verification — Execution Handoff

> **Written for a fresh context.** Everything needed is inline; no prior conversation required.
> **Repo root:** `/run/media/rafael/master_backup/Repos/AI Works/FullCycle-IA-MBA/challenge/StreamTubeContinuation`
> **Skills to load first:** `superpowers:using-superpowers`, then the `diagnose` skill at `/run/media/rafael/master_backup/Repos/AI Works/.claude/skills/diagnose/SKILL.md`. Also `superpowers:verification-before-completion` before writing any verdict.

---

## Step 0 — Branch first, before anything else

All work happens on its own branch. The AC being verified contains "Commit direto na main" as an auto-fail clause, and a verification of that clause must not itself violate it.

```bash
cd '/run/media/rafael/master_backup/Repos/AI Works/FullCycle-IA-MBA/challenge/StreamTubeContinuation'
git status --short          # expect only: ?? .idea/
git checkout dev
git pull --ff-only          # dev and origin/dev were both f32fc58 at plan time
git checkout -b bugfix/phase-03-ac-verification dev
```

Land it later as `bugfix/phase-03-ac-verification` → `dev` (`--ff-only`) → `main`. **Ask the user before merging into `main`.** No `rebase`, no `push --force`, no `reset` on any shared branch — see finding GIT-2 below for why that matters here specifically.

This plan already sits in the repo at `docs/phases/phase-03-videos/ac-verification-plan.md` as an **untracked** file (it was written before the branch existed, so it survives the checkout). Committing it as the first commit on the branch is recommended, so the execution record lives with the phase artifacts.

`git diff --stat main dev` is empty at plan time — `main` and `dev` differ only by three merge commits, so the checkout above changes no file contents.

---

## Context — why this task exists

`PROJECT_INSTRUCTIONS.md` §"Critérios de Aceite" (lines 144-173) is the single evaluation list for the Fase 03 challenge, backed by §"Reprova automática" (lines 175-184), eight auto-fail clauses. Phase 03 is implemented and merged to `main`.

An audit already exists — `docs/phases/phase-03-videos/acceptance-validation.md` — but it is **`status: dirty`, `issue_count: 1`**, and its own "Verification Note" admits some figures were never re-run live. Five commits landed after it (`8dfa167`, `8b914fd`, `d86322a`, `e4f6c06`, `f32fc58`) that changed the lint story materially.

More importantly, that document has a track record of being wrong in a specific way: on 2026-07-21 it recorded that all 216 lint errors were "in files outside Phase 03's touched set." That was false for a week — `validation.md:82` carries the 2026-07-28 correction showing 66 of them were Phase 03's own, and that the "targeted lint" command used to prove the claim simply omitted the three spec files that failed. The claim had been derived from reading a *description* of the code rather than running the command.

So the job is to **test**, not re-read. Per the `diagnose` skill: build a real pass/fail feedback loop first and let the loop produce each verdict. Read-only inspection has already been done (results below) — do not redo it; spend the effort on the loops.

**Deliverable:** an evidence-backed verification report, plus the documentation fixes it turns up. No feature code changes. No git-history rewriting.

---

## Already established by read-only inspection — record, do not re-derive

### Satisfied on inspection

| AC item | Evidence |
|---|---|
| Research doc resolves the 5 open decisions | `docs/decisions/technical-decisions-phase-03-videos.md` has `TD-01` (queue) … `TD-05` (status lifecycle), each with Options / trade-offs / recommendation, plus a `## Decisions Summary` |
| Phase folder has all 5 files | `docs/phases/phase-03-videos/` contains `context.md`, `validation.md`, `phase-03-videos.md`, `progress.md`, `library-refs.md` |
| Plan follows project format | `phase-03-videos.md` has `SI-03.1`…`SI-03.9`, and all five Technical Specifications — `Data Model` (:1074), `API Contracts` (:1102), `Authorization Matrix` (:1154), `Error Catalog` (:1166), `Events/Messages` (:1179) — plus `Dependency Map` (:1192) and `Deliverables` (:1221) |
| Infra declared in Compose | `nestjs-project/compose.yaml` declares `nestjs-api`, `db`, `mailpit`, `redis`, `minio`, `minio-init`, `video-worker` |
| Migration + entity linked to channel | `src/database/migrations/1784572856263-CreateVideos.ts`; `src/videos/entities/video.entity.ts` has `@Entity('videos')`, `@ManyToOne(() => Channel)`, `slug` unique varchar(11), `status` enum defaulting `DRAFT`, plus duration / metadata / thumbnail-key / error-message columns |
| Endpoint surface | `src/videos/videos.controller.ts`: `POST /videos` (:48), `POST /videos/:id/complete-upload` (:91), and `@Public()` `GET /videos/:slug` (:165), `:slug/stream` (:186), `:slug/download` (:247) |

### Finding VAL-1 — `validation.md` does not close in `clean`  ⚠️ auto-fail clause

AC line 151 requires "validation.md (status clean)". Reprova line 178 lists "validation.md que não fecha em clean".

`docs/phases/phase-03-videos/validation.md` has **no frontmatter at all** — it opens directly with `# Phase 03 — Upload and Video Processing Validation`. No `kind`, no `status`, no `issue_count`. It is a post-hoc test-results log, not a `plan-validate` gate artifact.

Every sibling artifact has the frontmatter and closes clean — compare `docs/phases/phase-02-auth/validation.md:1-11`:

```yaml
---
kind: phase
name: phase-02-auth
status: clean
issue_count: 0
sources_mtime:
  docs/phases/phase-02-auth/context.md: "2026-05-12T13:36:17-03:00"
  docs/decisions/technical-decisions-phase-02-auth.md: "2026-05-12T12:23:19-03:00"
issues: []
advisories: []
---
```

`docs/phases/phase-02-auth-frontend/validation.md` and `docs/tasks/task-openapi-docs-nestjs/validation.md` follow the same shape, and both carry historical `issues:` entries with `status: resolved` + `resolved_by` — so recording resolved history inside a `clean` document is the established convention, not a fudge.

This is already known internally as `ADV-1` in `acceptance-validation.md:162`, where it was downgraded to "advisory" on the reasoning that the file exists and "records status-equivalent information." Against the literal Reprova wording that reasoning does not hold.

### Finding GIT-2 — direct-to-main commits happened, and the evidence was rewound off `main`  ⚠️ auto-fail clause

Reprova line 182: "Commit direto na main".

`git reflog show main` (local only — this is not visible to anyone cloning the repo):

```
5b98d43 main@{0}: merge dev: Merge made by the 'ort' strategy.
a1e9a3d main@{1}: merge dev: Merge made by the 'ort' strategy.
a81e88d main@{2}: merge feature/phase-03-docs-remediation: Merge made by the 'ort' strategy.
1ee5f4d main@{3}: reset: moving to 1ee5f4dda72a2364937a7d70ea33d99e7cce4156
cfbd180 main@{4}: merge dev: Merge made by the 'ort' strategy.
1ee5f4d main@{5}: reset: moving to 1ee5f4dda72a2364937a7d70ea33d99e7cce4156
824faa4 main@{6}: commit: fix: correct MAIL_FROM syntax in .env.example
85434b9 main@{7}: merge dev: Fast-forward
ba66c8b main@{8}: merge dev: Fast-forward
a37e122 main@{9}: merge dev: Fast-forward
8e4af55 main@{10}: commit: feat: refactor skill from the other challenge and a command approval
a970086 main@{11}: commit: docs: update README for Phase 03 completion (backend)
cfdfb5a main@{12}: merge dev: Fast-forward
f3adf84 main@{13}: merge origin/main: Merge made by the 'ort' strategy.
f0ba485 main@{14}: commit (initial): feat: Challenge instructions
```

Three commits authored directly on `main`: `a970086`, `8e4af55`, `824faa4`. Then `main@{5}` and `main@{3}` **reset `main` back to `1ee5f4d`**, after which the branch was rebuilt via merge commits.

Result today:

```
$ git log --oneline --first-parent main
5b98d43 Merge branch 'dev'
a1e9a3d Merge branch 'dev'
a81e88d Merge branch 'feature/phase-03-docs-remediation'
1ee5f4d chore: ignore .worktrees/ directory
f3adf84 Merge remote-tracking branch 'origin/main'
f0ba485 feat: Challenge instructions
```

The three commits now reach `main` only through merge commits, so `git log` shows a Git-Flow-compliant history. `main` and `origin/main` are both `5b98d43`; `dev` and `origin/dev` are both `f32fc58`; `git log dev..main` is only the three merge commits. `1ee5f4d` was authored on `dev` (`dev@{18}`), not on `main`. `f0ba485` is the initial challenge-setup commit, pre-workflow.

The correction needed: `acceptance-validation.md:153-154` asserts the violation window was "disclosed, not erased", that rewriting was "rejected", and that the only git action taken was a pure fast-forward "no rewrite". The reflog contradicts all three. Fix the *description*; do not touch the history.

### Finding QG-2 — the DoD lint gate measures with `--fix` on

`nestjs-project/package.json:15`:

```json
"lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
```

The DoD's literal command auto-fixes while it measures. A green `npm run lint` can therefore mean "green after mutating the working tree", and running the gate dirties the tree. A truthful measurement needs `npx eslint "{src,apps,libs,test}/**/*.ts"` with no `--fix`, and `git status --short` captured before and after.

`validation.md:93` currently claims `npm run lint` exits `0` (0 errors, 1 warning) as of 2026-07-29, with the single remaining warning being `@typescript-eslint/no-unsafe-argument` at `src/auth/auth.service.integration-spec.ts:479`. Verify both numbers live; do not carry them forward on trust.

---

## Phase 1 — Build the feedback loops

**This is the skill.** Everything downstream just consumes these signals. All commands run inside Docker from `nestjs-project/` per `nestjs-project/CLAUDE.md` — never on the host. Capture raw output to the scratchpad so every number in the report is quotable rather than remembered.

### Loop A — quality gates (fast, deterministic)

Bring the stack up first (`docker compose up -d` from `nestjs-project/`; at plan time no containers existed, so expect a cold start of `db`/`redis`/`minio`/`minio-init`/`mailpit`/`nestjs-api`/`video-worker`).

1. `docker compose exec nestjs-api npx tsc --noEmit` → expect exit `0`
2. `docker compose exec nestjs-api npx eslint "{src,apps,libs,test}/**/*.ts"` — **no `--fix`; this is the real gate.** Record exit code, error count, warning count, and the per-file breakdown.
3. `git status --short`, then `docker compose exec nestjs-api npm run lint` (the DoD's literal command), then `git status --short` again — diff the two to expose any `--fix` mutation. Revert anything it changed.
4. Unit + integration suite and e2e suite, using the invocations already recorded in `validation.md:7-31` — they carry the required `DB_HOST=db`, `DB_USERNAME`/`PASSWORD`/`NAME`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` env:
   - `docker compose run --rm --workdir /home/node/app --env … nestjs-api npm test -- --runInBand` → baseline to beat: 32 suites / 200 tests
   - `… nestjs-api npm run test:e2e` → baseline: 4 suites / 92 tests
5. `docker compose config --services` and `docker compose ps` → the storage/queue/worker Compose clause (Reprova line 180 requires them *real and running*, not merely declared — so `ps` matters more than `config`)

### Loop B — real pipeline probe (the feature clauses)

The e2e suite covers endpoint *contracts* thoroughly (43 `it()`s in `test/videos.e2e-spec.ts`, including `Range: bytes=0-999` → 206 with exactly 1000 bytes, and 302-with-`Content-Disposition`), but it never drives one real file all the way through MinIO → BullMQ → ffmpeg → `ready`. That end-to-end path is what four AC bullets actually claim. Probe it against the running stack:

1. Register a user / log in. `POST /videos` with a real multi-part-sized file's metadata → assert a `draft` row with a `slug` exists **before any bytes move** (the pré-cadastro clause). Query the DB directly (the `postgres` MCP server is configured) rather than trusting the response body alone.
2. PUT the parts straight to MinIO using the returned presigned URLs — confirm from MinIO/API logs that no file bytes traversed `nestjs-api`.
3. `POST /videos/:id/complete-upload` → poll `GET /videos/:slug` until `status` leaves `processing`.
4. Assert terminal state is `ready` with non-null `durationSeconds`, `metadata`, and `thumbnailKey`; confirm the thumbnail object actually exists in the `streamtube` bucket (processing + thumbnail clauses).
5. `GET /:slug/stream` with `Range: bytes=0-1023` → assert `206`, a correct `Content-Range`, exactly 1024 bytes returned. Then `GET /:slug/download` → assert `302` and that following the presigned target serves the file (streaming + download clauses).
6. Create two videos back to back → assert distinct slugs (URL única clause).
7. Force a failure path (e.g. complete-upload on an object ffprobe cannot parse) → assert `status = error` with `error_message` set, closing the "rascunho → processando → pronto/erro" clause end to end.

Fixture: a small real video (a few MiB) generated with ffmpeg **inside the container**. **Do not move 10GB.** The 10GB clause is architectural — bytes never traverse the API — and is proven by step 2 plus the existing `fileSizeBytes > 10 GiB` rejection test (`videos.e2e-spec.ts:254`) and the parts-count calculation test (:340).

Iterate on the loop as the skill demands: pin the fixture, seed nothing random, keep the whole thing under a minute, assert on the specific symptom rather than "didn't crash."

### Loop B-2 — measured non-blocking check

Turn "sem travar a API" into a measurement instead of an architecture argument:

1. Baseline: N=20 sequential `GET /videos/:slug` (or the health endpoint) with the stack idle → record median and p95.
2. Repeat the same polling continuously while the presigned part PUTs saturate MinIO → record median and p95 under load.
3. Assert the two distributions sit in the same band. An API that "travava" would show the request queue backing up.

Record the actual numbers. If latency *does* degrade, that is a finding — it enters Phase 3's hypothesis loop rather than being explained away.

### Loop C — doc-coherence check

Reprova line 183: "CLAUDE.md/equivalente inconsistente com o código". `nestjs-project/CLAUDE.md` §"Video Processing (Phase 03)" (line 152) makes specific checkable claims. Grep each against reality:

- the four module dirs `src/videos/`, `src/storage/`, `src/queue/`, `src/video-worker/` exist
- `start:worker:dev` in `package.json` contains `-r dotenv/config` (it does at plan time, line 28) — the claim about `VIDEO_WORKER_CONCURRENCY` depends on it
- `compose.yaml` has `redis` (6379), `minio` (9000/9001), `minio-init` creating bucket `streamtube`, `video-worker`
- the three named integration specs (`storage.service.integration-spec.ts`, `video-processing.processor.integration-spec.ts`, `video-processing.queue.integration-spec.ts`) exist and contain no `jest.mock` of `StorageService`/the queue
- root `CLAUDE.md:26` reads `**Message Queue** (BullMQ/Redis)`; `grep -rn "TBD" CLAUDE.md docs/project-plan.md nestjs-project/CLAUDE.md` returns nothing

Also check the reverse direction, which the previous audit did not: does `CLAUDE.md` describe anything that *no longer* exists? Note that `validation.md:101` flags `queueConfig.videoWorkerConcurrency` in `src/config/queue.config.ts` as dead config the worker bypasses — check whether any doc still points at it.

Any claim failing a grep is a Reprova hit.

---

## Phases 2-4 — only if a loop goes red

Reproduce first — confirm the loop shows the failure the AC describes, not a nearby one. Then generate **3-5 ranked falsifiable hypotheses and show them to the user before testing any** (each with its prediction: "if X is the cause, changing Y makes it disappear"). Instrument one variable at a time, tagging every probe `[DEBUG-p03]` so cleanup is a single grep. Do not skip to a fix.

---

## Deliverables

### 1. The report

Append a new dated section to `docs/phases/phase-03-videos/acceptance-validation.md`. **Do not rewrite the existing audit trail** — it is the historical record, including its own corrections. One row per AC bullet (lines 148-173) and per Reprova clause (lines 175-184), each carrying a verdict **plus the command and exit code, or the measurement, that produced it.** Continue the existing `DOC-`/`GIT-`/`QG-` finding-ID scheme (`VAL-1`, `GIT-2`, `QG-2` above are reserved by this plan). Anything not actually run gets labelled "not verified" — never inferred. That inference failure is exactly what the 2026-07-28 correction had to undo.

### 2. Fix `validation.md` so it closes in clean (VAL-1)

Add the frontmatter block, copying the shape from `docs/phases/phase-02-auth/validation.md:1-11`: `kind: phase`, `name: phase-03-videos`, `status`, `issue_count`, `sources_mtime` (fingerprint `context.md` and `technical-decisions-phase-03-videos.md`), `issues:`, `advisories:`.

The existing body stays — the test results, the 2026-07-28 correction, the resolved lint blocker, the known follow-ups are all real evidence. Carry the historical blockers into `issues:` with `status: resolved` + `resolved_by` commit, the way `phase-02-auth-frontend/validation.md` does.

**Write `status: clean` only if Loop A comes back green.** If a gate is red the file says `dirty` and the AC bullet fails. The verdict follows the loop, not the desired outcome.

### 3. Correct GIT-2's text in `acceptance-validation.md`

Rewrite `acceptance-validation.md:153-154` (finding GIT-1) to state what the reflog actually shows: three direct-to-main commits, followed by a `reset` of `main` to `1ee5f4d` and a rebuild via merge commits, such that `git log --first-parent main` no longer shows the violation and `origin/main` matches at `5b98d43` — recoverable only from local reflog. Remove the claims that rewriting was "rejected" and that only a fast-forward occurred. No history is touched; the fix is to the description, which is the thing that is currently wrong.

### 4. Re-verdict the frontmatter

Recompute `acceptance-validation.md`'s `issue_count` and top-level `status` from what the loops found. Its current text asserts `clean` is permanently unreachable because GIT-1 can never resolve; revisit that reasoning once GIT-2's corrected wording is in, and state the honest conclusion either way.

---

## Files

- **Read/verify:** `PROJECT_INSTRUCTIONS.md:144-184`, `docs/phases/phase-03-videos/{validation,progress,context,phase-03-videos}.md`, `docs/decisions/technical-decisions-phase-03-videos.md`, `nestjs-project/{compose.yaml,package.json,CLAUDE.md}`, root `CLAUDE.md`
- **Write:** `docs/phases/phase-03-videos/acceptance-validation.md`, `docs/phases/phase-03-videos/validation.md`, optionally `docs/phases/phase-03-videos/ac-verification-plan.md` (this plan)
- **Probe scripts (Loops B, B-2):** scratchpad only — deleted at the end, or moved to a clearly-marked debug location
- **Out of bounds:** no changes to `nestjs-project/src/{videos,storage,queue,video-worker}`; the feature code is not what is under test here

---

## Definition of done for this task

- Every AC bullet and every Reprova clause has a verdict traceable to a captured exit code or measurement
- `validation.md` has frontmatter whose `status` matches Loop A's real result, and whose `issue_count` matches its own `issues:` list
- GIT-2's text matches what `git reflog show main` and `git log --first-parent main` actually print
- `grep -r "DEBUG-p03"` is empty; throwaway probes removed
- `git status --short` shows no unintended tree changes — in particular none left by the `--fix` lint run
- Work is on `bugfix/phase-03-ac-verification`, not on `main`; merge to `main` only after asking
- **Post-mortem stated after the report is written, not before:** what would have prevented the 2026-07-21 → 2026-07-28 week where the record held a false lint claim? If the answer is structural — the DoD gate command itself carries `--fix`, so it can never be a clean measurement — say so as a recommendation, and note that `dotenv` being undeclared in `package.json` (`validation.md:100`) is a related latent trap.
