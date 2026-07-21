---
kind: acceptance-validation
name: phase-03-videos
target: PROJECT_INSTRUCTIONS.md § "Critérios de Aceite" + § "Reprova automática"
status: dirty
issue_count: 2
generated: "2026-07-21T19:29:20-03:00"
generated_at_commit: 8e4af55
sources_consulted:
  PROJECT_INSTRUCTIONS.md: read in full (this session)
  README.md: read in full (this session)
  docs/project-plan.md: read in full (this session)
  docs/decisions/technical-decisions-phase-03-videos.md: headers + Recommendation lines (this session)
  docs/phases/phase-03-videos/progress.md: read in full (this session)
  docs/phases/phase-03-videos/validation.md: read in full (this session)
  docs/phases/phase-03-videos/phase-03-videos.md: headers only (this session)
  CLAUDE.md (root): grepped for video/queue/storage/worker terms (this session)
  nestjs-project/CLAUDE.md: read in full (this session)
  nestjs-project/src/videos/**: file listing + entity + controller routes (this session)
  nestjs-project/src/storage, queue, video-worker: file listing (this session)
  nestjs-project/compose.yaml: read in full (this session)
  git log / git reflog (main, dev): read in full (this session)
issues:
  - id: DOC-1
    status: resolved
    summary: "nestjs-project/CLAUDE.md has zero mentions of videos/storage/queue/worker"
    resolved_by: "Task 1 Step 1 — added '## Video Processing (Phase 03)' section (uncommitted, pending Task 2)"
  - id: DOC-2
    status: resolved
    summary: "root CLAUDE.md architecture section still says 'Message Queue (TBD)'"
    resolved_by: "Task 1 Step 2 — changed to '(BullMQ/Redis)' (uncommitted, pending Task 2)"
  - id: GIT-1
    status: open
    summary: "Two commits landed directly on main after the dev→main fast-forward merge"
  - id: QG-1
    status: open
    summary: "Repo-wide 'npm run lint' fails (260 pre-existing problems); DoD/AC wording has no scoping exception"
advisories:
  - id: ADV-1
    status: open
    summary: "validation.md reads as a post-implementation test-results log, not a pre-build plan-validate coherence gate"
---

# Phase 03 — Acceptance Criteria Validation

This document is **not** a `/plan-validate` run — Phase 03 was already implemented before this analysis started, so there is no `context.md` coherence gate to re-run. It borrows three things from the project's own planning skills instead of inventing a new format from scratch:

- **From `spdd-analysis`** (`.agents/skills/spdd-analysis/SKILL.md` in the `AI Works` workspace): the discipline of separating *what exists* (Domain Concept Identification) from *what to do about it* (Strategic Approach) from *what could go wrong* (Risk & Gap Analysis), and preserving the original requirement verbatim rather than paraphrasing it.
- **From `plan-context`** (`.claude/skills/plan-context/SKILL.md`): the idea of a lean, indexed artifact that only reports what subagents/reads actually found, with an explicit source list (its `sources_mtime` — here `sources_consulted`, since this doc has no upstream `context.md` to fingerprint against) — never inventing findings that aren't traceable to a specific file or command.
- **From `plan-validate`** (`.claude/skills/plan-validate/SKILL.md`): the categorized-issue format with stable IDs, a `status: clean|dirty` verdict, an `advisories:` channel for informational-but-non-blocking items, and a `## Resolved Issues` audit trail for future reruns.

Everything below is grounded in files/commands actually read/run this session (see `sources_consulted` above) or in the prior conversation turn's analysis, which itself cited exact file paths, line numbers, and command output. Nothing here is invented.

## Original Acceptance Criteria (verbatim from PROJECT_INSTRUCTIONS.md)

> ## Decisões e planejamento
>
> - technical-decisions-phase-03-videos.md com as decisões em aberto resolvidas e justificadas (fila, estratégia de upload, streaming, processamento/thumbnail, ciclo de status)
> - Pasta docs/phases/phase-03-videos/ com context.md, validation.md (status clean), o plano phase-03-videos.md, o progress.md e o library-refs.md (se houver libs novas a fixar — esperado nesta fase)
> - O plano segue o formato do projeto: SIs SI-03.x, Technical Specifications (Data Model, API Contracts, Authorization Matrix, Error Catalog, Events/Messages), Dependency Map e Deliverables
>
> ## Implementação — feature
>
> - Upload de vídeo de até 10GB sem travar a API, com pré-cadastro do vídeo como rascunho ao iniciar
> - Processamento automático após o upload: extração de duração/metadados e geração de thumbnail
> - URL única por vídeo, sem conflito
> - Streaming funcionando (sem exigir download completo) e download do vídeo disponível
> - Ciclo de status do vídeo (rascunho → processando → pronto/erro) refletido no banco
>
> ## Implementação — infraestrutura e qualidade
>
> - Object storage, fila e worker subindo via docker compose junto com o backend
> - Migration cria a tabela de vídeos; entidade ligada ao canal
> - Testes nos níveis adequados, verdes (npm test e npm run test:e2e)
> - Definition of Done completa: suíte verde + npx tsc --noEmit (código 0) + npm run lint
> - Git Flow respeitado (trabalho em feature/* a partir de dev, sem commit direto na main)
>
> ## Documentação e ferramenta
>
> - CLAUDE.md (ou equivalente) atualizado com a seção de vídeos, coerente com o código
> - Se usou outra ferramenta que não o Claude Code: a fundação de IA foi portada para a convenção dela e os artefatos da pasta da fase foram entregues no mesmo formato
>
> ## Reprova automática
>
> - Pular o workflow: implementar sem as etapas de research, planejamento e implementação (e seus artefatos)
> - Plano sem SIs ou sem as Technical Specifications, ou validation.md que não fecha em clean
> - Passar o arquivo de 10GB pela API de forma que trave o sistema (sem estratégia de upload assíncrono/direto)
> - Não ter fila, worker e storage reais subindo no Compose
> - tsc com erro, lint quebrado ou suíte vermelha
> - Commit direto na main
> - CLAUDE.md/equivalente inconsistente com o código
> - Usar outra ferramenta sem portar a fundação para a convenção dela

## Domain Concept Identification

#### Existing Concepts (from codebase)

- **Phase-pipeline artifacts** (`docs/decisions/technical-decisions-phase-03-videos.md`, `docs/phases/phase-03-videos/{context,validation,phase-03-videos,progress,library-refs}.md`): the project's own SPDD-derived planning contract, defined by `.claude/skills/plan-context`, `plan-validate`, `plan-build`. All five required files exist and are populated.
- **`videos` / `storage` / `queue` / `video-worker` modules** (`nestjs-project/src/`): the Phase 03 implementation itself. Fully built — entity, migration, 5 endpoints, BullMQ queue, ffmpeg worker.
- **`CLAUDE.md` (root and `nestjs-project/`)**: the AI-instruction artifacts this acceptance criterion targets. Both exist; neither currently documents the video subsystem.
- **Git Flow** (`main` / `dev` / `feature/*`): the branching contract from the root `CLAUDE.md`. `git reflog` shows it was followed correctly for the feature itself (`feature/phase-03-videos` → `dev` fast-forward → `main` fast-forward), then violated by two subsequent doc-only commits straight on `main`.
- **Definition of Done** (root `CLAUDE.md`): "suíte verde + tsc + lint", worded without a "pre-existing debt" carve-out — yet the team's own `validation.md` documents accepting 260 pre-existing lint problems as out of scope.

#### New Concepts Required

- None. This is a remediation/documentation pass over an already-implemented phase, not new feature work — no new domain entities, endpoints, or business rules are introduced by any task below.

#### Key Business Rules

- **"CLAUDE.md deve ser coerente com o código"** governs Task 1 below: every claim added must point at a file/command that exists (verified against `nestjs-project/src/videos|storage|queue|video-worker` and `compose.yaml`).
- **"Sem commit direto na main"** governs Task 2: any further change (including committing this very document) must go through `feature/* → dev → main`, not straight onto `main`, even though two prior commits already broke that rule and can't be silently un-committed.
- **"Lint quebrado" is listed under Reprova automática with no exception clause** — this is the rule QG-1 tests literally, independent of the team's own scoping decision recorded in `validation.md`.

## Strategic Approach

#### Solution Direction

Three of four gaps are pure documentation/process fixes with no code risk: writing the missing CLAUDE.md section (DOC-1/DOC-2) and routing further commits through the proper branch (part of GIT-1's remediation). The fourth (QG-1) is a **decision**, not a mechanical fix — literally satisfying "npm run lint" repo-wide means touching ~14 files across `auth/`, `channels/`, `common/`, `mail/`, `users/` that Phase 03 never touched, which is a different blast radius and arguably a different task than "Phase 03 acceptance." I'm surfacing it as an explicit choice rather than silently picking a side.

GIT-1 cannot be "fixed" in the normal sense: `a970086` and `8e4af55` are already on `main`'s history. Rewriting shared main history (rebase + force-push) is exactly the kind of destructive, hard-to-reverse action this session's operating rules require explicit confirmation for, and it is not proportionate to a documentation-commit slip. The realistic remediation is procedural: stop the bleeding (route everything from here forward through `dev`) and document the deviation honestly rather than hide it.

#### Key Design Decisions

- **DOC-1/DOC-2 (video documentation): write it now, no trade-off.** Low-risk, purely additive, directly required by the AC text ("atualizado com a seção de vídeos, coerente com o código").
- **GIT-1 (main history): do not rewrite `main`; document + fix forward.** Trade-off: rewriting history would make the branch *look* compliant retroactively but risks losing/duplicating history and requires a force-push the user hasn't authorized. Fixing forward (this doc's own commit goes through `feature/* → dev → main`) is reversible and honest, but does not erase the AC violation already sitting in `main`'s log — that has to be disclosed, not concealed.
- **QG-1 (lint gate): needs a human decision, not a default.** Two real options exist — (a) actually clean the 260 pre-existing problems (real effort, wide blast radius, arguably its own task), or (b) formally amend the DoD wording in root `CLAUDE.md` to state the "no NEW debt in touched files" exception the team already applied in practice. Recommendation: (b) as the immediate unblock (it makes the written rule match what the team actually enforced and already got a human sign-off for in `validation.md`'s 2026-07-21 entry), with (a) tracked as a separate follow-up task — but this is the user's call, not mine to silently pick.

#### Alternatives Considered

- **Squash/rewrite `main` to remove the two direct commits**: rejected — destructive, requires force-push, disproportionate to a docs-only slip, and this session's git-safety rules require explicit authorization before any such action.
- **Leave QG-1 unaddressed / silently treat the pre-existing debt as fine**: rejected — the AC text has no carve-out clause, so silently accepting the team's own scoping decision as sufficient would be asserting compliance the source document doesn't actually grant.

## Acceptance Criteria Coverage

| Bucket | Addressable today? | Gaps / Notes |
|---|---|---|
| Decisões e planejamento | Yes — already satisfied | `technical-decisions-phase-03-videos.md` resolves all 5 TDs; all 5 phase-folder files exist; plan has SIs + all 5 Technical Specs. One advisory only (ADV-1, see below), not a hard gap. |
| Implementação — feature | Yes — already satisfied | Upload/pre-cadastro/processing/thumbnail/unique-URL/streaming/download/status-cycle all verified against controller routes + entity + worker. |
| Implementação — infraestrutura e qualidade | Partial | Storage/queue/worker/migration/tests all green per `validation.md`. `npx tsc --noEmit` exits 0. **`npm run lint` (repo-wide) does not exit 0 — QG-1.** Git Flow was respected for the feature itself but violated afterward — **GIT-1**. |
| Documentação e ferramenta | Yes — DOC-1/DOC-2 fixed | Both `CLAUDE.md` files now cover the video subsystem (see `## Resolved Issues`). **Not yet committed** — still pending Task 2's `feature/* → dev → main` path; until that lands, the working tree satisfies the AC but the last commit on `main` does not. |
| Reprova automática | At risk on 2 of 8 clauses | "lint quebrado" (QG-1) and "Commit direto na main" (GIT-1) are both literally true today; the other 6 clauses are clear. |

## Findings

### Documentation Gaps

_None open — DOC-1 and DOC-2 resolved, see `## Resolved Issues` below._

### Git Flow Violations

- **GIT-1** — `git reflog show main` shows `main@{2}: merge dev: Fast-forward` at `cfdfb5a` (the correct Phase 03 landing), followed by two commits authored straight onto `main` with no branch: `a970086` ("docs: update README for Phase 03 completion") and `8e4af55` ("feat: refactor skill from the other challenge and a command approval"). Both bypass `dev` entirely. Explicit choice: (a) leave `main`'s history as-is and disclose the deviation in this doc (chosen — see Strategic Approach); (b) rewrite `main`'s history via rebase + force-push (rejected, destructive, needs separate explicit authorization); (c) going forward, route every further commit — including this document's own — through `feature/* → dev → main` (adopted in Task 2).

### Quality Gate

- **QG-1** — `docs/phases/phase-03-videos/validation.md` (lines documenting the 2026-07-21 remediation) records `npx eslint "{src,apps,libs,test}/**/*.ts"` exiting `1` with 260 pre-existing problems in 14 files outside Phase 03's touched set, human-accepted as pre-existing baseline debt. `PROJECT_INSTRUCTIONS.md`'s "Reprova automática" list states `"tsc com erro, lint quebrado ou suíte vermelha"` with no carve-out for pre-existing/out-of-scope debt, and root `CLAUDE.md`'s Definition of Done says `"Lint passes: npm run lint"` — also unqualified. Explicit choice surfaced to the user in Task 3: (a) fix the 260 pre-existing problems repo-wide; (b) formally amend the DoD wording to state the "no NEW debt" exception the team already applied in practice, then track (a) as separate follow-up work. **Not re-verified live this session** — Docker was not running when this doc was produced (`docker compose ps` returned no containers); the 260 figure is inherited from `validation.md`'s 2026-07-21 entry, not re-executed. Task 3 Step 1 re-runs it for real before any decision is finalized.

