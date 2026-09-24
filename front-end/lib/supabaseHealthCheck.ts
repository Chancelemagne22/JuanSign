import { supabase } from './supabase';
import { logger } from '@/lib/logger';

interface HealthCheckResult {
  isHealthy: boolean;
  message: string;
  details: {
    supabaseUrlValid: boolean;
    supabaseAnonKeyValid: boolean;
    networkReachable: boolean;
    supabaseServiceHealthy: boolean;
  };
}

/**
 * Performs a comprehensive health check on Supabase connectivity
 * Useful for diagnosing "Failed to fetch" errors during signup
 */
export async function checkSupabaseHealth(): Promise<HealthCheckResult> {
  const details = {
    supabaseUrlValid: false,
    supabaseAnonKeyValid: false,
    networkReachable: false,
    supabaseServiceHealthy: false,
  };

  // Check 1: Verify environment variables are set
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      isHealthy: false,
      message: 'Supabase configuration is missing. Please check your environment variables.',
      details,
    };
  }

  details.supabaseUrlValid = supabaseUrl.startsWith('https://') && supabaseUrl.includes('.supabase.co');
  details.supabaseAnonKeyValid = supabaseAnonKey.length > 0 && supabaseAnonKey.startsWith('sb_');

  if (!details.supabaseUrlValid || !details.supabaseAnonKeyValid) {
    return {
      isHealthy: false,
      message: 'Supabase configuration format is invalid.',
      details,
    };
  }

  // Check 2: Test network connectivity to Supabase
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'GET',
      headers: {
        apikey: supabaseAnonKey,
      },
    });
    
    details.networkReachable = response.status === 401 || response.status === 200;
    
    if (details.networkReachable) {
      details.supabaseServiceHealthy = true;
    }
  } catch (err) {
    logger.error('healthcheck', 'network_test_failed', { reason: err instanceof Error ? err.message : String(err) });
    details.networkReachable = false;
    details.supabaseServiceHealthy = false;
  }

  // Check 3: Test Supabase auth endpoint
  if (details.networkReachable) {
    try {
      const authTestResponse = await fetch(
        `${supabaseUrl}/auth/v1/health`,
        {
          method: 'GET',
          headers: {
            apikey: supabaseAnonKey,
          },
        }
      );
      
      if (authTestResponse.ok) {
        details.supabaseServiceHealthy = true;
      }
    } catch (err) {
      logger.warn('healthcheck', 'auth_test_failed', { reason: err instanceof Error ? err.message : String(err) });
    }
  }

  const isHealthy = details.supabaseUrlValid && details.supabaseAnonKeyValid && details.networkReachable;

  return {
    isHealthy,
    message: isHealthy
      ? 'Supabase connection is healthy'
      : 'Supabase connection check failed. Please verify your network connection and Supabase configuration.',
    details,
  };
}

/**
 * Logs detailed health check information to console
 * Helpful for debugging signup failures
 */
export async function logSupabaseHealthCheck(): Promise<void> {
  logger.debug('healthcheck', 'starting');

  const result = await checkSupabaseHealth();

  logger.debug('healthcheck', 'result', { healthy: result.isHealthy });

  if (!result.isHealthy) {
    logger.error('healthcheck', 'unhealthy', { message: result.message });
  }
}
