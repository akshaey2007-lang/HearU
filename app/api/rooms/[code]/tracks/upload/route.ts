import { NextRequest, NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth';
import {
  abortTrackUpload,
  addTrack,
  beginTrackUpload,
  completeTrackUpload,
  deleteTrack,
  getRoom,
  getRoomTracks,
  uploadTrackPart,
  type TrackRecord,
} from '@/lib/rooms';

type Context = { params: Promise<{ code: string }> };
type UploadedPart = { partNumber: number; etag: string };
type UploadBody = {
  action?: unknown;
  trackId?: unknown;
  uploadId?: unknown;
  name?: unknown;
  type?: unknown;
  size?: unknown;
  duration?: unknown;
  position?: unknown;
  parts?: unknown;
};

const MAX_FILE_BYTES = 70 * 1024 * 1024;
const MAX_PART_BYTES = 5 * 1024 * 1024 + 1024;

function normalizedCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

function validTrackId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validUploadId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 8 && value.length <= 1024;
}

function trackMetadata(body: UploadBody) {
  const size = Number(body.size);
  const duration = Number(body.duration);
  const position = Number(body.position);
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ').slice(0, 100) : '';
  const type = typeof body.type === 'string' && body.type.startsWith('audio/') ? body.type.slice(0, 100) : 'audio/mpeg';

  if (!name || !Number.isInteger(size) || size <= 0 || size > MAX_FILE_BYTES) return null;
  if (!Number.isInteger(position) || position < 0 || position >= 250) return null;
  return { name, type, size, duration: Number.isFinite(duration) ? Math.max(0, duration) : 0, position };
}

function uploadedParts(value: unknown): UploadedPart[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 20) return null;
  const parts = value.map((part) => {
    const item = part as { partNumber?: unknown; etag?: unknown };
    return { partNumber: Number(item.partNumber), etag: item.etag };
  });
  if (parts.some((part) => !Number.isInteger(part.partNumber) || part.partNumber < 1 || part.partNumber > 20 || typeof part.etag !== 'string' || !part.etag || part.etag.length > 256)) return null;
  if (new Set(parts.map((part) => part.partNumber)).size !== parts.length) return null;
  return parts.sort((a, b) => a.partNumber - b.partNumber) as UploadedPart[];
}

async function authorizedRoom(request: NextRequest, context: Context) {
  if (!await requireUser(request)) return { response: NextResponse.json({ error: 'Sign in to add songs.' }, { status: 401 }) };
  const { code: rawCode } = await context.params;
  const code = normalizedCode(rawCode);
  const room = await getRoom(code);
  if (!room) return { response: NextResponse.json({ error: 'Room not found.' }, { status: 404 }) };
  if (room.expires_at <= Date.now()) return { response: NextResponse.json({ error: 'This room has expired.' }, { status: 410 }) };
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!bearer || bearer !== room.host_token) return { response: NextResponse.json({ error: 'Only the host can add songs.' }, { status: 403 }) };
  return { code, room };
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const authorization = await authorizedRoom(request, context);
    if ('response' in authorization) return authorization.response;
    const { code } = authorization;
    const body = await request.json() as UploadBody;
    const metadata = trackMetadata(body);
    if (!metadata) return NextResponse.json({ error: 'That song cannot be uploaded.' }, { status: 400 });

    if (body.action === 'start') {
      const tracks = await getRoomTracks(code);
      if (tracks.length >= 250) return NextResponse.json({ error: 'This room already has 250 songs.' }, { status: 409 });
      if (tracks.some((track) => track.position === metadata.position)) return NextResponse.json({ error: 'That playlist position is unavailable.' }, { status: 409 });

      const trackId = crypto.randomUUID();
      const upload = await beginTrackUpload(`rooms/${code}/${trackId}`, metadata.name, metadata.type);
      return NextResponse.json({ trackId, uploadId: upload.uploadId }, { status: 201 });
    }

    if (body.action === 'complete') {
      if (!validTrackId(body.trackId) || !validUploadId(body.uploadId)) return NextResponse.json({ error: 'The upload session is invalid.' }, { status: 400 });
      const parts = uploadedParts(body.parts);
      if (!parts || parts.length !== Math.ceil(metadata.size / (5 * 1024 * 1024))) return NextResponse.json({ error: 'The song upload is incomplete.' }, { status: 400 });

      const tracks = await getRoomTracks(code);
      if (tracks.length >= 250) return NextResponse.json({ error: 'This room already has 250 songs.' }, { status: 409 });
      if (tracks.some((track) => track.position === metadata.position)) return NextResponse.json({ error: 'That playlist position is unavailable.' }, { status: 409 });

      const storageKey = `rooms/${code}/${body.trackId}`;
      const object = await completeTrackUpload(storageKey, body.uploadId, parts);
      if (object.size !== metadata.size) {
        await deleteTrack(storageKey);
        return NextResponse.json({ error: 'The uploaded song size did not match the selected file.' }, { status: 400 });
      }
      const track: TrackRecord = {
        id: body.trackId,
        room_code: code,
        storage_key: storageKey,
        name: metadata.name,
        type: metadata.type,
        size: metadata.size,
        duration: metadata.duration,
        position: metadata.position,
        created_at: Date.now(),
      };
      try {
        await addTrack(track);
      } catch (error) {
        await deleteTrack(storageKey);
        throw error;
      }
      return NextResponse.json({ track: { id: track.id, name: track.name, duration: track.duration, position: track.position } }, { status: 201 });
    }

    return NextResponse.json({ error: 'Unknown upload action.' }, { status: 400 });
  } catch (error) {
    console.error('Multipart track upload failed', error);
    return NextResponse.json({ error: 'The song could not be uploaded. Please try again.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: Context) {
  try {
    const authorization = await authorizedRoom(request, context);
    if ('response' in authorization) return authorization.response;
    const { code } = authorization;
    const trackId = request.nextUrl.searchParams.get('trackId');
    const uploadId = request.nextUrl.searchParams.get('uploadId');
    const partNumber = Number(request.nextUrl.searchParams.get('partNumber'));
    if (!validTrackId(trackId) || !validUploadId(uploadId) || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 20) {
      return NextResponse.json({ error: 'The upload part is invalid.' }, { status: 400 });
    }

    const body = await request.arrayBuffer();
    if (!body.byteLength || body.byteLength > MAX_PART_BYTES) return NextResponse.json({ error: 'The upload part is too large.' }, { status: 413 });
    const part = await uploadTrackPart(`rooms/${code}/${trackId}`, uploadId, partNumber, body);
    return NextResponse.json({ partNumber: part.partNumber, etag: part.etag });
  } catch (error) {
    console.error('Track upload part failed', error);
    return NextResponse.json({ error: 'A song upload part failed. Please try again.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const authorization = await authorizedRoom(request, context);
    if ('response' in authorization) return authorization.response;
    const { code } = authorization;
    const trackId = request.nextUrl.searchParams.get('trackId');
    const uploadId = request.nextUrl.searchParams.get('uploadId');
    if (!validTrackId(trackId) || !validUploadId(uploadId)) return NextResponse.json({ error: 'The upload session is invalid.' }, { status: 400 });
    await abortTrackUpload(`rooms/${code}/${trackId}`, uploadId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Abort track upload failed', error);
    return NextResponse.json({ error: 'The upload could not be cancelled.' }, { status: 500 });
  }
}
