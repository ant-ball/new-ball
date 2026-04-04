import { useEffect, useRef, useState } from "react";
import { getStoredBallToken } from "./auth";

const POLYMARKET_REFRESH_TOPIC = "polymarket-refresh";
const POLYMARKET_WS_PATH = "/ws/polymarket";

function resolveWsUrl(baseUrl) {
  const fallback = typeof window !== "undefined" && window.location && window.location.origin
    ? window.location.origin
    : (baseUrl || "https://ball.skybit.shop");
  const source = (baseUrl || fallback).replace(/\/$/, "");
  try {
    const parsed = new URL(source);
    const scheme = parsed.protocol === "https:" ? "wss:" : "ws:";
    return `${scheme}//${parsed.host}${POLYMARKET_WS_PATH}`;
  } catch {
    const match = String(source).match(/^https?:\/\/([^/]+)/i);
    const host = match ? match[1] : "ball.skybit.shop";
    const scheme = String(source).startsWith("https:") ? "wss:" : "ws:";
    return `${scheme}//${host}${POLYMARKET_WS_PATH}`;
  }
}

export function usePolymarketSocket({ baseUrl, enabled, onRefresh, onConnectedChange }) {
  const wsRef = useRef(null);
  const lastSubscribedRef = useRef("");
  const onRefreshRef = useRef(onRefresh);
  const onConnectedChangeRef = useRef(onConnectedChange);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    onConnectedChangeRef.current = onConnectedChange;
  }, [onConnectedChange]);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      const ws = wsRef.current;
      wsRef.current = null;
      lastSubscribedRef.current = "";
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      if (typeof onConnectedChangeRef.current === "function") {
        onConnectedChangeRef.current(false);
      }
      return;
    }

    const wsUrl = resolveWsUrl(baseUrl);
    let cancelled = false;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (cancelled) return;
      setConnected(true);
      if (typeof onConnectedChangeRef.current === "function") {
        onConnectedChangeRef.current(true);
      }
      const token = getStoredBallToken();
      const topics = [POLYMARKET_REFRESH_TOPIC];
      const key = JSON.stringify({ topics, token: token || "" });
      lastSubscribedRef.current = key;
      ws.send(JSON.stringify({
        type: "subscribe",
        topics,
        token: token || "",
        authToken: token || "",
      }));
    };

    ws.onmessage = (ev) => {
      if (cancelled) return;
      try {
        const msg = JSON.parse(ev.data);
        const type = msg && msg.type;
        if (type === "sub_ack") return;
        if ((type === POLYMARKET_REFRESH_TOPIC || type === "polymarket_refresh" || type === "polymarket-price" || type === "polymarket-result") && typeof onRefreshRef.current === "function") {
          onRefreshRef.current(msg);
        }
      } catch (err) {
        console.warn("[usePolymarketSocket] 解析消息失败:", err);
      }
    };

    ws.onclose = () => {
      if (cancelled) return;
      setConnected(false);
      if (typeof onConnectedChangeRef.current === "function") {
        onConnectedChangeRef.current(false);
      }
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      console.warn("[usePolymarketSocket] WebSocket 已关闭");
    };

    ws.onerror = () => {
      if (cancelled) return;
      setConnected(false);
      if (typeof onConnectedChangeRef.current === "function") {
        onConnectedChangeRef.current(false);
      }
    };

    return () => {
      cancelled = true;
      const current = wsRef.current;
      wsRef.current = null;
      lastSubscribedRef.current = "";
      if (current && current.readyState === WebSocket.OPEN) {
        current.close();
      }
      setConnected(false);
      if (typeof onConnectedChangeRef.current === "function") {
        onConnectedChangeRef.current(false);
      }
    };
  }, [baseUrl, enabled]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const token = getStoredBallToken();
    const topics = [POLYMARKET_REFRESH_TOPIC];
    const key = JSON.stringify({ topics, token: token || "" });
    if (lastSubscribedRef.current === key) return;
    lastSubscribedRef.current = key;
    ws.send(JSON.stringify({
      type: "subscribe",
      topics,
      token: token || "",
      authToken: token || "",
    }));
  }, [baseUrl, enabled]);

  return { connected };
}
