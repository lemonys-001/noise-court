import { useEffect, useRef, useState } from 'react';
import MicTake from '../components/MicTake.jsx';
import UserChip from '../components/UserChip.jsx';
import { roomSocket } from '../lib/ws.js';
import { getSoundBuffer, loadManifest, pickDeck, soundTitle } from '../lib/sounds.js';
import { decode, play, toMono } from '../lib/audio.js';
import { analyze } from '../lib/score.js';
import { applyEffect } from '../lib/effects.js';
import { blobToB64Url, b64ToBlob } from '../lib/recorder.js';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const EFFECT_LABELS = {
  saturate: 'Saturation', echo: 'Echo', pitch: 'Pitch drop', chop: 'Chopped', fart: 'Farted on',
};
const CARD_LABELS = {
  none: 'Nothing. Breathe.',
  bonus50: '+50 pts on your next take',
  mult2: '×2 multiplier next take',
  mult05: '×½ multiplier next take',
};

function genCode() {
  const a = new Uint32Array(4);
  crypto.getRandomValues(a);
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[a[i] % CODE_CHARS.length];
  return s;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function Online({ code, session, clientId, setSession }) {
  if (!code) return <Landing session={session} />;
  return <Game key={code} code={code} session={session} clientId={clientId} setSession={setSession} />;
}

function Landing({ session }) {
  const [join, setJoin] = useState('');
  return (
    <div className="picker">
      <h2 className="bigtitle">Online rooms</h2>
      <p className="hint">2–5 players, separate devices, private room codes. Takes replay to everyone. Sign in with Google first (top right).</p>
      <button
        className="btn big"
        disabled={!session}
        onClick={() => { location.hash = `#/room/${genCode()}`; }}
      >
        Create a room
      </button>
      <div className="row">
        <input className="input codeinput" placeholder="CODE" maxLength={8}
          value={join}
          onChange={(e) => setJoin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && join.length >= 3 && (location.hash = `#/room/${join}`)}
        />
        <button className="btn" disabled={join.length < 3 || !session}
          onClick={() => { location.hash = `#/room/${join}`; }}>
          Join
        </button>
      </div>
      {!session && <p className="hint">Sign in to create or join rooms.</p>}
    </div>
  );
}

function Game({ code, session, clientId, setSession }) {
  const [snap, setSnap] = useState(null);
  const [view, setView] = useState('connecting'); // lobby | loading | round | takes | wheel | end
  const [round, setRound] = useState(null);
  const [refSound, setRefSound] = useState(null);
  const [go, setGo] = useState(false);
  const [submitted, setSubmitted] = useState({ n: 0, need: 0 });
  const [mineSent, setMineSent] = useState(false);
  const [takes, setTakes] = useState(null);
  const [nowTake, setNowTake] = useState(-1);
  const [playbackDone, setPlaybackDone] = useState(false);
  const [cards, setCards] = useState(null);
  const [spin, setSpin] = useState(false);
  const [standings, setStandings] = useState(null);
  const [rounds, setRounds] = useState(4);
  const [err, setErr] = useState(null);
  const [copied, setCopied] = useState(false);
  const wsRef = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    if (!session) return;
    const ws = roomSocket(code, {
      onMsg: handle,
      onClose: () => setErr('Connection lost. Refresh to rejoin.'),
    });
    wsRef.current = ws;
    return () => ws.close();
  }, [code, session]);

  function handle(m) {
    switch (m.t) {
      case 'state':
        setSnap(m);
        if (m.phase === 'lobby') {
          setView('lobby');
          setRound(null); setTakes(null); setCards(null); setStandings(null);
          setMineSent(false); setRefSound(null); setGo(false);
        }
        break;
      case 'round':
        setRound(m);
        setTakes(null); setCards(null); setStandings(null);
        setMineSent(false); setRefSound(null); setGo(false);
        setSubmitted({ n: 0, need: snap?.players.length || 0 });
        setPlaybackDone(false);
        setView('loading');
        loadSound(m.sound);
        break;
      case 'go':
        setGo(true);
        break;
      case 'submitted':
        setSubmitted({ n: m.n, need: m.need });
        break;
      case 'takes':
        setTakes(m.takes);
        setView('takes');
        runPlayback(m.takes);
        break;
      case 'wheel':
        setCards(m.cards);
        break;
      case 'end':
        setStandings(m.standings);
        setView('end');
        break;
      case 'close':
        setErr(m.msg);
        break;
      default:
        if (m.t === 'err') setErr(m.msg);
    }
  }

  async function loadSound(id) {
    try {
      const buffer = await getSoundBuffer(id);
      const mono = await toMono(buffer);
      setRefSound({ buffer, frames: analyze(mono.getChannelData(0), 16000) });
      if (go) setView('round');
    } catch {
      setErr(`Sound "${soundTitle(id)}" failed to load. Waiting for the round to time out.`);
    }
  }

  useEffect(() => {
    if (refSound && go && view === 'loading') setView('round');
  }, [refSound, go]);

  useEffect(() => {
    if (cards && playbackDone && viewRef.current === 'takes') {
      setView('wheel');
      setSpin(true);
      const t = setTimeout(() => setSpin(false), 1500);
      return () => clearTimeout(t);
    }
  }, [cards, playbackDone]);

  async function runPlayback(list) {
    for (let i = 0; i < list.length; i++) {
      setNowTake(i);
      try {
        const t = list[i];
        let buf = null;
        if (t.audio) buf = await decode(await b64ToBlob(t.audio, 'audio/webm').arrayBuffer());
        if (buf) {
          const fx = await applyEffect(buf, t.sab);
          play(fx);
          await sleep(fx.duration * 1000 + 900);
        } else {
          await sleep(700);
        }
      } catch {}
    }
    setNowTake(-1);
    setPlaybackDone(true);
  }

  function completeTake({ blob, score, takeBuffer }) {
    setMineSent(true);
    (async () => {
      let audio = null;
      try {
        if (blob && blob.size <= 70000) audio = await blobToB64Url(blob);
      } catch {}
      wsRef.current?.send({
        t: 'submit', score, audio, dur: Math.round((takeBuffer?.duration || 0) * 1000),
      });
    })();
  }

  if (err) {
    return (
      <div className="picker">
        <div className="card errcard">{err}</div>
        <button className="btn" onClick={() => location.reload()}>Reload</button>
        <button className="btn ghost" onClick={() => { location.hash = '#/room'; }}>Back to rooms</button>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="picker">
        <h2 className="bigtitle">Room {code}</h2>
        <p className="hint">Sign in with Google to play online rooms.</p>
        <UserChip session={session} setSession={setSession} clientId={clientId} />
      </div>
    );
  }

  if (view === 'connecting' || !snap) {
    return <div className="prep"><div className="spinner" /><p>Knocking on room {code}…</p></div>;
  }

  const me = snap.players.find((p) => p.sub) || null;
  const mySub = session.sub;
  const isHost = snap.hostSub === mySub;

  if (view === 'lobby') {
    const link = `${location.origin}${location.pathname}#/room/${snap.code}`;
    const allReady = snap.players.length >= 2 && snap.players.every((p) => p.ready);
    return (
      <div className="picker lobby">
        <div className="codecard card">
          <span className="codelabel">Room code</span>
          <span className="bigcode">{snap.code}</span>
          <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? 'Copied!' : 'Copy invite link'}
          </button>
        </div>
        <ul className="playergrid">
          {snap.players.map((p) => (
            <li key={p.sub} className={`card player ${p.connected ? '' : 'off'} ${p.sub === mySub ? 'me' : ''}`}>
              {p.pic ? <img src={p.pic} alt="" referrerPolicy="no-referrer" /> : <span className="avatar-fallback">{p.name[0]}</span>}
              <span className="pname">{p.name}{p.sub === snap.hostSub ? ' (host)' : ''}</span>
              <span className={`pstatus ${p.ready ? 'ok' : ''}`}>{p.connected ? (p.ready ? 'ready' : 'not ready') : 'away'}</span>
            </li>
          ))}
        </ul>
        {snap.players.length < 5 && <p className="hint">Waiting for up to {5 - snap.players.length} more.</p>}
        <div className="row">
          {isHost ? (
            <>
              <label className="chip">Rounds
                <select value={rounds} onChange={(e) => setRounds(+e.target.value)}>
                  {[3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <button className="btn big" disabled={!allReady}
                onClick={() => loadManifest().then(() => {
                  wsRef.current.send({ t: 'start', deck: pickDeck(Math.random, rounds) });
                })}>
                Start
              </button>
            </>
          ) : (
            <button className="btn big"
              onClick={() => wsRef.current.send({ t: 'ready', v: !snap.players.find((p) => p.sub === mySub).ready })}>
              {snap.players.find((p) => p.sub === mySub)?.ready ? 'Not ready' : 'Ready'}
            </button>
          )}
        </div>
        {!allReady && <p className="hint">Host can start when everyone is ready (2+ players).</p>}
      </div>
    );
  }

  if (view === 'loading') {
    return (
      <div className="prep">
        <div className="spinner" />
        <p>Round {round.i + 1}/{snap.deckLen} — loading “{soundTitle(round.sound)}”…</p>
      </div>
    );
  }

  if (view === 'round') {
    return (
      <div className="engine">
        <header className="roundhead">
          <span className="chip">Round {round.i + 1}/{snap.deckLen}</span>
          <h2 className="soundtitle">{soundTitle(round.sound)}</h2>
          <span className="hint">{mineSent ? `Sent. Waiting for others (${submitted.n}/${submitted.need})…` : `${submitted.n}/${submitted.need} submitted`}</span>
        </header>
        {!mineSent && refSound && go && (
          <MicTake refBuffer={refSound.buffer} refFrames={refSound.frames}
            hint={`Round ${round.i + 1}. Listen once, then mimic.`}
            onComplete={completeTake} />
        )}
        {(!refSound || !go) && <div className="prep"><div className="spinner" /><p>Syncing with the room…</p></div>}
        {mineSent && (
          <div className="prep">
            <div className="spinner" />
            <p>Take sent. Waiting for the rest…</p>
          </div>
        )}
      </div>
    );
  }

  if (view === 'takes') {
    return (
      <div className="takesview">
        <h2 className="bigtitle">The takes</h2>
        <ul className="takelist">
          {takes.map((t, i) => (
            <li key={t.sub} className={`card take ${i === nowTake ? 'playing' : ''}`}>
              <span className="tname">{t.name}</span>
              {t.sab && t.sab !== 'none' && <span className="chip sab">⚠ {EFFECT_LABELS[t.sab] || t.sab}</span>}
              <span className="tscore">{t.score}</span>
            </li>
          ))}
        </ul>
        <div className="prep"><div className="spinner" /><p>Wheel incoming…</p></div>
      </div>
    );
  }

  if (view === 'wheel') {
    const myCard = cards[mySub];
    return (
      <div className="wheelview">
        <div className={`wheel ${spin ? 'spin' : ''}`} />
        <div className="pointer" aria-hidden="true" />
        {!spin && myCard && (
          <div className="card mycard">
            <span className="codelabel">Your card</span>
            <strong>{myCard.k === 'sab' ? `Sabotage: ${EFFECT_LABELS[myCard.e]}` : CARD_LABELS[myCard.k] || 'Nothing. Breathe.'}</strong>
            {myCard.k === 'sab' && <p className="hint">Your next take plays back ruined — and loses 15%. The room finds out on playback.</p>}
          </div>
        )}
        <ul className="cardlist">
          {snap.players.map((p) => (
            <li key={p.sub} className="chip">
              {p.name}: {cards[p.sub] ? (cards[p.sub].k === 'sab' ? `⚠ ${EFFECT_LABELS[cards[p.sub].e]}` : CARD_LABELS[cards[p.sub].k]) : '—'}
            </li>
          ))}
        </ul>
        {isHost && <button className="btn big" onClick={() => wsRef.current.send({ t: 'advance' })}>Next round</button>}
        {!isHost && <p className="hint">Host deals the next round.</p>}
      </div>
    );
  }

  if (view === 'end') {
    return (
      <div className="summary">
        <h2 className="bigtitle">Final court</h2>
        <ul className="reslist">
          {standings.map((s, i) => (
            <li key={s.sub}>
              <span>{i === 0 ? '🏆 ' : `${i + 1}. `}{s.name}</span>
              <strong>{s.score}</strong>
            </li>
          ))}
        </ul>
        {isHost
          ? <button className="btn big" onClick={() => wsRef.current.send({ t: 'again' })}>Play again</button>
          : <p className="hint">Host decides on a rematch.</p>}
      </div>
    );
  }

  return null;
}