## Advisories

- **ADV-1** — `docs/phases/phase-03-videos/validation.md` documents *post*-implementation test/lint/Docker-service results (remediation verification), not the *pre*-`plan-build` coherence check (missing decisions, ambiguities, dependency gaps against `context.md`) that `.claude/skills/plan-validate/SKILL.md` describes producing before a plan is built. `progress.md`'s own 2026-07-20 handoff note says `context.md`/`validation.md` "do not exist yet ... out of scope for the planning pass," and both were added retroactively during the 2026-07-21 remediation. This does not violate the literal AC text (`validation.md` exists and records `status`-equivalent information), so it's advisory, not a hard issue — but it means the `validate ↔ resolve` iterate-to-clean loop the workflow describes cannot be confirmed to have happened *before* `plan-build`, only that a validation artifact exists *after* implementation. No action required unless the user wants the historical record to be more precise about this.

## Resolved Issues

- **DOC-1** _(resolved_by Task 1 Step 1)_ — `nestjs-project/CLAUDE.md` had zero mentions of `video`/`storage`/`queue`/`worker`/`ffmpeg`/`minio`/`bullmq`/`redis`. Fixed: added a `## Video Processing (Phase 03)` section (worker execution model, new Compose services, upload flow, testing conventions). Verified via `grep -c -i "video\|storage\|queue\|worker\|ffmpeg\|minio\|bullmq\|redis" nestjs-project/CLAUDE.md` → `10` (was `0`). Change is currently uncommitted, staged for landing via the `feature/* → dev → main` path in Task 2 — not yet on any branch.
- **DOC-2** _(resolved_by Task 1 Step 2)_ — root `CLAUDE.md:26` said `**Message Queue** (TBD)`. Fixed: changed to `**Message Queue** (BullMQ/Redis)`. Verified via `grep -n "Message Queue" CLAUDE.md` → shows the corrected line; `grep -rn "TBD" CLAUDE.md docs/project-plan.md nestjs-project/CLAUDE.md` → exit `1` (no matches left). Same uncommitted/pending-Task-2 status as DOC-1.

