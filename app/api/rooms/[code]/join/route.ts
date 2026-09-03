import { NextRequest, NextResponse } from 'next/server';

import { getRoom, joinRoom } from '@/lib/rooms';

type Context = { params: Promise<{ code: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const { code: rawCode } = await context.params;
    const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    const room = await getRoom(code);
    if (!room) return NextResponse.json({ error: 'Room not found. Check the code and try again.' }, { status: 404 });
    if (room.expires_at <= Date.now()) return NextResponse.json({ error: 'This room has expired.' }, { status: 410 });

    const body = await request.json() as { displayName?: unknown };
    const displayName = typeof body.displayName === 'string'
      ? body.displayName.trim().replace(/\s+/g, ' ').slice(0, 24)
      : '';
    if (!displayName) return NextResponse.json({ error: 'Enter your name.' }, { status: 400 });

    const memberId = crypto.randomUUID();
    await joinRoom({ room_code: code, id: memberId, display_name: displayName, is_host: 0, last_seen: Date.now() });

    return NextResponse.json({
      memberId,
      displayName,
      room: { code, name: room.name, trackName: room.track_name, duration: room.duration },
    });
  } catch (error) {
    console.error('Join room failed', error);
    return NextResponse.json({ error: 'The room could not be joined.' }, { status: 500 });
  }
}
