import { env } from 'cloudflare:workers';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const GOOGLE_CLIENT_ID = '922402174418-9vcvmgb1u6al78delh4u9j482ulrtqc2.apps.googleusercontent.com';
export const AUTH_COOKIE = 'hearu_auth';
export const SESSION_SECONDS = 30 * 24 * 60 * 60;

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  picture: string | null;
};

type SessionRecord = AuthUser & {
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
};

type Bindings = { DB?: D1Database; GOOGLE_CLIENT_ID?: string };
const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const memoryKey = '__hearu_auth_sessions__';

function bindings() {
  return env as unknown as Bindings;
}

function sessions() {
  const root = globalThis as typeof globalThis & { [memoryKey]?: Map<string, SessionRecord> };
  root[memoryKey] ??= new Map();
  return root[memoryKey];
}

function canUseLocalFallback() {
  return process.env.NODE_ENV !== 'production';
}

function configuredClientId() {
  return bindings().GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyGoogleCredential(credential: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(credential, jwks, {
    audience: configuredClientId(),
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    algorithms: ['RS256'],
  });

  if (!payload.sub || typeof payload.email !== 'string' || payload.email_verified !== true) {
    throw new Error('Google account email is not verified');
  }

  return {
    id: payload.sub,
    email: payload.email,
    name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 80) : payload.email.split('@')[0],
    picture: typeof payload.picture === 'string' && payload.picture.startsWith('https://') ? payload.picture : null,
  };
}

export async function createUserSession(user: AuthUser) {
  const token = randomToken();
  const tokenHash = await hashToken(token);
  const now = Date.now();
  const record: SessionRecord = { ...user, tokenHash, createdAt: now, expiresAt: now + SESSION_SECONDS * 1000 };
  const db = bindings().DB;

  try {
    if (!db) throw new Error('DB binding unavailable');
    await db.prepare(`
      INSERT INTO user_sessions (token_hash, google_sub, email, name, picture, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(record.tokenHash, record.id, record.email, record.name, record.picture, record.createdAt, record.expiresAt).run();
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    sessions().set(tokenHash, record);
  }

  return token;
}

export async function getUserSession(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const now = Date.now();
  const db = bindings().DB;

  try {
    if (!db) throw new Error('DB binding unavailable');
    const result = await db.prepare(`
      SELECT google_sub, email, name, picture
      FROM user_sessions
      WHERE token_hash = ? AND expires_at > ?
    `).bind(tokenHash, now).first<{ google_sub: string; email: string; name: string; picture: string | null }>();
    return result ? { id: result.google_sub, email: result.email, name: result.name, picture: result.picture } : null;
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    const result = sessions().get(tokenHash);
    if (!result || result.expiresAt <= now) return null;
    return { id: result.id, email: result.email, name: result.name, picture: result.picture };
  }
}

export async function deleteUserSession(token: string | undefined) {
  if (!token) return;
  const tokenHash = await hashToken(token);
  const db = bindings().DB;
  try {
    if (!db) throw new Error('DB binding unavailable');
    await db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').bind(tokenHash).run();
  } catch (error) {
    if (!canUseLocalFallback()) throw error;
    sessions().delete(tokenHash);
  }
}

export async function requireUser(request: Request) {
  const cookie = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${AUTH_COOKIE}=`));
  const token = cookie ? decodeURIComponent(cookie.slice(AUTH_COOKIE.length + 1)) : undefined;
  return getUserSession(token);
}