---

## Remediation Tasks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close DOC-1, DOC-2, GIT-1, and get a human decision + real number on QG-1, without touching any Phase 03 feature code (which is already correct and out of scope for this remediation).

**Architecture:** Two of three tasks are documentation-only edits routed through a proper `feature/* → dev → main` cycle (fixing GIT-1 forward while doing DOC-1/DOC-2). The third re-runs the real lint gate and asks the user to pick between two already-identified remediation strategies rather than silently choosing one.

**Tech Stack:** Markdown edits; Docker Compose (`nestjs-project/`) to re-run `npm run lint` for real.

### Global Constraints

- No code in `nestjs-project/src/{videos,storage,queue,video-worker}` may change — Phase 03 feature/infra/tests are already acceptance-complete; touching them is out of scope here.
- No destructive git operation (`rebase`, `push --force`, `reset --hard` on `main`) without a separate, explicit user request — GIT-1's existing violation is documented, not erased.
- Every command that touches `nestjs-project` runs inside its Docker containers, never on the host (`nestjs-project/CLAUDE.md`).
- All new commits for this remediation go through `feature/* → dev → main` — none land directly on `main`.

---

### Task 1: Document the video subsystem in CLAUDE.md

**Files:**
- Modify: `nestjs-project/CLAUDE.md` (add new section; insert after the existing `## Architecture` section, currently ending around line 149)
- Modify: `CLAUDE.md` (root of `StreamTubeContinuation/`, line 26)

