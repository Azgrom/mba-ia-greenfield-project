export const VIDEO_PROCESSING_QUEUE = 'video-processing' as const;
export const PROCESS_VIDEO_JOB = 'process-video' as const;

/**
 * Bounded retention for failed jobs.
 *
 * `removeOnFail: false` kept every failure forever, which is not a retention
 * policy but the absence of one: `bull:video-processing:failed` had grown to 25
 * entries, all of them orphans pointing at test rows that no longer existed.
 * Unbounded growth is the smaller problem — the real cost is that genuine
 * failures get buried in that noise and have to be told apart by hand.
 *
 * A week of history is enough to diagnose a production failure, and the count
 * cap keeps a crash-looping job from crowding out everything else.
 */
export const FAILED_JOB_RETENTION = {
  age: 7 * 24 * 60 * 60,
  count: 100,
} as const;

export interface ProcessVideoJobData {
  videoId: string;
}
