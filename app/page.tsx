'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  AudioLines,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  FileAudio,
  Headphones,
  Heart,
  Home as HomeIcon,
  Library,
  Link2,
  ListMusic,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  Search,
  Send,
  Share2,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sparkles,
  Upload,
  Users,
  Volume2,
  WandSparkles,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

type Screen = 'home' | 'library' | 'create' | 'room';

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

type Track = {
  title: string;
  artist: string;
  duration: string;
  tone: string;
};

const tracks: Track[] = [
  { title: 'Afterglow', artist: 'Nova Lane', duration: '3:42', tone: 'violet' },
  { title: 'Midnight Drive', artist: 'Aster', duration: '4:08', tone: 'cyan' },
  { title: 'Slow Motion', artist: 'Mira Coast', duration: '3:18', tone: 'rose' },
  { title: 'Blue Hour', artist: 'Low Tide', duration: '2:56', tone: 'blue' },
];

const waveform = [14, 30, 20, 42, 28, 58, 35, 68, 48, 78, 52, 36, 65, 86, 44, 70, 54, 30, 58, 40, 76, 52, 24, 44, 28, 64, 46, 30, 54, 22, 38, 18];

function Logo() {
  return (
    <div className="brand" aria-label="HearU home">
      <span className="brand-mark"><AudioLines size={19} strokeWidth={2.4} /></span>
      <span>Hear<span>U</span></span>
    </div>
  );
}

function Artwork({ tone = 'violet', size = 'md' }: { tone?: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={`artwork artwork-${tone} artwork-${size}`} aria-hidden="true">
      <span className="artwork-orbit" />
      <span className="artwork-core"><Music2 /></span>
      <span className="artwork-shine" />
    </div>
  );
}

function AvatarStack() {
  return (
    <div className="avatar-stack" aria-label="4 friends in room">
      <span className="avatar avatar-a">AK</span>
      <span className="avatar avatar-b">RV</span>
      <span className="avatar avatar-c">NS</span>
      <span className="avatar avatar-more">+1</span>
    </div>
  );
}

function AppHeader({ onProfile }: { onProfile: () => void }) {
  return (
    <header className="app-header">
      <Logo />
      <button className="avatar profile-button" onClick={onProfile} aria-label="Open profile">AK</button>
    </header>
  );
}

function HomeScreen({ goTo, openJoin }: { goTo: (screen: Screen) => void; openJoin: () => void }) {
  return (
    <section className="screen home-screen" aria-labelledby="home-title">
      <AppHeader onProfile={() => {}} />
      <div className="intro-copy">
        <p className="eyebrow"><Sparkles size={13} /> Your sound, together</p>
        <h1 id="home-title">Good evening,<br /><span>Akshaey.</span></h1>
        <p>Bring the room closer, one song at a time.</p>
      </div>

      <div className="action-grid">
        <button className="liquid-card action-card action-primary" onClick={() => goTo('library')}>
          <span className="action-icon"><Plus /></span>
          <span><strong>Start a room</strong><small>Pick a song & invite friends</small></span>
          <ChevronRight className="action-arrow" />
        </button>
        <button className="liquid-card action-card" onClick={openJoin}>
          <span className="action-icon soft"><Users /></span>
          <span><strong>Join friends</strong><small>Enter a room code</small></span>
          <ChevronRight className="action-arrow" />
        </button>
      </div>

      <div className="section-heading">
        <div><span className="live-dot" /><span>Live now</span></div>
        <button onClick={() => goTo('room')}>See room <ChevronRight size={15} /></button>
      </div>

      <button className="liquid-card live-card" onClick={() => goTo('room')}>
        <Artwork tone="violet" size="md" />
        <div className="live-copy">
          <span className="room-label"><Radio size={12} /> ROOM 8K2P</span>
          <strong>Afterglow</strong>
          <small>Nova Lane</small>
          <div className="live-meta"><AvatarStack /><span>4 listening</span></div>
        </div>
        <span className="mini-equalizer" aria-hidden="true"><i /><i /><i /><i /></span>
      </button>

      <div className="section-heading history-heading">
        <div><Clock3 size={15} /><span>Recent sessions</span></div>
        <button>View all</button>
      </div>
      <div className="history-list">
        {tracks.slice(1, 3).map((track) => (
          <button key={track.title} className="history-row" onClick={() => goTo('room')}>
            <Artwork tone={track.tone} size="sm" />
            <span className="history-copy"><strong>{track.title}</strong><small>{track.artist} · with 3 friends</small></span>
            <Play size={16} fill="currentColor" />
          </button>
        ))}
      </div>
    </section>
  );
}

