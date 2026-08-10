---
kind: acceptance-validation
name: phase-03-videos
target: PROJECT_INSTRUCTIONS.md § "Critérios de Aceite" + § "Reprova automática"
status: dirty
issue_count: 1
generated: "2026-07-21T19:29:20-03:00"
generated_at_commit: 8e4af55
reverified: "2026-07-29"
reverified_on_branch: bugfix/phase-03-ac-verification
reverified_note: >-
  Re-verification pass against the running stack — see "# Verification Pass —
  2026-07-29" at the end of this document for per-bullet verdicts with exit
  codes. Outcome: 13/14 applicable AC bullets PASS, 7/8 Reprova clauses CLEAR.
  status stays `dirty` and issue_count stays 1 because GIT-2 (direct-to-main
  commits) is genuinely unresolvable without rewriting shared history. VAL-1,
  WORKER-1 and TEST-1 were found red this pass and fixed at the source.
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
    status: superseded
    summary: "Two commits landed directly on main after the dev→main fast-forward merge"
    mitigated_by: "Task 2 — dev fast-forwarded to main (a970086, 8e4af55 now also on dev, no more divergence); all remediation from a37e122 onward went through feature/phase-03-docs-remediation → dev → main. Historical violation window disclosed above, not erased — status stays open by design (see Strategic Approach)."
    superseded_by: "GIT-2 — the reflog shows three direct commits (not two) and two resets of main; GIT-1's account of 'no rewrite' was false. GIT-1 text kept verbatim as the historical record."
  - id: QG-1
    status: resolved
    summary: "Repo-wide 'npm run lint' fails (260 pre-existing problems); DoD/AC wording has no scoping exception"
    resolved_by: "Task 3 Step 3b, commit fdccc8e — DoD rule 4 scoped to changed files; repo-wide cleanup tracked as separate follow-up (not resolved, deliberately out of scope)"
  - id: VAL-1
    status: resolved
    summary: "validation.md had no frontmatter at all, so it could not close in clean — a literal Reprova hit (line 178)"
    resolved_by: "bugfix/phase-03-ac-verification — frontmatter added following phase-02-auth/validation.md:1-11; status: clean written only after Loop A came back green"
  - id: WORKER-1
    status: resolved
    summary: "video-worker crashed on every boot (Entity metadata for Video#channel not found); queue held 5 jobs with 0 consumers, so processing/thumbnail/status-cycle/streaming all failed in the real stack while 200 tests stayed green — Reprova hit (line 180)"
    resolved_by: "bugfix/phase-03-ac-verification — forFeature([Video, Channel, User]) plus video-worker.module.integration-spec.ts as the missing composition-root seam; red-green verified"
  - id: TEST-1
    status: resolved
    summary: "videos.service.integration-spec.ts assumed no live queue consumer; once video-worker actually ran, the suite went red with 'locked by another worker'"
    resolved_by: "bugfix/phase-03-ac-verification — queue.pause()/resume() around the enqueue assertion; verified green with the worker both up and down"
  - id: GIT-2
    status: open
    summary: "Three commits authored directly on main (a970086, 8e4af55, 824faa4), then main was reset twice to 1ee5f4d and rebuilt via merge commits, hiding them from git log --first-parent — Reprova hit (line 182)"
    unresolvable_because: "Resolving would require rewriting shared history. Deliberately not done. The fix applied was to GIT-1's false description, not to the repository."
advisories:
  - id: ADV-1
    status: resolved
    summary: "validation.md reads as a post-implementation test-results log, not a pre-build plan-validate coherence gate"
    resolved_by: "Superseded by VAL-1 — the underlying gap was the missing frontmatter, now added. The post-hoc nature of the document remains historically true and is recorded in the body."
  - id: ADV-2
    status: open
    summary: "npm run lint carries --fix, so the DoD gate mutates the tree while measuring it; recommend splitting into `lint` (no --fix, the gate) and `lint:fix`"
  - id: ADV-3
    status: open
    summary: "dotenv is relied on via -r dotenv/config in Jest setupFiles and start:worker:dev but is not a declared dependency — resolves only as a transitive hoist"
  - id: ADV-4
    status: open
    summary: "queueConfig.videoWorkerConcurrency is dead config; the worker reads process.env.VIDEO_WORKER_CONCURRENCY directly and the two disagree on how '0' resolves"
  - id: ADV-5
    status: open
    summary: "video-worker is the only compose.yaml service with no healthcheck, which is why a hard boot crash stayed invisible for a week"
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
| Implementação — infraestrutura e qualidade | Yes, with a disclosed exception | Storage/queue/worker/migration/tests all green per `validation.md`. `npx tsc --noEmit` exits 0. `npm run lint` still fails repo-wide (260 problems, unchanged) — **QG-1 resolved** by scoping the DoD wording to changed files rather than fixing the debt (`fdccc8e`); the underlying 260-problem debt itself is still there, just no longer a literal blocker. Git Flow was respected for the feature itself, violated by two later doc commits, and mitigated going forward — **GIT-1 stays open** (see Findings). |
| Documentação e ferramenta | Yes — DOC-1/DOC-2 fixed | Both `CLAUDE.md` files now cover the video subsystem (see `## Resolved Issues`). **Not yet committed** — still pending Task 2's `feature/* → dev → main` path; until that lands, the working tree satisfies the AC but the last commit on `main` does not. |
| Reprova automática | At risk on 1 of 8 clauses | "lint quebrado" (QG-1) is resolved — the DoD wording now scopes lint to the diff, and Phase 03's own touched files pass. "Commit direto na main" (GIT-1) is still literally true historically (`a970086`, `8e4af55`) even though `dev`/`main` are now reconciled and every commit since `a37e122` followed Git Flow correctly; the other 6 clauses are clear. |

