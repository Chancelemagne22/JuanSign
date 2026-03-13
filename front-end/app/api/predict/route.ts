// API ROUTE: /api/predict
//
// Server-side proxy to the Modal endpoint.
// The browser calls this route (same origin → no CORS).
// This route forwards the request to Modal (server-to-server → no CORS).
// MODAL_ENDPOINT_URL stays server-only (no NEXT_PUBLIC_ prefix).

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const modalUrl = process.env.MODAL_ENDPOINT_URL;
  if (!modalUrl) {
    return NextResponse.json({ error: 'Modal endpoint not configured' }, { status: 500 });
  }

  const body = await req.json();

  const modalRes = await fetch(modalUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  // Modal sometimes returns plain-text errors (gateway issues, wrong URL, etc.)
  // Always try to parse as JSON; if it fails, surface the raw text as the error.
  const contentType = modalRes.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const text = await modalRes.text();
    console.error('[predict route] Modal returned non-JSON:', modalRes.status, text);
    return NextResponse.json(
      { error: `Modal error ${modalRes.status}: ${text.slice(0, 200)}` },
      { status: 502 },
    );
  }

  const data = await modalRes.json();
  return NextResponse.json(data, { status: modalRes.status });
}
