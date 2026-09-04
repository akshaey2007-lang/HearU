import { NextRequest, NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth';
import { corsPreflight, withCorsHandler } from '@/lib/cors';
import { addReaction, getMember, getRoom } from '@/lib/rooms';

type Context = { params: Promise<{ code: string }> };
const allowed = new Set(['💜', '🔥', '✨', '🥹']);

async function post(request: NextRequest, context: Context) {
  try {
    if (!await requireUser(request)) return NextResponse.json({ error: 'Sign in to react.' }, { status: 401 });
    const { code: rawCode } = await context.params;
    const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    const room = await getRoom(code);
    if (!room) return NextResponse.json({ error: 'Room not found.' }, { status: 404 });
    if (!room.reactions_enabled) return NextResponse.json({ error: 'Reactions are disabled.' }, { status: 403 });

    const body = await request.json() as { memberId?: unknown; emoji?: unknown };
    if (typeof body.memberId !== 'string' || typeof body.emoji !== 'string' || !allowed.has(body.emoji)) {
      return NextResponse.json({ error: 'Invalid reaction.' }, { status: 400 });
    }
    const member = await getMember(code, body.memberId);
    if (!member) return NextResponse.json({ error: 'Join the room before reacting.' }, { status: 403 });

    await addReaction(code, member.display_name, body.emoji, Date.now());
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Reaction failed', error);
    return NextResponse.json({ error: 'Reaction could not be sent.' }, { status: 500 });
  }
}

export const POST = withCorsHandler(post);
export const OPTIONS = corsPreflight;
