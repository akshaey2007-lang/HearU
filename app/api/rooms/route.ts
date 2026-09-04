import { NextRequest, NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth';
import { createRoom, roomExists, type MemberRecord, type RoomRecord } from '@/lib/rooms';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cleanText(value: FormDataEntryValue | null, fallback: string, maxLength: number) {
  if (typeof value !== 'string') return fallback;
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength) || fallback;
}

export async function POST(request: NextRequest) {
  try {
    if (!await requireUser(request)) return NextResponse.json({ error: 'Sign in to create a room.' }, { status: 401 });
    const form = await request.formData();

    let code = randomCode();
    for (let attempt = 0; attempt < 5 && await roomExists(code); attempt += 1) code = randomCode();
    if (await roomExists(code)) throw new Error('Unable to allocate a room code');

    const now = Date.now();
    const hostToken = randomToken();
    const memberId = crypto.randomUUID();
    const room: RoomRecord = {
      code,
      name: cleanText(form.get('roomName'), 'Listening room', 32),
      host_token: hostToken,
      track_key: '',
      track_name: '',
      track_type: 'audio/mpeg',
      track_size: 0,
      current_track_id: null,
      duration: 0,
      is_playing: 0,
      position: 0,
      position_updated_at: now,
      version: 0,
      host_only: form.get('hostOnly') === 'true' ? 1 : 0,
      reactions_enabled: form.get('reactionsEnabled') === 'false' ? 0 : 1,
      created_at: now,
      expires_at: now + 6 * 60 * 60 * 1000,
    };
    const host: MemberRecord = {
      room_code: code,
      id: memberId,
      display_name: cleanText(form.get('displayName'), 'Host', 24),
      is_host: 1,
      last_seen: now,
    };
    await createRoom(room, host);

    return NextResponse.json({
      room: { code, name: room.name },
      hostToken,
      memberId,
      displayName: host.display_name,
    }, { status: 201 });
  } catch (error) {
    console.error('Create room failed', error);
    return NextResponse.json({ error: 'The room could not be created. Please try again.' }, { status: 500 });
  }
}
