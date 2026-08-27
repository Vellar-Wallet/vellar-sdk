/**
 * Retrying Transaction Submitter
 * Wraps a submission function with retry logic and exponential backoff
 */

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
}

export class RetryingSubmitter {
  private config: RetryConfig;

  constructor(config: RetryConfig) {
    this.config = config;
  }

  /**
   * Submit with retry logic
   * @param submitFn The function to retry
   * @returns The result from submitFn
   * @throws Error if all attempts are exhausted
   */
  async submit<T>(submitFn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
      try {
        console.log(`Attempt ${attempt}/${this.config.maxAttempts}...`);
        const result = await submitFn();
        console.log(`Success on attempt ${attempt}`);
        return result;
      } catch (error) {
        lastError = error as Error;
        console.log(`Attempt ${attempt} failed: ${lastError.message}`);

        if (attempt < this.config.maxAttempts) {
          const delay = this.calculateBackoff(attempt);
          console.log(`Waiting ${delay}ms before retry...`);
          await this.sleep(delay);
        }
      }
    }

    throw new Error(
      `All ${this.config.maxAttempts} attempts exhausted. Last error: ${lastError?.message}`
    );
  }

  /**
   * Calculate exponential backoff delay
   * Formula: baseDelay * (2 ^ (attempt - 1))
   */
  private calculateBackoff(attempt: number): number {
    return this.config.baseDelayMs * Math.pow(2, attempt - 1);
  }

  /**
   * Sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
