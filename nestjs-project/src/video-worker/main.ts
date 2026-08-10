import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createServer } from 'http';
import { VideoWorkerModule } from './video-worker.module';
import { resolveVideoWorkerHealthPort } from './worker-health.service';

const logger = new Logger('VideoWorkerBootstrap');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(VideoWorkerModule, {
    // Without this, Nest handles a bootstrap error itself by exiting with code
    // 1, so the promise never rejects and the catch below never runs. That exit
    // is the behaviour WORKER-1 hid behind — see serveUnhealthy().
    abortOnError: false,
  });
  app.enableShutdownHooks();
}

/**
 * Keeps the process alive answering 503 after a failed boot.
 *
 * A boot failure previously became an unhandled rejection and `exit(1)`. That
 * reads like the safe thing to do, but it is what made WORKER-1 invisible for a
 * week: `docker compose ps` does not list stopped containers, so a crashed
 * worker disappears from the default view entirely (`--all` was needed to see
 * it), and nothing else in the stack depends on this service to notice.
 *
 * Staying up and failing the healthcheck puts the failure where it gets seen:
 * `docker compose ps` reports `unhealthy`, and both `up --wait` and any
 * `depends_on: condition: service_healthy` fail instead of passing over a dead
 * consumer. The underlying error is logged first, so the cause stays in the logs.
 */
function serveUnhealthy(): void {
  const port = resolveVideoWorkerHealthPort(
    process.env.VIDEO_WORKER_HEALTH_PORT,
  );

  const server = createServer((_req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'boot-failed' }));
  });

  // Nothing left to fall back on: with no listener the healthcheck fails, which
  // is still the correct signal.
  server.on('error', (err: Error) => {
    logger.error(`could not serve the unhealthy signal: ${err.message}`);
  });

  server.listen(port);
}

void bootstrap().catch((err: unknown) => {
  logger.error(
    'video-worker failed to boot; reporting unhealthy',
    err instanceof Error ? err.stack : String(err),
  );
  serveUnhealthy();
});
