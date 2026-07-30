import type { Queue } from 'bullmq';

/**
 * Redis-side counterpart to `cleanAllTables`.
 *
 * `cleanAllTables` deletes the `videos` rows between suites but leaves the jobs
 * those suites enqueued sitting in Redis. The worker then picks them up, cannot
 * find the row, and fails with `Could not find any entity of type "Video"` — so
 * every suite run used to deposit a few more permanent orphans. Draining the DB
 * without draining the queue is only half a cleanup.
 *
 * Call this in the teardown of any suite that enqueues against the real queue,
 * alongside `cleanAllTables`.
 */
export async function cleanVideoProcessingQueue(queue: Queue): Promise<void> {
  // Waiting + delayed. `true` includes delayed, which retried jobs sit in.
  await queue.drain(true);

  // drain() does not touch terminal states; these two need an explicit clean.
  // grace 0 = regardless of age.
  const limit = 1000;
  await queue.clean(0, limit, 'completed');
  await queue.clean(0, limit, 'failed');
}
