# CLAUDE.md

## Environment Startup Verification

**Default behavior:** starting the environment means starting **only infrastructure services** (database, mail, etc.) — **never** start the NestJS application server unless the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

After starting infrastructure, always confirm the containers are up before proceeding:

```bash
docker compose ps   # all services must show status "running"
```

Then verify each infrastructure service is actually ready to accept connections — not just running:

- **PostgreSQL:** `docker compose exec db pg_isready -U streamtube` — expect `accepting connections`

Only start the NestJS dev server (`npm run start:dev`) when the user **explicitly** asks to run the application — never as part of "start the environment".

## Development Environment

This project runs inside Docker. Always use the container for development:

```bash
# Start containers
docker compose up -d

# Install dependencies (first time only)
docker compose exec nestjs-api npm install

# Run the dev server (watch mode)
docker compose exec nestjs-api npm run start:dev
```

Services:
- `nestjs-api` — NestJS API, port `3000`
- `db` — PostgreSQL 17, port `5432`, database `streamtube`, user/password `streamtube`

All verification and teardown commands run on the **host machine**:

```bash
# Verify NestJS is running (expect 200 + "Hello World!")
curl http://localhost:3000

# Verify PostgreSQL is ready (runs inside the db container)
docker compose exec db pg_isready -U streamtube

# Check container logs
docker compose logs nestjs-api
docker compose logs db

# Tear down the entire environment
docker compose down
```

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and test command runs **inside the container**, never on the host. Running on the host causes env-var divergence (`DB_HOST` resolves to `localhost` instead of the Compose service), uses a different Node version, and produces results that do not reflect what runs in CI/prod.

### Container-only commands (always prefix with `docker compose exec nestjs-api`)

```bash
npm run start:dev                        # Dev server with hot-reload
npm run build                            # Compile to dist/
npm run start:prod                       # Run compiled build

npm test                                 # Unit tests
npm run test:watch                       # Unit tests in watch mode
npm run test:cov                         # Coverage report
npm run test:e2e                         # End-to-end tests (always with --runInBand)

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npm run lint                             # ESLint, read-only — this is the DoD gate
npm run lint:fix                         # ESLint with --fix (developer convenience, never the gate)
npm run format                           # Prettier formatting
```

`lint` and `lint:fix` are deliberately separate. A gate that can rewrite the tree it is judging cannot produce evidence: a green `--fix` run means "green *after* being rewritten", and it dirties the working tree as a side effect. Use `lint` to measure and `lint:fix` to change. Do not add `--fix` back to `lint`.

### Host-only commands (Docker / connectivity probes)

```bash
docker compose ps
docker compose logs nestjs-api
docker compose exec db pg_isready -U streamtube
curl http://localhost:3000
```

### Test execution

Integration and e2e suites share a single test database. They **must** be run with `--runInBand`:

```bash
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e   # already configured
```

Parallel execution causes FK violations, deadlocks, and cross-suite contamination because suites truncate or seed shared tables concurrently.

During active development, run only the tests related to the file being changed (`npm test -- path/to/file.spec.ts`). Before declaring a task done, run the full suite — see the global `CLAUDE.md` → "Definition of Done (Technical)".

## Long-running Processes

Commands that never exit (dev server, watch modes) must be run in background in the Bash tool — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `start:dev`, `start:prod`, `test:watch`, and any other persistent process.

## Test Type Selection

Choose the suffix by what the test really does, not by where the code under test lives. The suffix is a contract that drives Jest config (`testRegex`, parallelism), CI steps, and reader expectations.

| Suffix                  | Purpose                                                              | DB / external I/O | Location                     |
|-------------------------|----------------------------------------------------------------------|-------------------|------------------------------|
| `*.spec.ts`             | **Unit** — pure logic, all collaborators mocked                      | Forbidden         | Next to the source file      |
| `*.integration-spec.ts` | **Integration** — exercises real DB, real repositories, real modules | Required          | Next to the source file      |
| `*.e2e-spec.ts`         | **End-to-end** — full HTTP cycle via `supertest`                     | Required          | `nestjs-project/test/`       |

A test that constructs a `TypeOrmModule.forRoot`, opens a connection, or hits the `db` service **must** be `*.integration-spec.ts`, never `*.spec.ts`. A test that boots the full Nest application and makes HTTP calls **must** be `*.e2e-spec.ts`.

Conventions for **how to write** each kind of test (mocking patterns, AAA structure, override strategies for global guards, etc.) live in `.claude/rules/nestjs-testing.md` and load when you edit a test file.

## Jest Configuration

These settings are required in `package.json` (jest config) and `test/jest-e2e.json` for the project's tests to work correctly:

- `setupFiles: ["dotenv/config"]` — without this, `.env` is not loaded inside the Jest process. `DB_HOST`, `JWT_SECRET`, etc. fall back to undefined or to the host's `localhost`, breaking container-to-container DNS.
- `testRegex: '.*\\.(spec|integration-spec)\\.ts$'` — covers both unit (`*.spec.ts`) and integration (`*.integration-spec.ts`) suffixes.

Do not add new test-file suffixes; if a new test type is needed, update the regex deliberately.

## Environment File Conventions

`.env` is parsed by both Docker Compose and `dotenv` — values containing shell-special characters (`<`, `>`, `|`, `&`, spaces) **must be quoted** or rewritten:

```dotenv
# Wrong — the unquoted angle brackets are shell redirection syntax and break parsing
MAIL_FROM=StreamTube <noreply@streamtube.local>

# Right — quote the value
MAIL_FROM="StreamTube <noreply@streamtube.local>"
```

