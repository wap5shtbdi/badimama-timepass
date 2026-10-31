import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { TableView } from '../game/protocol';
import type { Card as CardT } from '../rules';
import { Card, CardBack } from './Card';
import { canVibrate } from './alerts';
import { setLabel } from './hand';
import { nameOf, signed } from './text';
import type { Status, TableConnection, Toast } from './useTable';

// ---------- Modal base ----------

export function Modal({
  label,
  onClose,
  children,
  wide,
}: {
  label: string;
  onClose?: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('button, [href], input')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose ? (e) => e.target === e.currentTarget && onClose() : undefined}>
      <div ref={box} className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

function SetsRow({ sets, joker, fourColor, pairs }: { sets: CardT[][]; joker: CardT | null; fourColor: boolean; pairs?: boolean }) {
  return (
    <div className="sets-show">
      {sets.map((s, i) => {
        const label = pairs ? { tone: 'ok', text: 'Pair' } : setLabel(s, joker);
        return (
          <div key={i} className={`set set-${label.tone}`}>
            <div className="set-head">
              <span className="set-label">
                {label.tone === 'bad' ? '! ' : '✓ '}
                {label.text}
              </span>
            </div>
            <div className="set-cards set-cards-open">
              {s.map((c) => (
                <Card key={c.id} card={c} size="md" joker={joker} fourColor={fourColor} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- 2. Others check the shown sets ----------

export function ShowDialog({ view, conn, fourColor }: { view: TableView; conn: TableConnection; fourColor: boolean }) {
  const show = view.round!.show!;
  const acked = show.acks.includes(view.you ?? '');
  const others = view.round!.hand ? view.players.filter((p) => p.inRound && p.id !== show.by && !p.packed) : [];
  const meOut = !!view.players.find((p) => p.id === view.you)?.packed;
  const title =
    show.kind === 'sets' ? `${nameOf(view, show.by)} is showing 3 sets` : `${nameOf(view, show.by)} is showing ${show.sets.length} pairs`;
  const why = show.kind === 'sets' ? 'to see the joker' : show.kind === 'pack' ? 'to pack' : 'to declare';
  return (
    <Modal label={title}>
      <div className="modal-head">
        <h2>{title}</h2>
        <span className="muted">{why}</span>
      </div>
      {/* Pure sets only: labels as for someone who hasn't seen the joker. */}
      <SetsRow sets={show.sets} joker={null} fourColor={fourColor} pairs={show.kind !== 'sets'} />
      <div className="modal-foot">
        <span className="muted">Checked:</span>
        {others.map((p) => {
          const ok = show.acks.includes(p.id);
          return (
            <span key={p.id} className={`tag${ok ? ' tag-ok' : ''}`}>
              {ok ? '✓ ' : ''}
              {p.id === view.you ? 'You' : p.name}
              {ok ? '' : ' · waiting'}
            </span>
          );
        })}
        <span className="grow" />
        {view.round!.hand && !meOut && (
          <button type="button" className="btn btn-gold" disabled={acked} onClick={() => conn.send({ type: 'ack' })}>
            {acked ? 'Waiting for the others' : "OK, I've seen them"}
          </button>
        )}
      </div>
    </Modal>
  );
}

// ---------- 3. First shower picks the joker ----------

const SPREAD = 16;

export function PickJoker({ view, conn }: { view: TableView; conn: TableConnection }) {
  const round = view.round!;
  const count = Math.min(SPREAD, round.stockCount);
  const [sent, setSent] = useState(false);
  const checked = view.players.filter((p) => p.inRound && p.id !== view.you);
  const pick = (k: number) => {
    // Each face-down card stands for an even slice of the (shuffled) stock.
    const index = Math.floor((k * round.stockCount) / count);
    if (conn.send({ type: 'pickJoker', index })) setSent(true);
  };
  return (
    <Modal label="Pick the joker" wide>
      <div className="pick">
        <div className="tags">
          <span className="muted">Everyone checked your sets:</span>
          {checked.map((p) => (
            <span key={p.id} className="tag tag-ok">
              ✓ {p.name}
            </span>
          ))}
        </div>
        <h2>Pick the joker</h2>
        <p className="muted">Tap any card from the stock. Only you will see it for now.</p>
        <div className="spread">
          {Array.from({ length: count }, (_, k) => (
            <span className="slot slot-md" key={k}>
              <CardBack size="md" label={`Stock card ${k + 1}`} onTap={sent ? undefined : () => pick(k)} />
            </span>
          ))}
        </div>
        <p className="muted small">Others see the joker once they show their own 3 sets.</p>
      </div>
    </Modal>
  );
}

// ---------- A player's sets (tap a name) ----------

export function PlayerSheet({
  view,
  playerId,
  fourColor,
  onClose,
}: {
  view: TableView;
  playerId: string;
  fourColor: boolean;
  onClose: () => void;
}) {
  const p = view.players.find((x) => x.id === playerId);
  if (!p) return null;
  const myJoker = view.round?.joker ?? null;
  return (
    <Modal label={`${p.name}'s sets`} onClose={onClose} wide>
      <div className="modal-head">
        <h2>{p.name}</h2>
        <span className="muted">
          {p.inRound ? `${p.cardCount} cards · ` : ''}
          {p.seen ? 'has seen the joker · ' : ''}
          total {signed(p.total)}
          {p.connected ? '' : ' · offline'}
        </span>
        <span className="grow" />
        <CloseButton onClose={onClose} />
      </div>
      {p.sets.length > 0 && <SetsRow sets={p.sets} joker={myJoker} fourColor={fourColor} />}
      {p.sets.length === 0 && p.hiddenSets === 0 && <p className="muted">No sets made yet. Cards in hand are never shown.</p>}
      {p.hiddenSets > 0 && (
        <p className="muted">
          {p.sets.length > 0 ? '+ ' : ''}
          {p.hiddenSets} more {p.hiddenSets === 1 ? 'set' : 'sets'}, hidden until you've seen the joker.
        </p>
      )}
    </Modal>
  );
}

// ---------- Menu ----------

export function Menu({
  view,
  conn,
  fourColor,
  onFourColor,
  onLeave,
  onClose,
  install,
  alerts,
  onAlerts,
}: {
  view: TableView;
  conn: TableConnection;
  fourColor: boolean;
  onFourColor: (on: boolean) => void;
  alerts: { sound: boolean; vibrate: boolean };
  onAlerts: (next: { sound: boolean; vibrate: boolean }) => void;
  onLeave: () => void;
  onClose: () => void;
  install: (() => void) | null;
}) {
  const isHost = view.hostId === view.you;
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  return (
    <Modal label="Menu" onClose={onClose}>
      <div className="modal-head">
        <h2>Table {view.code}</h2>
        <span className="grow" />
        <CloseButton onClose={onClose} />
      </div>
      <div className="menu">
        <FullscreenButton />
        <label className="switch">
          <input type="checkbox" checked={fourColor} onChange={(e) => onFourColor(e.target.checked)} />
          <span>Four-colour deck (♦ blue, ♣ green)</span>
        </label>
        <label className="switch">
          <input type="checkbox" checked={alerts.sound} onChange={(e) => onAlerts({ ...alerts, sound: e.target.checked })} />
          <span>Sound when it's my turn</span>
        </label>
        {canVibrate() && (
          <label className="switch">
            <input type="checkbox" checked={alerts.vibrate} onChange={(e) => onAlerts({ ...alerts, vibrate: e.target.checked })} />
            <span>Vibrate when it's my turn</span>
          </label>
        )}
        {install && (
          <button type="button" className="btn" onClick={install}>
            Install on this phone
          </button>
        )}
        {view.phase !== 'playing' && view.you && (
          <button type="button" className="btn btn-outline" onClick={onLeave}>
            Leave table
          </button>
        )}
        {view.phase === 'playing' && isHost && (
          <button
            type="button"
            className={`btn ${confirmAbandon ? 'btn-danger' : 'btn-outline'}`}
            onClick={() => {
              if (!confirmAbandon) return setConfirmAbandon(true);
              conn.send({ type: 'abandonRound' });
              onClose();
            }}
          >
            {confirmAbandon ? 'Tap again: stop this round, no scores' : 'Stop this round (host)'}
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Full screen + landscape lock (Android Chrome allows the lock only in full screen). */
export async function goFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o.lock?.('landscape');
  } catch {
    // Not supported (iPhone, desktop): fine, the layout still works.
  }
}

function FullscreenButton() {
  if (typeof document === 'undefined' || !document.fullscreenEnabled) return null;
  return (
    <button type="button" className="btn" onClick={() => void goFullscreen()}>
      Play full screen
    </button>
  );
}

// ---------- Small pieces ----------

export function RotateHint() {
  return (
    <div className="rotate" role="alert">
      <svg aria-hidden="true" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="7" width="18" height="10" rx="2" />
        <path d="M7 3l-2 2 2 2" />
      </svg>
      <p>Turn your phone sideways to play</p>
      {document.fullscreenEnabled && (
        <button type="button" className="btn btn-gold" onClick={() => void goFullscreen()}>
          Play full screen
        </button>
      )}
    </div>
  );
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" role="status" aria-live="assertive">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function ConnectionBanner({ status }: { status: Status }) {
  if (status === 'open' || status === 'missing') return null;
  return (
    <div className="conn" role="status">
      {status === 'checking' ? 'Opening the table…' : 'Reconnecting…'}
    </div>
  );
}