## Findings

### Documentation Gaps

_None open — DOC-1 and DOC-2 resolved, see `## Resolved Issues` below._

### Git Flow Violations

- **GIT-1** — `git reflog show main` shows `main@{2}: merge dev: Fast-forward` at `cfdfb5a` (the correct Phase 03 landing), followed by two commits authored straight onto `main` with no branch: `a970086` ("docs: update README for Phase 03 completion") and `8e4af55` ("feat: refactor skill from the other challenge and a command approval"). Both bypassed `dev` entirely — confirmed as a real fork: `git merge-base --is-ancestor dev main` returned true while `dev` was still at `cfdfb5a`, i.e. `dev` was genuinely 2 commits behind `main`, not just differently-ordered history. Explicit choice: (a) leave `main`'s history as-is and disclose the deviation in this doc (chosen — see Strategic Approach); (b) rewrite `main`'s history via rebase + force-push (rejected, destructive, needs separate explicit authorization); (c) going forward, route every further commit — including this document's own — through `feature/* → dev → main` (adopted in Task 2, see `mitigated_by` in frontmatter).
  **Mitigation executed:** `dev` was fast-forwarded onto `main` (`git checkout dev && git merge --ff-only main`, `8e4af55..8e4af55` — pure catch-up, no rewrite), eliminating the fork itself, not just papering over it. Then `feature/phase-03-docs-remediation` was branched from the now-reconciled `dev`, DOC-1/DOC-2's fix committed there (`a37e122`), merged back to `dev` (fast-forward), then `dev` merged to `main` (fast-forward). `main`, `dev`, and the feature branch all point at `a37e122` as of this write-up — verified via `git log --oneline -1 main dev feature/phase-03-docs-remediation`. Status stays `open` — the historical direct-to-main window (`cfdfb5a..8e4af55`) is disclosed, not erased.

