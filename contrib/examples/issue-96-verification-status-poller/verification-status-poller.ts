/**
 * Verification status poller (issue #96)
 *
 * Polls a mock verification job on an interval and resolves once the job
 * reaches a terminal state. Rejects if the maximum wait time is exceeded.
 */

export type JobStatus = 'pending' | 'processing' | 'verified' | 'failed';

export interface VerificationJob {
  id: string;
  status: JobStatus;
}

export type StatusFetcher = (jobId: string) => Promise<VerificationJob>;

const TERMINAL_STATUSES: JobStatus[] = ['verified', 'failed'];

export interface PollOptions {
  /** How often to check, in milliseconds. Default: 1000 */
  intervalMs?: number;
  /** Maximum total wait time before rejecting, in milliseconds. Default: 30000 */
  maxWaitMs?: number;
}

/**
 * Poll `fetcher` for `jobId` until it reaches a terminal status or
 * `maxWaitMs` elapses. Returns the final `VerificationJob` on success,
 * or rejects with a timeout error.
 */
export function pollVerificationStatus(
  jobId: string,
  fetcher: StatusFetcher,
  options: PollOptions = {},
): Promise<VerificationJob> {
  const intervalMs = options.intervalMs ?? 1000;
  const maxWaitMs = options.maxWaitMs ?? 30000;

  return new Promise((resolve, reject) => {
    const start = Date.now();
    let timer: ReturnType<typeof setInterval> | null = null;

    async function check() {
      if (Date.now() - start >= maxWaitMs) {
        if (timer) clearInterval(timer);
        reject(new Error(`Verification job ${jobId} timed out after ${maxWaitMs}ms`));
        return;
      }

      const job = await fetcher(jobId);
      if (TERMINAL_STATUSES.includes(job.status)) {
        if (timer) clearInterval(timer);
        resolve(job);
      }
    }

    // First check immediately, then on interval.
    check();
    timer = setInterval(check, intervalMs);
  });
}
