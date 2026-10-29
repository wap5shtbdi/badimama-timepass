// Touch drag on phones (chosen by Vikram 2026-10-29): press and hold a card, then drag it.
// Standard HTML drag-and-drop doesn't work with fingers, so this uses pointer events.
//
// - Hold still for HOLD_MS: the card lifts (short buzz on Android) and follows the finger.
// - Move more than SLOP before that: it's a normal swipe (scrolling the sets), no drag.
// - A quick tap still selects the card as before.
// - Drop targets are elements with a data-drop attribute (see dropResult in hand.ts).

import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export const HOLD_MS = 300;
const SLOP = 10;

export interface TouchDrag {
  /** The dragged card ids (the touched card, or the whole selection if it was part of it). */
  ids: string[];
  /** The card that was touched (shown under the finger). */
  cardId: string;
}

export function useTouchDrag(onDrop: (ids: string[], target: string | null) => void) {
  const [drag, setDrag] = useState<TouchDrag | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: 0, y: 0 });
  const hover = useRef<Element | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const stop = useRef<(() => void) | null>(null);
  /** Ignore the click the browser may send right after a drag (it would toggle selection). */
  const swallowClickUntil = useRef(0);

  useEffect(() => () => stop.current?.(), []);

  // The ghost mounts after the hold timer fires: put it under the finger straight away.
  useLayoutEffect(() => {
    const g = ghostRef.current;
    if (drag && g) g.style.transform = `translate(${pos.current.x}px, ${pos.current.y}px)`;
  }, [drag]);

  const begin = useCallback((e: ReactPointerEvent, cardId: string, ids: string[]) => {
    if (e.pointerType === 'mouse' || !e.isPrimary) return; // mouse uses normal drag-and-drop
    stop.current?.();
    const pointerId = e.pointerId;
    const start = { x: e.clientX, y: e.clientY };
    pos.current = { ...start };
    let active = false;

    const setHover = (el: Element | null) => {
      if (el === hover.current) return;
      hover.current?.classList.remove('drop-hover');
      el?.classList.add('drop-hover');
      hover.current = el;
    };
    const place = (x: number, y: number) => {
      pos.current = { x, y };
      const g = ghostRef.current;
      if (g) g.style.transform = `translate(${x}px, ${y}px)`;
      setHover(document.elementFromPoint(x, y)?.closest('[data-drop]') ?? null);
    };

    const timer = setTimeout(() => {
      active = true;
      setDrag({ ids, cardId });
      try {
        navigator.vibrate?.(15);
      } catch {
        // not supported
      }
      place(pos.current.x, pos.current.y);
    }, HOLD_MS);

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!active) {
        pos.current = { x: ev.clientX, y: ev.clientY };
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > SLOP) end(false);
        return;
      }
      place(ev.clientX, ev.clientY);
    };
    const onUp = (ev: PointerEvent) => ev.pointerId === pointerId && end(true);
    const onCancel = (ev: PointerEvent) => ev.pointerId === pointerId && end(false);
    // Once the card is lifted the page must not scroll under the finger.
    const onTouchMove = (ev: TouchEvent) => {
      if (active && ev.cancelable) ev.preventDefault();
    };
    // Long-press would otherwise open the browser's menu (Android) or callout (iPhone).
    const onContextMenu = (ev: Event) => ev.preventDefault();

    function end(drop: boolean) {
      clearTimeout(timer);
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
      removeEventListener('pointercancel', onCancel);
      document.removeEventListener('touchmove', onTouchMove);
      removeEventListener('contextmenu', onContextMenu, true);
      stop.current = null;
      const target = hover.current?.getAttribute('data-drop') ?? null;
      setHover(null);
      if (!active) return;
      swallowClickUntil.current = Date.now() + 500;
      setDrag(null);
      if (drop) onDropRef.current(ids, target);
    }

    addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onCancel);
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    addEventListener('contextmenu', onContextMenu, true);
    stop.current = () => end(false);
  }, []);

  /** True if this click is the leftover of a drag and should be ignored. */
  const swallowClick = useCallback(() => Date.now() < swallowClickUntil.current, []);

  return { drag, begin, ghostRef, swallowClick };
}