function LibraryScreen({ goTo, selectTrack }: { goTo: (screen: Screen) => void; selectTrack: (track: Track) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  function importTrack(file?: File) {
    if (!file) return;
    const title = file.name.replace(/\.[^/.]+$/, '') || 'Imported song';
    selectTrack({ title, artist: 'From this device', duration: '—', tone: 'cyan' });
  }

  return (
    <section className="screen library-screen" aria-labelledby="library-title">
      <div className="sub-header">
        <button className="icon-button" onClick={() => goTo('home')} aria-label="Go back"><ArrowLeft /></button>
        <span>Choose a song</span>
        <button className="icon-button" aria-label="More options"><MoreHorizontal /></button>
      </div>

      <div className="page-title">
        <p className="eyebrow"><FileAudio size={13} /> Local music</p>
        <h1 id="library-title">What are we<br /><span>playing?</span></h1>
      </div>

      <label className="search-field">
        <Search size={18} />
        <input type="search" placeholder="Search songs on this device" aria-label="Search local songs" />
      </label>

      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept="audio/*"
        onChange={(event) => importTrack(event.target.files?.[0])}
      />
      <button className="liquid-card upload-card" onClick={() => inputRef.current?.click()}>
        <span className="upload-icon"><Upload /></span>
        <span><strong>Import from device</strong><small>MP3, M4A, WAV or FLAC</small></span>
        <ChevronRight />
      </button>

      <div className="section-heading library-heading">
        <div><ListMusic size={15} /><span>Recently added</span></div>
        <span className="track-count">12 tracks</span>
      </div>

      <div className="track-list">
        {tracks.map((track, index) => (
          <button key={track.title} className="track-row" onClick={() => selectTrack(track)}>
            <span className="track-number">{String(index + 1).padStart(2, '0')}</span>
            <Artwork tone={track.tone} size="sm" />
            <span className="history-copy"><strong>{track.title}</strong><small>{track.artist}</small></span>
            <span className="duration">{track.duration}</span>
            <ChevronRight size={16} />
          </button>
        ))}
      </div>
    </section>
  );
}

function CreateScreen({ goTo, track }: { goTo: (screen: Screen) => void; track: Track }) {
  const [reactions, setReactions] = useState(true);
  const [hostOnly, setHostOnly] = useState(true);

  return (
    <section className="screen create-screen" aria-labelledby="create-title">
      <div className="sub-header">
        <button className="icon-button" onClick={() => goTo('library')} aria-label="Go back"><ArrowLeft /></button>
        <span>New room</span>
        <span className="header-spacer" />
      </div>

      <div className="page-title compact-title">
        <p className="eyebrow"><WandSparkles size={13} /> Almost there</p>
        <h1 id="create-title">Set the<br /><span>vibe.</span></h1>
      </div>

      <div className="liquid-card selected-track">
        <Artwork tone={track.tone} size="md" />
        <div><small>PLAYING FIRST</small><strong>{track.title}</strong><span>{track.artist} · {track.duration}</span></div>
        <button className="icon-button" onClick={() => goTo('library')} aria-label="Change song"><MoreHorizontal /></button>
      </div>

      <div className="settings-card liquid-card">
        <label className="room-name-field">
          <span>Room name</span>
          <input defaultValue="After Hours" maxLength={32} />
        </label>
        <div className="setting-row">
          <span className="setting-icon"><LockKeyhole /></span>
          <span><strong>Host controls playback</strong><small>Only you can play, pause and skip</small></span>
          <Switch checked={hostOnly} onCheckedChange={setHostOnly} aria-label="Host controls playback" />
        </div>
        <div className="setting-row">
          <span className="setting-icon"><Heart /></span>
          <span><strong>Friend reactions</strong><small>Let everyone react to the music</small></span>
          <Switch checked={reactions} onCheckedChange={setReactions} aria-label="Allow friend reactions" />
        </div>
      </div>

      <div className="privacy-note"><ShieldCheck size={16} /><p><strong>Private by default.</strong> The song is only available to invited listeners while the room is active.</p></div>

      <Button className="create-button" onClick={() => goTo('room')}>
        <Radio /> Create listening room <ChevronRight />
      </Button>
    </section>
  );
}

function RoomScreen({ goTo }: { goTo: (screen: Screen) => void }) {
  const [playing, setPlaying] = useState(true);
  const [copied, setCopied] = useState(false);
  const [liked, setLiked] = useState(false);

  function copyCode() {
    setCopied(true);
    navigator.clipboard?.writeText('8K2P');
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <section className="screen room-screen" aria-labelledby="room-title">
      <h1 id="room-title" className="sr-only">Live listening room</h1>
      <div className="sub-header room-header">
        <button className="icon-button" onClick={() => goTo('home')} aria-label="Leave room"><X /></button>
        <div><span className="live-dot" /> LIVE · ROOM 8K2P</div>
        <button className="icon-button" onClick={copyCode} aria-label="Share room"><Share2 /></button>
      </div>

      <div className="listener-strip liquid-card">
        <AvatarStack />
        <div><strong>You + 3 friends</strong><small>Everyone is in sync</small></div>
        <span className="sync-pill"><Check size={12} /> Synced</span>
      </div>

      <div className="now-playing">
        <div className="hero-art-wrap">
          <Artwork tone="violet" size="lg" />
          <span className="glass-badge"><Headphones size={14} /> Listening together</span>
        </div>
        <div className="track-title-row">
          <div><p>Afterglow</p><span>Nova Lane</span></div>
          <button className={`icon-button heart-button ${liked ? 'liked' : ''}`} onClick={() => setLiked(!liked)} aria-label="Like song"><Heart fill={liked ? 'currentColor' : 'none'} /></button>
        </div>
      </div>

      <div className="waveform" aria-hidden="true">
        {waveform.map((height, index) => <i key={index} className={index < 13 ? 'played' : ''} style={{ height: `${height}%` }} />)}
      </div>
      <div className="time-row"><span>1:26</span><span>-2:16</span></div>

      <div className="player-controls">
        <button className="icon-button" aria-label="Previous song"><SkipBack fill="currentColor" /></button>
        <button className="play-button" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" className="play-offset" />}
        </button>
        <button className="icon-button" aria-label="Next song"><SkipForward fill="currentColor" /></button>
      </div>

      <div className="volume-row"><Volume2 size={16} /><Slider defaultValue={[68]} aria-label="Volume" /><span>68</span></div>

      <div className="reaction-row" aria-label="Send a reaction">
        {['💜', '🔥', '✨', '🥹'].map((reaction) => <button key={reaction}>{reaction}</button>)}
        <button className="message-button" aria-label="Open room chat"><MessageCircle /></button>
      </div>

      <button className="room-code liquid-card" onClick={copyCode}>
        <span className="setting-icon"><Link2 /></span>
        <span><small>INVITE CODE</small><strong>8K2P</strong></span>
        <span className="copy-action">{copied ? <><Check /> Copied</> : <><Copy /> Copy</>}</span>
      </button>
    </section>
  );
}

function JoinOverlay({ close, join }: { close: () => void; join: () => void }) {
  const [code, setCode] = useState('');
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={close}>
      <div className="join-modal liquid-card" role="dialog" aria-modal="true" aria-labelledby="join-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="icon-button close-modal" onClick={close} aria-label="Close"><X /></button>
        <span className="modal-icon"><Users /></span>
        <p className="eyebrow">Listen together</p>
        <h2 id="join-title">Join a room</h2>
        <p>Ask your friend for their four-character invite code.</p>
        <input
          className="code-input"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
          placeholder="8K2P"
          aria-label="Room code"
          autoFocus
        />
        <Button className="join-button" disabled={code.length !== 4} onClick={join}><Send /> Join room</Button>
      </div>
    </div>
  );
}

