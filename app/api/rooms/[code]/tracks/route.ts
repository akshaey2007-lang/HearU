import { NextRequest, NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth';
import { corsPreflight, withCorsHandler } from '@/lib/cors';
import { addTrack, deleteTrack, getRoom, getRoomTracks, saveTrack, type TrackRecord } from '@/lib/rooms';

type Context = { params: Promise<{ code: string }> };

function normalizedCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

function cleanTrackName(value: FormDataEntryValue | null, fallback: string) {
  if (typeof value !== 'string') return fallback;
  return value.trim().replace(/\s+/g, ' ').slice(0, 100) || fallback;
}

async function post(request: NextRequest, context: Context) {
  let storageKey = '';
  try {
    if (!await requireUser(request)) return NextResponse.json({ error: 'Sign in to add songs.' }, { status: 401 });
    const { code: rawCode } = await context.params;
    const code = normalizedCode(rawCode);
    const room = await getRoom(code);
    if (!room) return NextResponse.json({ error: 'Room not found.' }, { status: 404 });
    if (room.expires_at <= Date.now()) return NextResponse.json({ error: 'This room has expired.' }, { status: 410 });

    const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!bearer || bearer !== room.host_token) return NextResponse.json({ error: 'Only the host can add songs.' }, { status: 403 });

    const tracks = await getRoomTracks(code);
    if (tracks.length >= 250) return NextResponse.json({ error: 'This room already has 250 songs.' }, { status: 409 });

    const form = await request.formData();
    const audio = form.get('audio');
    if (!audio || typeof audio === 'string' || audio.size === 0) {
      return NextResponse.json({ error: 'Choose an audio file first.' }, { status: 400 });
    }
    if (audio.size > 70 * 1024 * 1024) {
      return NextResponse.json({ error: 'Audio files must be 70 MB or smaller.' }, { status: 413 });
    }
    if (audio.type && !audio.type.startsWith('audio/')) {
      return NextResponse.json({ error: 'That file is not a supported audio format.' }, { status: 415 });
    }
    const requestedPosition = Number(form.get('position'));
    const position = Number.isInteger(requestedPosition) ? requestedPosition : tracks.length;
    if (position < 1 || position >= 250 || tracks.some((track) => track.position === position)) {
      return NextResponse.json({ error: 'That playlist position is unavailable.' }, { status: 409 });
    }

    const trackId = crypto.randomUUID();
    storageKey = `rooms/${code}/${trackId}`;
    const durationValue = Number(form.get('duration'));
    const track: TrackRecord = {
      id: trackId,
      room_code: code,
      storage_key: storageKey,
      name: cleanTrackName(form.get('trackName'), audio.name.replace(/\.[^/.]+$/, '') || 'Untitled song'),
      type: audio.type || 'audio/mpeg',
      size: audio.size,
      duration: Number.isFinite(durationValue) ? Math.max(0, durationValue) : 0,
      position,
      created_at: Date.now(),
    };

    await saveTrack(storageKey, audio);
    try {
      await addTrack(track);
    } catch (error) {
      await deleteTrack(storageKey);
      throw error;
    }

    return NextResponse.json({
      track: { id: track.id, name: track.name, duration: track.duration, position: track.position },
      count: tracks.length + 1,
    }, { status: 201 });
  } catch (error) {
    console.error('Add track failed', error);
    if (storageKey) await deleteTrack(storageKey).catch(() => undefined);
    return NextResponse.json({ error: 'The song could not be added. Please try again.' }, { status: 500 });
  }
}

export const POST = withCorsHandler(post);
export const OPTIONS = corsPreflight;
