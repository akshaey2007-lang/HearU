import { NextRequest, NextResponse } from 'next/server';

import { activeMembers, getMember, getRoom, recentReactions, updatePlayback } from '@/lib/rooms';

type Context = { params: Promise<{ code: string }> };

function normalizedCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

function publicState(room: NonNullable<Awaited<ReturnType<typeof getRoom>>>, now: number) {
  const elapsed = room.is_playing ? Math.max(0, (now - room.position_updated_at) / 1000) : 0;
  const position = Math.min(room.duration || Number.MAX_SAFE_INTEGER, room.position + elapsed);
  return {
    code: room.code,
    name: room.name,
    trackName: room.track_name,
    trackType: room.track_type,
    trackSize: room.track_size,
    duration: room.duration,
    isPlaying: Boolean(room.is_playing),
    position,
    positionUpdatedAt: room.position_updated_at,
    version: room.version,
    hostOnly: Boolean(room.host_only),
    reactionsEnabled: Boolean(room.reactions_enabled),
    expiresAt: room.expires_at,
    serverTime: now,
  };
}

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { code: rawCode } = await context.params;
    const code = normalizedCode(rawCode);
    const room = await getRoom(code);
    if (!room) return NextResponse.json({ error: 'Room not found.' }, { status: 404 });
    const now = Date.now();
    if (room.expires_at <= now) return NextResponse.json({ error: 'This room has expired.' }, { status: 410 });

    const [members, reactions] = await Promise.all([
      activeMembers(code, now - 18_000),
      recentReactions(code, now - 20_000),
    ]);

    return NextResponse.json({
      room: publicState(room, now),
      members: members.map((member) => ({
        id: member.id,
        displayName: member.display_name,
        isHost: Boolean(member.is_host),
      })),
      reactions: reactions.map((reaction) => ({
        id: reaction.id,
        memberName: reaction.member_name,
        emoji: reaction.emoji,
        createdAt: reaction.created_at,
      })),
    });
  } catch (error) {
    console.error('Read room failed', error);
    return NextResponse.json({ error: 'Room status is temporarily unavailable.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { code: rawCode } = await context.params;
    const code = normalizedCode(rawCode);
    const room = await getRoom(code);
    if (!room) return NextResponse.json({ error: 'Room not found.' }, { status: 404 });
    if (room.expires_at <= Date.now()) return NextResponse.json({ error: 'This room has expired.' }, { status: 410 });

    const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const memberId = request.headers.get('x-member-id') ?? '';
    const member = memberId ? await getMember(code, memberId) : null;
    const canControl = bearer === room.host_token || (!room.host_only && Boolean(member));
    if (!canControl) return NextResponse.json({ error: 'Only the host can control playback.' }, { status: 403 });

    const body = await request.json() as { isPlaying?: unknown; position?: unknown };
    if (typeof body.isPlaying !== 'boolean' || typeof body.position !== 'number' || !Number.isFinite(body.position)) {
      return NextResponse.json({ error: 'Invalid playback update.' }, { status: 400 });
    }
    const position = Math.max(0, Math.min(room.duration || Number.MAX_SAFE_INTEGER, body.position));
    const now = Date.now();
    await updatePlayback(code, body.isPlaying, position, now);
    const updated = await getRoom(code);
    if (!updated) throw new Error('Room disappeared after update');
    return NextResponse.json({ room: publicState(updated, now) });
  } catch (error) {
    console.error('Update room failed', error);
    return NextResponse.json({ error: 'Playback could not be updated.' }, { status: 500 });
  }
}
