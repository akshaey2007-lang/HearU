import { NextRequest, NextResponse } from 'next/server';

import { AUTH_COOKIE, deleteUserSession, getUserSession } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const user = await getUserSession(request.cookies.get(AUTH_COOKIE)?.value);
  return user
    ? NextResponse.json({ user }, { headers: { 'Cache-Control': 'no-store' } })
    : NextResponse.json({ user: null }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE(request: NextRequest) {
  await deleteUserSession(request.cookies.get(AUTH_COOKIE)?.value);
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
