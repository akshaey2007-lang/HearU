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

type SelectedTrack = {
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
type RoomPayload = { room: RoomState; members: Member[]; reactions: Reaction[] };

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

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const minutes = Math.floor(value / 60);
  return `${minutes}:${Math.floor(value % 60).toString().padStart(2, '0')}`;
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

function HomeScreen({ session, goTo, openJoin }: { session: Session | null; goTo: (screen: Screen) => void; openJoin: () => void }) {
  return (
    <section className="screen home-screen" aria-labelledby="home-title">
      <header className="app-header"><Logo /><span className="avatar profile-button">{initials(session?.displayName ?? 'Guest')}</span></header>
      <div className="intro-copy">
        <p className="eyebrow"><Sparkles size={13} /> Your sound, together</p>
        <h1 id="home-title">Listen closer.<br /><span>Stay in sync.</span></h1>
        <p>Share one song with everyone in the room.</p>
      </div>

      <div className="action-grid">
        <button className="liquid-card action-card action-primary" onClick={() => goTo('library')}>
          <span className="action-icon"><Plus /></span>
          <span><strong>Start a room</strong><small>Choose a song and invite friends</small></span>
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
          <span><Upload /><b>Import</b><small>Choose an audio file</small></span>
          <ChevronRight />
          <span><Share2 /><b>Invite</b><small>Share the room code</small></span>
          <ChevronRight />
          <span><AudioLines /><b>Listen</b><small>Playback stays synced</small></span>
        </div>
      )}

      <div className="privacy-note home-privacy"><ShieldCheck size={16} /><p><strong>Temporary and private.</strong> Songs are available only to room participants and rooms expire automatically.</p></div>
    </section>
  );
}

function LibraryScreen({ selected, goTo, chooseFile, error }: { selected: SelectedTrack | null; goTo: (screen: Screen) => void; chooseFile: (file: File) => void; error: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <section className="screen library-screen" aria-labelledby="library-title">
      <div className="sub-header">
        <button className="icon-button" onClick={() => goTo('home')} aria-label="Go back"><ArrowLeft /></button>
        <span>Local music</span><span className="header-spacer" />
      </div>
      <div className="page-title">
        <p className="eyebrow"><FileAudio size={13} /> From this device</p>
        <h1 id="library-title">Choose a<br /><span>song.</span></h1>
      </div>

      <input ref={inputRef} className="sr-only" type="file" accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) chooseFile(file);
      }} />
      <button className="liquid-card upload-zone" onClick={() => inputRef.current?.click()}>
        <span className="upload-icon"><Upload /></span>
        <strong>{selected ? 'Choose a different song' : 'Import an audio file'}</strong>
        <small>MP3, M4A, WAV, FLAC or OGG · up to 70 MB</small>
      </button>
      {error && <p className="form-error">{error}</p>}

      {selected ? (
        <div className="selected-preview">
          <div className="section-heading"><div><Check size={15} /><span>Ready to share</span></div></div>
          <div className="liquid-card selected-track">
            <Artwork size="md" />
            <div><small>SELECTED SONG</small><strong>{selected.title}</strong><span>{formatTime(selected.duration)} · {(selected.file.size / 1024 / 1024).toFixed(1)} MB</span></div>
            <audio src={selected.previewUrl} controls preload="metadata" />
          </div>
          <Button className="create-button" onClick={() => goTo('create')}>Use this song <ChevronRight /></Button>
        </div>
      ) : (
        <div className="empty-music"><Music2 /><strong>No song selected</strong><p>Your browser keeps local files private until you choose one.</p></div>
      )}
    </section>
  );
}