**Interfaces:**
- Consumes: the already-verified list of real files/commands — `nestjs-project/src/videos/`, `src/storage/`, `src/queue/`, `src/video-worker/`, `compose.yaml`'s `redis`/`minio`/`minio-init`/`video-worker` services, `package.json`'s `start:worker:dev` script.
- Produces: nothing consumed by later tasks — this is a leaf documentation task.

- [x] **Step 1: Add a "Video Processing (Phase 03)" section to `nestjs-project/CLAUDE.md`**

  Insert after the existing `## Architecture` section (after the `Controllers handle HTTP routing...` bullet, before `## Code Conventions`):

  ```markdown
  ## Video Processing (Phase 03)

  Upload, storage, async processing, and delivery of videos. Four modules: `videos/` (entity, controller, upload/detail/stream/download endpoints), `storage/` (MinIO/S3 wrapper — multipart upload, presigned URLs, range GET), `queue/` (BullMQ producer — `VideoQueueService`), `video-worker/` (separate process consuming the queue — metadata extraction + thumbnail via fluent-ffmpeg/ffprobe).

  ### Running the worker

  The worker is a **separate Node process**, not part of `nestjs-api`. It runs as its own Compose service (`video-worker`) via `npm run start:worker:dev`. `VIDEO_WORKER_CONCURRENCY` (default BullMQ concurrency is 1) is only honored because `start:worker:dev` preloads `-r dotenv/config` — this loads `.env` before the `@Processor` decorator reads the concurrency option at import time, ahead of `ConfigModule.forRoot()`. If you ever see the worker silently running at concurrency 1 despite `VIDEO_WORKER_CONCURRENCY` being set, check that preload flag first.

  ### New infra services (`compose.yaml`)

  - `redis` — BullMQ backing store, port `6379`.
  - `minio` + `minio-init` — S3-compatible object storage, ports `9000` (API) / `9001` (console), bucket `streamtube` auto-created by `minio-init`.
  - `video-worker` — the background processor described above.

  ### Upload flow

  Direct-to-storage multipart upload (never through the API): `POST /videos` initiates a draft + returns presigned part URLs; the client PUTs parts straight to MinIO; `POST /videos/:id/complete-upload` finalizes the multipart upload and enqueues processing. This is why a 10GB file never touches the NestJS process.

  ### Testing conventions specific to this subsystem

  Per the project's "don't mock what you can run for real" rule: `storage.service.integration-spec.ts`, `video-processing.processor.integration-spec.ts`, and `video-processing.queue.integration-spec.ts` all exercise **real MinIO and real Redis/BullMQ** via the Compose services — never mock `StorageService` or the queue in an integration spec. Unit specs (`*.spec.ts`) still mock these collaborators.
  ```

