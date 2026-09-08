// Bind Google's nonce to the caller's high-entropy app session. The old session
// is consumed atomically after verification, so a credential cannot be reused.
export const NONCE_WINDOW_MS = 5 * 60 * 1000;

export async function androidNonce(token: string, slot = Math.floor(Date.now() / NONCE_WINDOW_MS)) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`hearu:android-google:v1:${slot}:${token}`));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function androidNonces(token: string, now = Date.now()) {
  const slot = Math.floor(now / NONCE_WINDOW_MS);
  return Promise.all([androidNonce(token, slot), androidNonce(token, slot - 1)]);
}

export function requireMatchingNonce(nonce: unknown, expected: readonly string[]) {
  if (typeof nonce !== 'string' || !expected.length || !expected.includes(nonce)) {
    throw new Error('Google sign-in expired. Please try again.');
  }
}