function CreateScreen({ selected, goTo, create, busy, error }: {
  selected: SelectedTrack | null;
  goTo: (screen: Screen) => void;
  create: (settings: { roomName: string; displayName: string; hostOnly: boolean; reactionsEnabled: boolean }) => void;
  busy: boolean;
  error: string;
}) {
  const [roomName, setRoomName] = useState('After Hours');
  const [displayName, setDisplayName] = useState('Host');
  const [hostOnly, setHostOnly] = useState(true);
  const [reactionsEnabled, setReactionsEnabled] = useState(true);

  if (!selected) {
    return <section className="screen centered-state"><FileAudio /><h2>Choose a song first</h2><Button onClick={() => goTo('library')}>Open music</Button></section>;
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
        <div><small>PLAYING FIRST</small><strong>{selected.title}</strong><span>{formatTime(selected.duration)}</span></div>
      </div>

      <div className="settings-card liquid-card">
        <label className="room-name-field"><span>Room name</span><input value={roomName} onChange={(event) => setRoomName(event.target.value)} maxLength={32} /></label>
        <label className="room-name-field name-field"><span>Your name</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={24} /></label>
        <div className="setting-row"><span className="setting-icon"><LockKeyhole /></span><span><strong>Host controls playback</strong><small>Only you can play, pause and seek</small></span><Switch checked={hostOnly} onCheckedChange={setHostOnly} aria-label="Host controls playback" /></div>
        <div className="setting-row"><span className="setting-icon"><Heart /></span><span><strong>Friend reactions</strong><small>Let listeners react to the song</small></span><Switch checked={reactionsEnabled} onCheckedChange={setReactionsEnabled} aria-label="Friend reactions" /></div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="privacy-note"><ShieldCheck size={16} /><p><strong>Private by default.</strong> The uploaded song and room expire after six hours.</p></div>
      <Button className="create-button" disabled={busy || !roomName.trim() || !displayName.trim()} onClick={() => create({ roomName, displayName, hostOnly, reactionsEnabled })}>
        {busy ? <><Loader2 className="spin" /> Uploading song…</> : <><Radio /> Create listening room <ChevronRight /></>}
      </Button>
    </section>
  );
}

