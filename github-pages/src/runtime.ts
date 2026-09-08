import { xhrUpload } from '../../lib/client-transfer';
import { createNativeGoogleAuth } from '../../lib/native-google';

const API_ORIGIN = 'https://hearu-listen-together.akshaey2007.chatgpt.site';
const SESSION_KEY = 'hearu-github-web-session';
const nativeFetch = window.fetch.bind(window);

let sessionRequest: Promise<string> | null = null;

function savedSession() {
  try {
    return window.localStorage.getItem(SESSION_KEY) || '';
  } catch {
    return '';
  }
}

function saveSession(token: string) {
  try {
    window.localStorage.setItem(SESSION_KEY, token);
  } catch {
    // The session still works until this tab is closed when storage is unavailable.
  }
}

function clearSession() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing else is required when storage is unavailable.
  }
  sessionRequest = null;
}

async function createSession(force = false, staleToken?: string) {
  // A delayed guest request must not replace a newly verified Google session.
  if (force && (!staleToken || !savedSession() || savedSession() === staleToken)) clearSession();
  const existing = savedSession();
  if (existing) return existing;
  if (!sessionRequest) {
    sessionRequest = nativeFetch(`${API_ORIGIN}/api/auth/guest`, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    }).then(async (response) => {
      const result = await response.json() as { token?: string; error?: string };
      if (!response.ok || !result.token) throw new Error(result.error || 'HearU could not start a web session.');
      saveSession(result.token);
      return result.token;
    }).catch((error) => {
      sessionRequest = null;
      throw error;
    });
  }
  return sessionRequest;
}

function apiTarget(input: RequestInfo | URL) {
  const value = typeof input === 'string' || input instanceof URL ? input.toString() : input.url;
  const source = new URL(value, window.location.href);
  if (source.origin !== window.location.origin || !source.pathname.startsWith('/api/')) return null;
  return new URL(`${source.pathname}${source.search}`, API_ORIGIN).toString();
}

async function webFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const target = apiTarget(input);
  if (!target) return nativeFetch(input, init);

  const send = async (token: string) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    headers.set('X-HearU-Session', `Bearer ${token}`);
    return nativeFetch(target, { ...init, headers });
  };

  const token = await createSession();
  let response = await send(token);
  if (response.status === 401) response = await send(await createSession(true, token));
  if (new URL(target).pathname === '/api/auth/me' && (init.method || 'GET').toUpperCase() === 'DELETE') clearSession();
  return response;
}

window.fetch = webFetch as typeof window.fetch;

window.hearuUpload = async (url, headers, body, progress, signal, method) => {
  const send = async (token: string) => xhrUpload(apiTarget(url) || url, { ...headers, 'X-HearU-Session': `Bearer ${token}` }, body, progress, signal, method);
  const token = await createSession();
  let response = await send(token);
  if (response.status === 401) response = await send(await createSession(true, token));
  return response;
};

if (window.location.pathname === '/HearU/_android/android.html') {
  const auth = createNativeGoogleAuth({
    bridge: window.HearUNative,
    getSession: () => createSession(),
    setSession: (token) => { saveSession(token); sessionRequest = Promise.resolve(token); },
    clearSession,
    send: (token, body) => nativeFetch(`${API_ORIGIN}/api/auth/android`, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', 'X-HearU-Session': `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
  });
  window.hearuGoogleSignIn = auth.signIn;
  window.hearuGoogleSignOut = auth.signOut;
}
