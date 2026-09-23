import { useEffect, useRef, useState, useCallback } from 'react';

export function getSessionClientId() {
  let id = null;
  try {
    id = localStorage.getItem('wt_client_id') || sessionStorage.getItem('wt_client_id');
  } catch {}

  if (!id) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2, 10) + '-' + Date.now();
    try {
      localStorage.setItem('wt_client_id', id);
      sessionStorage.setItem('wt_client_id', id);
    } catch {}
  }
  return id;
}

export function useWebSocket(roomId, userName, onMessage) {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const reconnectTimer = useRef(null);
  const attempt = useRef(0);
  const onMessageRef = useRef(onMessage);
  const clientId = getSessionClientId();

  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (!roomId || !userName) return;

    // Terminate any existing socket cleanly before opening a new one
    if (wsRef.current) {
      wsRef.current._isClosedByClient = true;
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    clearTimeout(reconnectTimer.current);

    // Support both ws:// and secure wss:// (when accessed via HTTPS / Cloudflare Tunnel)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws?room=${encodeURIComponent(roomId)}&name=${encodeURIComponent(userName)}&clientId=${encodeURIComponent(clientId)}`;
    const ws = new WebSocket(url);
    ws._isClosedByClient = false;
    wsRef.current = ws;

    ws.onopen = () => {
      if (ws._isClosedByClient) return;
      setConnected(true);
      attempt.current = 0;
      console.log('[WS] Connected via', protocol);
    };

    ws.onmessage = (e) => {
      if (ws._isClosedByClient) return;
      try {
        const msg = JSON.parse(e.data);
        onMessageRef.current?.(msg);
      } catch {
        console.error('[WS] Bad message', e.data);
      }
    };

    ws.onclose = () => {
      if (ws._isClosedByClient) return;
      setConnected(false);
      console.log('[WS] Disconnected, scheduling reconnect...');
      const delay = Math.min(1000 * 2 ** attempt.current, 10000);
      attempt.current++;
      reconnectTimer.current = setTimeout(connect, delay);
    };

    ws.onerror = (err) => {
      if (ws._isClosedByClient) return;
      console.error('[WS] Error', err);
      try { ws.close(); } catch {}
    };
  }, [roomId, userName, clientId]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current._isClosedByClient = true;
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }
    };
  }, [connect]);

  const send = useCallback((type, payload = {}) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, ...payload }));
    }
  }, []);

  return { connected, send, clientId };
}
