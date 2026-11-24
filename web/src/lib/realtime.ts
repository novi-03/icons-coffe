import { useEffect, useRef, useState } from 'react';

export type RtEvent = { t: string; o?: string; s?: string; ps?: string; prev?: string; nt?: string; n?: string; [k: string]: unknown };
export type RtStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

/**
 * Live connection to the shared backend. Reconnects with backoff; after any
 * reconnect (or when the tab comes back / network returns) it emits a synthetic
 * `resync` event so screens refetch whatever they might have missed.
 */
export function useRealtime(as: 'staff' | 'guest', onEvent: (e: RtEvent) => void, enabled = true): RtStatus {
  const [status, setStatus] = useState<RtStatus>('connecting');
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let attempt = 0;
    let timer: number | undefined;
    let closed = false;
    let everConnected = false;

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws?as=${as}`);
      ws.onopen = () => {
        attempt = 0;
        setStatus('live');
        if (everConnected) handler.current({ t: 'resync' });
        everConnected = true;
      };
      ws.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data);
          if (e.t !== 'hello') handler.current(e);
        } catch { /* ignore */ }
      };
      ws.onclose = () => {
        if (closed) return;
        setStatus(navigator.onLine ? 'reconnecting' : 'offline');
        const delay = Math.min(15000, 500 * 2 ** attempt++) + Math.random() * 400;
        timer = window.setTimeout(connect, delay);
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    const resync = () => {
      if (document.visibilityState === 'visible') handler.current({ t: 'resync' });
    };
    const online = () => {
      setStatus('reconnecting');
      if (ws && ws.readyState !== WebSocket.OPEN) { window.clearTimeout(timer); attempt = 0; connect(); }
      handler.current({ t: 'resync' });
    };
    const offline = () => setStatus('offline');
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    // Safety net: periodic resync in case a socket silently stalls.
    const poll = window.setInterval(() => handler.current({ t: 'resync' }), 45000);
    return () => {
      closed = true;
      window.clearTimeout(timer);
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      ws?.close();
    };
  }, [as, enabled]);

  return status;
}
