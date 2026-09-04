import { NextRequest, NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth';
import { corsPreflight, withCorsHandler } from '@/lib/cors';
import { heartbeat } from '@/lib/rooms';

type Context = { params: Promise<{ code: string }> };

async function post(request: NextRequest, context: Context) {
  try {
    if (!await requireUser(request)) return NextResponse.json({ error: 'Sign in to update presence.' }, { status: 401 });
    const { code: rawCode } = await context.params;
    const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    const body = await request.json() as { memberId?: unknown };
    if (typeof body.memberId !== 'string' || !body.memberId) {
      return NextResponse.json({ error: 'Member id required.' }, { status: 400 });
    }
    await heartbeat(code, body.memberId, Date.now());
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Heartbeat failed', error);
    return NextResponse.json({ error: 'Presence update failed.' }, { status: 500 });
  }
}

export const POST = withCorsHandler(post);
export const OPTIONS = corsPreflight;
