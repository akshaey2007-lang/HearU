import { NextRequest, NextResponse } from 'next/server';

import { AUTH_COOKIE, deleteUserSession, getUserSession } from '@/lib/auth';
import { corsPreflight, withCorsHandler } from '@/lib/cors';

async function get(request: NextRequest) {
  const webSession = request.headers.get('x-hearu-session')?.replace(/^Bearer\s+/i, '').trim();
  const user = await getUserSession(webSession || request.cookies.get(AUTH_COOKIE)?.value);
  return user
    ? NextResponse.json({ user }, { headers: { 'Cache-Control': 'no-store' } })
    : NextResponse.json({ user: null }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
}

async function remove(request: NextRequest) {
  const webSession = request.headers.get('x-hearu-session')?.replace(/^Bearer\s+/i, '').trim();
  await deleteUserSession(webSession || request.cookies.get(AUTH_COOKIE)?.value);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE, '', {
    httpOnly: true,
    secure: new URL(request.url).protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}

export const GET = withCorsHandler(get);
export const DELETE = withCorsHandler(remove);
export const OPTIONS = corsPreflight;