- [x] **Step 2: Fix the stale "Message Queue (TBD)" line in root `CLAUDE.md`**

  In `CLAUDE.md` (repo root), replace:

  ```markdown
  - **Message Queue (TBD)** → video processing job queue
  ```

  with:

  ```markdown
  - **Message Queue** (BullMQ/Redis) → video processing job queue
  ```

- [x] **Step 3: Verify no other stale/inconsistent doc claims remain**

  Ran (widened to include `nestjs-project/CLAUDE.md` since Step 1 also touched it):
  ```bash
  grep -rn "TBD" CLAUDE.md docs/project-plan.md nestjs-project/CLAUDE.md
  ```
  Result: exit `1`, zero matches. No remaining `TBD` markers anywhere in scope.

- [ ] **Step 4: Commit on a feature branch (not directly on `main` — see Task 2 for why)**

  This step is superseded by Task 2, Step 1 below — do not commit directly here. Stage the changes and hand off to Task 2.

---

### Task 2: Route this remediation through proper Git Flow (fixes GIT-1 going forward)

**Files:** none new — this task governs *how* Task 1's and Task 3's changes get committed, not their content.

**Interfaces:**
- Consumes: the staged-but-uncommitted changes from Task 1 (CLAUDE.md edits) and, once decided, Task 3 (DoD wording change, if option (b) is chosen).
- Produces: a clean `feature/* → dev → main` history for this remediation, matching the pattern `git reflog` already showed working correctly for `feature/phase-03-videos`.

