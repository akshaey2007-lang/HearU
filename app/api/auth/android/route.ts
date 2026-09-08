import { NextResponse } from 'next/server';
import { androidNonces } from '@/lib/android-auth';
import { consumeUserSession, createUserSession, getUserSession, verifyGoogleCredential } from '@/lib/auth';
import { corsPreflight, isGithubPagesRequest, withCorsHandler } from '@/lib/cors';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export const POST = withCorsHandler(async (request: Request) => {
  if (!isGithubPagesRequest(request)) return json({ error: 'Origin is not allowed.' }, 403);
  const token = request.headers.get('x-hearu-session')?.replace(/^Bearer\s+/i, '').trim();
  if (!token || token.length > 128 || !await getUserSession(token)) return json({ error: 'Please try signing in again.' }, 401);
  const raw = await request.text();
  if (raw.length > 12000) return json({ error: 'Sign-in request is too large.' }, 413);
  let body: { action?: string; credential?: string };
  try { body = JSON.parse(raw); } catch { return json({ error: 'Invalid sign-in request.' }, 400); }
  if (!body || typeof body !== 'object') return json({ error: 'Invalid sign-in request.' }, 400);
  const nonces = await androidNonces(token);
  if (body.action === 'challenge') return json({ nonce: nonces[0] });
  if (body.action !== 'verify' || typeof body.credential !== 'string' || !body.credential || body.credential.length > 10000) {
    return json({ error: 'A Google credential is required.' }, 400);
  }
  let user;
  try { user = await verifyGoogleCredential(body.credential, nonces); }
  catch { return json({ error: 'Google could not verify this sign-in. Please try again.' }, 400); }
  if (!await consumeUserSession(token)) return json({ error: 'This sign-in was already used. Please try again.' }, 401);
  const nextToken = await createUserSession(user);
  return json({ user, token: nextToken });
});

export const OPTIONS = corsPreflight;
