import { NextRequest, NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth';
import { corsPreflight, isGithubPagesRequest, withCorsHandler } from '@/lib/cors';
import { getRoom, getRoomTrack, readTrack } from '@/lib/rooms';

type Context = { params: Promise<{ code: string }> };

async function get(request: NextRequest, context: Context) {
  try {
    if (!isGithubPagesRequest(request) && !await requireUser(request)) return NextResponse.json({ error: 'Sign in to listen.' }, { status: 401 });
    const { code: rawCode } = await context.params;
    const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    const room = await getRoom(code);
    if (!room) return NextResponse.json({ error: 'Room not found.' }, { status: 404 });
    if (room.expires_at <= Date.now()) return NextResponse.json({ error: 'This room has expired.' }, { status: 410 });
    const requestedTrackId = request.nextUrl.searchParams.get('track') || room.current_track_id;
    const track = await getRoomTrack(code, requestedTrackId);
    if (!track) return NextResponse.json({ error: 'Song not found.' }, { status: 404 });

    const rangeHeader = request.headers.get('range');
    let start: number | undefined;
    let end: number | undefined;
    if (rangeHeader) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
      if (!match) return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${track.size}` } });
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), track.size - 1) : track.size - 1;
      if (start >= track.size || end < start) {
        return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${track.size}` } });
      }
    }

    const length = start === undefined ? undefined : (end as number) - start + 1;
    const audio = await readTrack(track.storage_key, start, length);
    if (!audio) return NextResponse.json({ error: 'Audio is unavailable.' }, { status: 404 });

    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=300',
      'Content-Type': audio.type,
      'Content-Length': String(length ?? track.size),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(track.name)}`,
    });
    if (start !== undefined) headers.set('Content-Range', `bytes ${start}-${end}/${track.size}`);
    return new NextResponse(audio.body, { status: start === undefined ? 200 : 206, headers });
  } catch (error) {
    console.error('Audio stream failed', error);
    return NextResponse.json({ error: 'Audio could not be streamed.' }, { status: 500 });
  }
}

export const GET = withCorsHandler(get);
export const OPTIONS = corsPreflight;