- [ ] **Step 1: Confirm current branch state before branching**

  Run:
  ```bash
  git status --short
  git branch --show-current
  ```
  Expected: currently on `main`, with Task 1's edits present as uncommitted changes (or freshly committed if Step 4 of Task 1 was skipped correctly).

- [ ] **Step 2: Create a feature branch from `dev`**

  ```bash
  git checkout dev
  git pull --ff-only
  git checkout -b feature/phase-03-docs-remediation
  ```
  Expected: new branch created from `dev`'s tip (which per the reflog already contains all of Phase 03's real commits, ending at `cfdfb5a`).

- [ ] **Step 3: Re-apply Task 1's CLAUDE.md edits on this branch and commit**

  ```bash
  git add CLAUDE.md nestjs-project/CLAUDE.md docs/phases/phase-03-videos/acceptance-validation.md
  git commit -m "docs: document Phase 03 video subsystem in CLAUDE.md, add acceptance-criteria audit"
  ```
  Expected: one commit, non-empty diff limited to the two `CLAUDE.md` files and this audit doc.

- [ ] **Step 4: Merge to `dev`, then fast-forward `dev` into `main`**

  ```bash
  git checkout dev
  git merge --ff-only feature/phase-03-docs-remediation
  git checkout main
  git merge --ff-only dev
  ```
  Expected: both merges succeed as fast-forwards (mirrors the exact `main@{2}: merge dev: Fast-forward` pattern already in the reflog for the real Phase 03 landing). If either merge is not fast-forward-able, stop and investigate — do not force it.

- [ ] **Step 5: Record the GIT-1 deviation as closed-going-forward, not erased**

  No file edit needed — GIT-1 stays `status: open` in this doc's frontmatter (the historical violation on `main` is real and undisclosed rewriting would be worse), but note in a follow-up commit message or PR description that all remediation from this point forward followed Git Flow correctly.

---

### Task 3: Resolve the lint-gate ambiguity (QG-1)

**Files:**
- Read-only: `nestjs-project/package.json`, `nestjs-project/.eslintrc*` (whichever config file exists)
- Possibly modify: `CLAUDE.md` (repo root, Definition of Done section) — only if the user picks option (b)

**Interfaces:**
- Consumes: Docker Compose services from `nestjs-project/compose.yaml` (needs `db`, `redis`, `minio` up for the app to boot enough for lint — actually lint doesn't need runtime services, only `nestjs-api`'s installed `node_modules`; confirm this assumption in Step 1).
- Produces: an authoritative current lint number (may differ from the 260 recorded 2026-07-21) and a human decision recorded back into this doc's `issues:` frontmatter.

