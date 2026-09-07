'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject, type ReactNode } from 'react';
import {
  ArrowLeft,
  AudioLines,
  Check,
  ChevronRight,
  Copy,
  FileAudio,
  FolderOpen,
  Heart,
  Home as HomeIcon,
  Library,
  Link2,
  Loader2,
  LockKeyhole,
  Moon,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Share2,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sparkles,
  Sun,
  Upload,
  Users,
  Volume2,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { mapConcurrent, readAudioDuration, retryPart, TransferError, xhrUpload } from '@/lib/client-transfer';

type Screen = 'home' | 'library' | 'create' | 'room';
type Role = 'host' | 'listener';
type ThemeMode = 'dark' | 'light';
type AuthUser = { id: string; email: string; name: string; picture: string | null };

type GoogleIdentity = {
  accounts: {
    id: {
      initialize: (options: { client_id: string; callback: (response: { credential?: string }) => void; auto_select?: boolean; cancel_on_tap_outside?: boolean }) => void;
      renderButton: (parent: HTMLElement, options: { theme: string; size: string; shape: string; text: string; width: number }) => void;
      cancel: () => void;
    };
  };
};

declare global {
  interface Window { google?: GoogleIdentity }
}

type SelectedTrack = {
  id: string;
  file: File;
  title: string;
  duration: number;
  previewUrl: string;
};

type Session = {
  code: string;
  role: Role;
  memberId: string;
  displayName: string;
  hostToken?: string;
};

type RoomState = {
  code: string;
  name: string;
  currentTrackId: string;
  trackName: string;
  trackType: string;
  trackSize: number;
  duration: number;
  isPlaying: boolean;
  position: number;
  version: number;
  hostOnly: boolean;
  reactionsEnabled: boolean;
  expiresAt: number;
  serverTime: number;
};

type Member = { id: string; displayName: string; isHost: boolean };
type Reaction = { id: number; memberName: string; emoji: string; createdAt: number };
type RoomTrack = { id: string; name: string; type: string; size: number; duration: number; position: number };
type RoomPayload = { room: RoomState; tracks: RoomTrack[]; members: Member[]; reactions: Reaction[] };
type InviteStatus = 'idle' | 'copied' | 'shared';
type LocalPlayerController = {
  activeIndex: number;
  isPlaying: boolean;
  position: number;
  duration: number;
  expanded: boolean;
  open: (index: number) => void;
  close: () => void;
  toggle: () => void;
  seek: (value: number) => void;
  previous: () => void;
  next: () => void;
};
type LocalFileHandle = { kind: 'file'; name: string; getFile: () => Promise<File> };
type LocalDirectoryHandle = {
  kind: 'directory';
  name: string;
  values: () => AsyncIterableIterator<LocalFileHandle | LocalDirectoryHandle>;
  queryPermission?: (options: { mode: 'read' }) => Promise<PermissionState>;
};
type LocalDirectoryWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' }) => Promise<LocalDirectoryHandle>;
};
type MusicSourceController = {
  scanning: boolean;
  message: string;
  folderPickerAvailable: boolean;
  chooseFiles: (files: File[]) => void;
  scanFolder: () => void;
};
type ApiResult = { error?: string };
type UploadSessionResult = ApiResult & { trackId?: string; uploadId?: string };
type UploadPartResult = ApiResult & { partNumber?: number; etag?: string };
type UploadProgress = { done: number; total: number; bytes: number; totalBytes: number };

type ModelContext = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => unknown;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

const screenLabels: { id: Screen; label: string; icon: typeof HomeIcon }[] = [
  { id: 'home', label: 'Home', icon: HomeIcon },
  { id: 'library', label: 'Music', icon: Library },
  { id: 'create', label: 'Create', icon: Plus },
  { id: 'room', label: 'Room', icon: Radio },
];

const waveform = [18, 32, 23, 46, 29, 62, 38, 72, 51, 84, 56, 39, 69, 91, 46, 73, 58, 33, 61, 44, 80, 55, 28, 48, 31, 68, 49, 34, 57, 26, 41, 20];
const UPLOAD_PART_BYTES = 5 * 1024 * 1024;
const AUDIO_FILE_PATTERN = /\.(mp3|m4a|aac|wav|flac|ogg|opus|webm)$/i;
const LOCAL_LIBRARY_DB = 'hearu-local-library';
const LOCAL_LIBRARY_STORE = 'folders';
const GITHUB_PAGES_HOST = 'akshaey2007-lang.github.io';
const HOSTED_APP_ORIGIN = 'https://hearu-listen-together.akshaey2007.chatgpt.site';

function isGithubPagesApp() {
  return typeof window !== 'undefined' && window.location.hostname === GITHUB_PAGES_HOST;
}

function apiUrl(path: string) {
  return isGithubPagesApp() ? new URL(path, HOSTED_APP_ORIGIN).toString() : path;
}

function openLocalLibraryDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(LOCAL_LIBRARY_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(LOCAL_LIBRARY_STORE)) request.result.createObjectStore(LOCAL_LIBRARY_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function rememberMusicFolder(handle: LocalDirectoryHandle) {
  const database = await openLocalLibraryDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(LOCAL_LIBRARY_STORE, 'readwrite');
    transaction.objectStore(LOCAL_LIBRARY_STORE).put(handle, 'music');
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function readRememberedMusicFolder() {
  const database = await openLocalLibraryDatabase();
  const handle = await new Promise<LocalDirectoryHandle | null>((resolve, reject) => {
    const request = database.transaction(LOCAL_LIBRARY_STORE, 'readonly').objectStore(LOCAL_LIBRARY_STORE).get('music');
    request.onsuccess = () => resolve((request.result as LocalDirectoryHandle | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return handle;
}

async function collectAudioFiles(directory: LocalDirectoryHandle, files: File[] = []) {
  for await (const entry of directory.values()) {
    if (files.length >= 250) break;
    try {
      if (entry.kind === 'directory') {
        await collectAudioFiles(entry, files);
        continue;
      }
      const file = await entry.getFile();
      if (file.type.startsWith('audio/') || AUDIO_FILE_PATTERN.test(file.name)) files.push(file);
    } catch {
      // Keep scanning when an individual file or nested folder cannot be read.
    }
  }
  return files;
}

async function readApiResult<T extends ApiResult>(response: Response, fallback: string): Promise<T> {
  const text = await response.text();
  if (text) {
    try { return JSON.parse(text) as T; } catch { /* Use a readable fallback below. */ }
  }
  const error = response.status === 413
    ? 'This song is too large for the connection. Try a smaller audio file.'
    : fallback;
  return { error } as T;
}

async function uploadSelectedTrack(session: Session, track: SelectedTrack, position: number, signal: AbortSignal, onProgress: (bytes: number) => void, concurrency = 3) {
  const endpoint = `/api/rooms/${session.code}/tracks/upload`;
  const metadata = {
    name: track.title,
    type: track.file.type || 'audio/mpeg',
    size: track.file.size,
    duration: track.duration,
    position,
  };
  const authorization = { Authorization: `Bearer ${session.hostToken ?? ''}` };
  // Small files do not need start/part/complete round trips. Stay safely below
  // the hosting request-size ceiling; larger files keep the multipart path.
  if (track.file.size <= 2 * 1024 * 1024) {
    const form = new FormData();
    form.set('audio', track.file);
    form.set('trackName', track.title);
    form.set('duration', String(track.duration));
    form.set('position', String(position));
    const response = await (window.hearuUpload || xhrUpload)(`/api/rooms/${session.code}/tracks`, authorization, form, (bytes) => onProgress(Math.min(track.file.size, bytes)), signal, 'POST');
    const result = await readApiResult<ApiResult & { track?: { id: string } }>(response, 'The song could not be uploaded.');
    if (response.ok && result.track?.id) { onProgress(track.file.size); return result.track.id; }
    // Older servers reject position zero; proxies may reject an encoded body.
    // Only these definitive rejections are safe to fall back from (not timeouts).
    if (!(response.status === 413 || (position === 0 && response.status === 409))) throw new Error(result.error || 'The song could not be uploaded.');
  }
  const startResponse = await fetch(endpoint, {
    signal,
    method: 'POST',
    headers: { ...authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'start', ...metadata }),
  });
  const started = await readApiResult<UploadSessionResult>(startResponse, 'The song upload could not start.');
  if (!startResponse.ok || !started.trackId || !started.uploadId) throw new Error(started.error || 'The song upload could not start.');

  const query = `trackId=${encodeURIComponent(started.trackId)}&uploadId=${encodeURIComponent(started.uploadId)}`;
  try {
    const offsets = Array.from({ length: Math.ceil(track.file.size / UPLOAD_PART_BYTES) }, (_, index) => index * UPLOAD_PART_BYTES);
    const loaded = offsets.map(() => 0);
    const parts = await mapConcurrent(offsets, concurrency, async (offset, index) => {
      const blob = track.file.slice(offset, Math.min(offset + UPLOAD_PART_BYTES, track.file.size));
      const report = (bytes: number) => {
        loaded[index] = bytes;
        onProgress(loaded.reduce((sum, value) => sum + value, 0));
      };
      return retryPart(async () => {
        report(0);
        const response = await (window.hearuUpload || xhrUpload)(`${endpoint}?${query}&partNumber=${index + 1}`, { ...authorization, 'Content-Type': 'application/octet-stream' }, blob, report, signal);
        const part = await readApiResult<UploadPartResult>(response, 'Part of the song could not be uploaded.');
        if (!response.ok || part.partNumber !== index + 1 || !part.etag) throw new TransferError(part.error || 'Part of the song could not be uploaded.', response.status >= 500 || response.status === 429 || response.status === 408);
        report(blob.size);
        return { partNumber: part.partNumber, etag: part.etag };
      }, signal);
    });

    const completeResponse = await fetch(endpoint, {
      signal,
      method: 'POST',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete', trackId: started.trackId, uploadId: started.uploadId, parts, ...metadata }),
    });
    const completed = await readApiResult<ApiResult>(completeResponse, 'The song upload could not be finished.');
    if (!completeResponse.ok) throw new Error(completed.error || 'The song upload could not be finished.');
    return started.trackId;
  } catch (error) {
    void fetch(`${endpoint}?${query}`, { method: 'DELETE', headers: authorization }).catch(() => undefined);
    throw error;
  }
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const minutes = Math.floor(value / 60);
  return `${minutes}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
}

function useStableEvent<A extends unknown[], R>(callback: (...args: A) => R) {
  const latest = useRef(callback);
  useLayoutEffect(() => { latest.current = callback; });
  return useCallback((...args: A) => latest.current(...args), []);
}

// Keep the playback clock out of the app root and its potentially 250-row lists.
function PlaybackTimeline({ audioRef, duration, onSeek, disabled = false, room = false }: {
  audioRef: RefObject<HTMLAudioElement | null>; duration: number; onSeek: (value: number) => void; disabled?: boolean; room?: boolean;
}) {
  const [time, setTime] = useState(0);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const update = () => setTime(audio.currentTime || 0);
    update();
    audio.addEventListener('timeupdate', update);
    audio.addEventListener('loadedmetadata', update);
    audio.addEventListener('emptied', update);
    return () => {
      audio.removeEventListener('timeupdate', update);
      audio.removeEventListener('loadedmetadata', update);
      audio.removeEventListener('emptied', update);
    };
  }, [audioRef]);
  const progress = duration ? Math.min(100, time / duration * 100) : 0;
  return <>
    {room && <div className="waveform" aria-hidden="true">{waveform.map((height, index) => <i key={index} className={index / waveform.length * 100 <= progress ? 'played' : ''} style={{ height: `${height}%` }} />)}</div>}
    <input className={room ? 'seek-slider' : 'local-seek'} type="range" min={0} max={Math.max(duration, 1)} step={0.1} value={Math.min(time, Math.max(duration, 1))} disabled={disabled} onChange={(event) => { const value = Number(event.target.value); setTime(value); onSeek(value); }} aria-label="Song position" />
    <div className="time-row"><span>{formatTime(time)}</span><span>-{formatTime(Math.max(0, duration - time))}</span></div>
  </>;
}

const LocalTrackList = memo(function LocalTrackList({ tracks, activeIndex, open, queue = false }: { tracks: SelectedTrack[]; activeIndex: number; open: (index: number) => void; queue?: boolean }) {
  return <div className={queue ? 'room-queue local-queue liquid-card' : 'liquid-card selection-list local-library-list'} aria-label={queue ? 'Local music queue' : 'Selected songs'}>
    {tracks.map((track, index) => <button key={track.id} className={`${queue ? 'queue-track' : 'selection-row local-track-row'}${index === activeIndex ? ' active' : ''}`} onClick={() => open(index)}>
      {queue ? <><span className="queue-number">{index === activeIndex ? <AudioLines /> : index + 1}</span><span><strong>{track.title}</strong><small>{index === activeIndex ? 'Now playing' : `Song ${index + 1}`}</small></span><time>{formatTime(track.duration)}</time></> : <><span>{index + 1}</span><strong>{track.title}</strong><small>{formatTime(track.duration)}</small></>}
    </button>)}
  </div>;
});

const RoomQueue = memo(function RoomQueue({ tracks, currentId, canControl, select }: { tracks: RoomTrack[]; currentId: string; canControl: boolean; select: (id: string) => void }) {
  return <div className="room-queue liquid-card" aria-label="Room playlist">
    {tracks.map((track, index) => <button key={track.id} className={track.id === currentId ? 'queue-track active' : 'queue-track'} disabled={!canControl && track.id !== currentId} onClick={() => track.id !== currentId && select(track.id)}>
      <span className="queue-number">{track.id === currentId ? <AudioLines /> : index + 1}</span>
      <span><strong>{track.name}</strong><small>{track.id === currentId ? 'Now playing' : `Song ${index + 1}`}</small></span>
      <time>{formatTime(track.duration)}</time>
    </button>)}
  </div>;
});

const GlassNavigation = memo(function GlassNavigation({ screen, navigate }: { screen: Screen; navigate: (screen: Screen) => void }) {
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const dragMoved = useRef(false);
  const activeTab = screenLabels.findIndex((item) => item.id === screen);
  function pointerPosition(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(3, (event.clientX - bounds.left - 4) / ((bounds.width - 8) / 4) - .5));
  }
  return <nav className="nav-dock" aria-label="App navigation"><div className={`ios-tabbar ${dragPosition !== null ? 'dragging' : ''}`}
    onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragMoved.current = false; setDragPosition(pointerPosition(event)); }}
    onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const next = pointerPosition(event); if (Math.abs(next - activeTab) > .08) dragMoved.current = true; setDragPosition(next); }}
    onPointerUp={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const target = Math.round(pointerPosition(event)); event.currentTarget.releasePointerCapture(event.pointerId); setDragPosition(null); navigate(screenLabels[target].id); }}
    onPointerCancel={() => { setDragPosition(null); dragMoved.current = true; }}>
    <span className="tab-slider" style={{ transform: `translateX(${(dragPosition ?? activeTab) * 100}%)` }} />
    {screenLabels.map(({ id, label, icon: Icon }, index) => <button key={id} className={(dragPosition === null ? activeTab : Math.round(dragPosition)) === index ? 'active' : ''} onClick={(event) => { if (dragMoved.current) { event.preventDefault(); return; } navigate(id); }} onKeyDown={() => { dragMoved.current = false; }} aria-label={label}><Icon /><span>{label}</span></button>)}
  </div></nav>;
});

function UploadStatus({ progress }: { progress: UploadProgress | null }) {
  if (!progress) return null;
  const percent = Math.min(100, Math.round(progress.bytes / Math.max(1, progress.totalBytes) * 100));
  return <output className="upload-status">
    <span>{progress.done} of {progress.total} songs ready · {percent}% transferred</span>
    <progress value={progress.bytes} max={progress.totalBytes} aria-label="Song upload progress" />
    <small>{percent === 100 ? 'Finishing the playlist…' : 'Keep HearU open while songs upload.'}</small>
  </output>;
}

function roomInviteUrl(code: string) {
  const url = isGithubPagesApp()
    ? new URL('/HearU/', window.location.origin)
    : new URL(window.location.origin);
  url.searchParams.set('room', code);
  return url.toString();
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // The legacy selection fallback still works in some embedded browsers.
    }
  }

  const input = document.createElement('textarea');
  input.value = value;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('Could not copy the invite link.');
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
}

function Logo() {
  return (
    <div className="brand" aria-label="HearU">
      <span className="brand-mark"><AudioLines size={18} strokeWidth={2.5} /></span>
      <span>HearU</span>
    </div>
  );
}

function ProfileAvatar({ user, size = 'sm' }: { user: AuthUser; size?: 'sm' | 'lg' }) {
  return user.picture
    ? <img className={`profile-photo profile-photo-${size}`} src={user.picture} alt="" referrerPolicy="no-referrer" />
    : <span className={`avatar profile-photo-${size}`}>{initials(user.name)}</span>;
}

function GoogleSignIn({ onSignedIn }: { onSignedIn: (user: AuthUser) => void }) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function ready() {
      const configResponse = await fetch('/api/auth/config');
      const { clientId } = await configResponse.json() as { clientId?: string };
      if (!clientId) throw new Error('Google login is not configured.');

      if (!window.google) {
        await new Promise<void>((resolve, reject) => {
          const existing = document.getElementById('google-identity-services') as HTMLScriptElement | null;
          if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error('Google login could not load.')), { once: true });
            return;
          }
          const script = document.createElement('script');
          script.id = 'google-identity-services';
          script.src = 'https://accounts.google.com/gsi/client';
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error('Google login could not load.'));
          document.head.appendChild(script);
        });
      }

      if (cancelled || !window.google || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: async ({ credential }) => {
          if (!credential) return setError('Google did not return a sign-in credential.');
          setError('');
          const response = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential }),
          });
          const result = await response.json() as { user?: AuthUser; error?: string };
          if (!response.ok || !result.user) return setError(result.error || 'Google sign-in failed.');
          onSignedIn(result.user);
        },
      });
      buttonRef.current.replaceChildren();
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: 300,
      });
    }

    void ready().catch((cause) => setError(cause instanceof Error ? cause.message : 'Google login could not load.'));
    return () => { cancelled = true; window.google?.accounts.id.cancel(); };
  }, [onSignedIn]);

  return <div className="google-signin-wrap"><div ref={buttonRef} /><p className="form-error" role="alert">{error}</p></div>;
}

function LoginScreen({ onSignedIn, inviteCode }: { onSignedIn: (user: AuthUser) => void; inviteCode: string }) {
  return (
    <section className="screen login-screen" aria-labelledby="login-title">
      <header className="login-header"><Logo /><span className="secure-label"><ShieldCheck /> Private rooms</span></header>
      <div className="login-visual" aria-hidden="true">
        <span className="login-orbit orbit-one" /><span className="login-orbit orbit-two" />
        <span className="login-logo"><AudioLines /></span>
        <span className="login-avatar avatar-one">A</span><span className="login-avatar avatar-two">J</span><span className="login-avatar avatar-three">M</span>
      </div>
      <div className="login-copy">
        <p className="eyebrow"><Sparkles size={13} /> Your sound, together</p>
        <h1 id="login-title">Welcome to<br /><span>HearU.</span></h1>
        <p>Sign in once, then create a room and listen in sync with friends.</p>
      </div>
      <div className="liquid-card login-card">
        {inviteCode && <span className="pending-invite"><Link2 /> Room {inviteCode} is waiting</span>}
        <strong>Continue securely</strong>
        <small>HearU only uses your name, email and profile photo.</small>
        <GoogleSignIn onSignedIn={onSignedIn} />
      </div>
      <p className="login-terms"><LockKeyhole /> Your songs stay temporary and rooms expire automatically.</p>
    </section>
  );
}

function AccountOverlay({ user, close, signOut, theme, setTheme }: { user: AuthUser; close: () => void; signOut: () => void; theme: ThemeMode; setTheme: (theme: ThemeMode) => void }) {
  const isWebSession = user.id.startsWith('guest:');
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={close}>
      <div className="account-modal liquid-card" role="dialog" aria-modal="true" aria-labelledby="account-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="icon-button close-modal" onClick={close} aria-label="Close"><X /></button>
        <ProfileAvatar user={user} size="lg" />
        <p className="eyebrow">{isWebSession ? 'Web session' : 'Google account'}</p><h2 id="account-title">{user.name}</h2><p>{user.email}</p>
        <div className="appearance-setting">
          <span className="appearance-icon">{theme === 'dark' ? <Moon /> : <Sun />}</span>
          <span><strong>Appearance</strong><small>{theme === 'dark' ? 'Dark mode' : 'Light mode'}</small></span>
          <Switch checked={theme === 'dark'} onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')} aria-label="Use dark mode" />
        </div>
        <button className="signout-button" onClick={signOut}>{isWebSession ? 'Reset session' : 'Sign out'}</button>
      </div>
    </div>
  );
}

function Artwork({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={`artwork artwork-blue artwork-${size}`} aria-hidden="true">
      <span className="artwork-orbit" />
      <span className="artwork-core"><Music2 /></span>
      <span className="artwork-shine" />
    </div>
  );
}

function AvatarStack({ members }: { members: Member[] }) {
  const visible = members.slice(0, 4);
  if (!visible.length) return <div className="avatar-stack"><span className="avatar avatar-more">1</span></div>;
  return (
    <div className="avatar-stack" aria-label={`${members.length} listeners`}>
      {visible.map((member, index) => (
        <span key={member.id} className={`avatar avatar-${index % 3}`}>{initials(member.displayName)}</span>
      ))}
      {members.length > 4 && <span className="avatar avatar-more">+{members.length - 4}</span>}
    </div>
  );
}

function HomeScreen({ session, user, goTo, openJoin, openAccount }: { session: Session | null; user: AuthUser; goTo: (screen: Screen) => void; openJoin: () => void; openAccount: () => void }) {
  return (
    <section className="screen home-screen" aria-labelledby="home-title">
      <header className="app-header"><Logo /><button className="profile-button" onClick={openAccount} aria-label="Open account"><ProfileAvatar user={user} /></button></header>
      <div className="intro-copy">
        <p className="eyebrow"><Sparkles size={13} /> Your sound, together</p>
        <h1 id="home-title">Listen closer.<br /><span>Stay in sync.</span></h1>
        <p>Share a playlist of up to 250 songs with everyone in the room.</p>
      </div>

      <div className="action-grid">
        <button className="liquid-card action-card action-primary" onClick={() => goTo('library')}>
          <span className="action-icon"><Plus /></span>
          <span><strong>Start a room</strong><small>Choose songs and invite friends</small></span>
          <ChevronRight className="action-arrow" />
        </button>
        <button className="liquid-card action-card" onClick={openJoin}>
          <span className="action-icon soft"><Users /></span>
          <span><strong>Join friends</strong><small>Enter a four-character code</small></span>
          <ChevronRight className="action-arrow" />
        </button>
      </div>

      <div className="section-heading">
        <div><span className={session ? 'live-dot' : 'idle-dot'} /><span>{session ? 'Your active room' : 'How it works'}</span></div>
      </div>
      {session ? (
        <button className="liquid-card live-card" onClick={() => goTo('room')}>
          <Artwork size="md" />
          <div className="live-copy">
            <span className="room-label"><Radio size={12} /> ROOM {session.code}</span>
            <strong>Continue listening</strong>
            <small>Signed in as {session.displayName}</small>
          </div>
          <span className="mini-equalizer" aria-hidden="true"><i /><i /><i /><i /></span>
        </button>
      ) : (
        <div className="liquid-card how-card">
          <span><Upload /><b>Import</b><small>Select up to 250 songs</small></span>
          <ChevronRight />
          <span><Share2 /><b>Invite</b><small>Send the room link</small></span>
          <ChevronRight />
          <span><AudioLines /><b>Listen</b><small>Playback stays synced</small></span>
        </div>
      )}

      <div className="privacy-note home-privacy"><ShieldCheck size={16} /><p><strong>Temporary and private.</strong> Songs are available only to room participants and rooms expire automatically.</p></div>
    </section>
  );
}

function MusicSourcePicker({ source, selectedCount, compact = false }: { source: MusicSourceController; selectedCount: number; compact?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const directoryAttributes = { webkitdirectory: '', directory: '' } as Record<string, string>;
  const handleFiles = (files: FileList | null) => {
    const next = Array.from(files ?? []);
    if (next.length) source.chooseFiles(next);
  };

  return (
    <div className={compact ? 'music-source-picker compact-source-picker' : 'music-source-picker'}>
      <input ref={inputRef} className="sr-only" type="file" multiple accept="audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus,.webm" onChange={(event) => {
        handleFiles(event.target.files);
        event.target.value = '';
      }} />
      <input ref={directoryInputRef} className="sr-only" type="file" multiple accept="audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus,.webm" {...directoryAttributes} onChange={(event) => {
        handleFiles(event.target.files);
        event.target.value = '';
      }} />
      <button className="liquid-card folder-scan-button" disabled={source.scanning} onClick={() => {
        if (source.folderPickerAvailable) source.scanFolder();
        else directoryInputRef.current?.click();
      }}>
        <span className="upload-icon">{source.scanning ? <Loader2 className="spin" /> : selectedCount ? <RefreshCw /> : <FolderOpen />}</span>
        <span>
          <strong>{source.scanning ? 'Scanning for music…' : selectedCount ? 'Rescan a music folder' : 'Scan a music folder'}</strong>
          <small>{source.message || 'Choose a folder once and HearU will find up to 250 audio files.'}</small>
        </span>
      </button>
      <button className="choose-files-button" onClick={() => inputRef.current?.click()}><Upload /> Choose audio files instead</button>
    </div>
  );
}

function LibraryScreen({ selected, goTo, error, player, source, audioRef }: { selected: SelectedTrack[]; goTo: (screen: Screen) => void; error: string; player: LocalPlayerController; source: MusicSourceController; audioRef: RefObject<HTMLAudioElement | null> }) {
  const totalDuration = selected.reduce((sum, track) => sum + track.duration, 0);
  const totalSize = selected.reduce((sum, track) => sum + track.file.size, 0);
  const activeTrack = selected[player.activeIndex] ?? selected[0];

  if (player.expanded && activeTrack) {
    const duration = player.duration || activeTrack.duration;
    return (
      <section className="screen library-screen local-player-screen" aria-labelledby="local-player-title">
        <div className="sub-header">
          <button className="icon-button" onClick={player.close} aria-label="Back to local music"><ArrowLeft /></button>
          <span>Playing from this device</span><span className="header-spacer" />
        </div>

        <div className="local-player-art"><Artwork size="lg" /><span className="glass-badge"><Music2 size={14} /> Local playback</span></div>
        <div className="track-title-row local-player-title">
          <div><p id="local-player-title">{activeTrack.title}</p><span>{player.activeIndex + 1} of {selected.length} · HearU local</span></div>
          <span className="room-role">On device</span>
        </div>

        <PlaybackTimeline audioRef={audioRef} duration={duration} onSeek={player.seek} />

        <div className="player-controls local-player-controls">
          <button className="icon-button" disabled={player.activeIndex === 0} onClick={player.previous} aria-label="Previous song"><SkipBack fill="currentColor" /></button>
          <button className="play-button" onClick={player.toggle} aria-label={player.isPlaying ? 'Pause' : 'Play'}>{player.isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" className="play-offset" />}</button>
          <button className="icon-button" disabled={player.activeIndex >= selected.length - 1} onClick={player.next} aria-label="Next song"><SkipForward fill="currentColor" /></button>
        </div>
        <p className="local-device-note"><ShieldCheck /> Playing directly from your device. Nothing is uploaded.</p>

        <div className="queue-heading"><span><Music2 /> Local queue</span><small>{selected.length} {selected.length === 1 ? 'song' : 'songs'}</small></div>
        <LocalTrackList tracks={selected} activeIndex={player.activeIndex} open={player.open} queue />
      </section>
    );
  }

  return (
    <section className="screen library-screen" aria-labelledby="library-title">
      <div className="sub-header">
        <button className="icon-button" onClick={() => goTo('home')} aria-label="Go back"><ArrowLeft /></button>
        <span>Local music</span><span className="header-spacer" />
      </div>
      <div className="page-title">
        <p className="eyebrow"><FileAudio size={13} /> From this device</p>
        <h1 id="library-title">Your local<br /><span>music.</span></h1>
      </div>

      <MusicSourcePicker source={source} selectedCount={selected.length} />
      {error && <p className="form-error">{error}</p>}

      {selected.length ? (
        <div className="selected-preview">
          <div className="section-heading"><div><Check size={15} /><span>{selected.length} of 250 selected</span></div></div>
          <button className="liquid-card selected-track selection-summary local-summary" onClick={() => player.open(player.activeIndex)}>
            <Artwork size="md" />
            <div><small>PLAYLIST READY</small><strong>{selected.length} {selected.length === 1 ? 'song' : 'songs'}</strong><span>{formatTime(totalDuration)} · {(totalSize / 1024 / 1024).toFixed(1)} MB total</span></div>
            <span className="local-summary-play"><Play fill="currentColor" /></span>
          </button>
          <LocalTrackList tracks={selected} activeIndex={player.activeIndex} open={player.open} />
          <div className="library-actions">
            <Button className="local-play-button" onClick={() => player.open(player.activeIndex)}><Play fill="currentColor" /> Play locally</Button>
            <Button className="create-button" onClick={() => goTo('create')}>Create room <ChevronRight /></Button>
          </div>
        </div>
      ) : (
        <div className="empty-music"><Music2 /><strong>No songs selected</strong><p>Choose one song or a playlist of up to 250 songs.</p></div>
      )}
    </section>
  );
}

function CreateScreen({ selected, defaultName, goTo, create, busy, error, uploadProgress, source }: {
  selected: SelectedTrack[];
  defaultName: string;
  goTo: (screen: Screen) => void;
  create: (settings: { roomName: string; displayName: string; hostOnly: boolean; reactionsEnabled: boolean }) => void;
  busy: boolean;
  error: string;
  uploadProgress: UploadProgress | null;
  source: MusicSourceController;
}) {
  const [roomName, setRoomName] = useState('After Hours');
  const [displayName, setDisplayName] = useState(defaultName);
  const [hostOnly, setHostOnly] = useState(true);
  const [reactionsEnabled, setReactionsEnabled] = useState(true);

  return (
    <section className="screen create-screen" aria-labelledby="create-title">
      <div className="sub-header">
        <button className="icon-button" onClick={() => goTo('home')} aria-label="Go back"><ArrowLeft /></button>
        <span>New room</span><span className="header-spacer" />
      </div>
      <div className="page-title compact-title"><p className="eyebrow"><Radio size={13} /> Almost ready</p><h1 id="create-title">Set the<br /><span>room.</span></h1></div>

      {selected.length ? (
        <div className="liquid-card selected-track compact-track">
          <Artwork size="md" />
          <div><small>{selected.length} SONG PLAYLIST</small><strong>{selected[0].title}</strong><span>Plays first · {formatTime(selected[0].duration)}</span></div>
          <Check className="selected-check" />
        </div>
      ) : (
        <div className="liquid-card create-song-empty"><FileAudio /><span><strong>Add music to this room</strong><small>Select songs here without leaving Create.</small></span></div>
      )}
      <MusicSourcePicker source={source} selectedCount={selected.length} compact />

      <div className="settings-card liquid-card">
        <label className="room-name-field"><span>Room name</span><input value={roomName} onChange={(event) => setRoomName(event.target.value)} maxLength={32} /></label>
        <label className="room-name-field name-field"><span>Your name</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={24} /></label>
        <div className="setting-row"><span className="setting-icon"><LockKeyhole /></span><span><strong>Host controls playback</strong><small>Only you can play, pause and seek</small></span><Switch checked={hostOnly} onCheckedChange={setHostOnly} aria-label="Host controls playback" /></div>
        <div className="setting-row"><span className="setting-icon"><Heart /></span><span><strong>Friend reactions</strong><small>Let listeners react to the song</small></span><Switch checked={reactionsEnabled} onCheckedChange={setReactionsEnabled} aria-label="Friend reactions" /></div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      <UploadStatus progress={uploadProgress} />
      <div className="privacy-note"><ShieldCheck size={16} /><p><strong>Temporary by design.</strong> Uploaded songs and the room expire after six hours.</p></div>
      <Button className="create-button" disabled={busy || !selected.length || !roomName.trim() || !displayName.trim()} onClick={() => create({ roomName, displayName, hostOnly, reactionsEnabled })}>
        {busy ? <><Loader2 className="spin" /> {uploadProgress ? `Uploading ${uploadProgress.done} of ${uploadProgress.total} songs…` : 'Creating room…'}</> : <><Radio /> Create listening room <ChevronRight /></>}
      </Button>
    </section>
  );
}

function RoomScreen({ session, payload, audioRef, localSource, uploadProgress, volume, needsGesture, inviteStatus, notice, onLeave, onToggle, onSeek, onVolume, onCopyInvite, onShareInvite, onSelectTrack, onEnded, onReact, onSync }: {
  session: Session | null;
  payload: RoomPayload | null;
  audioRef: RefObject<HTMLAudioElement | null>;
  localSource?: string;
  uploadProgress: UploadProgress | null;
  volume: number;
  needsGesture: boolean;
  inviteStatus: InviteStatus;
  notice: string;
  onLeave: () => void;
  onToggle: () => void;
  onSeek: (value: number) => void;
  onVolume: (value: number) => void;
  onCopyInvite: () => void;
  onShareInvite: () => void;
  onSelectTrack: (trackId: string) => void;
  onEnded: () => void;
  onReact: (emoji: string) => void;
  onSync: () => void;
}) {
  const selectTrack = useStableEvent(onSelectTrack);
  if (!session || !payload) return <section className="screen centered-state"><Loader2 className="spin" /><h2>Connecting to room…</h2><button onClick={onLeave}>Cancel</button></section>;
  const { room, tracks, members, reactions } = payload;
  const canControl = session.role === 'host' || !room.hostOnly;
  const currentIndex = Math.max(0, tracks.findIndex((track) => track.id === room.currentTrackId));

  return (
    <section className="screen room-screen" aria-labelledby="room-title">
      <div className="sub-header room-header">
        <button className="icon-button" onClick={onLeave} aria-label="Leave room"><X /></button>
        <div><span className="live-dot" /> LIVE · {room.code}</div>
        <button className="icon-button" onClick={onShareInvite} aria-label="Share invite link"><Share2 /></button>
      </div>

      <div className="listener-strip liquid-card">
        <AvatarStack members={members} />
        <div><strong>{members.length} {members.length === 1 ? 'listener' : 'listeners'}</strong><small>{session.role === 'host' ? 'You are hosting' : `Joined as ${session.displayName}`}</small></div>
        <span className="sync-pill"><Check size={12} /> Synced</span>
      </div>
      {notice && <p className="room-notice" role="status">{notice}</p>}
      <UploadStatus progress={uploadProgress} />

      <div className="now-playing">
        <div className="hero-art-wrap"><Artwork size="lg" /><span className="glass-badge"><AudioLines size={14} /> Listening together</span></div>
        <div className="track-title-row"><div><p id="room-title">{room.trackName}</p><span>{room.name}</span></div><span className="room-role">{session.role}</span></div>
      </div>

      <PlaybackTimeline audioRef={audioRef} duration={room.duration} onSeek={onSeek} disabled={!canControl} room />

      <div className="player-controls">
        <button className="icon-button" disabled={!canControl || currentIndex === 0} onClick={() => onSelectTrack(tracks[currentIndex - 1].id)} aria-label="Previous song"><SkipBack fill="currentColor" /></button>
        <button className="play-button" disabled={!canControl} onClick={onToggle} aria-label={room.isPlaying ? 'Pause' : 'Play'}>{room.isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" className="play-offset" />}</button>
        <button className="icon-button" disabled={!canControl || currentIndex >= tracks.length - 1} onClick={() => onSelectTrack(tracks[currentIndex + 1].id)} aria-label="Next song"><SkipForward fill="currentColor" /></button>
      </div>
      {!canControl && <p className="host-control-note"><LockKeyhole /> The host controls playback</p>}
      {needsGesture && <button className="sync-audio-button" onClick={onSync}><Play /> Tap to hear synchronized audio</button>}

      <div className="volume-row"><Volume2 size={16} /><Slider value={[volume]} min={0} max={100} onValueChange={(value) => onVolume(Array.isArray(value) ? value[0] : value)} aria-label="Volume" /><span>{volume}</span></div>

      {room.reactionsEnabled && <div className="reaction-row" aria-label="Send a reaction">{['💜', '🔥', '✨', '🥹'].map((emoji) => <button key={emoji} onClick={() => onReact(emoji)}>{emoji}</button>)}</div>}
      <div className="reaction-feed" aria-live="polite">{reactions.slice(0, 3).map((reaction) => <span key={reaction.id}><b>{reaction.emoji}</b>{reaction.memberName}</span>)}</div>

      <button className="room-code liquid-card" onClick={onCopyInvite}>
        <span className="setting-icon"><Link2 /></span>
        <span><small>INVITE LINK</small><strong>Join room {room.code}</strong></span>
        <span className="copy-action" aria-live="polite">
          {inviteStatus === 'copied' ? <><Check /> Copied</> : inviteStatus === 'shared' ? <><Check /> Shared</> : <><Copy /> Copy link</>}
        </span>
      </button>
      <div className="queue-heading"><span><Music2 /> Up next</span><small>{tracks.length} {tracks.length === 1 ? 'song' : 'songs'}</small></div>
      <RoomQueue tracks={tracks} currentId={room.currentTrackId} canControl={canControl} select={selectTrack} />
      <audio ref={audioRef} crossOrigin={!localSource && isGithubPagesApp() ? 'anonymous' : undefined} src={localSource || apiUrl(`/api/rooms/${room.code}/audio?track=${encodeURIComponent(room.currentTrackId)}`)} preload="auto" onLoadedMetadata={onSync} onEnded={() => canControl && onEnded()} />
    </section>
  );
}

function JoinOverlay({ defaultName, initialCode, close, join }: { defaultName: string; initialCode: string; close: () => void; join: (code: string, name: string) => Promise<string | null> }) {
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true); setError('');
    const message = await join(code, name);
    if (message) setError(message);
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={close}>
      <div className="join-modal liquid-card" role="dialog" aria-modal="true" aria-labelledby="join-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="icon-button close-modal" onClick={close} aria-label="Close"><X /></button>
        <span className="modal-icon"><Users /></span><p className="eyebrow">Listen together</p><h2 id="join-title">{initialCode ? `Join room ${initialCode}` : 'Join a room'}</h2><p>{initialCode ? 'Your invite is ready. Choose join to start listening.' : 'Enter the code shared by your friend.'}</p>
        <input className="code-input" value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))} placeholder="8K2P" aria-label="Room code" autoFocus />
        <input className="join-name-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" aria-label="Your name" maxLength={24} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button className="join-button" disabled={busy || code.length !== 4 || !name.trim()} onClick={submit}>{busy ? <><Loader2 className="spin" /> Joining…</> : <><Radio /> Join room</>}</Button>
      </div>
    </div>
  );
}

const LOCAL_APP_USER: AuthUser = { id: 'guest:local-device', name: 'Listener', email: '', picture: null };

function AppSurface({ standalone, children, overlays }: { standalone: boolean; children: ReactNode; overlays?: ReactNode }) {
  if (standalone) return <main className="app-surface">{children}{overlays}</main>;
  return <main className="site-shell"><div className="phone-stage"><div className="phone-frame"><div className="dynamic-island" aria-hidden="true" />{children}</div></div>{overlays}</main>;
}

export default function Home({ standalone = false }: { standalone?: boolean } = {}) {
  const [authUser, setAuthUser] = useState<AuthUser | null>(standalone ? LOCAL_APP_USER : null);
  const [authLoading, setAuthLoading] = useState(!standalone);
  const [accountOpen, setAccountOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'dark';
    return localStorage.getItem('hearu-theme') === 'light' ? 'light' : 'dark';
  });
  const [screen, setScreen] = useState<Screen>('home');
  const [selected, setSelected] = useState<SelectedTrack[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [payload, setPayload] = useState<RoomPayload | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const uploadController = useRef<AbortController | null>(null);
  const metadataController = useRef<AbortController | null>(null);
  const [hostSources, setHostSources] = useState<Record<string, string>>({});
  const hostUrls = useRef(new Set<string>());
  const [error, setError] = useState('');
  const [roomNotice, setRoomNotice] = useState('');
  const [volume, setVolume] = useState(72);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>('idle');
  const [localTrackIndex, setLocalTrackIndex] = useState(0);
  const [localIsPlaying, setLocalIsPlaying] = useState(false);
  const [localPosition, setLocalPosition] = useState(0);
  const [localDuration, setLocalDuration] = useState(0);
  const [localPlayerOpen, setLocalPlayerOpen] = useState(false);
  const [localPlayRequest, setLocalPlayRequest] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [folderPickerAvailable] = useState(() => typeof window !== 'undefined' && typeof (window as LocalDirectoryWindow).showDirectoryPicker === 'function');
  const autoScanAttempted = useRef(false);
  const previewUrls = useRef<Set<string>>(new Set());
  const audioRef = useRef<HTMLAudioElement>(null);
  const localAudioRef = useRef<HTMLAudioElement>(null);
  const localTrack = selected[localTrackIndex] ?? selected[0];
  const sessionRef = useRef(session);
  useLayoutEffect(() => { sessionRef.current = session; }, [session]);
  const payloadRef = useRef(payload);
  useLayoutEffect(() => { payloadRef.current = payload; }, [payload]);
  const playbackRevision = useRef(0);
  const playbackSending = useRef(false);
  const playbackNeedsRecovery = useRef(false);
  const queuedPlayback = useRef<{ isPlaying: boolean; position: number; trackId: string } | null>(null);
  const roomReading = useRef(false);
  const localPlayIntent = useRef(false);
  const localPlayRevision = useRef(0);
  const navigate = useStableEvent((target: Screen) => {
    if (target === 'room' && !session) setJoinOpen(true);
    else setScreen(target);
  });

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('room')?.trim().toUpperCase() ?? '';
    if (/^[A-Z0-9]{4}$/.test(code)) {
      setInviteCode(code);
      setJoinOpen(true);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('hearu-theme', theme);
  }, [theme]);

  useEffect(() => () => {
    uploadController.current?.abort();
    metadataController.current?.abort();
    hostUrls.current.forEach((url) => URL.revokeObjectURL(url));
    localAudioRef.current?.pause();
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current.clear();
  }, []);

  useEffect(() => {
    const audio = localAudioRef.current;
    if (!audio || !localTrack || localPlayRequest === 0) return;
    audioRef.current?.pause();
    audio.load();
    playLocal(audio);
  }, [localPlayRequest, localTrack?.previewUrl]);

  useEffect(() => {
    if (screen !== 'room') return;
    localPlayIntent.current = false;
    ++localPlayRevision.current;
    localAudioRef.current?.pause();
    setLocalIsPlaying(false);
  }, [screen]);

  useEffect(() => {
    let active = true;
    void fetch('/api/auth/me', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() as Promise<{ user: AuthUser }> : { user: null })
      .then(({ user }) => { if (active) setAuthUser(user ?? (standalone ? LOCAL_APP_USER : null)); })
      .catch(() => undefined)
      .finally(() => { if (active) setAuthLoading(false); });
    return () => { active = false; };
  }, [standalone]);

  const handleSignedIn = useCallback((user: AuthUser) => {
    setAuthUser(user);
    setAuthLoading(false);
  }, []);

  useEffect(() => {
    if (!authUser) return;
    const saved = sessionStorage.getItem('hearu-session');
    if (!saved) return;
    try {
      const restored = JSON.parse(saved) as Session;
      if (restored.code && restored.memberId) { setSession(restored); setScreen('room'); }
    } catch { sessionStorage.removeItem('hearu-session'); }
  }, [authUser]);

  const syncAudio = useCallback(async (room: RoomState, force = false) => {
    const audio = audioRef.current;
    if (!audio) return;
    const target = Math.min(room.duration || Number.MAX_SAFE_INTEGER, room.position);
    if (force || Math.abs(audio.currentTime - target) > 0.8) audio.currentTime = target;
    if (room.isPlaying && audio.paused) {
      try { await audio.play(); setNeedsGesture(false); } catch { setNeedsGesture(true); }
    } else if (!room.isPlaying && !audio.paused) {
      audio.pause();
    }
  }, []);

  const readRoom = useCallback(async () => {
    if (!session || !authUser || roomReading.current || playbackSending.current) return;
    roomReading.current = true;
    const revision = playbackRevision.current;
    try {
    const requestedAt = performance.now();
    const response = await fetch(`/api/rooms/${session.code}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (sessionRef.current?.code !== session.code || revision !== playbackRevision.current || playbackSending.current) return;
    if (response.status === 401) {
      sessionStorage.removeItem('hearu-session'); setSession(null); setPayload(null); setAuthUser(null); setScreen('home'); return;
    }
    if (response.status === 404 || response.status === 410) {
      sessionStorage.removeItem('hearu-session'); setSession(null); setPayload(null); setScreen('home'); return;
    }
    if (!response.ok) return;
    const next = await response.json() as RoomPayload;
    if (revision !== playbackRevision.current || playbackSending.current || sessionRef.current?.code !== session.code) return;
    if (payloadRef.current?.room.code === next.room.code && next.room.version < payloadRef.current.room.version) return;
    const previous = payloadRef.current;
    if (next.room.isPlaying) next.room.position = Math.min(next.room.duration || Infinity, next.room.position + (performance.now() - requestedAt) / 2000);
    payloadRef.current = next;
    setPayload(next);
    const changed = !previous || previous.room.version !== next.room.version || previous.room.currentTrackId !== next.room.currentTrackId;
    // Unchanged host polls must not repeatedly seek its already-correct local file.
    if (changed || session.role !== 'host' || playbackNeedsRecovery.current) await syncAudio(next.room);
    playbackNeedsRecovery.current = false;
    } catch { /* A temporary connection loss must not interrupt local playback. */ }
    finally { roomReading.current = false; }
  }, [session, authUser, syncAudio]);

  useEffect(() => {
    if (!session || !authUser) return;
    void readRoom();
    const statusTimer = window.setInterval(() => { void readRoom(); }, 1_000);
    const presenceTimer = window.setInterval(() => {
      void fetch(`/api/rooms/${session.code}/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId: session.memberId }), signal: AbortSignal.timeout(4500) }).catch(() => undefined);
    }, 5_000);
    return () => { window.clearInterval(statusTimer); window.clearInterval(presenceTimer); };
  }, [session, authUser, readRoom]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: 'open_hearu_flow', title: 'Open HearU flow',
      description: 'Open the song import or room join flow in the visible HearU app.',
      inputSchema: { type: 'object', properties: { flow: { type: 'string', enum: ['import_song', 'join_room'] } }, required: ['flow'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const flow = (input as { flow?: unknown }).flow;
        if (flow === 'import_song') { setScreen('library'); return { flow, status: 'visible' }; }
        if (flow === 'join_room') { setJoinOpen(true); return { flow, status: 'visible' }; }
        throw new Error('Flow must be import_song or join_room.');
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, []);

  const chooseFiles = useCallback((files: File[]) => {
    metadataController.current?.abort();
    const metadataTask = new AbortController();
    metadataController.current = metadataTask;
    const candidates = files.slice(0, 250);
    const supported = candidates.filter((file) => {
      const extensionOkay = AUDIO_FILE_PATTERN.test(file.name);
      return file.size > 0 && file.size <= 70 * 1024 * 1024 && (!file.type || file.type.startsWith('audio/') || extensionOkay);
    });
    if (!supported.length) { setError('Choose audio files smaller than 70 MB each.'); return; }

    const localAudio = localAudioRef.current;
    localAudio?.pause();
    localAudio?.removeAttribute('src');
    localAudio?.load();
    setLocalTrackIndex(0);
    setLocalIsPlaying(false);
    setLocalPosition(0);
    setLocalDuration(0);
    setLocalPlayerOpen(false);
    setLocalPlayRequest(0);
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current.clear();
    const tracks = supported.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
      return { id: crypto.randomUUID(), file, title: file.name.replace(/\.[^/.]+$/, '') || 'Untitled song', duration: 0, previewUrl };
    });
    setSelected(tracks);
    setScanMessage(`${supported.length} ${supported.length === 1 ? 'song is' : 'songs are'} ready on this device.`);
    const skipped = files.length - supported.length;
    setError(skipped ? `${skipped} ${skipped === 1 ? 'file was' : 'files were'} skipped. HearU supports up to 250 audio files, 70 MB each.` : '');

    // Two decoders and batched updates instead of 250 simultaneous media loads.
    void (async () => {
      for (let offset = 0; offset < tracks.length && !metadataTask.signal.aborted; offset += 8) {
        const batch = tracks.slice(offset, offset + 8);
        const durations = await mapConcurrent(batch, 2, (track) => readAudioDuration(track.previewUrl, metadataTask.signal));
        if (metadataTask.signal.aborted) return;
        const updates = new Map(batch.map((track, index) => [track.id, durations[index]]));
        setSelected((current) => current.map((track) => updates.has(track.id) ? { ...track, duration: updates.get(track.id)! } : track));
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
    })();
  }, []);

  useEffect(() => {
    if (!authUser || autoScanAttempted.current || !folderPickerAvailable) return;
    autoScanAttempted.current = true;
    void (async () => {
      try {
        const handle = await readRememberedMusicFolder();
        if (!handle || await handle.queryPermission?.({ mode: 'read' }) !== 'granted') {
          setScanMessage('Tap scan to allow access to your music folder.');
          return;
        }
        setScanning(true);
        setScanMessage(`Checking ${handle.name}…`);
        const files = (await collectAudioFiles(handle)).sort((a, b) => a.name.localeCompare(b.name));
        if (!files.length) {
          setScanMessage(`No supported audio files found in ${handle.name}.`);
          return;
        }
        chooseFiles(files);
        setScanMessage(`${files.length} ${files.length === 1 ? 'song' : 'songs'} loaded automatically from ${handle.name}.`);
      } catch {
        setScanMessage('Tap scan to reconnect your music folder.');
      } finally {
        setScanning(false);
      }
    })();
  }, [authUser, chooseFiles, folderPickerAvailable]);

  async function scanLocalFolder() {
    const picker = (window as LocalDirectoryWindow).showDirectoryPicker;
    if (!picker) return;
    setScanning(true);
    setError('');
    try {
      const handle = await picker({ mode: 'read' });
      setScanMessage(`Scanning ${handle.name}…`);
      const files = (await collectAudioFiles(handle)).sort((a, b) => a.name.localeCompare(b.name));
      if (!files.length) {
        setError('No supported audio files were found in that folder.');
        setScanMessage('Choose another folder or select audio files directly.');
        return;
      }
      await rememberMusicFolder(handle).catch(() => undefined);
      chooseFiles(files);
      setScanMessage(`${files.length} ${files.length === 1 ? 'song' : 'songs'} found in ${handle.name}. HearU will rescan it next time.`);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError('HearU could not scan that folder. You can still choose audio files directly.');
    } finally {
      setScanning(false);
    }
  }

  const openLocalTrack = useStableEvent((index: number) => {
    if (!selected[index]) return;
    setLocalPlayerOpen(true);
    audioRef.current?.pause();
    if (index === localTrackIndex) {
      const audio = localAudioRef.current;
      if (audio) playLocal(audio);
      return;
    }
    setLocalTrackIndex(index);
    setLocalPosition(0);
    setLocalDuration(selected[index].duration);
    setLocalPlayRequest((value) => value + 1);
  });

  function playLocal(audio: HTMLAudioElement) {
    const revision = ++localPlayRevision.current;
    localPlayIntent.current = true;
    setLocalIsPlaying(true);
    void audio.play().catch(() => {
      if (revision === localPlayRevision.current) { localPlayIntent.current = false; setLocalIsPlaying(false); }
    });
  }

  function toggleLocalPlayback() {
    const audio = localAudioRef.current;
    if (!audio || !localTrack) return;
    if (!localPlayIntent.current) {
      audioRef.current?.pause();
      playLocal(audio);
    } else {
      ++localPlayRevision.current;
      localPlayIntent.current = false;
      setLocalIsPlaying(false);
      audio.pause();
    }
  }

  function seekLocalPlayback(value: number) {
    const audio = localAudioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setLocalPosition(value);
  }

  function previousLocalTrack() {
    const audio = localAudioRef.current;
    if (audio && audio.currentTime > 3) {
      seekLocalPlayback(0);
      return;
    }
    openLocalTrack(Math.max(0, localTrackIndex - 1));
  }

  function nextLocalTrack() {
    openLocalTrack(Math.min(selected.length - 1, localTrackIndex + 1));
  }

  function finishLocalTrack() {
    if (localTrackIndex < selected.length - 1) openLocalTrack(localTrackIndex + 1);
    else {
      localPlayIntent.current = false;
      ++localPlayRevision.current;
      if (localAudioRef.current) localAudioRef.current.currentTime = 0;
      setLocalIsPlaying(false);
      setLocalPosition(0);
    }
  }

  async function createRoom(settings: { roomName: string; displayName: string; hostOnly: boolean; reactionsEnabled: boolean }) {
    if (!selected.length || uploadController.current) return;
    const playlist = selected;
    const controller = new AbortController();
    uploadController.current = controller;
    localAudioRef.current?.pause();
    localPlayIntent.current = false;
    setBusy(true); setError('');
    const totalBytes = playlist.reduce((sum, track) => sum + track.file.size, 0);
    const bytes = playlist.map(() => 0);
    let completed = 0;
    let lastProgress = 0;
    const report = (index: number, loaded: number, force = false) => {
      bytes[index] = loaded;
      if (!force && performance.now() - lastProgress < 150) return;
      lastProgress = performance.now();
      if (!controller.signal.aborted) setUploadProgress({ done: completed, total: playlist.length, bytes: bytes.reduce((sum, value) => sum + value, 0), totalBytes });
    };
    setUploadProgress({ done: 0, total: playlist.length, bytes: 0, totalBytes });
    try {
      const form = new FormData();
      form.set('roomName', settings.roomName); form.set('displayName', settings.displayName);
      form.set('hostOnly', String(settings.hostOnly)); form.set('reactionsEnabled', String(settings.reactionsEnabled));
      const response = await fetch('/api/rooms', { method: 'POST', body: form, signal: controller.signal });
      const result = await readApiResult<ApiResult & { room?: { code: string }; hostToken?: string; memberId?: string; displayName?: string }>(response, 'Room creation failed.');
      if (!response.ok || !result.room || !result.hostToken || !result.memberId) throw new Error(result.error || 'Room creation failed.');
      const next: Session = { code: result.room.code, role: 'host', hostToken: result.hostToken, memberId: result.memberId, displayName: result.displayName || settings.displayName };

      async function upload(index: number, concurrency: number) {
        const source = playlist[index];
        const track = source.duration ? source : { ...source, duration: await readAudioDuration(source.previewUrl, controller.signal) };
        const id = await uploadSelectedTrack(next, track, index, controller.signal, (loaded) => report(index, loaded), concurrency);
        controller.signal.throwIfAborted();
        // The host already has the file; do not download it again to play it.
        const url = URL.createObjectURL(playlist[index].file);
        hostUrls.current.add(url);
        setHostSources((current) => ({ ...current, [id]: url }));
        completed++;
        report(index, playlist[index].file.size, true);
      }
      await upload(0, 3);
      sessionStorage.setItem('hearu-session', JSON.stringify(next));
      const location = new URL(window.location.href);
      location.searchParams.set('room', next.code);
      window.history.replaceState(null, '', location);
      sessionRef.current = next;
      setPayload(null); payloadRef.current = null;
      setInviteCode(next.code); setSession(next); setScreen('room');
      setLocalPlayerOpen(false);

      let failed = 0;
      await mapConcurrent(playlist.slice(1), 2, async (_, index) => {
        controller.signal.throwIfAborted();
        try { await upload(index + 1, 2); }
        catch (cause) { if (controller.signal.aborted) throw cause; failed++; }
      });
      controller.signal.throwIfAborted();
      setRoomNotice(failed ? `${failed} ${failed === 1 ? 'song' : 'songs'} could not be uploaded. The rest are ready.` : '');
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Room creation failed.'); }
    finally {
      if (uploadController.current === controller) { uploadController.current = null; setBusy(false); setUploadProgress(null); }
    }
  }

  async function joinRoom(code: string, displayName: string) {
    try {
      const response = await fetch(`/api/rooms/${code}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName }) });
      const result = await response.json() as { error?: string; memberId?: string; displayName?: string };
      if (!response.ok || !result.memberId) return result.error || 'Could not join this room.';
      const next: Session = { code, role: 'listener', memberId: result.memberId, displayName: result.displayName || displayName };
      sessionStorage.setItem('hearu-session', JSON.stringify(next));
      window.history.replaceState(null, '', roomInviteUrl(next.code));
      setInviteCode(next.code); setSession(next); setJoinOpen(false); setScreen('room'); return null;
    } catch { return 'Could not reach the room. Try again.'; }
  }

  async function signOut() {
    uploadController.current?.abort();
    metadataController.current?.abort();
    queuedPlayback.current = null;
    ++playbackRevision.current;
    sessionRef.current = null;
    audioRef.current?.pause();
    localAudioRef.current?.pause();
    localAudioRef.current?.removeAttribute('src');
    localAudioRef.current?.load();
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current.clear();
    await fetch('/api/auth/me', { method: 'DELETE' }).catch(() => undefined);
    if (isGithubPagesApp()) {
      window.location.replace(new URL('/HearU/', window.location.origin));
      return;
    }
    sessionStorage.removeItem('hearu-session');
    window.history.replaceState(null, '', window.location.pathname);
    setInviteCode(''); setRoomNotice(''); setSession(null); setPayload(null); setSelected([]); setAccountOpen(false); setScreen('home'); setAuthUser(null);
    setLocalPlayerOpen(false); setLocalTrackIndex(0); setLocalPosition(0); setLocalDuration(0); setLocalIsPlaying(false); setLocalPlayRequest(0);
    setScanning(false); setScanMessage(''); autoScanAttempted.current = false;
  }

  async function updatePlayback(isPlaying: boolean, nextPosition: number, trackId?: string) {
    const current = payloadRef.current;
    const activeSession = sessionRef.current;
    if (!activeSession || !current || (activeSession.role !== 'host' && current.room.hostOnly)) return;
    const track = current.tracks.find((item) => item.id === (trackId || current.room.currentTrackId));
    if (!track) return;
    const intent = { isPlaying, position: nextPosition, trackId: track.id };
    const optimistic = { ...current, room: { ...current.room, isPlaying, position: nextPosition, currentTrackId: track.id, trackName: track.name, trackType: track.type, trackSize: track.size, duration: track.duration } };
    payloadRef.current = optimistic;
    setPayload(optimistic);
    queuedPlayback.current = intent;
    ++playbackRevision.current;
    if (playbackSending.current) return;
    playbackSending.current = true;
    // Serialize requests and collapse intermediate taps/seeks. Older replies can
    // never replace the newest intent, and polling cannot undo a pending tap.
    try {
      while (queuedPlayback.current && sessionRef.current?.code === activeSession.code) {
        const outgoing = queuedPlayback.current;
        queuedPlayback.current = null;
        const revision = playbackRevision.current;
        const response = await fetch(`/api/rooms/${activeSession.code}`, {
          method: 'PATCH', signal: AbortSignal.timeout(15000),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${activeSession.hostToken ?? ''}`, 'X-Member-Id': activeSession.memberId },
          body: JSON.stringify(outgoing),
        });
        const result = await readApiResult<ApiResult & { room?: RoomState }>(response, 'Playback could not be synced.');
        if (!response.ok || !result.room) throw new Error(result.error || 'Playback could not be synced.');
        if (revision === playbackRevision.current && sessionRef.current?.code === activeSession.code && payloadRef.current) {
          const updated: RoomPayload = { ...payloadRef.current, room: result.room };
          payloadRef.current = updated;
          setPayload(updated);
          setRoomNotice('');
        }
      }
    } catch {
      queuedPlayback.current = null;
      playbackNeedsRecovery.current = true;
      if (sessionRef.current?.code === activeSession.code) setRoomNotice('Playback could not sync. Check your connection and try again.');
    } finally { playbackSending.current = false; }
  }

  async function togglePlayback() {
    const current = payloadRef.current;
    if (!current) return;
    const audio = audioRef.current;
    if (!audio) return;
    const nextPlaying = !current.room.isPlaying;
    void updatePlayback(nextPlaying, audio.currentTime);
    const revision = playbackRevision.current;
    if (nextPlaying) { void audio.play().then(() => { if (revision === playbackRevision.current) setNeedsGesture(false); }).catch(() => { if (revision === playbackRevision.current) setNeedsGesture(true); }); }
    else { audio.pause(); setNeedsGesture(false); }
  }

  async function seek(value: number) {
    if (!payloadRef.current) return;
    if (audioRef.current) audioRef.current.currentTime = value;
    await updatePlayback(payloadRef.current.room.isPlaying, value);
  }

  async function selectRoomTrack(trackId: string) {
    if (!payload || trackId === payload.room.currentTrackId) return;
    await updatePlayback(payload.room.isPlaying, 0, trackId);
  }

  async function handleTrackEnded() {
    if (!payload) return;
    const currentIndex = payload.tracks.findIndex((track) => track.id === payload.room.currentTrackId);
    const next = payload.tracks[currentIndex + 1];
    if (next) await updatePlayback(true, 0, next.id);
    else await updatePlayback(false, payload.room.duration, payload.room.currentTrackId);
  }

  async function react(emoji: string) {
    if (!session) return;
    await fetch(`/api/rooms/${session.code}/reaction`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId: session.memberId, emoji }) });
    await readRoom();
  }

  function leaveRoom() {
    uploadController.current?.abort();
    sessionRef.current = null;
    payloadRef.current = null;
    queuedPlayback.current = null;
    ++playbackRevision.current;
    hostUrls.current.forEach((url) => URL.revokeObjectURL(url));
    hostUrls.current.clear();
    setHostSources({});
    audioRef.current?.pause(); sessionStorage.removeItem('hearu-session');
    window.history.replaceState(null, '', window.location.pathname);
    setInviteCode(''); setRoomNotice(''); setSession(null); setPayload(null); setScreen('home');
  }

  function showInviteStatus(status: InviteStatus) {
    setInviteStatus(status);
    window.setTimeout(() => setInviteStatus('idle'), 1_800);
  }

  async function copyInvite() {
    if (!session) return;
    try {
      await copyText(roomInviteUrl(session.code));
      showInviteStatus('copied');
    } catch {
      setError('Could not copy the invite link.');
    }
  }

  async function shareInvite() {
    if (!session) return;
    const url = roomInviteUrl(session.code);
    const roomName = payload?.room.name || 'my listening room';
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Join me on HearU', text: `Join ${roomName} and listen with me.`, url });
        showInviteStatus('shared');
      } else {
        await copyText(url);
        showInviteStatus('copied');
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      await copyText(url);
      showInviteStatus('copied');
    }
  }

  function setAudioVolume(value: number) {
    setVolume(value); if (audioRef.current) audioRef.current.volume = value / 100;
  }

  if (authLoading) {
    return <AppSurface standalone={standalone}><div className="phone-screen"><section className="screen centered-state"><Loader2 className="spin" /><h2>Opening HearU…</h2></section></div></AppSurface>;
  }

  if (!authUser) {
    return <AppSurface standalone={standalone}><div className="phone-screen"><LoginScreen onSignedIn={handleSignedIn} inviteCode={inviteCode} /></div></AppSurface>;
  }

  return (
    <AppSurface standalone={standalone} overlays={<>
      {joinOpen && <JoinOverlay defaultName={authUser.name.split(' ')[0]} initialCode={inviteCode} close={() => setJoinOpen(false)} join={joinRoom} />}
      {accountOpen && <AccountOverlay user={authUser} close={() => setAccountOpen(false)} signOut={() => { void signOut(); }} theme={theme} setTheme={setTheme} />}
    </>}>
        <div className="phone-screen">
          {screen === 'home' && <HomeScreen session={session} user={authUser} goTo={setScreen} openJoin={() => setJoinOpen(true)} openAccount={() => setAccountOpen(true)} />}
          {screen === 'library' && <LibraryScreen audioRef={localAudioRef} selected={selected} goTo={setScreen} error={error} source={{
            scanning,
            message: scanMessage,
            folderPickerAvailable,
            chooseFiles,
            scanFolder: () => { void scanLocalFolder(); },
          }} player={{
            activeIndex: localTrackIndex,
            isPlaying: localIsPlaying,
            position: localPosition,
            duration: localDuration || localTrack?.duration || 0,
            expanded: localPlayerOpen,
            open: openLocalTrack,
            close: () => setLocalPlayerOpen(false),
            toggle: toggleLocalPlayback,
            seek: seekLocalPlayback,
            previous: previousLocalTrack,
            next: nextLocalTrack,
          }} />}
          {screen === 'create' && <CreateScreen selected={selected} defaultName={authUser.name.split(' ')[0]} goTo={setScreen} create={createRoom} busy={busy} error={error} uploadProgress={uploadProgress} source={{
            scanning,
            message: scanMessage,
            folderPickerAvailable,
            chooseFiles,
            scanFolder: () => { void scanLocalFolder(); },
          }} />}
          {screen === 'room' && <RoomScreen session={session} payload={payload} audioRef={audioRef} localSource={payload ? hostSources[payload.room.currentTrackId] : undefined} uploadProgress={uploadProgress} volume={volume} needsGesture={needsGesture} inviteStatus={inviteStatus} notice={roomNotice} onLeave={leaveRoom} onToggle={togglePlayback} onSeek={seek} onVolume={setAudioVolume} onCopyInvite={() => { void copyInvite(); }} onShareInvite={() => { void shareInvite(); }} onSelectTrack={(trackId) => { void selectRoomTrack(trackId); }} onEnded={() => { void handleTrackEnded(); }} onReact={react} onSync={() => payload && void syncAudio(payload.room, true)} />}
        </div>
        <audio
          ref={localAudioRef}
          className="sr-only"
          src={localTrack?.previewUrl}
          preload="metadata"
          onLoadedMetadata={(event) => setLocalDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
          onDurationChange={(event) => setLocalDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
          onPlay={() => { if (localPlayIntent.current) setLocalIsPlaying(true); }}
          onPause={() => { if (!localPlayIntent.current) setLocalIsPlaying(false); }}
          onEnded={finishLocalTrack}
        />
        <GlassNavigation screen={screen} navigate={navigate} />
    </AppSurface>
  );
}
