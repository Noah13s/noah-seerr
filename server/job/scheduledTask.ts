import logger from '@server/logger';

/** Own the entire async job, including failures, instead of detaching its work. */
export function scheduledTask(
  name: string,
  task: () => unknown,
  level: 'info' | 'debug' = 'info'
): () => Promise<void> {
  return async () => {
    logger[level](`Starting scheduled job: ${name}`, { label: 'Jobs' });
    try {
      await task();
    } catch (error) {
      // A failed tick must be visible without terminating the scheduler/process.
      // The next configured invocation can try again.
      logger.error('Scheduled job failed', {
        label: 'Jobs',
        job: name,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };
}
