import type { DragEvent } from 'react';
import { type Card as CardT, rankLabel } from '../rules';
import { cardLabel, jokerMark, SUIT_SYMBOL, suitColor } from './cards';

export type CardSize = 'sm' | 'md' | 'lg';

interface CardProps {
  card: CardT;
  size: CardSize;
  joker: CardT | null;
  fourColor: boolean;
  /** 1-based tap order when selected (badge), or 0. */
  selected?: number;
  onTap?: () => void;
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  disabled?: boolean;
}

/** One face-up card. A <button> when it can be tapped, otherwise an image for screen readers. */
export function Card({ card, size, joker, fourColor, selected = 0, onTap, draggable, onDragStart, onDrop, disabled }: CardProps) {
  const mark = jokerMark(card, joker);
  const label = cardLabel(card, joker) + (selected ? ', selected' : '');
  const inner = (
    <>
      <span className="card-corner">
        <span className="card-rank">{rankLabel(card.rank)}</span>
        <span className="card-suit">{SUIT_SYMBOL[card.suit]}</span>
      </span>
      <span className="card-pip" aria-hidden="true">
        {SUIT_SYMBOL[card.suit]}
      </span>
      {mark && <span className={`card-mark card-mark-${mark}`} aria-hidden="true" />}
      {selected > 0 && (
        <span className="card-badge" aria-hidden="true">
          {selected}
        </span>
      )}
    </>
  );
  const className = `card card-${size}${selected ? ' is-selected' : ''}`;
  const style = { color: suitColor(card.suit, fourColor) };
  if (!onTap) {
    return (
      <span className={className} style={style} role="img" aria-label={label}>
        {inner}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={className}
      style={style}
      aria-label={label}
      aria-pressed={selected > 0}
      onClick={onTap}
      disabled={disabled}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDrop ? (e) => e.preventDefault() : undefined}
      onDrop={onDrop}
    >
      {inner}
    </button>
  );
}

/** Face-down card. */
export function CardBack({ size, label, onTap, raised }: { size: CardSize; label?: string; onTap?: () => void; raised?: boolean }) {
  if (!onTap) return <span className={`card card-${size} card-back`} role="img" aria-label={label ?? 'Face-down card'} />;
  return (
    <button
      type="button"
      className={`card card-${size} card-back${raised ? ' is-raised' : ''}`}
      aria-label={label ?? 'Face-down card'}
      onClick={onTap}
    />
  );
}
