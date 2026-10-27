import { useState } from 'react';
import { MAX_PLAYERS, MIN_PLAYERS } from '../rules';
import type { TableView } from '../game/protocol';
import type { TableConnection } from './useTable';

export function tableLink(code: string): string {
  return `${location.origin}/t/${code}`;
}

/** Android's share sheet when available (WhatsApp is in it), else a WhatsApp link. */
export async function shareInvite(code: string): Promise<void> {
  const url = tableLink(code);
  const text = `Join my Marriage table (code ${code}): ${url}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Marriage', text, url });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

export function Lobby({ view, conn }: { view: TableView; conn: TableConnection }) {
  const [copied, setCopied] = useState(false);
  const isHost = view.hostId === view.you;
  const host = view.players.find((p) => p.isHost);
  const enough = view.players.length >= MIN_PLAYERS;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tableLink(view.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      conn.toast('Could not copy. The code is ' + view.code, 'info');
    }
  };
  const seats = Array.from({ length: MAX_PLAYERS }, (_, i) => view.players[i] ?? null);

  return (
    <main className="lobby">
      <div className="lobby-title">
        <h1>Marriage</h1>
        <p className="muted">Family table · 21 cards</p>
      </div>

      <section className="lobby-box" aria-label="Invite">
        <div className="muted strong">Table code</div>
        <div className="code">{view.code}</div>
        <button type="button" className="btn btn-gold btn-big" onClick={() => void shareInvite(view.code)}>
          <ShareIcon /> Share invite on WhatsApp
        </button>
        <button type="button" className="btn btn-outline" onClick={() => void copy()}>
          {copied ? 'Link copied' : 'Copy link'}
        </button>
      </section>

      <section className="seats" aria-label="Players">
        <div className="muted strong">
          Players · {view.players.length} of {MAX_PLAYERS}
        </div>
        {seats.map((p, i) =>
          p ? (
            <div key={p.id} className={`seat${p.connected ? '' : ' is-offline'}`}>
              <span className="avatar" aria-hidden="true">
                {p.name.charAt(0).toUpperCase()}
              </span>
              <span className="seat-name">
                {p.name}
                {p.id === view.you ? ' (you)' : ''}
              </span>
              <span className="muted small">{p.isHost ? 'Host' : p.connected ? 'Joined' : 'Offline'}</span>
            </div>
          ) : (
            <div key={`empty-${i}`} className="seat seat-empty">
              Empty seat
            </div>
          ),
        )}
      </section>

      <div className="grow" />

      <div className="lobby-foot">
        <p className="muted small center">Turn your phone sideways to play</p>
        {isHost ? (
          <button type="button" className="btn btn-cream btn-big" disabled={!enough} onClick={() => conn.send({ type: 'start' })}>
            {enough ? 'Start game' : 'Waiting for players…'}
          </button>
        ) : (
          <p className="center">{view.you ? `Waiting for ${host?.name ?? 'the host'} to start` : 'Joining…'}</p>
        )}
      </div>
    </main>
  );
}

function ShareIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
      <path d="M16 6l-4-4-4 4" />
      <path d="M12 2v13" />
    </svg>
  );
}
