import { NextRequest, NextResponse } from 'next/server';

import { GOOGLE_CLIENT_ID } from '@/lib/auth';
import { corsPreflight, withCorsHandler } from '@/lib/cors';

async function get(_request: NextRequest) {
  return NextResponse.json({ clientId: GOOGLE_CLIENT_ID }, {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}

export const GET = withCorsHandler(get);
export const OPTIONS = corsPreflight;
