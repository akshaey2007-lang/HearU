import { NextResponse } from 'next/server';

export const GITHUB_PAGES_ORIGIN = 'https://akshaey2007-lang.github.io';

function allowedOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (origin === GITHUB_PAGES_ORIGIN || origin === new URL(request.url).origin) return origin;
  if (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

export function isGithubPagesRequest(request: Request) {
  return request.headers.get('origin') === GITHUB_PAGES_ORIGIN;
}

export function withCors(request: Request, response: Response) {
  const origin = allowedOrigin(request);
  if (!origin) return response;
  response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.append('Vary', 'Origin');
  response.headers.set('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range');
  return response;
}

export function corsPreflight(request: Request) {
  const origin = allowedOrigin(request);
  if (!origin) return NextResponse.json({ error: 'Origin is not allowed.' }, { status: 403 });
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range, X-HearU-Session, X-Member-Id',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  });
}

export function withCorsHandler<TRequest extends Request, TArgs extends unknown[]>(
  handler: (request: TRequest, ...args: TArgs) => Promise<Response>,
) {
  return async (request: TRequest, ...args: TArgs) => withCors(request, await handler(request, ...args));
}
