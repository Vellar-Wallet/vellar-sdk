/**
 * Relayer Fallback Submitter
 * Attempts primary relayer submission, falls back to direct submission on failure
 */

export interface SubmitFunction<T, R> {
  (transaction: T): Promise<R>;
}

export interface FallbackConfig<T, R> {
  primarySubmit: SubmitFunction<T, R>;
  fallbackSubmit: SubmitFunction<T, R>;
}

export interface SubmitResult<R> {
  path: 'primary' | 'fallback';
  result: R;
}

export class RelayerFallbackSubmitter<T = any, R = any> {
  private config: FallbackConfig<T, R>;

  constructor(config: FallbackConfig<T, R>) {
    this.config = config;
  }

  /**
   * Submit a transaction, trying primary first, then fallback
   */
  async submit(transaction: T): Promise<SubmitResult<R>> {
    console.log('Attempting primary submission...');
    
    try {
      const result = await this.config.primarySubmit(transaction);
      console.log('Primary submission succeeded');
      return {
        path: 'primary',
        result,
      };
    } catch (primaryError) {
      console.log(
        `Primary submission failed: ${(primaryError as Error).message}`
      );
      console.log('Attempting fallback submission...');

      try {
        const result = await this.config.fallbackSubmit(transaction);
        console.log('Fallback submission succeeded');
        return {
          path: 'fallback',
          result,
        };
      } catch (fallbackError) {
        console.log(
          `Fallback submission failed: ${(fallbackError as Error).message}`
        );
        throw new Error(
          `Both submission paths failed. Primary: ${
            (primaryError as Error).message
          }, Fallback: ${(fallbackError as Error).message}`
        );
      }
    }
  }
}