- [ ] **Step 1: Bring up the container and get a real, current lint result**

  ```bash
  cd nestjs-project
  docker compose up -d nestjs-api
  docker compose exec nestjs-api npm run lint
  ```
  Expected: either exit `0` (QG-1 auto-resolves — record as `resolved` in this doc's frontmatter with the command output as evidence) or a non-zero exit with a problem count. Record the **exact** count and file list — do not reuse the 260 figure from `validation.md` without re-confirming it's still accurate.

- [ ] **Step 2: If still failing, present the two options to the user (do not pick silently)**

  Ask (via `AskUserQuestion` or plain text, whichever fits the session):
  > QG-1: repo-wide lint still fails with N problems in M files, none touched by Phase 03. Two options: (a) fix them now — real effort, expands scope beyond Phase 03; (b) formally amend the Definition of Done in root `CLAUDE.md` to state the "no NEW debt in touched files" exception the team already applied during the 2026-07-21 remediation, and track (a) as a separate follow-up task. Which do you want?

- [ ] **Step 3a: If the user picks (a) — fix the debt**

  This branches into its own task-per-file scope (14 files per `validation.md`'s inventory) and is **out of scope for this document** — write a fresh plan for it (a new `docs/superpowers/plans/<date>-lint-debt-cleanup.md`) rather than folding it in here, since it's unrelated to Phase 03's acceptance criteria once QG-1's DoD-wording question is settled.

- [ ] **Step 3b: If the user picks (b) — amend the DoD wording**

  In root `CLAUDE.md`, under `## Definition of Done (Technical)`, change:
  ```markdown
  4. Lint passes: `npm run lint`.
  ```
  to:
  ```markdown
  4. Lint passes on all files touched by the change (`npm run lint` scoped to the diff). Pre-existing repo-wide lint debt outside the current change's scope is tracked separately, not a blocker — see `docs/phases/phase-03-videos/validation.md` for the accepted 2026-07-21 baseline.
  ```
  Commit through the same `feature/* → dev → main` path as Task 2 — never directly on `main`.

- [ ] **Step 4: Update this document's frontmatter**

  Flip `QG-1`'s `status` to `resolved` (citing the chosen option and commit SHA) once Step 2/3 concludes, and recompute `issue_count` / top-level `status` (only `clean` once DOC-1, DOC-2, GIT-1's forward-fix, and QG-1 are all resolved — GIT-1 itself can only ever be annotated "mitigated going forward," never "resolved," since the historical commits remain).

---

## Self-Review

*(per `superpowers:writing-plans`' Self-Review checklist, applied to this document)*

**1. AC coverage:** every bucket in the "Acceptance Criteria Coverage" table above maps to either "already satisfied" (no task needed) or a specific Finding ID with a specific Task. No AC bucket is left unaddressed. ✅

**2. Placeholder scan:** re-read every step above for "TBD" / "add appropriate X" / "similar to Task N" patterns. Task 3 Step 3a intentionally defers to a *separate* plan rather than hand-waving a fix inline — that's a scope decision, not a placeholder, and is explicitly justified rather than left vague. No other placeholders found. ✅

**3. Type/reference consistency:** file paths referenced (`nestjs-project/CLAUDE.md`, root `CLAUDE.md`, `compose.yaml`, `package.json`) were all confirmed to exist and to contain the cited content in this session's own reads (see `sources_consulted`), not assumed. The `start:worker:dev` script name and `VIDEO_WORKER_CONCURRENCY` env var were confirmed against `progress.md`'s remediation entry and `compose.yaml`'s `video-worker` service definition. ✅

## Verification Note

*(per `superpowers:verification-before-completion` — evidence before assertions)*

- **DOC-1, DOC-2, GIT-1** are backed by commands run live in this session: `grep -n -i "video\|storage\|queue\|worker\|ffmpeg\|minio\|bullmq\|redis" nestjs-project/CLAUDE.md` (zero matches), `grep -n -i "video" CLAUDE.md` (shows the stale `TBD` line), and `git reflog show main` / `git reflog show dev` (shows the fast-forward merges and the two direct-to-main commits). These are facts, not inference.
- **QG-1's "260 problems" figure is NOT independently re-verified this session** — Docker was not running (`docker compose ps` returned an empty table) and bringing up the full stack + running lint was deliberately deferred to Task 3, Step 1, rather than asserted as still-current. This document explicitly flags that gap in the Finding text itself rather than silently treating the 2026-07-21 number as still accurate.
- **The feature/infra/test claims** ("all 5 endpoints exist", "migration links video to channel", "compose has redis/minio/video-worker") are backed by direct reads of `videos.controller.ts` (route decorators), `video.entity.ts` (the `@ManyToOne(() => Channel)` relation), and `compose.yaml` (service list) — all done in this session, not carried over from memory.
- **The "real MinIO/Redis, never mocked" claim inside Task 1's proposed CLAUDE.md section** was initially sourced only from `progress.md`'s prose narrative, not from reading the test files themselves — caught during this verification pass as exactly the kind of gap this skill exists to catch (a doc claiming code-coherence based on a *description* of the code rather than the code). Fixed by running two fresh checks against all three integration specs (`storage.service.integration-spec.ts`, `video-processing.processor.integration-spec.ts`, `video-processing.queue.integration-spec.ts`): `grep -n "jest.mock\|jest.spyOn.*mockResolvedValue\|jest.spyOn.*mockImplementation"` → zero matches in all three; `grep -n "StorageModule\|Test.createTestingModule\|getQueueToken"` → all three boot real `StorageModule` via `Test.createTestingModule` and the queue spec pulls a real `getQueueToken(VIDEO_PROCESSING_QUEUE)`. The claim stands, now on direct evidence rather than inherited narrative.
