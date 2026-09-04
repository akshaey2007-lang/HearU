import { NextRequest, NextResponse } from 'next/server';

import { AUTH_COOKIE, SESSION_SECONDS, createUserSession, verifyGoogleCredential } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin) {
      return NextResponse.json({ error: 'Invalid sign-in origin.' }, { status: 403 });
    }

    const body = await request.json() as { credential?: unknown };
    if (typeof body.credential !== 'string' || body.credential.length > 10_000) {
      return NextResponse.json({ error: 'Google did not return a valid credential.' }, { status: 400 });
    }

    const user = await verifyGoogleCredential(body.credential);
    const token = await createUserSession(user);
    const response = NextResponse.json({ user });
    response.cookies.set(AUTH_COOKIE, token, {
      httpOnly: true,
      secure: new URL(request.url).protocol === 'https:',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_SECONDS,
    });
    return response;
  } catch (error) {
    console.error('Google sign-in failed', error);
    return NextResponse.json({ error: 'Google sign-in could not be verified.' }, { status: 401 });
  }
}