Whenever possible, prefer storing only the bare address in `.env` and composing display names in code (e.g., in `mail.config.ts`) so the file stays shell-safe.

## Build Assets

`tsc` (and therefore `nest build`) only emits compiled `.ts` files to `dist/`. Any non-TypeScript runtime asset — Handlebars templates (`.hbs`), JSON fixtures, static config files, etc. — must be declared in `nest-cli.json` under `compilerOptions.assets` (with `watchAssets: true` for dev). Without that, the file exists in `src/` but is missing in `dist/` and runtime fails only after build.

## Architecture

NestJS with standard module structure. Source lives in `src/`, compiled output in `dist/`.

- Each domain feature gets its own module (e.g., `UsersModule`, `VideosModule`) registered in `AppModule`
- Controllers handle HTTP routing; Services hold business logic; both are scoped to their module

## Video Processing (Phase 03)

Upload, storage, async processing, and delivery of videos. Four modules: `videos/` (entity, controller, upload/detail/stream/download endpoints), `storage/` (MinIO/S3 wrapper — multipart upload, presigned URLs, range GET), `queue/` (BullMQ producer — `VideoQueueService`), `video-worker/` (separate process consuming the queue — metadata extraction + thumbnail via fluent-ffmpeg/ffprobe).

### Running the worker

The worker is a **separate Node process**, not part of `nestjs-api`. It runs as its own Compose service (`video-worker`) via `npm run start:worker:dev`. `VIDEO_WORKER_CONCURRENCY` (default BullMQ concurrency is 1) is only honored because `start:worker:dev` preloads `-r dotenv/config` — this loads `.env` before the `@Processor` decorator reads the concurrency option at import time, ahead of `ConfigModule.forRoot()`. If you ever see the worker silently running at concurrency 1 despite `VIDEO_WORKER_CONCURRENCY` being set, check that preload flag first.

### Worker liveness — do not remove

`video-worker` neither serves traffic nor is depended on by any other service, so for a week nothing noticed it was in `exited (1)` while the whole test suite reported green. Two mechanisms exist specifically to stop that recurring; treat both as load-bearing:

- **`WorkerHealthService`** (`src/video-worker/worker-health.service.ts`) serves a liveness endpoint on `VIDEO_WORKER_HEALTH_PORT` (default `3001`), and `compose.yaml` healthchecks it. It answers 200 only when the BullMQ consumer `isRunning()` **and** its Redis connection is `ready` — "the process exists" is deliberately not enough to pass.
- **`main.ts` passes `abortOnError: false`** and, on a failed boot, logs the cause and keeps the process alive answering 503. Without this, Nest exits with code 1 on a bootstrap error — and `docker compose ps` does not list stopped containers, so the crash vanishes from the default view. Staying up as `unhealthy` is what makes `docker compose ps`, `up --wait`, and `depends_on: condition: service_healthy` all report the failure.

When checking the stack, `docker compose ps` alone is now sufficient for this service; before, `--all` was required to even see it.

### New infra services (`compose.yaml`)

- `redis` — BullMQ backing store, port `6379`.
- `minio` + `minio-init` — S3-compatible object storage, ports `9000` (API) / `9001` (console), bucket `streamtube` auto-created by `minio-init`.
- `video-worker` — the background processor described above.

### Upload flow

Direct-to-storage multipart upload (never through the API): `POST /videos` initiates a draft + returns presigned part URLs; the client PUTs parts straight to MinIO; `POST /videos/:id/complete-upload` finalizes the multipart upload and enqueues processing. This is why a 10GB file never touches the NestJS process.

### Testing conventions specific to this subsystem

Per the project's "don't mock what you can run for real" rule: `storage.service.integration-spec.ts`, `video-processing.processor.integration-spec.ts`, and `video-processing.queue.integration-spec.ts` all exercise **real MinIO and real Redis/BullMQ** via the Compose services — never mock `StorageService` or the queue in an integration spec. Unit specs (`*.spec.ts`) still mock these collaborators.

**Clean Redis, not just Postgres.** `cleanAllTables` deletes the `videos` rows but leaves the jobs a suite enqueued sitting in Redis; the worker then picks them up, cannot find the row, and fails them permanently. That is how `bull:video-processing:failed` reached 25 orphans, which had to be told apart from real failures by hand while debugging. Any suite that enqueues against the real queue must also call **`cleanVideoProcessingQueue`** (`src/test/clean-video-processing-queue.ts`) in its teardown — it is the Redis-side counterpart to `cleanAllTables`. Note `queue.drain()` alone is not enough: it leaves completed/failed jobs behind, which is why the helper also calls `queue.clean`.

**A live worker competes with your spec.** The `video-worker` container consumes the same queue as the tests. A spec that asserts on a job it enqueued can have that job claimed by the container's worker first (`Job … could not be removed because it is locked by another worker`). `videos.service.integration-spec.ts` handles this by wrapping the assertion in `queue.pause()` / `queue.resume()` in a `finally`. If a queue spec is flaky only when `docker compose ps` shows `video-worker` running, this is why.

## Code Conventions

- **TypeScript:** `nodenext` module resolution, `ES2023` target, `strictNullChecks` on, `noImplicitAny` off
- **Decorators:** `emitDecoratorMetadata` + `experimentalDecorators` enabled — required for NestJS DI
- **Prettier:** single quotes, trailing commas everywhere
- **ESLint:** `no-explicit-any` allowed; `no-floating-promises` and `no-unsafe-argument` are warnings

## REST Conventions

This is a RESTful API. All endpoints must follow standard REST conventions — correct HTTP methods, proper status codes, plural resource nouns, and consistent URL structure. Details are enforced via rules on controller files.
