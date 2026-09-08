import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNativeGoogleAuth } from '../lib/native-google.ts';

function fixture({ nativeError, serverStatus = 200 } = {}) {
  let saved = 'guest-token';
  const messages = [];
  const exchanges = [];
  const bridge = {
    postMessage(raw) {
      const message = JSON.parse(raw);
      messages.push(message);
      queueMicrotask(() => bridge.onmessage({ data: JSON.stringify({ id: message.id,
        ...(message.action === 'signIn' ? nativeError ? { error: nativeError } : { credential: 'google-id-token' } : {}),
      }) }));
    },
  };
  const user = { id: 'google-subject', name: 'Listener', email: 'listener@example.test', picture: null };
  const auth = createNativeGoogleAuth({
    bridge, getSession: async () => saved,
    setSession: token => { saved = token; }, clearSession: () => { saved = ''; },
    send: async (token, body) => {
      exchanges.push({ token, body });
      return Response.json(body.action === 'challenge' ? { nonce: 'a'.repeat(64) }
        : serverStatus === 200 ? { token: 'google-session', user } : { error: 'Verification failed' },
      { status: body.action === 'challenge' ? 200 : serverStatus });
    },
  });
  return { auth, user, messages, exchanges, saved: () => saved };
}

test('Google signup upgrades only after server verification using the same session challenge', async () => {
  const f = fixture();
  assert.deepEqual(await f.auth.signIn(), f.user);
  assert.equal(f.saved(), 'google-session');
  assert.equal(f.messages[0].nonce, 'a'.repeat(64));
  assert.deepEqual(f.exchanges.map(item => item.token), ['guest-token', 'guest-token']);
  assert.equal(f.exchanges[1].body.credential, 'google-id-token');
  await f.auth.signOut();
  assert.equal(f.saved(), '');
  assert.equal(f.messages.at(-1).action, 'signOut');
});

test('cancelling preserves the local session and permits retry', async () => {
  const f = fixture({ nativeError: 'Sign-in cancelled.' });
  await assert.rejects(f.auth.signIn(), /cancelled/);
  assert.equal(f.saved(), 'guest-token');
  assert.equal(f.exchanges.length, 1);
  await assert.rejects(f.auth.signIn(), /cancelled/);
});

test('server rejection cannot turn a guest into a Google account', async () => {
  const f = fixture({ serverStatus: 400 });
  await assert.rejects(f.auth.signIn(), /Verification failed/);
  assert.equal(f.saved(), 'guest-token');
});

test('expired sessions are cleared and duplicate taps do not launch multiple account pickers', async () => {
  const f = fixture({ serverStatus: 401 });
  const first = f.auth.signIn();
  await assert.rejects(f.auth.signIn(), /already open/);
  await assert.rejects(first, /Verification failed/);
  assert.equal(f.saved(), '');
  assert.equal(f.messages.filter(item => item.action === 'signIn').length, 1);
});

test('missing native support fails clearly without starting a web OAuth popup', async () => {
  const auth = createNativeGoogleAuth({ getSession: async () => { throw new Error('Unexpected network call'); },
    setSession() {}, clearSession() {}, send: async () => { throw new Error('Unexpected network call'); } });
  await assert.rejects(auth.signIn(), /Update Android System WebView/);
});
