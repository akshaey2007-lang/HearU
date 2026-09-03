import { env } from 'cloudflare:workers';

export type RoomRecord = {
  code: string;
  name: string;
  host_token: string;
  track_key: string;
  track_name: string;
  track_type: string;
  track_size: number;
  duration: number;
  is_playing: number;
  position: number;
  position_updated_at: number;
  version: number;
  host_only: number;
  reactions_enabled: number;
  created_at: number;
  expires_at: number;
};

export type MemberRecord = {
  room_code: string;
  id: string;
  display_name: string;
  is_host: number;
  last_seen: number;
};

export type ReactionRecord = {
  id: number;
  room_code: string;
  member_name: string;
  emoji: string;
  created_at: number;
};

type Bindings = {
  DB?: D1Database;
  MEDIA?: R2Bucket;
};

type StoredAudio = { bytes: Uint8Array; type: string };
type MemoryState = {
  rooms: Map<string, RoomRecord>;
  members: Map<string, MemberRecord>;
  reactions: ReactionRecord[];
  audio: Map<string, StoredAudio>;
  reactionId: number;
};

const memoryKey = '__hearu_memory_state__';

function bindings() {
  return env as unknown as Bindings;
}

function memory(): MemoryState {
  const root = globalThis as typeof globalThis & { [memoryKey]?: MemoryState };
  root[memoryKey] ??= {
    rooms: new Map(),
    members: new Map(),
    reactions: [],
    audio: new Map(),
    reactionId: 0,
  };
  return root[memoryKey];
}

function canUseLocalFallback() {
  return process.env.NODE_ENV !== 'production';
}

function memberKey(roomCode: string, memberId: string) {
  return `${roomCode}:${memberId}`;
}

