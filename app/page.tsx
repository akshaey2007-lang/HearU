'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import {
  ArrowLeft,
  AudioLines,
  Check,
  ChevronRight,
  Copy,
  FileAudio,
  Heart,
  Home as HomeIcon,
  Library,
  Link2,
  Loader2,
  LockKeyhole,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  Share2,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sparkles,
  Upload,
  Users,
  Volume2,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

type Screen = 'home' | 'library' | 'create' | 'room';
type Role = 'host' | 'listener';
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
type ApiResult = { error?: string };
type UploadSessionResult = ApiResult & { trackId?: string; uploadId?: string };
type UploadPartResult = ApiResult & { partNumber?: number; etag?: string };

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

async function uploadSelectedTrack(session: Session, track: SelectedTrack, position: number) {
  const endpoint = `/api/rooms/${session.code}/tracks/upload`;
  const metadata = {
    name: track.title,
    type: track.file.type || 'audio/mpeg',
    size: track.file.size,
    duration: track.duration,
    position,
  };
  const authorization = { Authorization: `Bearer ${session.hostToken ?? ''}` };
  const startResponse = await fetch(endpoint, {
    method: 'POST',
    headers: { ...authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'start', ...metadata }),
  });
  const started = await readApiResult<UploadSessionResult>(startResponse, 'The song upload could not start.');
  if (!startResponse.ok || !started.trackId || !started.uploadId) throw new Error(started.error || 'The song upload could not start.');

  const query = `trackId=${encodeURIComponent(started.trackId)}&uploadId=${encodeURIComponent(started.uploadId)}`;
  const parts: { partNumber: number; etag: string }[] = [];
  try {
    for (let offset = 0, partNumber = 1; offset < track.file.size; offset += UPLOAD_PART_BYTES, partNumber += 1) {
      const partResponse = await fetch(`${endpoint}?${query}&partNumber=${partNumber}`, {
        method: 'PUT',
        headers: { ...authorization, 'Content-Type': 'application/octet-stream' },
        body: track.file.slice(offset, Math.min(offset + UPLOAD_PART_BYTES, track.file.size)),
      });
      const part = await readApiResult<UploadPartResult>(partResponse, 'Part of the song could not be uploaded.');
      if (!partResponse.ok || typeof part.partNumber !== 'number' || !part.etag) throw new Error(part.error || 'Part of the song could not be uploaded.');
      parts.push({ partNumber: part.partNumber, etag: part.etag });
    }

    const completeResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { ...authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete', trackId: started.trackId, uploadId: started.uploadId, parts, ...metadata }),
    });
    const completed = await readApiResult<ApiResult>(completeResponse, 'The song upload could not be finished.');
    if (!completeResponse.ok) throw new Error(completed.error || 'The song upload could not be finished.');
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