const screenLabels: { id: Screen; label: string; icon: typeof HomeIcon }[] = [
  { id: 'home', label: 'Home', icon: HomeIcon },
  { id: 'library', label: 'Library', icon: Library },
  { id: 'create', label: 'Create', icon: Plus },
  { id: 'room', label: 'Live room', icon: Radio },
];

export default function Home() {
  const [screen, setScreen] = useState<Screen>('home');
  const [selectedTrack, setSelectedTrack] = useState<Track>(tracks[0]);
  const [joinOpen, setJoinOpen] = useState(false);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();

    void Promise.resolve(context.registerTool({
      name: 'show_hearu_template',
      title: 'Show HearU template',
      description: 'Open one of the visible HearU app templates: home, library, create, or room.',
      inputSchema: {
        type: 'object',
        properties: { screen: { type: 'string', enum: ['home', 'library', 'create', 'room'] } },
        required: ['screen'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        const requested = (input as { screen?: unknown })?.screen;
        if (!screenLabels.some((item) => item.id === requested)) {
          throw new Error('Screen must be home, library, create, or room.');
        }
        setScreen(requested as Screen);
        return { screen: requested, status: 'visible' };
      },
    }, { signal: lifecycle.signal })).catch(() => undefined);

    return () => lifecycle.abort();
  }, []);

  function selectTrack(track: Track) {
    setSelectedTrack(track);
    setScreen('create');
  }

  return (
    <main className="site-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="ambient ambient-three" />

      <aside className="prototype-panel liquid-card">
        <div>
          <Logo />
          <span className="prototype-tag">APP TEMPLATES · V1</span>
        </div>
        <h2>Listening feels<br />better <span>together.</span></h2>
        <p>A liquid-glass mobile experience for sharing local music in perfect sync.</p>
        <nav aria-label="Choose template screen">
          {screenLabels.map(({ id, label, icon: Icon }, index) => (
            <button key={id} className={screen === id ? 'active' : ''} onClick={() => setScreen(id)}>
              <span>0{index + 1}</span><Icon />{label}<ChevronRight />
            </button>
          ))}
        </nav>
        <div className="design-note"><Sparkles /><span><strong>Liquid glass system</strong><small>Refractive layers · soft depth · luminous color</small></span></div>
      </aside>

      <div className="phone-stage">
        <div className="phone-frame">
          <div className="phone-glint" />
          <div className="dynamic-island" aria-hidden="true" />
          <div className="phone-screen">
            {screen === 'home' && <HomeScreen goTo={setScreen} openJoin={() => setJoinOpen(true)} />}
            {screen === 'library' && <LibraryScreen goTo={setScreen} selectTrack={selectTrack} />}
            {screen === 'create' && <CreateScreen goTo={setScreen} track={selectedTrack} />}
            {screen === 'room' && <RoomScreen goTo={setScreen} />}
          </div>
        </div>
        <div className="screen-caption"><span>0{screenLabels.findIndex((item) => item.id === screen) + 1}</span><p>{screenLabels.find((item) => item.id === screen)?.label} template</p></div>
      </div>

      <nav className="mobile-template-nav liquid-card" aria-label="Choose template screen">
        {screenLabels.map(({ id, label, icon: Icon }) => (
          <button key={id} className={screen === id ? 'active' : ''} onClick={() => setScreen(id)} aria-label={label}><Icon /><span>{label}</span></button>
        ))}
      </nav>

      {joinOpen && <JoinOverlay close={() => setJoinOpen(false)} join={() => { setJoinOpen(false); setScreen('room'); }} />}
    </main>
  );
}
