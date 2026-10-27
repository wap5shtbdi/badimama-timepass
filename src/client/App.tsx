import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { NAME_MAX } from '../game/engine';
import { ConnectionBanner, Menu, PickJoker, PlayerSheet, RotateHint, ShowDialog, Toasts } from './Dialogs';
import { Game } from './Game';
import { Lobby } from './Lobby';
import { Result } from './Result';
import { alertFor, playAlert } from './alerts';
import { alertPrefs, fourColorDeck, lastTable, saveAlertPrefs, saveFourColorDeck, saveLastTable, saveName, savedName } from './storage';
import { useTable } from './useTable';

// ---------- Tiny router: "/" home, "/t/CODE" a table ----------

function usePath(): [string, (to: string) => void] {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  const go = useCallback((to: string) => {
    history.pushState(null, '', to);
    setPath(to);
  }, []);
  return [path, go];
}

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const fn = () => setOn(m.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, [query]);
  return on;
}

// Android Chrome's install prompt, kept for the "Install on this phone" button.
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
}
let installEvent: InstallPrompt | null = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e as InstallPrompt;
});

const CODE_RE = /^[A-Za-z0-9]{4}$/;

export function App() {
  const [path, go] = usePath();
  const m = /^\/t\/([A-Za-z0-9]{4})\/?$/.exec(path);
  if (m) return <TablePage code={(m[1] as string).toUpperCase()} go={go} />;
  return <Home go={go} />;
}

// ---------- Home: create or join ----------