- **GIT-2** _(2026-07-29 — corrects GIT-1's account above; the GIT-1 text is left intact as the historical record)_ — GIT-1 says the violation window was "disclosed, not erased", that rewriting was "rejected", and that the only git action taken was a pure fast-forward with "no rewrite". **`git reflog show main` contradicts all three.** Verified live this session:

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

  What actually happened, corrected on three points:

  1. **Three** commits were authored directly on `main`, not two — `a970086`, `8e4af55`, and additionally `824faa4` ("fix: correct MAIL_FROM syntax in .env.example") at `main@{6}`, which GIT-1 does not mention at all.
  2. **`main` was reset twice**, at `main@{5}` and `main@{3}`, both `reset: moving to 1ee5f4d`. A `reset` on a shared branch *is* a history rewrite. The claim that rewriting was "rejected" and that only a fast-forward occurred is false as a description of what the repository actually underwent.
  3. **The violation is no longer visible in the normal view.** After the resets, `main` was rebuilt through merge commits, so:

     ```
     $ git log --oneline --first-parent main
     5b98d43 Merge branch 'dev'
     a1e9a3d Merge branch 'dev'
     a81e88d Merge branch 'feature/phase-03-docs-remediation'
     1ee5f4d chore: ignore .worktrees/ directory
     f3adf84 Merge remote-tracking branch 'origin/main'
     f0ba485 feat: Challenge instructions
     ```

     All three direct commits are still *reachable* from `main` (`git merge-base --is-ancestor <sha> main` → true for each) but none appears in `--first-parent`, so `main` now reads as Git-Flow-compliant. The evidence survives only in the local reflog, which is not part of a clone.

  Current topology, verified live: `main` and `origin/main` are both `5b98d43`; `dev` and `origin/dev` are both `f32fc58`; `git log dev..main` is exactly the three merge commits. `1ee5f4d` was authored on `dev` (`dev@{18}`), not on `main`. `f0ba485` is the pre-workflow initial challenge-setup commit.

  **No history was touched to produce this correction, and none should be.** The defect being fixed here is the *description*, which was wrong. The underlying Reprova clause ("Commit direto na main") remains genuinely violated in the historical record — see the verdict table in the 2026-07-29 section below.

### Quality Gate

_None open — QG-1 resolved via DoD wording amendment, see `## Resolved Issues` below._

## Advisories

- **ADV-1** — `docs/phases/phase-03-videos/validation.md` documents *post*-implementation test/lint/Docker-service results (remediation verification), not the *pre*-`plan-build` coherence check (missing decisions, ambiguities, dependency gaps against `context.md`) that `.claude/skills/plan-validate/SKILL.md` describes producing before a plan is built. `progress.md`'s own 2026-07-20 handoff note says `context.md`/`validation.md` "do not exist yet ... out of scope for the planning pass," and both were added retroactively during the 2026-07-21 remediation. This does not violate the literal AC text (`validation.md` exists and records `status`-equivalent information), so it's advisory, not a hard issue — but it means the `validate ↔ resolve` iterate-to-clean loop the workflow describes cannot be confirmed to have happened *before* `plan-build`, only that a validation artifact exists *after* implementation. No action required unless the user wants the historical record to be more precise about this.

## Resolved Issues

- **DOC-1** _(resolved_by Task 1 Step 1)_ — `nestjs-project/CLAUDE.md` had zero mentions of `video`/`storage`/`queue`/`worker`/`ffmpeg`/`minio`/`bullmq`/`redis`. Fixed: added a `## Video Processing (Phase 03)` section (worker execution model, new Compose services, upload flow, testing conventions). Verified via `grep -c -i "video\|storage\|queue\|worker\|ffmpeg\|minio\|bullmq\|redis" nestjs-project/CLAUDE.md` → `10` (was `0`). Change is currently uncommitted, staged for landing via the `feature/* → dev → main` path in Task 2 — not yet on any branch.
- **DOC-2** _(resolved_by Task 1 Step 2)_ — root `CLAUDE.md:26` said `**Message Queue** (TBD)`. Fixed: changed to `**Message Queue** (BullMQ/Redis)`. Verified via `grep -n "Message Queue" CLAUDE.md` → shows the corrected line; `grep -rn "TBD" CLAUDE.md docs/project-plan.md nestjs-project/CLAUDE.md` → exit `1` (no matches left). Same uncommitted/pending-Task-2 status as DOC-1.
- **QG-1** _(resolved_by Task 3 Step 3b, commit `fdccc8e`)_ — root `CLAUDE.md`'s Definition of Done rule 4 said `"Lint passes: npm run lint"` unqualified. Fresh live check confirmed the repo-wide command still fails identically to the 2026-07-21 baseline: `docker compose exec nestjs-api npm run lint` → exit `1`, **260 problems (216 errors, 44 warnings)** across the same 14 files (`grep -E "^/home/node/app/src|^/home/node/app/test"` on the raw output enumerated exactly `auth.service.integration-spec.ts`, `auth.service.spec.ts`, `channels.service.spec.ts`, `channels.service.ts`, `domain-exception.filter.spec.ts`, `validation-exception.filter.spec.ts`, `env.validation.integration-spec.ts`, `mail.service.integration-spec.ts`, `video-queue.service.spec.ts`, `create-test-data-source.ts`, `users.service.integration-spec.ts`, `videos.service.integration-spec.ts`, `videos.service.spec.ts`, `auth.e2e-spec.ts` — nothing drifted since the remediation). User chose (per `AskUserQuestion`, this session): amend the DoD wording rather than fix the debt now. Rule 4 now reads: `"Lint passes on all files touched by the change (npm run lint scoped to the diff). Pre-existing repo-wide lint debt outside the current change's scope is tracked separately, not a blocker — see docs/phases/phase-03-videos/validation.md for the accepted 2026-07-21 baseline."` The 260-problem repo-wide cleanup itself is **not** done — it's explicitly deferred to a separate follow-up task (Task 3 Step 3a's territory), tracked here as still-outstanding technical debt, just no longer a blocker on Phase 03's acceptance.

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

- [x] **Step 1: Confirm current branch state before branching**

  Ran:
  ```bash
  git status --short
  git branch --show-current
  ```
  Result: on `main`, Task 1's edits present as uncommitted changes, as expected.

- [x] **Step 2: Create a feature branch from `dev`** _(plan text corrected during execution — see below)_

  **Deviation from the plan as originally written:** the plan assumed `dev` already contained everything on `main`. Checking `git merge-base --is-ancestor dev main` (run fresh at execution time) proved the opposite: `dev` was 2 commits **behind** `main` (`a970086`, `8e4af55` existed only on `main`). Branching straight from stale `dev` would have made Step 4's fast-forward into `main` fail later. Fixed by reconciling first:
  ```bash
  git checkout dev
  git merge --ff-only main        # dev catches up to main's 2 extra commits — pure fast-forward, no rewrite
  git checkout -B feature/phase-03-docs-remediation dev
  ```
  Result: `dev` fast-forwarded `8e4af55..8e4af55` cleanly (Updating `cfdfb5a..8e4af55`); feature branch created from the now-reconciled `dev`. This also closes part of GIT-1 for real, not just for this remediation's own commits.

- [x] **Step 3: Re-apply Task 1's CLAUDE.md edits on this branch and commit**

  ```bash
  git add CLAUDE.md nestjs-project/CLAUDE.md docs/phases/phase-03-videos/acceptance-validation.md
  git commit -m "docs: document Phase 03 video subsystem in CLAUDE.md, add acceptance-criteria audit"
  ```
  Result: commit `a37e122`, diff limited to exactly `CLAUDE.md`, `nestjs-project/CLAUDE.md`, and this audit doc (3 files, 389 insertions, 1 deletion) — confirmed via `git diff --cached --stat` before committing.

- [x] **Step 4: Merge to `dev`, then fast-forward `dev` into `main`**

  ```bash
  git checkout dev
  git merge --ff-only feature/phase-03-docs-remediation
  git checkout main
  git merge --ff-only dev
  ```
  Result: both fast-forwards succeeded (`Updating 8e4af55..a37e122` on both). Verified via `git log --oneline -1 main dev feature/phase-03-docs-remediation` → all three print `a37e122`. Working tree clean afterward (`git status --short` shows only the pre-existing, unrelated untracked `.idea/`).

- [x] **Step 5: Record the GIT-1 deviation as closed-going-forward, not erased**

  Done — see GIT-1's `mitigated_by` frontmatter field and the "Mitigation executed" paragraph under `### Git Flow Violations` above. `status: open` is intentional and permanent for this issue; it cannot become `resolved` because the historical direct-to-main commits genuinely happened.

---

### Task 3: Resolve the lint-gate ambiguity (QG-1)

**Files:**
- Read-only: `nestjs-project/package.json`, `nestjs-project/.eslintrc*` (whichever config file exists)
- Possibly modify: `CLAUDE.md` (repo root, Definition of Done section) — only if the user picks option (b)

**Interfaces:**
- Consumes: Docker Compose services from `nestjs-project/compose.yaml` (needs `db`, `redis`, `minio` up for the app to boot enough for lint — actually lint doesn't need runtime services, only `nestjs-api`'s installed `node_modules`; confirm this assumption in Step 1).
- Produces: an authoritative current lint number (may differ from the 260 recorded 2026-07-21) and a human decision recorded back into this doc's `issues:` frontmatter.

- [x] **Step 1: Bring up the container and get a real, current lint result**

  ```bash
  cd nestjs-project
  docker compose up -d nestjs-api
  docker compose exec nestjs-api npm run lint
  ```
  Result: no containers existed yet at all (`docker compose ps --all` was empty) — `docker compose up -d nestjs-api` created the full network + `db`/`redis`/`minio`/`minio-init`/`mailpit`/`nestjs-api` (dependencies), all healthy. `node_modules` was already present in the container, no install needed. Lint exited `1` with **260 problems (216 errors, 44 warnings)** across exactly the same 14 files as `validation.md`'s 2026-07-21 entry — confirmed identical, not just similar, via direct file-list diff.

- [x] **Step 2: If still failing, present the two options to the user (do not pick silently)**

  Presented via `AskUserQuestion` with the live numbers (260/216/44, 14 files, none Phase-03-introduced per the targeted-lint precedent). User chose: amend the DoD wording (not fix the debt now, not leave it undecided).

- [ ] **Step 3a: If the user picks (a) — fix the debt**

  **Not chosen this session** — user picked 3b instead. Left unstarted; still the correct path if a future session decides to actually clean up the 14 files.

- [x] **Step 3b: If the user picks (b) — amend the DoD wording**

  Applied exactly as drafted, committed as `fdccc8e` on `feature/phase-03-docs-remediation` (not directly on `main`), then landed via `feature/* → dev → main` fast-forwards per the Task 2 pattern.

- [x] **Step 4: Update this document's frontmatter**

  `QG-1` flipped to `resolved` with `resolved_by: commit fdccc8e`. `issue_count` recomputed `2 → 1`. Top-level `status` stays `dirty` — and will **permanently** stay `dirty`, by design: `GIT-1` can never reach `resolved` (the historical direct-to-main commits are real and undisclosed rewriting was rejected), so `clean` is not a reachable state for this document. That is the honest outcome, not a bug in the verdict computation.

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

---

# Verification Pass — 2026-07-29 (evidence-backed, live)

> **What this section is.** A re-verification of every AC bullet (`PROJECT_INSTRUCTIONS.md:150-173`) and every Reprova clause (`:177-184`) against the **running stack**, not against a description of it. Executed per `docs/phases/phase-03-videos/ac-verification-plan.md` on branch `bugfix/phase-03-ac-verification`.
>
> **Why it exists.** The audit above closed `status: dirty` and its own Verification Note admitted the `260`-problem lint figure was never re-run live. Worse, `validation.md:82` records a correction to a claim this document had carried for a week: that all `216` lint errors were "outside Phase 03's touched set", derived from reading a *description* of the code rather than running the command. Every row below therefore carries the command and exit code, or the measurement, that produced it. **Nothing here is inferred; anything not actually run is labelled "not verified".**
>
> **Rule applied throughout:** the verdict follows the loop, not the desired outcome.

## What the loops found

Two clauses were **red on first measurement**, and both are now fixed at the source on this branch rather than rescoped:

- **`WORKER-1`** — the `video-worker` Compose service crashed on every boot. Never detected because no test booted `VideoWorkerModule`.
- **`TEST-1`** — exposed by fixing `WORKER-1`: `videos.service.integration-spec.ts` assumed no live queue consumer existed.

Details in Findings below. All gates were then re-run with the worker running.

## Loop A — quality gates (live, worker running)

| # | Command | Exit | Detail |
|---|---|---|---|
| A1 | `docker compose exec nestjs-api npx tsc --noEmit` | `0` | no output |
| A2 | `docker compose exec nestjs-api npx eslint "{src,apps,libs,test}/**/*.ts"` (**no `--fix`** — the truthful gate) | `0` | **0 errors, 0 warnings, 111 files linted** (counted from `-f json`) |
| A3 | `docker compose exec nestjs-api npm run lint` (DoD literal, carries `--fix`) | `0` | `git status --short` **byte-identical** before and after → `--fix` mutated nothing |
| A4 | `docker compose run --rm … nestjs-api npm test -- --runInBand` | `0` | **33 suites / 203 tests passed** (was 32/200; +1 suite, +3 tests from the new boot spec) |
| A5 | `docker compose run --rm … nestjs-api npm run test:e2e` | `0` | **4 suites / 92 tests passed** |
| A6 | `docker compose ps --all` | — | `db`, `redis`, `minio`, `mailpit`, `nestjs-api`, `video-worker` all `running`; `minio-init` `exited (0)` — one-shot bucket creator, correct terminal state |

**Correction to the record:** `validation.md:94` stated one remaining warning (`@typescript-eslint/no-unsafe-argument` at `src/auth/auth.service.integration-spec.ts:479`). Live eslint reports **zero** warnings — `f32fc58` ("use IsNull() for the refresh-token grace-period assertion") cleared it. That line was stale, not wrong-in-kind; corrected in `validation.md` as `LINT-3`.

## Loop B — real pipeline probe (one real file, end to end)

A 3-second h264/aac fixture (99 208 bytes) generated with the bundled `ffmpeg-static` **inside the container**, driven through the live stack; the DB was queried directly rather than trusting response bodies. **17/17 checks passed after the fix** (10/16 before it).

| Check | Evidence |
|---|---|
| Draft pre-registered **before any bytes move** | `POST /videos` → `201`; DB row `status=draft`, `slug=0V_de5_0WKI`, queried before the first `PUT` |
| Bytes bypass the API | presigned part URL host is `minio:9000`, not the API (`localhost:3000`); `PUT` → `200` + ETag |
| `complete-upload` → `processing` | → `200`, body `status=processing`; DB confirms `processing` |
| Terminal state | `ready` after **1 s** |
| Metadata extracted | `duration_seconds=3`, `metadata` non-null |
| Thumbnail generated **and present in storage** | `thumbnail_key=videos/f7c552b1…/c50b70ef…/thumbnail.jpg`; `mc ls local/streamtube` shows `thumbnail.jpg` 9.5 KiB alongside `original.mp4` 97 KiB |
| Streaming without full download | `GET /:slug/stream` `Range: bytes=0-1023` → **`206`**, `Content-Range: bytes 0-1023/99208`, exactly **1024 bytes** |
| Download available | `GET /:slug/download` → **`302`** to `minio:9000`; following it → `200` with all **99 208 bytes** |
| Unique URL per video | two back-to-back creates → `CZgFdc9n_ow` ≠ `VNzHkj-2v1I`; `SELECT COUNT(*), COUNT(DISTINCT slug) FROM videos` → `14, 14` |
| Error branch | unparseable object → `status=error`, `error_message="ffprobe exited with code 1 … moov atom not found"` |

The 10 GiB clause is **architectural, and verified as such**: bytes never traverse `nestjs-api` (row 2 above), plus the existing `fileSizeBytes > 10 GiB` rejection test (`videos.e2e-spec.ts:254`) and the parts-count calculation test (`:340`). **No 10 GiB transfer was performed** — labelled here as architecture-verified, not volume-tested.

## Loop B-2 — "sem travar a API", measured rather than argued

| Condition | n | median | p95 | max |
|---|---|---|---|---|
| Stack idle | 20 | `1.3 ms` | `3.8 ms` | `3.8 ms` |
| During 6 × 64 MiB concurrent presigned PUTs (**384 MiB**, all `200`) | 212 | `1.1 ms` | `7.8 ms` | `34.1 ms` |

Median ratio under load / idle = **`0.85×`**. The two distributions sit in the same band; no request-queue backlog. This is the direct-upload strategy working as designed — the API is not in the data path.

## Loop C — doc coherence (`CLAUDE.md` vs. code)

| Claim (`nestjs-project/CLAUDE.md` § Video Processing) | Check | Result |
|---|---|---|
| Four modules `videos/`, `storage/`, `queue/`, `video-worker/` | dir test | all 4 exist |
| `start:worker:dev` preloads `-r dotenv/config` | `grep` `package.json:28` | present |
| `VIDEO_WORKER_CONCURRENCY` honored **because of** that preload | live, in the worker container | **with** preload → `"2"`; **without** → `undefined`. Mechanism claim confirmed — and testable for the first time only because the worker now boots |
| `redis` 6379, `minio` 9000/9001, `minio-init` creates bucket `streamtube`, `video-worker` | `compose.yaml` | all present |
| Three named integration specs exist, none mocks `StorageService`/the queue | file test + `grep jest.mock` | all 3 exist; `grep` exit `1` (no matches) |
| root `CLAUDE.md:26` = `**Message Queue** (BullMQ/Redis)` | `grep` | matches; `grep -rn "TBD"` over `CLAUDE.md`, `docs/project-plan.md`, `nestjs-project/CLAUDE.md` → exit `1` |
| Reverse direction — does any doc describe something gone? | `grep videoWorkerConcurrency` | no `CLAUDE.md` reference; only `src/config/queue.config.ts:10` (dead field) and the historical plan doc. Tracked as `ADV-4`, not a doc-coherence failure |

## AC verdicts — `PROJECT_INSTRUCTIONS.md:150-173`

| Line | Criterion | Verdict | Evidence |
|---|---|---|---|
| 150 | `technical-decisions-…` resolves the 5 open decisions | **PASS** | `TD-01`…`TD-05` each with Options / trade-offs / recommendation + `## Decisions Summary` |
| 151 | Phase folder has 5 files, `validation.md` **status clean** | **PASS** *(was FAIL)* | All 5 files present. `validation.md` had **no frontmatter at all** (`VAL-1`); frontmatter added this pass, `status: clean` written **only after** Loop A came back green — `issue_count: 0` with five `status: resolved` entries, matching the sibling convention (`phase-02-auth-frontend/validation.md` carries 17 resolved issues at `issue_count: 0`) |
| 152 | Plan format: SIs + 5 Technical Specifications + Dependency Map + Deliverables | **PASS** | `SI-03.1`…`SI-03.9`; Data Model `:1074`, API Contracts `:1102`, Authorization Matrix `:1154`, Error Catalog `:1166`, Events/Messages `:1179`, Dependency Map `:1192`, Deliverables `:1221` |
| 156 | 10 GB upload without blocking the API, draft pre-registered | **PASS** | Loop B rows 1-2 + Loop B-2 (`0.85×`). 10 GiB architecture-verified, not volume-tested |
| 157 | Automatic processing: duration/metadata + thumbnail | **PASS** *(was FAIL)* | Loop B: `ready` in 1 s, `duration_seconds=3`, `metadata` present, `thumbnail.jpg` confirmed in bucket. Failed before `WORKER-1` |
| 158 | Unique URL per video, no conflict | **PASS** | distinct slugs; `14/14` distinct in table; `slug` is `unique varchar(11)` |
| 159 | Streaming (no full download) + download available | **PASS** *(was FAIL)* | `206` + exact `Content-Range` + 1024 bytes; `302` → full 99 208 bytes. Returned `409` before `WORKER-1` (video never reached `ready`) |
| 160 | Status cycle draft → processing → ready/error in the DB | **PASS** *(was FAIL)* | all four states observed in Postgres, including `error` + `error_message`. Stalled at `processing` before `WORKER-1` |
| 164 | Object storage, queue **and worker** up via Compose with the backend | **PASS** *(was FAIL)* | `docker compose ps`: `video-worker` `running`. Was `exited (1)` on every boot before `WORKER-1` |
| 165 | Migration creates the videos table; entity linked to the channel | **PASS** | `1784572856263-CreateVideos.ts`; `@Entity('videos')` + `@ManyToOne(() => Channel)` + `@JoinColumn({ name: 'channel_id' })` |
| 166 | Tests at the right levels, green (`npm test`, `npm run test:e2e`) | **PASS** | A4 `33/203`, A5 `4/92`, both exit `0`, with the worker running |
| 167 | Full DoD: suite green + `tsc --noEmit` 0 + `npm run lint` | **PASS** | A1-A5 all exit `0` |
| 168 | Git Flow respected, no direct commits on `main` | **FAIL** | Three commits authored directly on `main` (`a970086`, `8e4af55`, `824faa4`) — see `GIT-2`. Historical and unfixable without rewriting shared history, which is deliberately not done |
| 172 | `CLAUDE.md` updated with the video section, coherent with the code | **PASS** | Loop C: every checkable claim verified, including the concurrency mechanism |
| 173 | Other-tool portability | **N/A** | Claude Code was used; clause does not apply |

## Reprova verdicts — `PROJECT_INSTRUCTIONS.md:177-184`

| Line | Clause | Verdict | Evidence |
|---|---|---|---|
| 177 | Skipping the workflow (no research/planning/implementation artifacts) | **CLEAR** | decisions doc + all 5 phase files + plan + progress present |
| 178 | Plan without SIs / Technical Specs, or `validation.md` not closing `clean` | **CLEAR** *(was HIT)* | Specs all present; `validation.md` now closes `clean` on green gates (`VAL-1`) |
| 179 | Passing the 10 GB file through the API so it blocks | **CLEAR** | bytes go straight to MinIO; API latency flat under 384 MiB (`0.85×`) |
| 180 | Not having **real** queue, worker and storage up in Compose | **CLEAR** *(was HIT)* | all three `running`; worker verified consuming a real job to `ready`. Was a genuine hit — `ps` mattered more than `config`, exactly as the plan predicted |
| 181 | `tsc` error, broken lint, or red suite | **CLEAR** | A1-A5 exit `0`; eslint 0 errors / 0 warnings |
| 182 | **Commit directly on `main`** | **HIT** | `a970086`, `8e4af55`, `824faa4` authored on `main`; two `reset`s then hid them from `--first-parent`. See `GIT-2` |
| 183 | `CLAUDE.md` inconsistent with the code | **CLEAR** | Loop C, both directions |
| 184 | Another tool without porting the foundation | **N/A** | Claude Code was used |

## Findings

### WORKER-1 — `video-worker` crashed on every boot; the queue had zero consumers  ⚠️ was a Reprova hit (line 180)

`docker compose ps --all` → `video-worker  exited (1)`. Every boot: `TypeORMError: Entity metadata for Video#channel was not found`, 10 TypeORM retries, then death. Reproduced across two independent boots ~10 h apart (20 identical retry cycles in the logs).

**Root cause.** `video-worker.module.ts` used `autoLoadEntities: true` with `TypeOrmModule.forFeature([Video])`. `autoLoadEntities` registers only what `forFeature` declares, so `Channel` — and transitively `User`, via `Channel.user` — were never registered. TypeORM cannot build `Video`'s metadata without the target of its `@ManyToOne(() => Channel)`, and a missing relation target fails the **entire** boot. Established by differential, not guesswork: `videos.module.ts:12` registers `[Video, Channel]` and `nestjs-api` boots fine on the identical DataSource config; the worker registered `[Video]` and died. This also falsified the competing hypothesis that `autoLoadEntities` fails under `createApplicationContext` — it loaded `Video` correctly; it simply had nothing else to load.

**Measured impact while broken.** `bull:video-processing:wait` held **5 jobs, 0 active**. Videos reached `processing` and stayed there permanently: `duration_seconds`, `metadata`, `thumbnail_key` all `null`; `/stream` and `/download` answered `409`; the `error` branch equally unreachable. Four AC bullets (157, 159, 160, 164) and one Reprova clause (180) were failing in the real stack **while all 200 tests stayed green**.

**Why every test missed it.** No test booted `VideoWorkerModule`. `video-processing.processor.integration-spec.ts` and `video-processing.queue.integration-spec.ts` each rebuild the module graph by hand — their own `ConfigModule`, `TypeOrmModule` and entity list — so they exercised the processor while bypassing the module's own registration. That is precisely the seam that was broken: the specs tested the worker's *logic* and never its *wiring*.

**Fix** (`src/video-worker/`, TDD): `forFeature([Video, Channel, User])`, plus `video-worker.module.integration-spec.ts`, which boots the real module the way `NestFactory.createApplicationContext` does. Red-green verified — `3 failed` with the production `TypeORMError` before, `3 passed` in `1.9 s` after. Confirmed on the real container: `VideoWorkerModule dependencies initialized`, state `running`, and the backlog drained (the good fixture → `ready` with duration + thumbnail; the unparseable one → `error`).

### TEST-1 — a live worker broke an integration spec that assumed none existed

Fixing `WORKER-1` turned the suite red: `videos.service.integration-spec.ts` → `Job 38 could not be removed because it is locked by another worker`. The spec enqueues a real job and inspects it, but the now-live `video-worker` container claims and locks it first.

Causality proven by differential (after first correcting a broken harness that had made both arms silently no-op): **worker stopped → `7 passed`, exit `0`; worker running → `1 failed`, exit `1`.**

This is a genuine conflict between two AC bullets — line 164 requires the worker up, line 166 requires a green suite — so it had to be fixed, not worked around by leaving the worker down. **Fix:** `queue.pause()` before the enqueue assertion, `queue.resume()` in a `finally`. Steps 1-6 (the real assertions) are unchanged; only the race is removed. Verified green with the worker **both up and down**, and Redis confirmed not left paused (`bull:video-processing:meta` `paused` unset, `:paused` key absent).

### VAL-1 — `validation.md` did not close in `clean`  ⚠️ was a Reprova hit (line 178) — resolved

The file had **no frontmatter at all**, so there was no `status` to close. Previously downgraded to `ADV-1` on the reasoning that it "records status-equivalent information"; against the literal Reprova wording ("validation.md que não fecha em clean") that reasoning does not hold. Frontmatter added following `docs/phases/phase-02-auth/validation.md:1-11`, with the historical blockers carried into `issues:` as `status: resolved` + `resolved_by` (the convention `phase-02-auth-frontend/validation.md` already established). `status: clean` was written **only after** Loop A came back green.

### GIT-2 — direct-to-`main` commits, and the evidence was rewound off `main`  ⚠️ Reprova hit (line 182) — cannot be resolved

See the corrected `GIT-2` entry under **Git Flow Violations** above for the full reflog. Summary: three commits authored on `main`, two `reset`s of `main` to `1ee5f4d`, then a rebuild via merge commits, leaving `git log --first-parent main` looking compliant. Only the local reflog preserves this; a fresh clone shows nothing. **No history was touched to produce this finding, and none should be** — the fix applied was to the false *description*, which is what was actually wrong.

### QG-2 — the DoD lint gate measures with `--fix` on

`nestjs-project/package.json:15` — `"lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix"`. The DoD's literal command auto-fixes while it measures, so a green `npm run lint` can mean "green *after* mutating the working tree", and running the gate dirties the tree. Measured this pass: `npm run lint` exit `0` with `git status --short` byte-identical before and after, so **nothing was mutated in fact** — but that is a property of the current tree, not of the command. The truthful gate is `npx eslint …` without `--fix` (A2 above). Recorded as `ADV-2`; see the post-mortem.

## Re-verdict of this document's frontmatter

The top-level `status` stays **`dirty`** with `issue_count: 1` — but the reasoning has changed and should be recorded honestly. The previous text asserted `clean` was permanently unreachable "because `GIT-1` can never resolve". That conclusion still holds, and `GIT-2` now states its basis correctly rather than on a false account of what happened to `main`. `VAL-1`, `WORKER-1` and `TEST-1` are resolved; `GIT-2` is the single remaining open issue and is genuinely unresolvable without rewriting shared history, which is out of bounds by design.

So: **13 of 14 applicable AC bullets PASS; 7 of 8 Reprova clauses CLEAR; the outstanding item on both counts is the same historical Git Flow violation.**

## Post-mortem

*(stated after the report, per the plan — the question is what would have prevented the failures, now that there is more information than at the start.)*

**1. The false-lint-claim week (2026-07-21 → 2026-07-28) was structural, not carelessness.** The DoD's own gate command carries `--fix`, so it can never be a clean measurement — it mutates while it measures. Worse, the "targeted lint" used to prove the 2026-07-21 claim simply omitted the three spec files that failed, and nobody re-ran the unscoped command. **Recommendation:** split the script — `"lint": "eslint \"{src,apps,libs,test}/**/*.ts\""` as the gate and `"lint:fix"` with `--fix` as the developer convenience. A gate that can rewrite the thing it is judging cannot produce evidence. This is `ADV-2`.

**2. `WORKER-1` is the same failure mode as the lint claim, one level deeper.** Both times, confidence came from an artifact that *described* the system instead of exercising it: there, a scoped lint command that skipped the failing files; here, integration specs that rebuilt the worker's module graph by hand and so never touched the wiring that was broken. A hand-rebuilt module graph is a description of the module, not the module. **Recommendation, now implemented:** every independently-deployable process gets one test that boots its real composition root. `video-worker.module.integration-spec.ts` is that test for the worker; `nestjs-api` gets it implicitly via the e2e suite. This is the cheapest possible guard — 3 assertions, 1.9 s — against a class of bug that no amount of unit coverage can catch.

**3. Green tests over a dead service should have been detectable.** For a week the worker could not start while the suite reported 200 passing tests, because nothing asserted on container state. **Recommendation:** assert `docker compose ps` service health as part of the DoD, or add a healthcheck to `video-worker` in `compose.yaml` so `exited (1)` surfaces as a failed dependency rather than silence. Currently `video-worker` is the only service in `compose.yaml` with no `healthcheck`.

**4. `TEST-1` is a latent-trap class worth naming.** The suite passed only because a required piece of infrastructure was broken; repairing the infrastructure broke the suite. Any test sharing mutable infrastructure with a live consumer must isolate itself explicitly. Worth auditing the other queue-touching specs for the same assumption.

**5. `dotenv` remains an undeclared dependency** (`validation.md:100`) — relied on via `-r dotenv/config` in both Jest's `setupFiles` and `start:worker:dev`, resolving only as a transitive hoist of `@nestjs/config`/`typeorm`. A dependency bump could remove it and break the worker's env loading, which is exactly what makes `VIDEO_WORKER_CONCURRENCY` work (verified live in Loop C). Declare it explicitly. This is `ADV-3`.

## Verification note

Per `superpowers:verification-before-completion` — every verdict above traces to a command run in this session, with its exit code, or to a recorded measurement. Specifically **not** claimed:

- **No 10 GiB file was transferred.** That clause is verified architecturally (bytes never reach the API, plus the existing size-rejection and part-count tests), and is labelled as such rather than as a volume test.
- **`git log --first-parent` cosmetics only.** No git history was rewritten, inspected destructively, or force-pushed during this pass. `GIT-2` corrects prose; the repository was not touched.
- **Residual cosmetic warning.** `video-worker.module.integration-spec.ts` leaves Jest printing "Jest did not exit one second after the test run has completed" (the pre-fix baseline did not). Established as **cosmetic, not a hang**, by measurement rather than assumption: `jest --detectOpenHandles` attributes **no** handle and prints no warning, and the two variants take the **same wall-clock time** (35 s vs 35 s, three repetitions each) — that time is container startup, not a wait. Exit code is `0` and the suite completes. Teardown closes the queue's ioredis socket explicitly, since BullModule only calls `disconnect()` for queues registered with `forceDisconnectOnShutdown`. A 250 ms teardown drain was also tried, did not help, and was removed rather than left in as a sleep that buys nothing. Booting a real BullMQ worker in-process is the cause — the price of testing the module's actual composition root.

  **Correction to an intermediate conclusion during this pass:** at one point a lingering `docker compose run` container was read as an intermittent hang, and step 4's exit code in that particular run is not trustworthy because the container was force-removed. The timing comparison above falsified the hang reading. The `33/33 / 203/203` and `4/4 / 92/92` results and their exit `0` are taken from the unassisted runs, not from that one.
- **`minio-init` shows `exited (0)`,** which is its correct terminal state as a one-shot bucket creator, not a failure.
