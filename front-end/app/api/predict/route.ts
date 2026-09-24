// API ROUTE: /api/predict
//
// Server-side proxy to the Modal endpoint with JWT authentication.
// The browser calls this route (same origin → no CORS).
// This route verifies JWT, then forwards to Modal (server-to-server → no CORS).
// MODAL_ENDPOINT_URL stays server-only (no NEXT_PUBLIC_ prefix).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, getClientIp, rateLimitHeaders } from '@/lib/rateLimit';
import { logger } from '@/lib/logger';

// V-5: abuse guards — Modal calls cost money. IP pre-auth cap + per-user quota
// + payload cap + upstream timeout.
const PREDICT_IP_LIMIT = 120; // /hour per IP (pre-auth; generous for classrooms behind NAT)
const PREDICT_USER_LIMIT = 60; // /hour per authenticated user
const PREDICT_WINDOW_MS = 60 * 60 * 1000;
const PREDICT_MAX_BYTES = 12 * 1024 * 1024; // 12 MB
const MODAL_TIMEOUT_MS = 25_000;

export async function POST(req: NextRequest) {
  const ipRl = checkRateLimit(`predict:ip:${getClientIp(req)}`, PREDICT_IP_LIMIT, PREDICT_WINDOW_MS);
  if (!ipRl.allowed) {
    return NextResponse.json(
      { error: 'Too many prediction requests. Try again later.' },
      { status: 429, headers: { 'Retry-After': '3600', ...rateLimitHeaders(ipRl.remaining, ipRl.resetAt) } }
    );
  }

  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > PREDICT_MAX_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  // Extract JWT from Authorization header
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('predict', 'missing_or_invalid_auth_header');
    return NextResponse.json(
      { error: 'Unauthorized: Missing or invalid token' },
      { status: 401 }
    );
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  // Validate JWT format (must have 3 segments: header.payload.signature)
  const tokenSegments = token.split('.');
  if (tokenSegments.length !== 3) {
    logger.warn('predict', 'malformed_jwt', { segments: tokenSegments.length });
    return NextResponse.json(
      { error: 'Unauthorized: Malformed token (invalid format)' },
      { status: 401 }
    );
  }

  // Verify JWT with Supabase using anon key
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  let userId = 'unknown';
  try {
    const { data: user, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      logger.warn('predict', 'jwt_verification_failed', { reason: authError?.message ?? 'not_found' });
      return NextResponse.json(
        { error: 'Unauthorized: Invalid token' },
        { status: 401 }
      );
    }

    // V-7: never log the full user object (PII). User id hash-prefix is enough.
    userId = user.user?.id ?? 'unknown';
  } catch (error) {
    logger.error('predict', 'jwt_verification_error', { reason: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: 'Unauthorized: Token verification failed' },
      { status: 401 }
    );
  }

  // Verify Modal endpoint is configured
  const modalUrl = process.env.MODAL_ENDPOINT_URL;
  if (!modalUrl) {
    logger.error('predict', 'modal_endpoint_not_configured');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  const userRl = checkRateLimit(`predict:user:${userId}`, PREDICT_USER_LIMIT, PREDICT_WINDOW_MS);
  if (!userRl.allowed) {
    return NextResponse.json(
      { error: 'Prediction quota exceeded. Try again later.' },
      { status: 429, headers: { 'Retry-After': '3600', ...rateLimitHeaders(userRl.remaining, userRl.resetAt) } }
    );
  }

  // Parse request body
  let body;
  try {
    body = await req.json();
  } catch {
    logger.warn('predict', 'invalid_json_body');
    return NextResponse.json(
      { error: 'Bad request: Invalid JSON' },
      { status: 400 }
    );
  }

  // V-5: post-parse size check (content-length can be spoofed/omitted).
  const approxBytes = JSON.stringify(body ?? {}).length;
  if (approxBytes > PREDICT_MAX_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  // Forward to Modal with token in the request body (Modal expects request["token"])
  try {
    const modalPayload = {
      ...body,
      token: token, // Add token to request body for Modal
    };

    const modalRes = await fetch(modalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(modalPayload),
      signal: AbortSignal.timeout(MODAL_TIMEOUT_MS),
    });

    // Modal sometimes returns plain-text errors (gateway issues, wrong URL, etc.)
    // Always try to parse as JSON; if it fails, surface the raw text as the error.
    const contentType = modalRes.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      // Drain the body (gateway error pages) without logging it — may contain
      // upstream internals and bloats logs on hot paths.
      await modalRes.text();
      logger.error('predict', 'modal_non_json', { status: modalRes.status });
      return NextResponse.json(
        { error: `Modal error ${modalRes.status}` },
        { status: 502 }
      );
    }

    const data = await modalRes.json();
    return NextResponse.json(data, { status: modalRes.status });
  } catch (error) {
    logger.error('predict', 'modal_request_failed', { reason: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: 'Internal server error: Modal request failed' },
      { status: 500 }
    );
  }
}