function roomInviteUrl(code: string) {
  const url = new URL(window.location.origin);
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

function AccountOverlay({ user, close, signOut }: { user: AuthUser; close: () => void; signOut: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={close}>
      <div className="account-modal liquid-card" role="dialog" aria-modal="true" aria-labelledby="account-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="icon-button close-modal" onClick={close} aria-label="Close"><X /></button>
        <ProfileAvatar user={user} size="lg" />
        <p className="eyebrow">Google account</p><h2 id="account-title">{user.name}</h2><p>{user.email}</p>
        <button className="signout-button" onClick={signOut}>Sign out</button>
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

function LibraryScreen({ selected, goTo, chooseFiles, error, player }: { selected: SelectedTrack[]; goTo: (screen: Screen) => void; chooseFiles: (files: File[]) => void; error: string; player: LocalPlayerController }) {
  const inputRef = useRef<HTMLInputElement>(null);
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

        <input className="local-seek" type="range" min={0} max={Math.max(duration, 1)} step={0.1} value={Math.min(player.position, Math.max(duration, 1))} onChange={(event) => player.seek(Number(event.target.value))} aria-label="Song position" />
        <div className="time-row"><span>{formatTime(player.position)}</span><span>-{formatTime(Math.max(0, duration - player.position))}</span></div>

        <div className="player-controls local-player-controls">
          <button className="icon-button" disabled={player.activeIndex === 0} onClick={player.previous} aria-label="Previous song"><SkipBack fill="currentColor" /></button>
          <button className="play-button" onClick={player.toggle} aria-label={player.isPlaying ? 'Pause' : 'Play'}>{player.isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" className="play-offset" />}</button>
          <button className="icon-button" disabled={player.activeIndex >= selected.length - 1} onClick={player.next} aria-label="Next song"><SkipForward fill="currentColor" /></button>
        </div>
        <p className="local-device-note"><ShieldCheck /> Playing directly from your device. Nothing is uploaded.</p>

        <div className="queue-heading"><span><Music2 /> Local queue</span><small>{selected.length} {selected.length === 1 ? 'song' : 'songs'}</small></div>
        <div className="room-queue local-queue liquid-card" aria-label="Local music queue">
          {selected.map((track, index) => {
            const active = index === player.activeIndex;
            return <button key={track.id} className={active ? 'queue-track active' : 'queue-track'} onClick={() => player.open(index)}>
              <span className="queue-number">{active ? <AudioLines /> : index + 1}</span>
              <span><strong>{track.title}</strong><small>{active ? 'Now playing' : `Song ${index + 1}`}</small></span>
              <time>{formatTime(track.duration)}</time>
            </button>;
          })}
        </div>
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
        <h1 id="library-title">Choose your<br /><span>songs.</span></h1>
      </div>

      <input ref={inputRef} className="sr-only" type="file" multiple accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg" onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        if (files.length) chooseFiles(files);
        event.target.value = '';
      }} />
      <button className="liquid-card upload-zone" onClick={() => inputRef.current?.click()}>
        <span className="upload-icon"><Upload /></span>
        <strong>{selected.length ? 'Choose a different playlist' : 'Select songs from this device'}</strong>
        <small>Up to 250 songs · 70 MB per file</small>
      </button>
      {error && <p className="form-error">{error}</p>}

      {selected.length ? (
        <div className="selected-preview">
          <div className="section-heading"><div><Check size={15} /><span>{selected.length} of 250 selected</span></div></div>
          <button className="liquid-card selected-track selection-summary local-summary" onClick={() => player.open(player.activeIndex)}>
            <Artwork size="md" />
            <div><small>PLAYLIST READY</small><strong>{selected.length} {selected.length === 1 ? 'song' : 'songs'}</strong><span>{formatTime(totalDuration)} · {(totalSize / 1024 / 1024).toFixed(1)} MB total</span></div>
            <span className="local-summary-play"><Play fill="currentColor" /></span>
          </button>
          <div className="liquid-card selection-list local-library-list" aria-label="Selected songs">
            {selected.map((track, index) => <button className={index === player.activeIndex ? 'selection-row local-track-row active' : 'selection-row local-track-row'} key={track.id} onClick={() => player.open(index)}><span>{index + 1}</span><strong>{track.title}</strong><small>{formatTime(track.duration)}</small></button>)}
          </div>
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

function CreateScreen({ selected, defaultName, goTo, create, busy, error, uploadProgress }: {
  selected: SelectedTrack[];
  defaultName: string;
  goTo: (screen: Screen) => void;
  create: (settings: { roomName: string; displayName: string; hostOnly: boolean; reactionsEnabled: boolean }) => void;
  busy: boolean;
  error: string;
  uploadProgress: { done: number; total: number } | null;
}) {
  const [roomName, setRoomName] = useState('After Hours');
  const [displayName, setDisplayName] = useState(defaultName);
  const [hostOnly, setHostOnly] = useState(true);
  const [reactionsEnabled, setReactionsEnabled] = useState(true);

  if (!selected.length) {
    return <section className="screen centered-state"><FileAudio /><h2>Choose songs first</h2><Button onClick={() => goTo('library')}>Open music</Button></section>;
  }

  return (
    <section className="screen create-screen" aria-labelledby="create-title">
      <div className="sub-header">
        <button className="icon-button" onClick={() => goTo('library')} aria-label="Go back"><ArrowLeft /></button>
        <span>New room</span><span className="header-spacer" />
      </div>
      <div className="page-title compact-title"><p className="eyebrow"><Radio size={13} /> Almost ready</p><h1 id="create-title">Set the<br /><span>room.</span></h1></div>

      <div className="liquid-card selected-track compact-track">
        <Artwork size="md" />
        <div><small>{selected.length} SONG PLAYLIST</small><strong>{selected[0].title}</strong><span>Plays first · {formatTime(selected[0].duration)}</span></div>
      </div>

      <div className="settings-card liquid-card">
        <label className="room-name-field"><span>Room name</span><input value={roomName} onChange={(event) => setRoomName(event.target.value)} maxLength={32} /></label>
        <label className="room-name-field name-field"><span>Your name</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={24} /></label>
        <div className="setting-row"><span className="setting-icon"><LockKeyhole /></span><span><strong>Host controls playback</strong><small>Only you can play, pause and seek</small></span><Switch checked={hostOnly} onCheckedChange={setHostOnly} aria-label="Host controls playback" /></div>
        <div className="setting-row"><span className="setting-icon"><Heart /></span><span><strong>Friend reactions</strong><small>Let listeners react to the song</small></span><Switch checked={reactionsEnabled} onCheckedChange={setReactionsEnabled} aria-label="Friend reactions" /></div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="privacy-note"><ShieldCheck size={16} /><p><strong>Temporary by design.</strong> Uploaded songs and the room expire after six hours.</p></div>
      <Button className="create-button" disabled={busy || !roomName.trim() || !displayName.trim()} onClick={() => create({ roomName, displayName, hostOnly, reactionsEnabled })}>
        {busy ? <><Loader2 className="spin" /> {uploadProgress ? `Uploading ${uploadProgress.done} of ${uploadProgress.total} songs…` : 'Creating room…'}</> : <><Radio /> Create listening room <ChevronRight /></>}
      </Button>
    </section>
  );
}

function RoomScreen({ session, payload, audioRef, position, volume, needsGesture, inviteStatus, notice, onLeave, onToggle, onSeek, onVolume, onCopyInvite, onShareInvite, onSelectTrack, onEnded, onReact, onSync }: {
  session: Session | null;
  payload: RoomPayload | null;
  audioRef: RefObject<HTMLAudioElement | null>;
  position: number;
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
  if (!session || !payload) return <section className="screen centered-state"><Loader2 className="spin" /><h2>Connecting to room…</h2><button onClick={onLeave}>Cancel</button></section>;
  const { room, tracks, members, reactions } = payload;
  const canControl = session.role === 'host' || !room.hostOnly;
  const progress = room.duration ? Math.min(100, (position / room.duration) * 100) : 0;
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

      <div className="now-playing">
        <div className="hero-art-wrap"><Artwork size="lg" /><span className="glass-badge"><AudioLines size={14} /> Listening together</span></div>
        <div className="track-title-row"><div><p id="room-title">{room.trackName}</p><span>{room.name}</span></div><span className="room-role">{session.role}</span></div>
      </div>

      <div className="waveform" aria-hidden="true">{waveform.map((height, index) => <i key={index} className={(index / waveform.length) * 100 <= progress ? 'played' : ''} style={{ height: `${height}%` }} />)}</div>
      <input className="seek-slider" type="range" min={0} max={Math.max(room.duration, 1)} step={0.1} value={Math.min(position, Math.max(room.duration, 1))} disabled={!canControl} onChange={(event) => onSeek(Number(event.target.value))} aria-label="Song position" />
      <div className="time-row"><span>{formatTime(position)}</span><span>-{formatTime(Math.max(0, room.duration - position))}</span></div>

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
      <div className="room-queue liquid-card" aria-label="Room playlist">
        {tracks.map((track, index) => {
          const active = track.id === room.currentTrackId;
          return <button key={track.id} className={active ? 'queue-track active' : 'queue-track'} disabled={!canControl && !active} onClick={() => !active && onSelectTrack(track.id)}>
            <span className="queue-number">{active ? <AudioLines /> : index + 1}</span>
            <span><strong>{track.name}</strong><small>{active ? 'Now playing' : `Song ${index + 1}`}</small></span>
            <time>{formatTime(track.duration)}</time>
          </button>;
        })}
      </div>
      <audio ref={audioRef} src={`/api/rooms/${room.code}/audio?track=${encodeURIComponent(room.currentTrackId)}`} preload="auto" onLoadedMetadata={onSync} onEnded={() => canControl && onEnded()} />
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

export default function Home() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accountOpen, setAccountOpen] = useState(false);
  const [screen, setScreen] = useState<Screen>('home');
  const [selected, setSelected] = useState<SelectedTrack[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [payload, setPayload] = useState<RoomPayload | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [roomNotice, setRoomNotice] = useState('');
  const [position, setPosition] = useState(0);
  const [volume, setVolume] = useState(72);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>('idle');
  const [localTrackIndex, setLocalTrackIndex] = useState(0);
  const [localIsPlaying, setLocalIsPlaying] = useState(false);
  const [localPosition, setLocalPosition] = useState(0);
  const [localDuration, setLocalDuration] = useState(0);
  const [localPlayerOpen, setLocalPlayerOpen] = useState(false);
  const [localPlayRequest, setLocalPlayRequest] = useState(0);
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const dragMoved = useRef(false);
  const previewUrls = useRef<Set<string>>(new Set());
  const audioRef = useRef<HTMLAudioElement>(null);
  const localAudioRef = useRef<HTMLAudioElement>(null);
  const activeTab = screenLabels.findIndex((item) => item.id === screen);
  const visibleTab = dragPosition === null ? activeTab : Math.round(dragPosition);
  const localTrack = selected[localTrackIndex] ?? selected[0];

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('room')?.trim().toUpperCase() ?? '';
    if (/^[A-Z0-9]{4}$/.test(code)) {
      setInviteCode(code);
      setJoinOpen(true);
    }
  }, []);

  useEffect(() => () => {
    localAudioRef.current?.pause();
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current.clear();
  }, []);

  useEffect(() => {
    const audio = localAudioRef.current;
    if (!audio || !localTrack || localPlayRequest === 0) return;
    audioRef.current?.pause();
    audio.load();
    void audio.play().catch(() => setLocalIsPlaying(false));
  }, [localPlayRequest, localTrack?.previewUrl]);

  useEffect(() => {
    if (screen !== 'room') return;
    localAudioRef.current?.pause();
    setLocalIsPlaying(false);
  }, [screen]);

  useEffect(() => {
    let active = true;
    void fetch('/api/auth/me', { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() as Promise<{ user: AuthUser }> : { user: null })
      .then(({ user }) => { if (active) setAuthUser(user); })
      .catch(() => undefined)
      .finally(() => { if (active) setAuthLoading(false); });
    return () => { active = false; };
  }, []);

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
    if (!session || !authUser) return;
    const response = await fetch(`/api/rooms/${session.code}`, { cache: 'no-store' });
    if (response.status === 401) {
      sessionStorage.removeItem('hearu-session'); setSession(null); setPayload(null); setAuthUser(null); setScreen('home'); return;
    }
    if (response.status === 404 || response.status === 410) {
      sessionStorage.removeItem('hearu-session'); setSession(null); setPayload(null); setScreen('home'); return;
    }
    if (!response.ok) return;
    const next = await response.json() as RoomPayload;
    setPayload(next);
    setPosition(next.room.position);
    await syncAudio(next.room);
  }, [session, authUser, syncAudio]);

  useEffect(() => {
    if (!session || !authUser) return;
    void readRoom();
    const statusTimer = window.setInterval(() => { void readRoom(); }, 1_000);
    const presenceTimer = window.setInterval(() => {
      void fetch(`/api/rooms/${session.code}/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId: session.memberId }) });
    }, 5_000);
    return () => { window.clearInterval(statusTimer); window.clearInterval(presenceTimer); };
  }, [session, authUser, readRoom]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const update = () => setPosition(audio.currentTime);
    audio.addEventListener('timeupdate', update);
    return () => audio.removeEventListener('timeupdate', update);
  }, [payload?.room.code, payload?.room.currentTrackId]);

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

  function chooseFiles(files: File[]) {
    const candidates = files.slice(0, 250);
    const supported = candidates.filter((file) => {
      const extensionOkay = /\.(mp3|m4a|wav|flac|ogg)$/i.test(file.name);
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
    const skipped = files.length - supported.length;
    setError(skipped ? `${skipped} ${skipped === 1 ? 'file was' : 'files were'} skipped. HearU supports up to 250 audio files, 70 MB each.` : '');

    tracks.forEach((track) => {
      const probe = new Audio(track.previewUrl);
      const finish = (duration: number) => setSelected((current) => current.map((item) => item.id === track.id ? { ...item, duration: Number.isFinite(duration) ? duration : 0 } : item));
      probe.addEventListener('loadedmetadata', () => finish(probe.duration), { once: true });
      probe.addEventListener('error', () => finish(0), { once: true });
    });
  }

  function openLocalTrack(index: number) {
    if (!selected[index]) return;
    setLocalPlayerOpen(true);
    audioRef.current?.pause();
    if (index === localTrackIndex) {
      const audio = localAudioRef.current;
      if (audio) void audio.play().catch(() => setLocalIsPlaying(false));
      return;
    }
    setLocalTrackIndex(index);
    setLocalPosition(0);
    setLocalDuration(selected[index].duration);
    setLocalPlayRequest((value) => value + 1);
  }

  function toggleLocalPlayback() {
    const audio = localAudioRef.current;
    if (!audio || !localTrack) return;
    if (audio.paused) {
      audioRef.current?.pause();
      void audio.play().catch(() => setLocalIsPlaying(false));
    } else {
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
      if (localAudioRef.current) localAudioRef.current.currentTime = 0;
      setLocalIsPlaying(false);
      setLocalPosition(0);
    }
  }

  async function createRoom(settings: { roomName: string; displayName: string; hostOnly: boolean; reactionsEnabled: boolean }) {
    if (!selected.length) { setScreen('library'); return; }
    localAudioRef.current?.pause();
    setBusy(true); setError('');
    setUploadProgress({ done: 0, total: selected.length });
    try {
      const form = new FormData();
      form.set('roomName', settings.roomName); form.set('displayName', settings.displayName);
      form.set('hostOnly', String(settings.hostOnly)); form.set('reactionsEnabled', String(settings.reactionsEnabled));
      const response = await fetch('/api/rooms', { method: 'POST', body: form });
      const result = await readApiResult<ApiResult & { room?: { code: string }; hostToken?: string; memberId?: string; displayName?: string }>(response, 'Room creation failed.');
      if (!response.ok || !result.room || !result.hostToken || !result.memberId) throw new Error(result.error || 'Room creation failed.');
      const next: Session = { code: result.room.code, role: 'host', hostToken: result.hostToken, memberId: result.memberId, displayName: result.displayName || settings.displayName };

      await uploadSelectedTrack(next, selected[0], 0);
      sessionStorage.setItem('hearu-session', JSON.stringify(next));
      window.history.replaceState(null, '', roomInviteUrl(next.code));
      setUploadProgress({ done: 1, total: selected.length });

      let failed = 0;
      let completed = 1;
      let cursor = 1;
      async function uploadWorker() {
        while (cursor < selected.length) {
          const index = cursor;
          cursor += 1;
          const track = selected[index];
          try {
            await uploadSelectedTrack(next, track, index);
          } catch {
            failed += 1;
          }
          completed += 1;
          setUploadProgress({ done: completed, total: selected.length });
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, selected.length - 1) }, () => uploadWorker()));

      localAudioRef.current?.removeAttribute('src');
      localAudioRef.current?.load();
      previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrls.current.clear();
      setSelected([]);
      setLocalPlayerOpen(false); setLocalTrackIndex(0); setLocalPosition(0); setLocalDuration(0); setLocalIsPlaying(false); setLocalPlayRequest(0);
      setRoomNotice(failed ? `${failed} ${failed === 1 ? 'song' : 'songs'} could not be uploaded. The rest are ready.` : '');
      setInviteCode(next.code); setSession(next); setScreen('room');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Room creation failed.'); }
    finally { setBusy(false); setUploadProgress(null); }
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
    audioRef.current?.pause();
    localAudioRef.current?.pause();
    localAudioRef.current?.removeAttribute('src');
    localAudioRef.current?.load();
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current.clear();
    await fetch('/api/auth/me', { method: 'DELETE' }).catch(() => undefined);
    sessionStorage.removeItem('hearu-session');
    window.history.replaceState(null, '', window.location.pathname);
    setInviteCode(''); setRoomNotice(''); setSession(null); setPayload(null); setSelected([]); setAccountOpen(false); setScreen('home'); setAuthUser(null);
    setLocalPlayerOpen(false); setLocalTrackIndex(0); setLocalPosition(0); setLocalDuration(0); setLocalIsPlaying(false); setLocalPlayRequest(0);
  }

  async function updatePlayback(isPlaying: boolean, nextPosition: number, trackId?: string) {
    if (!session || !payload) return;
    const response = await fetch(`/api/rooms/${session.code}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.hostToken ?? ''}`, 'X-Member-Id': session.memberId },
      body: JSON.stringify({ isPlaying, position: nextPosition, trackId }),
    });
    if (response.ok) await readRoom();
  }

  async function togglePlayback() {
    if (!payload) return;
    const audio = audioRef.current;
    if (!audio) return;
    const nextPlaying = !payload.room.isPlaying;
    if (nextPlaying) { try { await audio.play(); setNeedsGesture(false); } catch { setNeedsGesture(true); } } else audio.pause();
    await updatePlayback(nextPlaying, audio.currentTime);
  }

  async function seek(value: number) {
    if (!payload) return;
    if (audioRef.current) audioRef.current.currentTime = value;
    setPosition(value); await updatePlayback(payload.room.isPlaying, value);
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

  function pointerPosition(event: ReactPointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect(); const cellWidth = (bounds.width - 8) / screenLabels.length;
    return Math.max(0, Math.min(screenLabels.length - 1, (event.clientX - bounds.left - 4 - cellWidth / 2) / cellWidth));
  }
  function startDragging(event: ReactPointerEvent<HTMLDivElement>) { event.currentTarget.setPointerCapture(event.pointerId); dragMoved.current = false; setDragPosition(pointerPosition(event)); }
  function moveLens(event: ReactPointerEvent<HTMLDivElement>) { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const next = pointerPosition(event); if (Math.abs(next - activeTab) > .08) dragMoved.current = true; setDragPosition(next); }
  function finishDragging(event: ReactPointerEvent<HTMLDivElement>) { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const target = Math.round(pointerPosition(event)); event.currentTarget.releasePointerCapture(event.pointerId); setDragPosition(null); if (screenLabels[target].id === 'room' && !session) setJoinOpen(true); else setScreen(screenLabels[target].id); }

  if (authLoading) {
    return <main className="site-shell"><div className="phone-stage"><div className="phone-frame"><div className="phone-screen"><section className="screen centered-state"><Loader2 className="spin" /><h2>Opening HearU…</h2></section></div></div></div></main>;
  }

  if (!authUser) {
    return <main className="site-shell"><div className="phone-stage"><div className="phone-frame"><div className="dynamic-island" aria-hidden="true" /><div className="phone-screen"><LoginScreen onSignedIn={handleSignedIn} inviteCode={inviteCode} /></div></div></div></main>;
  }

  return (
    <main className="site-shell">
      <div className="phone-stage"><div className="phone-frame"><div className="dynamic-island" aria-hidden="true" />
        <div className="phone-screen">
          {screen === 'home' && <HomeScreen session={session} user={authUser} goTo={setScreen} openJoin={() => setJoinOpen(true)} openAccount={() => setAccountOpen(true)} />}
          {screen === 'library' && <LibraryScreen selected={selected} goTo={setScreen} chooseFiles={chooseFiles} error={error} player={{
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
          {screen === 'create' && <CreateScreen selected={selected} defaultName={authUser.name.split(' ')[0]} goTo={setScreen} create={createRoom} busy={busy} error={error} uploadProgress={uploadProgress} />}
          {screen === 'room' && <RoomScreen session={session} payload={payload} audioRef={audioRef} position={position} volume={volume} needsGesture={needsGesture} inviteStatus={inviteStatus} notice={roomNotice} onLeave={leaveRoom} onToggle={togglePlayback} onSeek={seek} onVolume={setAudioVolume} onCopyInvite={() => { void copyInvite(); }} onShareInvite={() => { void shareInvite(); }} onSelectTrack={(trackId) => { void selectRoomTrack(trackId); }} onEnded={() => { void handleTrackEnded(); }} onReact={react} onSync={() => payload && void syncAudio(payload.room, true)} />}
        </div>
        <audio
          ref={localAudioRef}
          className="sr-only"
          src={localTrack?.previewUrl}
          preload="metadata"
          onTimeUpdate={(event) => setLocalPosition(event.currentTarget.currentTime)}
          onLoadedMetadata={(event) => setLocalDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
          onDurationChange={(event) => setLocalDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
          onPlay={() => setLocalIsPlaying(true)}
          onPause={() => setLocalIsPlaying(false)}
          onEnded={finishLocalTrack}
        />
        <nav className="nav-dock" aria-label="App navigation"><div className={`ios-tabbar ${dragPosition !== null ? 'dragging' : ''}`} onPointerDown={startDragging} onPointerMove={moveLens} onPointerUp={finishDragging} onPointerCancel={() => setDragPosition(null)}>
          <span className="tab-slider" style={{ transform: `translateX(${(dragPosition ?? activeTab) * 100}%)` }} />
          {screenLabels.map(({ id, label, icon: Icon }, index) => <button key={id} className={visibleTab === index ? 'active' : ''} onClick={(event) => { if (dragMoved.current) { event.preventDefault(); return; } if (id === 'room' && !session) setJoinOpen(true); else setScreen(id); }} onKeyDown={() => { dragMoved.current = false; }} aria-label={label}><Icon /><span>{label}</span></button>)}
        </div></nav>
      </div></div>
      {joinOpen && <JoinOverlay defaultName={authUser.name.split(' ')[0]} initialCode={inviteCode} close={() => setJoinOpen(false)} join={joinRoom} />}
      {accountOpen && <AccountOverlay user={authUser} close={() => setAccountOpen(false)} signOut={() => { void signOut(); }} />}
    </main>
  );
}
