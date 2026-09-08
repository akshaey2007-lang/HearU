export type GoogleUser = { id: string; email: string; name: string; picture: string | null };
export type NativeBridge = { postMessage: (message: string) => void; onmessage?: (event: { data: string }) => void };

declare global {
  interface Window {
    HearUNative?: NativeBridge;
    hearuGoogleSignIn?: () => Promise<GoogleUser>;
    hearuGoogleSignOut?: () => Promise<void>;
  }
}

export function createNativeGoogleAuth(options: {
  bridge?: NativeBridge;
  getSession: () => Promise<string>;
  setSession: (token: string) => void;
  clearSession: () => void;
  send: (token: string, body: object) => Promise<Response>;
}) {
  const pending = new Map<string, { resolve: (value: { credential?: string }) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const bridge = options.bridge;
  if (bridge) bridge.onmessage = (event) => {
    let value: { id: string; credential?: string; error?: string };
    try { value = JSON.parse(event.data); } catch { return; }
    if (!value || typeof value.id !== 'string') return;
    const request = pending.get(value.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(value.id);
    if (value.error) request.reject(new Error(value.error)); else request.resolve(value);
  };
  function call(action: string, nonce?: string) {
    return new Promise<{ credential?: string }>((resolve, reject) => {
      if (!bridge) { reject(new Error('Update Android System WebView to use Google sign-in.')); return; }
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        bridge.postMessage(JSON.stringify({ id: crypto.randomUUID(), action: 'cancel' }));
        reject(new Error('Sign-in timed out. Please try again.'));
      }, action === 'signOut' ? 5000 : 180000);
      pending.set(id, { resolve, reject, timer });
      try { bridge.postMessage(JSON.stringify({ id, action, nonce })); }
      catch { clearTimeout(timer); pending.delete(id); reject(new Error('Google sign-in could not start.')); }
    });
  }
  async function exchange(token: string, body: object) {
    const response = await options.send(token, body);
    const value = await response.json().catch(() => ({})) as { nonce?: string; token?: string; user?: GoogleUser; error?: string };
    if (!response.ok) {
      if (response.status === 401) options.clearSession();
      throw new Error(value.error || 'Cannot reach Google sign-in. Check your connection and try again.');
    }
    return value;
  }
  let signingIn = false;
  let revision = 0;
  return {
    async signIn(): Promise<GoogleUser> {
      if (signingIn) throw new Error('A Google sign-in is already open.');
      signingIn = true;
      const started = ++revision;
      try {
        if (!bridge) throw new Error('Update Android System WebView to use Google sign-in.');
        const token = await options.getSession();
        const challenge = await exchange(token, { action: 'challenge' });
        if (!challenge.nonce || !/^[a-f0-9]{64}$/.test(challenge.nonce)) throw new Error('Google sign-in is not ready. Please try again later.');
        if (revision !== started) throw new Error('Sign-in cancelled.');
        const result = await call('signIn', challenge.nonce);
        if (revision !== started) throw new Error('Sign-in cancelled.');
        if (!result.credential) throw new Error('Google did not return an account.');
        const verified = await exchange(token, { action: 'verify', credential: result.credential });
        if (revision !== started) throw new Error('Sign-in cancelled.');
        if (!verified.token || !verified.user || verified.user.id.startsWith('guest:')) throw new Error('Google sign-in could not be completed.');
        options.setSession(verified.token);
        return verified.user;
      } finally { signingIn = false; }
    },
    async signOut() {
      ++revision;
      options.clearSession();
      await call('signOut').catch(() => undefined);
    },
  };
}
