// A bounded pool keeps uploads concurrent without exhausting mobile memory.
export async function mapConcurrent<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  let failure: unknown;
  let failed = false;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && cursor < items.length) {
      const index = cursor++;
      try { results[index] = await task(items[index], index); }
      catch (error) { failed = true; failure = error; }
    }
  }));
  // Drain in-flight work before aborting the multipart session.
  if (failed) throw failure;
  return results;
}

export type UploadTransport = (url: string, headers: Record<string, string>, body: Blob | FormData, progress: (loaded: number) => void, signal: AbortSignal, method?: 'PUT' | 'POST') => Promise<Response>;
declare global { interface Window { hearuUpload?: UploadTransport } }

export const xhrUpload: UploadTransport = (url, headers, body, progress, signal, method = 'PUT') => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  const xhr = new XMLHttpRequest();
  const abort = () => xhr.abort();
  const cleanup = () => signal.removeEventListener('abort', abort);
  xhr.open(method, url);
  xhr.timeout = 60000;
  Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
  xhr.upload.onprogress = (event) => progress(body instanceof Blob ? Math.min(body.size, event.loaded) : event.loaded);
  xhr.onload = () => { cleanup(); resolve(new Response(xhr.responseText, { status: xhr.status })); };
  xhr.onerror = () => { cleanup(); reject(new Error('The upload connection was interrupted.')); };
  xhr.ontimeout = () => { cleanup(); reject(new Error('The upload timed out.')); };
  xhr.onabort = () => { cleanup(); reject(new DOMException('Upload cancelled', 'AbortError')); };
  signal.addEventListener('abort', abort, { once: true });
  xhr.send(body);
});

export async function retryPart<T>(task: () => Promise<T>, signal: AbortSignal, attempts = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try { return await task(); }
    catch (error) {
      if (signal.aborted || attempt + 1 >= attempts || (error instanceof TransferError && !error.retryable)) throw error;
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 400 * 2 ** attempt);
        signal.addEventListener('abort', abort, { once: true });
      });
    }
  }
}

export class TransferError extends Error {
  retryable: boolean;
  constructor(message: string, retryable: boolean) { super(message); this.retryable = retryable; }
}

// Every metadata decoder is released before a worker opens the next file.
export function readAudioDuration(url: string, signal: AbortSignal): Promise<number> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(0); return; }
    const audio = new Audio();
    const finish = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute('src');
      audio.load();
      resolve(duration);
    };
    const timer = setTimeout(finish, 8000);
    signal.addEventListener('abort', finish, { once: true });
    audio.preload = 'metadata';
    audio.onloadedmetadata = finish;
    audio.onerror = finish;
    audio.src = url;
  });
}