function RoomScreen({ session, payload, audioRef, position, volume, needsGesture, copied, onLeave, onToggle, onSeek, onVolume, onCopy, onReact, onSync }: {
  session: Session | null;
  payload: RoomPayload | null;
  audioRef: RefObject<HTMLAudioElement | null>;
  position: number;
  volume: number;
  needsGesture: boolean;
  copied: boolean;
  onLeave: () => void;
  onToggle: () => void;
  onSeek: (value: number) => void;
  onVolume: (value: number) => void;
  onCopy: () => void;
  onReact: (emoji: string) => void;
  onSync: () => void;
}) {
  if (!session || !payload) return <section className="screen centered-state"><Loader2 className="spin" /><h2>Connecting to room…</h2><button onClick={onLeave}>Cancel</button></section>;
  const { room, members, reactions } = payload;
  const canControl = session.role === 'host' || !room.hostOnly;
  const progress = room.duration ? Math.min(100, (position / room.duration) * 100) : 0;

  return (
    <section className="screen room-screen" aria-labelledby="room-title">
      <div className="sub-header room-header">
        <button className="icon-button" onClick={onLeave} aria-label="Leave room"><X /></button>
        <div><span className="live-dot" /> LIVE · {room.code}</div>
        <button className="icon-button" onClick={onCopy} aria-label="Share room"><Share2 /></button>
      </div>

      <div className="listener-strip liquid-card">
        <AvatarStack members={members} />
        <div><strong>{members.length} {members.length === 1 ? 'listener' : 'listeners'}</strong><small>{session.role === 'host' ? 'You are hosting' : `Joined as ${session.displayName}`}</small></div>
        <span className="sync-pill"><Check size={12} /> Synced</span>
      </div>

      <div className="now-playing">
        <div className="hero-art-wrap"><Artwork size="lg" /><span className="glass-badge"><AudioLines size={14} /> Listening together</span></div>
        <div className="track-title-row"><div><p id="room-title">{room.trackName}</p><span>{room.name}</span></div><span className="room-role">{session.role}</span></div>
      </div>

      <div className="waveform" aria-hidden="true">{waveform.map((height, index) => <i key={index} className={(index / waveform.length) * 100 <= progress ? 'played' : ''} style={{ height: `${height}%` }} />)}</div>
      <input className="seek-slider" type="range" min={0} max={Math.max(room.duration, 1)} step={0.1} value={Math.min(position, Math.max(room.duration, 1))} disabled={!canControl} onChange={(event) => onSeek(Number(event.target.value))} aria-label="Song position" />
      <div className="time-row"><span>{formatTime(position)}</span><span>-{formatTime(Math.max(0, room.duration - position))}</span></div>

      <div className="player-controls">
        <button className="icon-button" disabled={!canControl} onClick={() => onSeek(Math.max(0, position - 10))} aria-label="Back 10 seconds"><SkipBack fill="currentColor" /></button>
        <button className="play-button" disabled={!canControl} onClick={onToggle} aria-label={room.isPlaying ? 'Pause' : 'Play'}>{room.isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" className="play-offset" />}</button>
        <button className="icon-button" disabled={!canControl} onClick={() => onSeek(Math.min(room.duration, position + 10))} aria-label="Forward 10 seconds"><SkipForward fill="currentColor" /></button>
      </div>
      {!canControl && <p className="host-control-note"><LockKeyhole /> The host controls playback</p>}
      {needsGesture && <button className="sync-audio-button" onClick={onSync}><Play /> Tap to hear synchronized audio</button>}

      <div className="volume-row"><Volume2 size={16} /><Slider value={[volume]} min={0} max={100} onValueChange={(value) => onVolume(Array.isArray(value) ? value[0] : value)} aria-label="Volume" /><span>{volume}</span></div>

      {room.reactionsEnabled && <div className="reaction-row" aria-label="Send a reaction">{['💜', '🔥', '✨', '🥹'].map((emoji) => <button key={emoji} onClick={() => onReact(emoji)}>{emoji}</button>)}</div>}
      <div className="reaction-feed" aria-live="polite">{reactions.slice(0, 3).map((reaction) => <span key={reaction.id}><b>{reaction.emoji}</b>{reaction.memberName}</span>)}</div>

      <button className="room-code liquid-card" onClick={onCopy}><span className="setting-icon"><Link2 /></span><span><small>INVITE CODE</small><strong>{room.code}</strong></span><span className="copy-action">{copied ? <><Check /> Copied</> : <><Copy /> Copy</>}</span></button>
      <audio ref={audioRef} src={`/api/rooms/${room.code}/audio`} preload="auto" />
    </section>
  );
}

function JoinOverlay({ close, join }: { close: () => void; join: (code: string, name: string) => Promise<string | null> }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('Friend');
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
        <span className="modal-icon"><Users /></span><p className="eyebrow">Listen together</p><h2 id="join-title">Join a room</h2><p>Enter the code shared by your friend.</p>
        <input className="code-input" value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))} placeholder="8K2P" aria-label="Room code" autoFocus />
        <input className="join-name-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" aria-label="Your name" maxLength={24} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <Button className="join-button" disabled={busy || code.length !== 4 || !name.trim()} onClick={submit}>{busy ? <><Loader2 className="spin" /> Joining…</> : <><Radio /> Join room</>}</Button>
      </div>
    </div>
  );
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>('home');
  const [selected, setSelected] = useState<SelectedTrack | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [payload, setPayload] = useState<RoomPayload | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [position, setPosition] = useState(0);
  const [volume, setVolume] = useState(72);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const dragMoved = useRef(false);
  const previewUrl = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const activeTab = screenLabels.findIndex((item) => item.id === screen);
  const visibleTab = dragPosition === null ? activeTab : Math.round(dragPosition);

  useEffect(() => {
    const saved = sessionStorage.getItem('hearu-session');
    if (!saved) return;
    try {
      const restored = JSON.parse(saved) as Session;
      if (restored.code && restored.memberId) { setSession(restored); setScreen('room'); }
    } catch { sessionStorage.removeItem('hearu-session'); }
  }, []);

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
    if (!session) return;
    const response = await fetch(`/api/rooms/${session.code}`, { cache: 'no-store' });
    if (response.status === 404 || response.status === 410) {
      sessionStorage.removeItem('hearu-session'); setSession(null); setPayload(null); setScreen('home'); return;
    }
    if (!response.ok) return;
    const next = await response.json() as RoomPayload;
    setPayload(next);
    setPosition(next.room.position);
    await syncAudio(next.room);
  }, [session, syncAudio]);

  useEffect(() => {
    if (!session) return;
    void readRoom();
    const statusTimer = window.setInterval(() => { void readRoom(); }, 1_000);
    const presenceTimer = window.setInterval(() => {
      void fetch(`/api/rooms/${session.code}/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId: session.memberId }) });
    }, 5_000);
    return () => { window.clearInterval(statusTimer); window.clearInterval(presenceTimer); };
  }, [session, readRoom]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const update = () => setPosition(audio.currentTime);
    audio.addEventListener('timeupdate', update);
    return () => audio.removeEventListener('timeupdate', update);
  }, [payload?.room.code]);

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

  function chooseFile(file: File) {
    if (file.size > 70 * 1024 * 1024) { setError('Choose a file smaller than 70 MB.'); return; }
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    const url = URL.createObjectURL(file); previewUrl.current = url;
    const probe = new Audio(url);
    const title = file.name.replace(/\.[^/.]+$/, '') || 'Untitled song';
    const finish = (duration: number) => { setSelected({ file, title, duration: Number.isFinite(duration) ? duration : 0, previewUrl: url }); setError(''); };
    probe.addEventListener('loadedmetadata', () => finish(probe.duration), { once: true });
    probe.addEventListener('error', () => finish(0), { once: true });
  }

  async function createRoom(settings: { roomName: string; displayName: string; hostOnly: boolean; reactionsEnabled: boolean }) {
    if (!selected) { setScreen('library'); return; }
    setBusy(true); setError('');
    try {
      const form = new FormData();
      form.set('audio', selected.file); form.set('trackName', selected.title); form.set('duration', String(selected.duration));
      form.set('roomName', settings.roomName); form.set('displayName', settings.displayName);
      form.set('hostOnly', String(settings.hostOnly)); form.set('reactionsEnabled', String(settings.reactionsEnabled));
      const response = await fetch('/api/rooms', { method: 'POST', body: form });
      const result = await response.json() as { error?: string; room?: { code: string }; hostToken?: string; memberId?: string; displayName?: string };
      if (!response.ok || !result.room || !result.hostToken || !result.memberId) throw new Error(result.error || 'Room creation failed.');
      const next: Session = { code: result.room.code, role: 'host', hostToken: result.hostToken, memberId: result.memberId, displayName: result.displayName || settings.displayName };
      sessionStorage.setItem('hearu-session', JSON.stringify(next)); setSession(next); setScreen('room');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Room creation failed.'); }
    finally { setBusy(false); }
  }

  async function joinRoom(code: string, displayName: string) {
    try {
      const response = await fetch(`/api/rooms/${code}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName }) });
      const result = await response.json() as { error?: string; memberId?: string; displayName?: string };
      if (!response.ok || !result.memberId) return result.error || 'Could not join this room.';
      const next: Session = { code, role: 'listener', memberId: result.memberId, displayName: result.displayName || displayName };
      sessionStorage.setItem('hearu-session', JSON.stringify(next)); setSession(next); setJoinOpen(false); setScreen('room'); return null;
    } catch { return 'Could not reach the room. Try again.'; }
  }

  async function updatePlayback(isPlaying: boolean, nextPosition: number) {
    if (!session || !payload) return;
    const response = await fetch(`/api/rooms/${session.code}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.hostToken ?? ''}`, 'X-Member-Id': session.memberId },
      body: JSON.stringify({ isPlaying, position: nextPosition }),
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

  async function react(emoji: string) {
    if (!session) return;
    await fetch(`/api/rooms/${session.code}/reaction`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memberId: session.memberId, emoji }) });
    await readRoom();
  }

  function leaveRoom() {
    audioRef.current?.pause(); sessionStorage.removeItem('hearu-session'); setSession(null); setPayload(null); setScreen('home');
  }

  function copyCode() {
    if (!session) return;
    void navigator.clipboard?.writeText(session.code); setCopied(true); window.setTimeout(() => setCopied(false), 1_500);
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

  return (
    <main className="site-shell">
      <div className="phone-stage"><div className="phone-frame"><div className="dynamic-island" aria-hidden="true" />
        <div className="phone-screen">
          {screen === 'home' && <HomeScreen session={session} goTo={setScreen} openJoin={() => setJoinOpen(true)} />}
          {screen === 'library' && <LibraryScreen selected={selected} goTo={setScreen} chooseFile={chooseFile} error={error} />}
          {screen === 'create' && <CreateScreen selected={selected} goTo={setScreen} create={createRoom} busy={busy} error={error} />}
          {screen === 'room' && <RoomScreen session={session} payload={payload} audioRef={audioRef} position={position} volume={volume} needsGesture={needsGesture} copied={copied} onLeave={leaveRoom} onToggle={togglePlayback} onSeek={seek} onVolume={setAudioVolume} onCopy={copyCode} onReact={react} onSync={() => payload && void syncAudio(payload.room, true)} />}
        </div>
        <nav className="nav-dock" aria-label="App navigation"><div className={`ios-tabbar ${dragPosition !== null ? 'dragging' : ''}`} onPointerDown={startDragging} onPointerMove={moveLens} onPointerUp={finishDragging} onPointerCancel={() => setDragPosition(null)}>
          <span className="tab-slider" style={{ transform: `translateX(${(dragPosition ?? activeTab) * 100}%)` }} />
          {screenLabels.map(({ id, label, icon: Icon }, index) => <button key={id} className={visibleTab === index ? 'active' : ''} onClick={(event) => { if (dragMoved.current) { event.preventDefault(); return; } if (id === 'room' && !session) setJoinOpen(true); else setScreen(id); }} onKeyDown={() => { dragMoved.current = false; }} aria-label={label}><Icon /><span>{label}</span></button>)}
        </div></nav>
      </div></div>
      {joinOpen && <JoinOverlay close={() => setJoinOpen(false)} join={joinRoom} />}
    </main>
  );
}
