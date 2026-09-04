import { NextRequest, NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth';
import { getRoom, readTrack } from '@/lib/rooms';

type Context = { params: Promise<{ code: string }> };

export async function GET(request: NextRequest, context: Context) {
  try {
    if (!await requireUser(request)) return NextResponse.json({ error: 'Sign in to listen.' }, { status: 401 });
    const { code: rawCode } = await context.params;
    const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    const room = await getRoom(code);
    if (!room) return NextResponse.json({ error: 'Room not found.' }, { status: 404 });
    if (room.expires_at <= Date.now()) return NextResponse.json({ error: 'This room has expired.' }, { status: 410 });

    const rangeHeader = request.headers.get('range');
    let start: number | undefined;
    let end: number | undefined;
    if (rangeHeader) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
      if (!match) return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${room.track_size}` } });
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), room.track_size - 1) : room.track_size - 1;
      if (start >= room.track_size || end < start) {
        return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${room.track_size}` } });
      }
    }

    const length = start === undefined ? undefined : (end as number) - start + 1;
    const audio = await readTrack(room.track_key, start, length);
    if (!audio) return NextResponse.json({ error: 'Audio is unavailable.' }, { status: 404 });

    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=300',
      'Content-Type': audio.type,
      'Content-Length': String(length ?? room.track_size),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(room.track_name)}`,
    });
    if (start !== undefined) headers.set('Content-Range', `bytes ${start}-${end}/${room.track_size}`);
    return new NextResponse(audio.body, { status: start === undefined ? 200 : 206, headers });
  } catch (error) {
    console.error('Audio stream failed', error);
    return NextResponse.json({ error: 'Audio could not be streamed.' }, { status: 500 });
  }
}
