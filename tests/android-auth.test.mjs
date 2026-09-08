import { test } from 'node:test';
import assert from 'node:assert/strict';
import { androidNonce, androidNonces, NONCE_WINDOW_MS, requireMatchingNonce } from '../lib/android-auth.ts';

test('Android challenge is session-bound, deterministic and time-limited', async () => {
  const token = 'a'.repeat(64);
  const current = await androidNonce(token, 100);
  assert.match(current, /^[a-f0-9]{64}$/);
  assert.equal(await androidNonce(token, 100), current);
  assert.notEqual(await androidNonce('b'.repeat(64), 100), current);
  requireMatchingNonce(current, await androidNonces(token, 101 * NONCE_WINDOW_MS));
  assert.throws(() => requireMatchingNonce(current, []));
  const stale = await androidNonces(token, 102 * NONCE_WINDOW_MS);
  assert.throws(() => requireMatchingNonce(current, stale));
  const other = await androidNonces('b'.repeat(64), 100 * NONCE_WINDOW_MS);
  assert.throws(() => requireMatchingNonce(current, other));
});

test('missing, malformed and attacker-selected nonces are rejected', () => {
  for (const nonce of [undefined, null, {}, '', 123, 'attacker']) {
    assert.throws(() => requireMatchingNonce(nonce, ['expected']));
  }
});
