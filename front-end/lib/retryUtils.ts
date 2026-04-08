/**
 * Utility for retrying failed operations with exponential backoff
 * Useful for transient network failures during signup
 */

interface RetryConfig {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
}

const defaultConfig: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * Retries a function with exponential backoff
 * @param fn - Async function to retry
 * @param config - Retry configuration
 * @returns Result of the function
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const cfg = { ...defaultConfig, ...config };
  let lastError: Error | null = null;
  let delayMs = cfg.initialDelayMs!;

  for (let attempt = 1; attempt <= cfg.maxAttempts!; attempt++) {
    try {
      console.log(`[Retry] Attempt ${attempt}/${cfg.maxAttempts}`);
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      if (attempt < cfg.maxAttempts!) {
        console.warn(`[Retry] Attempt ${attempt} failed, retrying in ${delayMs}ms`, lastError);
        await sleep(delayMs);
        
        // Calculate next delay with backoff
        delayMs = Math.min(
          delayMs * cfg.backoffMultiplier!,
          cfg.maxDelayMs!
        );
      } else {
        console.error(`[Retry] All ${cfg.maxAttempts} attempts failed`, lastError);
      }
    }
  }

  throw lastError || new Error('Retry exhausted');
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Checks if an error is likely transient (retryable)
 */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  const transientPatterns = [
    'network error',
    'failed to fetch',
    'timeout',
    'econnrefused',
    'econnreset',
    'etimedout',
    'ehostunreach',
    'enetunreach',
    'request_timeout',
  ];

  return transientPatterns.some(pattern => message.includes(pattern));
}

/**
 * Retries signup with exponential backoff
 * Useful for handling transient network failures
 */
export async function retrySignup(
  signupFn: () => Promise<any>,
  onAttempt?: (attemptNumber: number, error?: Error) => void
): Promise<any> {
  let attempt = 0;

  return retryWithBackoff(
    async () => {
      attempt++;
      try {
        onAttempt?.(attempt);
        return await signupFn();
      } catch (err) {
        if (!isTransientError(err)) {
          // Don't retry non-transient errors
          throw err;
        }
        throw err;
      }
    },
    {
      maxAttempts: 3,
      initialDelayMs: 1000,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
    }
  );
}
