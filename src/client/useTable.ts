// Connection to one table: reconnecting WebSocket, the latest view, errors, and optimistic
// arranging (your cards move at once; if the server refuses, they snap back).

import { WebSocket as ReconnectingWebSocket } from 'partysocket';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, ServerMessage, TableView } from '../game/protocol';
import { arrangeMessage, type HandModel } from './hand';
import { deviceToken } from './storage';

export type Status = 'checking' | 'missing' | 'connecting' | 'open';

export interface Toast {
  id: number;
  text: string;
  tone: 'error' | 'info';
}

const PING_MS = 25_000;

const sameHand = (a: HandModel, b: HandModel) =>
  JSON.stringify([a.sets.map((s) => s.map((c) => c.id)), a.loose.map((c) => c.id)]) ===
  JSON.stringify([b.sets.map((s) => s.map((c) => c.id)), b.loose.map((c) => c.id)]);

export function useTable(code: string, name: string) {
  const [view, setView] = useState<TableView | null>(null);
  const [status, setStatus] = useState<Status>('checking');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendingHand, setPendingHand] = useState<HandModel | null>(null);
  const wsRef = useRef<ReconnectingWebSocket | null>(null);
  const nameRef = useRef(name);
  nameRef.current = name;
  /** Arrangements sent but not yet echoed back by the server, oldest first. */
  const outstanding = useRef<HandModel[]>([]);
  /** Set when hello was refused because a round is on: try again when it ends. */
  const retryJoin = useRef(false);
  const toastId = useRef(0);

  const toast = useCallback((text: string, tone: Toast['tone'] = 'error') => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 4500 : 3000);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let ping: ReturnType<typeof setInterval> | undefined;
    let ws: ReconnectingWebSocket | null = null;

    const hello = () =>
      ws?.send(JSON.stringify({ type: 'hello', token: deviceToken(), name: nameRef.current } satisfies ClientMessage));

    const onMessage = (e: MessageEvent) => {
      if (e.data === 'pong') return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'error') {
        if (/round is being played/.test(msg.message)) retryJoin.current = true;
        // Whatever we tried was refused: show the server's cards again.
        outstanding.current = [];
        setPendingHand(null);
        toast(msg.message);
        return;
      }
      const v = msg.view;
      const serverHand = v.round?.hand;
      const q = outstanding.current;
      if (q.length > 0 && serverHand && sameHand(q[0] as HandModel, serverHand)) q.shift();
      if (q.length === 0 || !serverHand) {
        outstanding.current = [];
        setPendingHand(null);
      }
      setView(v);
      if (v.you === null && v.phase !== 'playing' && retryJoin.current) {
        retryJoin.current = false;
        hello();
      }
    };

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new ReconnectingWebSocket(`${proto}://${location.host}/api/tables/${code}/ws`, [], {
        maxEnqueuedMessages: 0, // never replay stale moves after a reconnect
        minReconnectionDelay: 500,
        maxReconnectionDelay: 5000,
        connectionTimeout: 8000,
      });
      wsRef.current = ws;
      setStatus('connecting');
      ws.addEventListener('open', () => {
        setStatus('open');
        hello();
      });
      ws.addEventListener('close', () => setStatus('connecting'));
      ws.addEventListener('message', onMessage);
      ping = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.send('ping');
      }, PING_MS);
    };

    // Phones drop sockets while asleep: reconnect straight away when the app is visible again.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && ws && ws.readyState !== WebSocket.OPEN) ws.reconnect();
    };
    document.addEventListener('visibilitychange', onVisible);

    setStatus('checking');
    fetch(`/api/tables/${code}`)
      .then((r) => {
        if (cancelled) return;
        if (r.status === 404) setStatus('missing');
        else connect();
      })
      .catch(() => !cancelled && connect());

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(ping);
      ws?.close();
      wsRef.current = null;
    };
  }, [code, toast]);

  const send = useCallback(
    (msg: ClientMessage): boolean => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        toast('Not connected, trying again…');
        return false;
      }
      ws.send(JSON.stringify(msg));
      return true;
    },
    [toast],
  );

  /** Move your cards on screen at once and tell the server. */
  const arrange = useCallback(
    (hand: HandModel) => {
      if (send(arrangeMessage(hand))) {
        outstanding.current.push(hand);
        setPendingHand(hand);
      }
    },
    [send],
  );

  const hand: HandModel | null = pendingHand ?? view?.round?.hand ?? null;
  return { view, status, toasts, toast, send, arrange, hand };
}

export type TableConnection = ReturnType<typeof useTable>;
