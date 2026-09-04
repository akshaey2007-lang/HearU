import { NextRequest, NextResponse } from 'next/server';

import { createUserSession, type AuthUser } from '@/lib/auth';
import { corsPreflight, isGithubPagesRequest, withCorsHandler } from '@/lib/cors';

async function post(request: NextRequest) {
  try {
    if (!isGithubPagesRequest(request) && process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Guest sessions are only available to the HearU web app.' }, { status: 403 });
    }

    const id = crypto.randomUUID();
    const user: AuthUser = {
      id: `guest:${id}`,
      email: 'Web session',
      name: 'Listener',
      picture: null,
    };
    const token = await createUserSession(user);
    return NextResponse.json({ token, user }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Guest session creation failed', error);
    return NextResponse.json({ error: 'HearU could not start a web session.' }, { status: 500 });
  }
}

export const POST = withCorsHandler(post);
export const OPTIONS = corsPreflight;
