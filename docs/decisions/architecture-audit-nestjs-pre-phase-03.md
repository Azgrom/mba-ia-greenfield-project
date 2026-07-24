# Architecture Audit Report

## Target
- Project: StreamTube backend (mba-ia-greenfield-project / StreamTubeContinuation monorepo)
- Target root: nestjs-project/
- Stack: TypeScript 5.7 (via `typescript: ^5.7.3`, `nodenext` resolution) / NestJS 11 (`@nestjs/core` resolved 11.1.16) + TypeORM 0.3.28 + PostgreSQL 17

## Project Fingerprint
- Language: TypeScript, strict mode (`strictNullChecks` on, `noImplicitAny` off), `nodenext` module resolution, `ES2023` target (`tsconfig.json`).
- Framework: NestJS `^11.0.1` declared, `@nestjs/core` resolved `11.1.16` (package-lock.json); `@nestjs/typeorm ^11.0.1` (resolved `11.0.1`), `typeorm ^0.3.28` (resolved `0.3.28`), `@nestjs/config ^4.0.3` (resolved `4.0.3`), `pg ^8.20.0` (resolved `8.20.0`).
- Entry points: `src/main.ts` (HTTP bootstrap), `src/database/data-source.ts` (TypeORM CLI data source for migrations), `src/database/seeds/seed.ts` (seed script entry, see F-005).
- Persistence: PostgreSQL via `@nestjs/typeorm` `TypeOrmModule.forRootAsync` in `src/app.module.ts` (`synchronize: false`, `autoLoadEntities: true`); migrations under `src/database/migrations/` applied via TypeORM CLI (`npm run migration:*`). Test suites use a parallel `createTestDataSource` helper (`src/test/create-test-data-source.ts`) that defaults to `synchronize: true` against the same Postgres service for ephemeral schema creation in `*.integration-spec.ts` files.
- Architecture shape: standard NestJS module-per-domain layout (`AuthModule`, `UsersModule`, `ChannelsModule`, `MailModule`) composed in `AppModule`. Controllers are thin (only `AuthController`; `UsersModule`/`ChannelsModule` currently expose no controllers — they are consumed internally by `AuthModule`'s registration flow). Domain errors are custom `DomainException` subclasses (`src/common/exceptions/domain.exception.ts`) mapped to HTTP by two global `APP_FILTER`-less filters registered manually in `main.ts` (`DomainExceptionFilter`, `ValidationExceptionFilter`). A single global `JwtAuthGuard` (`APP_GUARD`) plus a `@Public()` opt-out decorator protect all routes by default; `ThrottlerGuard` (`APP_GUARD`) is also registered application-wide, but both guard registrations and the `ThrottlerModule.forRoot(...)` policy live inside the feature-scoped `AuthModule` rather than `AppModule`, so the app-wide rate-limit policy that any future controller (e.g., a Phase 03 `VideosController`) inherits is configured outside the composition root.

## Source Scope
- Included: all executable TypeScript under `nestjs-project/src/` reachable from `src/main.ts` (HTTP path) and `src/database/data-source.ts` / `src/database/seeds/seed.ts` (CLI path) — 50 non-test `.ts` files (controllers, services, modules, entities, DTOs, guards, decorators, filters, config, migrations, mail templates wiring). Migration SQL bodies were read because they constrain runtime FK/constraint behavior.
- Excluded: `node_modules/`, `dist/`, `coverage/`, `.git/`; the 23 `*.spec.ts` / `*.integration-spec.ts` unit/integration test files and the 4 files under `nestjs-project/test/` (`*.e2e-spec.ts`, `jest-e2e.json`) — read selectively only to confirm test-setup conventions, not scored for findings per the catalog's test-code exclusion; `.env.example` — excluded from findings as example/template content per the audit contract's finding rules, even though one shell-quoting defect was observed in it (noted below, not scored); Handlebars mail templates (`.hbs`) — static content, not executable logic; `next-frontend/` and `docs/` — explicitly out of scope per this run's invocation.

## Behavioral Baseline
- Boot: `docker compose up -d` then `docker compose exec nestjs-api npm run start:dev` (per `nestjs-project/CLAUDE.md`); readiness via `curl http://localhost:3000` (200, "Hello World!") and `docker compose exec db pg_isready -U streamtube`. Not run dynamically in this audit — static tracing only, per the least-invasive-command rule; no boot/HTTP requests were issued against the project's database.
- Endpoints (all under `AuthController`, prefix `/auth`): `POST /auth/register` (201, public), `GET /auth/confirm-email` (204, public), `POST /auth/resend-confirmation` (204, public), `POST /auth/login` (200, public), `POST /auth/refresh` (200, public), `POST /auth/forgot-password` (204, public), `POST /auth/reset-password` (204, public), `POST /auth/logout` (204, authenticated), `GET /auth/me` (200, authenticated). Plus `GET /` (`AppController`, public "Hello World"). No `users`, `channels`, or `videos` controllers exist yet — `UsersService`/`ChannelsService` are invoked only internally from `AuthService.register`.
- Domain flows: register → create `User` row → create `Channel` row (nickname collision retry) → issue verification token → send confirmation email; login → verify password → issue access+refresh token pair; refresh → rotate refresh token within a family, detect reuse, revoke family on reuse outside grace window; logout/reset-password → revoke all refresh tokens for the user.
- Persistence expectations: `users`, `channels` (1:1, `channels.user_id` unique), `refresh_tokens`, `verification_tokens` — all FKs to `users(id)` declared `ON DELETE NO ACTION` (both migrations). No entity currently models videos, storage objects, or job-queue state.
- Proposed security exceptions: none identified; no unsafe contract requires preservation.

## Audit Limitations
- Dynamic/runtime behavior (actual boot, live HTTP calls, concurrent-write races) was not exercised against a live database; findings involving concurrency (F-001, F-002) are derived from static trace of PostgreSQL/TypeORM transaction semantics and the project's own documented pitfall (`.claude/rules/typeorm-queries.md`), not from an observed failure in this run.
- Dependency-version claims use `package-lock.json` resolved versions; no Context7/external documentation lookup was required because no finding in this report depends on an external deprecated-API claim.

## Severity Summary
| Severity | Count |
|---|---:|
| CRITICAL | 0 |
| HIGH | 2 |
| MEDIUM | 2 |
| LOW | 1 |

## Findings

### F-001 — Registration spans two independent commits with only manual compensation, not one atomic transaction
- Rule: high-missing-transaction-boundary
- Severity: HIGH
- Location: src/users/users.service.ts:14-35
- Evidence: `createUserWithChannel` calls `this.userRepository.save(user)` (line 22), which commits immediately, then calls `this.channelsService.createChannel(...)` (lines 25-28), which opens its own independent transaction (`src/channels/channels.service.ts:27`, `this.dataSource.transaction(...)`). On failure the `catch` block issues a compensating `this.userRepository.delete(savedUser.id)` (line 32) instead of the two writes sharing one atomic unit.
- Impact: if the process crashes or throws between the user commit and the channel transaction (or the compensating delete itself fails/is skipped, e.g., due to a downstream error inside the `catch`), a `User` row can persist with no `Channel` — violating the 1:1 `users`↔`channels` invariant enforced by the unique `channels.user_id` constraint, and leaving an account that can never complete registration cleanly (no channel to attach to future logins/orphan cleanup).
- Recommendation: own the transaction at the orchestrating layer — either have `UsersService.createUserWithChannel` open one `dataSource.transaction(...)` that performs both the user insert and delegates to a channel-creation routine using the same `EntityManager`, or move the orchestration into a dedicated application service that injects both repositories and coordinates a single commit/rollback. This is the pattern a Phase 03 `VideosService` must follow for any create flow that writes to more than one table (e.g., video row + initial processing-job row) — do not repeat the compensating-delete pattern.
- Status: proposed
- Evidence authority: full call path `AuthService.register` (`src/auth/auth.service.ts:56-80`) → `UsersService.createUserWithChannel` (`src/users/users.service.ts:14-35`) → `ChannelsService.createChannel` (`src/channels/channels.service.ts:24-61`); cross-reference `.claude/rules/nestjs-services.md` ("Never Swallow Errors" / re-throw convention, which this code follows, but transaction ownership is still split).

### F-002 — Nickname-collision retry loop lacks SAVEPOINTs, so a real unique-violation aborts the whole transaction instead of retrying
- Rule: high-missing-transaction-boundary
- Severity: HIGH
- Location: src/channels/channels.service.ts:24-61
- Evidence: the retry loop (lines 30-54) runs `manager.findOne` (line 31) and, in a separate iteration, `manager.save` (lines 40-46) inside one `dataSource.transaction(...)` (line 27) without any `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` around each attempt. The project's own documented rule (`.claude/rules/typeorm-queries.md`, "PostgreSQL aborts the transaction on constraint violation") states this exact pattern requires a `SAVEPOINT` per attempt, because once one statement inside a transaction fails, PostgreSQL puts the transaction in an aborted state and rejects every subsequent statement until rollback.
- Impact: if the pre-check `manager.findOne` (line 31) misses a real concurrent insert and `manager.save` (line 40) hits the unique violation the `catch` block anticipates (lines 47-54), the transaction is left aborted; the next loop iteration's `manager.findOne` (line 31) then throws PostgreSQL's "current transaction is aborted" error instead of participating in the intended retry. The error propagates out of `dataSource.transaction(...)`, which rolls back and rethrows, so `UsersService.createUserWithChannel`'s `catch` (line 31) deletes the just-created user and registration fails outright — exactly the concurrent-collision case the retry loop was written to survive.
- Recommendation: wrap each retry attempt in a `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` as documented in `.claude/rules/typeorm-queries.md`, or perform the collision check with an `INSERT ... ON CONFLICT` upsert instead of a separate pre-check + save. Any future retry-on-collision logic in a Phase 03 storage/queue path (e.g., generating a unique object key or job idempotency key) must use the SAVEPOINT pattern from the start.
- Status: proposed
- Evidence authority: source trace of `src/channels/channels.service.ts:24-61` plus the project's own documented PostgreSQL/TypeORM transaction-abort rule in `.claude/rules/typeorm-queries.md`.

### F-003 — Config default values are independently duplicated between `registerAs` factories and the Joi env-validation schema
- Rule: medium-duplicated-business-or-transport-policy
- Severity: MEDIUM
- Location: src/config/env.validation.ts:4-23
- Evidence: every default value declared in a `registerAs` config factory is re-declared independently in `envValidationSchema`: `DB_HOST` default `'localhost'` in both `src/config/database.config.ts:4` and `src/config/env.validation.ts:8`; `APP_URL` default `'http://localhost:3000'` in both `src/config/app.config.ts:6` and `src/config/env.validation.ts:19`; `MAIL_HOST`/`MAIL_PORT`/`MAIL_FROM` defaults duplicated between `src/config/mail.config.ts:4-6` and `src/config/env.validation.ts:20-22`; `JWT_ACCESS_EXPIRATION`/`JWT_REFRESH_EXPIRATION` defaults duplicated between `src/config/auth.config.ts:6-7` and `src/config/env.validation.ts:15-16`.
- Impact: the two sources of truth for the same default can silently diverge (one file's default is updated, the other is not), producing environment-dependent behavior that differs from what `envValidationSchema` documents as the validated default. Every new config namespace added for Phase 03 (`storage`, `queue`) will replicate this duplication unless the convention is corrected first.
- Recommendation: derive one of the two from the other — e.g., have each `registerAs` factory read its default from a single shared constants module that `envValidationSchema` also imports, or drop per-field Joi `.default()` calls and let `ConfigModule` defaults be the single source of truth (`validationOptions: { allowUnknown: true }` already tolerates this). Decide this before adding `storage`/`queue` config namespaces so they aren't built on the duplicated pattern.
- Status: proposed
- Evidence authority: direct comparison of `src/config/env.validation.ts` against `src/config/database.config.ts`, `src/config/app.config.ts`, `src/config/mail.config.ts`, `src/config/auth.config.ts`.

### F-004 — JWT TTL parsing silently falls back to a 0ms expiration instead of failing on a malformed config value
- Rule: medium-missing-boundary-validation
- Severity: MEDIUM
- Location: src/auth/auth.service.ts:29-40
- Evidence: `jwtExpirationToMs` (lines 29-40) returns `0` whenever `exp` does not match `/^(\d+)([smhd])$/` (line 31: `if (!match) return 0;`). Its only caller in `login`/`refresh` (lines 103, 214) feeds it `this.authCfg.jwtRefreshExpiration`, which is sourced from `JWT_REFRESH_EXPIRATION` and validated only as `Joi.string().default('7d')` (`src/config/env.validation.ts:16`) — no pattern/format constraint, so any string value passes Joi validation.
- Impact: a malformed `JWT_REFRESH_EXPIRATION` (wrong unit, typo, or a value in a different format than `\d+[smhd]`) passes environment validation at boot but silently produces refresh tokens with `expires_at = now`, making every refresh token expire immediately — a silent misconfiguration discovered only when refresh requests inexplicably fail with `TokenExpiredException`, not at startup.
- Recommendation: either add a `Joi.string().pattern(/^\d+[smhd]$/)` constraint to `JWT_ACCESS_EXPIRATION`/`JWT_REFRESH_EXPIRATION` in `envValidationSchema` so malformed values fail fast at boot, or make `jwtExpirationToMs` throw instead of returning `0` on a non-match. Any new Phase 03 config value with a similar "parse a formatted string into a runtime unit" step (e.g., a queue retry backoff string, a storage presigned-URL TTL) should validate the format at the config boundary rather than defaulting silently.
- Status: proposed
- Evidence authority: source trace `src/auth/auth.service.ts:29-40` (function) and call sites `src/auth/auth.service.ts:103,214`, cross-referenced with the Joi schema at `src/config/env.validation.ts:15-16`.

### F-005 — The database seed script performs no seeding
- Rule: low-misleading-name
- Severity: LOW
- Location: src/database/seeds/seed.ts:1-14
- Evidence: `runSeed` (lines 3-9) only calls `AppDataSource.initialize()` and `AppDataSource.destroy()` with two `console.log` statements; it contains no repository access, no entity creation, and no data insertion, despite `package.json`'s `"seed"` script (`ts-node ... src/database/seeds/seed.ts`) and the file/function names promising database seed data.
- Impact: a developer or CI step running `npm run seed` expecting fixture data (e.g., to exercise a fresh environment) gets a silent no-op with misleading success logs ("Database connection initialized" / "closed"), which can mask the absence of seed data until a manual/environment test fails for an unrelated-looking reason.
- Recommendation: either implement the intended seed inserts (using the same entities Phase 03 will extend) or rename/remove the script and its `package.json` entry until seeding is implemented, so the name does not promise behavior the code does not provide.
- Status: proposed
- Evidence authority: full-file read of `src/database/seeds/seed.ts` (14 lines) and its `package.json` `"seed"` script wiring.

## Proposed Refactoring Scope
- F-001, F-002 → introduce a single shared-transaction boundary for the register flow (`UsersService`/`ChannelsService` write coordination), compatible with existing callers of `AuthService.register` and `ChannelsService.createChannel` (public method signatures can be preserved; only the transaction/manager plumbing changes).
- F-003 → consolidate config defaults to one source of truth across `src/config/*.config.ts` and `src/config/env.validation.ts`; compatible with existing `ConfigType<typeof x>` consumers as long as resolved values are unchanged.
- F-004 → add Joi pattern validation for `JWT_ACCESS_EXPIRATION`/`JWT_REFRESH_EXPIRATION` and/or harden `jwtExpirationToMs`; compatible with all current valid `.env` values (`15m`, `7d`), changes only the failure mode for invalid ones.
- F-005 → implement or remove the seed script; no compatibility boundary since it currently has no observable effect on the application.

## Security-Driven Contract Changes
- None.

## Approval Required
Reply with explicit approval of this report path and snapshot digest before any target mutation. Identify all findings or the approved finding IDs.

## Audit Snapshot Digest
`sha256:b59dcd6ec55e1c0fdc43a8e9a166345dc1db434e2e3c62b7640ad478ea052e8c`
