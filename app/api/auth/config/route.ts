import { NextResponse } from 'next/server';

import { GOOGLE_CLIENT_ID } from '@/lib/auth';

export async function GET() {
  return NextResponse.json({ clientId: GOOGLE_CLIENT_ID }, {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
