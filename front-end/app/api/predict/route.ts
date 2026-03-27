// API ROUTE: /api/predict
//
// Server-side proxy to the Modal endpoint with JWT authentication.
// The browser calls this route (same origin → no CORS).
// This route verifies JWT, then forwards to Modal (server-to-server → no CORS).
// MODAL_ENDPOINT_URL stays server-only (no NEXT_PUBLIC_ prefix).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: NextRequest) {
  // Extract JWT from Authorization header
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error('[predict route] Missing or invalid Authorization header');
    return NextResponse.json(
      { error: 'Unauthorized: Missing or invalid token' },
      { status: 401 }
    );
  }

  const token = authHeader.slice(7); // Remove "Bearer " prefix

  // Validate JWT format (must have 3 segments: header.payload.signature)
  const tokenSegments = token.split('.');
  if (tokenSegments.length !== 3) {
    console.error('[predict route] Invalid JWT format: expected 3 segments, got', tokenSegments.length);
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

  try {
    const { data: user, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.error('[predict route] JWT verification failed:', authError?.message || 'User not found');
      return NextResponse.json(
        { error: 'Unauthorized: Invalid token' },
        { status: 401 }
      );
    }

    console.log('[predict route] Authenticated user:', user);
  } catch (error) {
    console.error('[predict route] JWT verification error:', error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      { error: 'Unauthorized: Token verification failed' },
      { status: 401 }
    );
  }

  // Verify Modal endpoint is configured
  const modalUrl = process.env.MODAL_ENDPOINT_URL;
  if (!modalUrl) {
    console.error('[predict route] MODAL_ENDPOINT_URL not configured');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Parse request body
  let body;
  try {
    body = await req.json();
  } catch {
    console.error('[predict route] Invalid JSON in request body');
    return NextResponse.json(
      { error: 'Bad request: Invalid JSON' },
      { status: 400 }
    );
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
    });

    // Modal sometimes returns plain-text errors (gateway issues, wrong URL, etc.)
    // Always try to parse as JSON; if it fails, surface the raw text as the error.
    const contentType = modalRes.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      const text = await modalRes.text();
      console.error('[predict route] Modal returned non-JSON:', modalRes.status, text.slice(0, 200));
      return NextResponse.json(
        { error: `Modal error ${modalRes.status}` },
        { status: 502 }
      );
    }

    const data = await modalRes.json();
    return NextResponse.json(data, { status: modalRes.status });
  } catch (error) {
    console.error('[predict route] Modal request failed:', error instanceof Error ? error.message : String(error));
    return NextResponse.json(
      { error: 'Internal server error: Modal request failed' },
      { status: 500 }
    );
  }
}