function Home({ go }: { go: (to: string) => void }) {
  const [name, setName] = useState(savedName());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const last = lastTable();

  const create = async () => {
    if (!name.trim()) return setError('Please enter your name');
    saveName(name);
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/tables', { method: 'POST' });
      if (!r.ok) throw new Error();
      const { code: newCode } = (await r.json()) as { code: string };
      go(`/t/${newCode}`);
    } catch {
      setError('Could not create a table. Check the internet connection and try again.');
      setBusy(false);
    }
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Please enter your name');
    if (!CODE_RE.test(code.trim())) return setError('The table code has 4 letters or numbers');
    saveName(name);
    go(`/t/${code.trim().toUpperCase()}`);
  };

  return (
    <main className="home">
      <div className="lobby-title">
        <h1>Marriage</h1>
        <p className="muted">Family table · 21 cards</p>
      </div>
      <div className="field">
        <label htmlFor="name">Your name</label>
        <input id="name" value={name} maxLength={NAME_MAX} autoComplete="given-name" onChange={(e) => setName(e.target.value)} />
      </div>
      <button type="button" className="btn btn-gold btn-big" disabled={busy} onClick={() => void create()}>
        {busy ? 'Creating…' : 'New table'}
      </button>
      <form className="join" onSubmit={join}>
        <div className="field">
          <label htmlFor="code">Table code</label>
          <input
            id="code"
            value={code}
            maxLength={4}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="code-input"
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </div>
        <button type="submit" className="btn btn-outline btn-big">
          Join
        </button>
      </form>
      {last && (
        <button type="button" className="btn btn-ghost" onClick={() => go(`/t/${last}`)}>
          Back to table {last}
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}

// ---------- A table ----------

function NamePrompt({ code, onName }: { code: string; onName: (n: string) => void }) {
  const [name, setName] = useState('');
  return (
    <main className="home">
      <div className="lobby-title">
        <h1>Marriage</h1>
        <p className="muted">Joining table {code}</p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onName(name.trim());
        }}
      >
        <div className="field">
          <label htmlFor="pname">Your name</label>
          <input id="pname" value={name} maxLength={NAME_MAX} autoFocus onChange={(e) => setName(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-gold btn-big" disabled={!name.trim()}>
          Join the table
        </button>
      </form>
    </main>
  );
}

function TablePage({ code, go }: { code: string; go: (to: string) => void }) {
  const [name, setName] = useState(savedName());
  if (!name) {
    return (
      <NamePrompt
        code={code}
        onName={(n) => {
          saveName(n);
          setName(n);
        }}
      />
    );
  }
  return <Table code={code} name={name} go={go} />;
}

function Table({ code, name, go }: { code: string; name: string; go: (to: string) => void }) {
  const conn = useTable(code, name);
  const { view, status, toasts } = conn;
  const [fourColor, setFourColor] = useState(fourColorDeck());
  const [playerSheet, setPlayerSheet] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const wide = useMedia('(min-width: 1100px) and (min-height: 600px)');
  const portraitPhone = useMedia('(orientation: portrait) and (pointer: coarse)');

  useEffect(() => saveLastTable(code), [code]);

  // "It's your turn" (and "check the shown sets", "pick the joker"): vibrate and/or chime.
  const [alerts, setAlerts] = useState(alertPrefs());
  const prevView = useRef<typeof view>(null);
  useEffect(() => {
    if (!view) return;
    const kind = alertFor(prevView.current, view);
    prevView.current = view;
    if (kind) playAlert(kind, alerts);
  }, [view, alerts]);

  // Browser tab title shows when it's your turn (handy on a PC with other tabs open).
  const myTurn = view?.phase === 'playing' && !!view.you && view.round?.turn === view.you;
  useEffect(() => {
    document.title = myTurn ? '● Your turn · Marriage' : 'Marriage';
  }, [myTurn]);

  // Tell me when I can see the joker.
  const me = view?.players.find((p) => p.id === view.you);
  // null until the first view arrives, so opening or reloading the app doesn't announce it.
  const sawBefore = useRef<boolean | null>(null);
  useEffect(() => {
    if (!view) return;
    const seen = !!me?.seen;
    if (sawBefore.current === false && seen) conn.toast('You can see the joker now', 'info');
    sawBefore.current = seen;
  }, [view, me?.seen, conn]);

  if (status === 'missing') {
    return (
      <main className="home">
        <h1>No table {code}</h1>
        <p className="muted">Check the code, or start a new table.</p>
        <button type="button" className="btn btn-gold btn-big" onClick={() => go('/')}>
          Go to start
        </button>
      </main>
    );
  }
  if (!view) {
    return (
      <main className="home">
        <ConnectionBanner status={status} />
        <p className="muted center">Opening table {code}…</p>
      </main>
    );
  }

  const round = view.round;
  const inRound = !!round?.hand;
  const leave = () => {
    conn.send({ type: 'leave' });
    go('/');
  };

  return (
    <div className={`app phase-${view.phase}`}>
      <ConnectionBanner status={status} />
      {view.phase === 'lobby' && <Lobby view={view} conn={conn} />}
      {view.phase === 'playing' && (
        <Game view={view} conn={conn} fourColor={fourColor} wide={wide} onOpenPlayer={setPlayerSheet} onOpenMenu={() => setMenu(true)} />
      )}
      {view.phase === 'roundOver' && <Result view={view} conn={conn} fourColor={fourColor} />}

      {view.phase !== 'playing' && (
        <button type="button" className="icon-btn menu-corner" aria-label="Menu" onClick={() => setMenu(true)}>
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      )}

      {round?.show && round.show.by !== view.you && inRound && <ShowDialog view={view} conn={conn} fourColor={fourColor} />}
      {round?.awaitingPick === view.you && <PickJoker view={view} conn={conn} />}
      {playerSheet && <PlayerSheet view={view} playerId={playerSheet} fourColor={fourColor} onClose={() => setPlayerSheet(null)} />}
      {menu && (
        <Menu
          view={view}
          conn={conn}
          fourColor={fourColor}
          onFourColor={(on) => {
            setFourColor(on);
            saveFourColorDeck(on);
          }}
          alerts={alerts}
          onAlerts={(next) => {
            setAlerts(next);
            saveAlertPrefs(next);
            if (next.sound && !alerts.sound) playAlert('check', { sound: true, vibrate: false }); // sample
            if (next.vibrate && !alerts.vibrate) playAlert('check', { sound: false, vibrate: true });
          }}
          onLeave={leave}
          onClose={() => setMenu(false)}
          install={
            installEvent
              ? () => {
                  void installEvent?.prompt();
                  installEvent = null;
                  setMenu(false);
                }
              : null
          }
        />
      )}
      {portraitPhone && view.phase !== 'lobby' && <RotateHint />}
      <Toasts toasts={toasts} />
    </div>
  );
}
