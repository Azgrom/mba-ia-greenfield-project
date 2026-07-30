import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { createServer, type Server, type ServerResponse } from 'http';
import { VideoProcessingProcessor } from './video-processing.processor';

/**
 * Liveness surface for the video-worker process.
 *
 * video-worker was the only Compose service with no healthcheck, and the only
 * one that merely *runs* rather than *serves* — so nothing ever asserted it was
 * alive. It sat in `exited (1)` for a week while the full suite reported green,
 * because a crashed consumer looks exactly like an idle one from the outside.
 *
 * The probe deliberately reports on the BullMQ consumer, not on the process:
 * `process is up` is the weaker claim and is not the one that matters. A worker
 * whose event loop is alive but whose consumer stopped, or whose Redis
 * connection dropped, is just as dead to the queue as a crashed one, and this
 * endpoint answers 503 in all three cases.
 */
export const WORKER_HEALTH_DEFAULT_PORT = 3001;

/** Bounds the probe so it always answers instead of hanging on a dead Redis. */
export const WORKER_HEALTH_TIMEOUT_MS = 2_000;

export function resolveVideoWorkerHealthPort(value?: string): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : WORKER_HEALTH_DEFAULT_PORT;
}

@Injectable()
export class WorkerHealthService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(WorkerHealthService.name);
  private server: Server | null = null;

  constructor(private readonly processor: VideoProcessingProcessor) {}

  onApplicationBootstrap(): void {
    const port = resolveVideoWorkerHealthPort(
      process.env.VIDEO_WORKER_HEALTH_PORT,
    );

    const server = createServer((_req, res) => {
      void this.respond(res);
    });

    // A bind failure must not take the process down, but it must not be silent
    // either: with no listener the healthcheck fails, which is the correct
    // outcome — the same "loud" property this whole service exists to restore.
    server.on('error', (err: Error) => {
      this.logger.error(`health endpoint failed to bind: ${err.message}`);
    });

    server.listen(port, () => {
      this.logger.log(`worker health endpoint listening on port ${port}`);
    });

    this.server = server;
  }

  async onApplicationShutdown(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  /**
   * True only when the BullMQ worker is running *and* its Redis connection is
   * usable — the two conditions required for an enqueued job to ever be picked
   * up.
   */
  async isConsuming(): Promise<boolean> {
    const worker = this.processor.worker;
    if (!worker || !worker.isRunning()) {
      return false;
    }

    try {
      const client = await this.withTimeout(worker.client);
      return client.status === 'ready';
    } catch {
      return false;
    }
  }

  private async respond(res: ServerResponse): Promise<void> {
    const consuming = await this.isConsuming();
    res.writeHead(consuming ? 200 : 503, {
      'content-type': 'application/json',
    });
    res.end(JSON.stringify({ status: consuming ? 'ok' : 'unavailable' }));
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('health probe timed out')),
            WORKER_HEALTH_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
