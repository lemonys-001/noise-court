import { useEffect, useRef, useState } from 'react';
import MicTake from '../components/MicTake.jsx';
import { roomSocket } from '../lib/ws.js';
import { getSoundBuffer, loadManifest, hasSounds, pickDeck, soundTitle } from '../lib/sounds.js';
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

function playerId() {
  let pid = null;
  try { pid = localStorage.getItem('nc_pid'); } catch {}
  if (!pid) {
    pid = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9_-]/g, '');
    try { localStorage.setItem('nc_pid', pid); } catch {}
  }
  return pid;
}

function savedName() {
  try { return localStorage.getItem('nc_name') || ''; } catch {}
  return '';
}

export default function Online({ code }) {
  if (!code) return <Landing />;
  return <Game key={code} code={code} />;
}

function Landing() {
  const [name, setName] = useState(savedName);
  const [join, setJoin] = useState('');
  const save = (n) => {
    setName(n);
    try { localStorage.setItem('nc_name', n.trim().slice(0, 18)); } catch {}
  };
  const go = (roomCode) => {
    if (!name.trim()) return;
    location.hash = `#/room/${roomCode}`;
  };

  return (
    <div className="picker">
      <h2 className="bigtitle">Online rooms</h2>
      <label className="fieldlabel" htmlFor="nick">Your nickname</label>
      <input id="nick" className="input namewide" placeholder="e.g. Screaming Mimi"
        maxLength={18} value={name}
        onChange={(e) => save(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && name.trim() && join.length >= 3 && go(join)} />
      <div className="row">
        <button className="btn big" disabled={!name.trim()} onClick={() => go(genCode())}>Create a room</button>
      </div>
      <div className="row">
        <input className="input codeinput" placeholder="CODE" maxLength={8}
          value={join}
          onChange={(e) => setJoin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && join.length >= 3 && go(join)} />
        <button className="btn" disabled={join.length < 3 || !name.trim()} onClick={() => go(join)}>Join</button>
      </div>
      <p className="hint">No accounts — a nickname and a room code are all there is.</p>
    </div>
  );
}

function Game({ code }) {
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
  const pid = useRef(playerId()).current;
  const name = useRef(savedName() || 'Player').current;

  useEffect(() => {
    const ws = roomSocket(`${code}?pid=${pid}&name=${encodeURIComponent(name)}`, {
      onMsg: handle,
      onClose: () => setErr('Connection lost. Refresh to rejoin.'),
    });
    wsRef.current = ws;
    return () => ws.close();
  }, [code]);

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
        <div className="card nosound">{err}</div>
        <button className="btn" onClick={() => location.reload()}>Reload</button>
        <button className="btn ghost" onClick={() => { location.hash = '#/room'; }}>Back to rooms</button>
      </div>
    );
  }

  if (view === 'connecting' || !snap) {
    return <div className="prep"><div className="spinner" /><p>Knocking on room {code}…</p></div>;
  }

  const isHost = snap.hostSub === pid;
  const me = snap.players.find((p) => p.sub === pid);

  if (view === 'lobby') {
    const link = `${location.origin}${location.pathname}#/room/${snap.code}`;
    const allReady = snap.players.length >= 2 && snap.players.every((p) => p.ready);
    return (
      <div className="picker lobby">
        <div className="codecard card">
          <span className="codelabel">Room code</span>
          <span className="bigcode">{snap.code}</span>
          <button className="btn ghost" onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? 'Copied' : 'Copy invite link'}
          </button>
        </div>
        <ul className="playergrid">
          {snap.players.map((p) => (
            <li key={p.sub} className={`card player ${p.connected ? '' : 'off'} ${p.sub === pid ? 'me' : ''}`}>
              <span className="avatar-fallback">{p.name[0]}</span>
              <span className="pname">{p.name}{p.sub === snap.hostSub ? ' · host' : ''}</span>
              <span className={`pstatus ${p.ready ? 'ok' : ''}`}>{p.connected ? (p.ready ? 'ready' : 'not ready') : 'away'}</span>
            </li>
          ))}
        </ul>
        {snap.players.length < 5 && <p className="hint">Room holds up to 5 players.</p>}
        <div className="row">
          {isHost ? (
            <>
              <label className="fieldlabel inline">Rounds
                <select value={rounds} onChange={(e) => setRounds(+e.target.value)}>
                  {[3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <button className="btn big" disabled={!allReady || !hasSounds()}
                onClick={() => {
                  loadManifest().then(() => {
                    const deck = pickDeck(Math.random, rounds);
                    if (!deck.length) { setErr('No sound files available.'); return; }
                    wsRef.current.send({ t: 'start', deck });
                  });
                }}>
                Start
              </button>
            </>
          ) : (
            <button className="btn big"
              onClick={() => wsRef.current.send({ t: "ready", v: !me?.ready })}>
              {me?.ready ? "Not ready" : "Ready"}
            </button>
          )}
        </div>
        {!hasSounds() && <p className="hint">No sound files on the server yet — the host can't start.</p>}
        {!allReady && hasSounds() && <p className="hint">Host can start when everyone is ready (2+ players).</p>}
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
          <span className="tag">Round {round.i + 1}/{snap.deckLen}</span>
          <h2 className="soundtitle">{soundTitle(round.sound)}</h2>
          <span className="hint">{mineSent ? `Sent — waiting for others (${submitted.n}/${submitted.need})` : `${submitted.n}/${submitted.need} submitted`}</span>
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
              {t.sab && t.sab !== 'none' && <span className="tag sab">{EFFECT_LABELS[t.sab] || t.sab}</span>}
              <span className="tscore">{t.score}</span>
            </li>
          ))}
        </ul>
        <div className="prep"><div className="spinner" /><p>Wheel incoming…</p></div>
      </div>
    );
  }

  if (view === 'wheel') {
    const myCard = cards[pid];
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
            <li key={p.sub} className="tag">
              {p.name}: {cards[p.sub] ? (cards[p.sub].k === 'sab' ? `${EFFECT_LABELS[cards[p.sub].e]}` : CARD_LABELS[cards[p.sub].k]) : '—'}
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
            <li key={s.sub} className={i === 0 ? 'winner' : ''}>
              <span>{i + 1}. {s.name}</span>
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