export async function createRoom(room: RoomRecord, host: MemberRecord) {
  const db = bindings().DB;
  try {
    if (!db) throw new Error('DB binding unavailable');
    await db.batch([
      db.prepare(`
        INSERT INTO rooms (
          code, name, host_token, track_key, track_name, track_type, track_size,
          duration, is_playing, position, position_updated_at, version,
          host_only, reactions_enabled, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        room.code, room.name, room.host_token, room.track_key, room.track_name,
        room.track_type, room.track_size, room.duration, room.is_playing,
        room.position, room.position_updated_at, room.version, room.host_only,
        room.reactions_enabled, room.created_at, room.expires_at,
      ),
      db.prepare(`
        INSERT INTO members (room_code, id, display_name, is_host, last_seen)
        VALUES (?, ?, ?, ?, ?)
      `).bind(host.room_code, host.id, host.display_name, host.is_host, host.last_seen),
    ]);
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    memory().rooms.set(room.code, room);
    memory().members.set(memberKey(host.room_code, host.id), host);
  }
}

export async function getRoom(code: string): Promise<RoomRecord | null> {
  const db = bindings().DB;
  try {
    if (!db) throw new Error('DB binding unavailable');
    return await db.prepare('SELECT * FROM rooms WHERE code = ?').bind(code).first<RoomRecord>();
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    return memory().rooms.get(code) ?? null;
  }
}

export async function roomExists(code: string) {
  return Boolean(await getRoom(code));
}

export async function updatePlayback(code: string, isPlaying: boolean, position: number, updatedAt: number) {
  const db = bindings().DB;
  try {
    if (!db) throw new Error('DB binding unavailable');
    await db.prepare(`
      UPDATE rooms
      SET is_playing = ?, position = ?, position_updated_at = ?, version = version + 1
      WHERE code = ?
    `).bind(isPlaying ? 1 : 0, position, updatedAt, code).run();
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    const room = memory().rooms.get(code);
    if (room) memory().rooms.set(code, {
      ...room,
      is_playing: isPlaying ? 1 : 0,
      position,
      position_updated_at: updatedAt,
      version: room.version + 1,
    });
  }
}

export async function joinRoom(member: MemberRecord) {
  const db = bindings().DB;
  try {
    if (!db) throw new Error('DB binding unavailable');
    await db.prepare(`
      INSERT INTO members (room_code, id, display_name, is_host, last_seen)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(room_code, id) DO UPDATE SET
        display_name = excluded.display_name,
        last_seen = excluded.last_seen
    `).bind(member.room_code, member.id, member.display_name, member.is_host, member.last_seen).run();
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    memory().members.set(memberKey(member.room_code, member.id), member);
  }
}

export async function heartbeat(roomCode: string, memberId: string, now: number) {
  const db = bindings().DB;
  try {
    if (!db) throw new Error('DB binding unavailable');
    await db.prepare('UPDATE members SET last_seen = ? WHERE room_code = ? AND id = ?')
      .bind(now, roomCode, memberId).run();
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    const key = memberKey(roomCode, memberId);
    const member = memory().members.get(key);
    if (member) memory().members.set(key, { ...member, last_seen: now });
  }
}

export async function activeMembers(roomCode: string, since: number): Promise<MemberRecord[]> {
  const db = bindings().DB;
  try {
    if (!db) throw new Error('DB binding unavailable');
    const result = await db.prepare(`
      SELECT room_code, id, display_name, is_host, last_seen
      FROM members
      WHERE room_code = ? AND last_seen >= ?
      ORDER BY is_host DESC, last_seen DESC
    `).bind(roomCode, since).all<MemberRecord>();
    return result.results;
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    return [...memory().members.values()]
      .filter((member) => member.room_code === roomCode && member.last_seen >= since)
      .sort((a, b) => b.is_host - a.is_host || b.last_seen - a.last_seen);
  }
}

export async function getMember(roomCode: string, memberId: string): Promise<MemberRecord | null> {
  const db = bindings().DB;
  try {
    if (!db) throw new Error('DB binding unavailable');
    return await db.prepare(`
      SELECT room_code, id, display_name, is_host, last_seen
      FROM members
      WHERE room_code = ? AND id = ?
    `).bind(roomCode, memberId).first<MemberRecord>();
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    return memory().members.get(memberKey(roomCode, memberId)) ?? null;
  }
}

export async function addReaction(roomCode: string, memberName: string, emoji: string, createdAt: number) {
  const db = bindings().DB;
  try {
    if (!db) throw new Error('DB binding unavailable');
    await db.prepare(`
      INSERT INTO reactions (room_code, member_name, emoji, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(roomCode, memberName, emoji, createdAt).run();
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    const state = memory();
    state.reactions.push({ id: ++state.reactionId, room_code: roomCode, member_name: memberName, emoji, created_at: createdAt });
    state.reactions = state.reactions.slice(-50);
  }
}

export async function recentReactions(roomCode: string, since: number): Promise<ReactionRecord[]> {
  const db = bindings().DB;
  try {
    if (!db) throw new Error('DB binding unavailable');
    const result = await db.prepare(`
      SELECT id, room_code, member_name, emoji, created_at
      FROM reactions
      WHERE room_code = ? AND created_at >= ?
      ORDER BY created_at DESC
      LIMIT 8
    `).bind(roomCode, since).all<ReactionRecord>();
    return result.results;
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    return memory().reactions
      .filter((reaction) => reaction.room_code === roomCode && reaction.created_at >= since)
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 8);
  }
}

export async function saveTrack(key: string, file: File) {
  const bucket = bindings().MEDIA;
  try {
    if (!bucket) throw new Error('MEDIA binding unavailable');
    await bucket.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || 'audio/mpeg' },
      customMetadata: { filename: file.name },
    });
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    memory().audio.set(key, { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type || 'audio/mpeg' });
  }
}

export async function deleteTrack(key: string) {
  const bucket = bindings().MEDIA;
  try {
    if (!bucket) throw new Error('MEDIA binding unavailable');
    await bucket.delete(key);
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    memory().audio.delete(key);
  }
}

export async function readTrack(key: string, start?: number, length?: number) {
  const bucket = bindings().MEDIA;
  try {
    if (!bucket) throw new Error('MEDIA binding unavailable');
    const object = await bucket.get(key, start === undefined ? undefined : { range: { offset: start, length } });
    if (!object) return null;
    return { body: object.body as BodyInit, type: object.httpMetadata?.contentType ?? 'audio/mpeg' };
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    const object = memory().audio.get(key);
    if (!object) return null;
    const bytes = start === undefined ? object.bytes : object.bytes.slice(start, start + (length ?? object.bytes.length));
    return { body: bytes as BodyInit, type: object.type };
  }
}
