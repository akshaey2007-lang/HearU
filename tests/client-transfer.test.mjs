import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapConcurrent, retryPart, TransferError, readAudioDuration } from '../lib/client-transfer.ts';

test('chunks overlap, remain bounded, and complete in playlist/part order', async () => {
  let active = 0, peak = 0;
  const results = await mapConcurrent([60, 10, 30, 5, 5, 5], 3, async (ms, index) => {
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, ms));
    active--;
    return index;
  });
  assert.equal(peak, 3);
  assert.equal(active, 0);
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5]);
});

test('failed uploads drain in-flight parts before cleanup and stop scheduling', async () => {
  let active = 0, started = 0;
  await assert.rejects(mapConcurrent([0, 1, 2, 3, 4], 2, async (index) => {
    active++; started++;
    try { await new Promise((resolve) => setTimeout(resolve, index ? 40 : 5)); if (!index) throw new Error('failure'); }
    finally { active--; }
  }), /failure/);
  assert.equal(active, 0);
  assert.equal(started, 2);
});

test('retries a transient part, but never retries permission/size errors', async () => {
  let calls = 0;
  assert.equal(await retryPart(async () => { if (++calls < 2) throw new Error('network'); return 'etag'; }, new AbortController().signal), 'etag');
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(retryPart(async () => { calls++; throw new TransferError('too large', false); }, new AbortController().signal), /too large/);
  assert.equal(calls, 1);
});

test('cancellation interrupts retry backoff without starting another request', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = retryPart(async () => { calls++; throw new Error('network'); }, controller.signal);
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending);
  assert.equal(calls, 1);
});

test('250 metadata probes never exceed two decoders and all are released', async () => {
  let active = 0, peak = 0, released = 0;
  globalThis.Audio = class {
    duration = 123;
    constructor() { peak = Math.max(peak, ++active); }
    set src(value) { setTimeout(() => this.onloadedmetadata?.(), 1); }
    removeAttribute() { active--; released++; }
    load() {}
  };
  const results = await mapConcurrent(Array.from({length:250}, (_, i) => `blob:${i}`), 2, (url) => readAudioDuration(url, new AbortController().signal));
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.equal(released, 250);
  assert.ok(results.every((value) => value === 123));
  delete globalThis.Audio;
});
