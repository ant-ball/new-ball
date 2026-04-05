import { useCallback, useEffect, useRef, useState } from "react";
import { getStoredBallToken } from "./auth";

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

/**
 * Polymarket WebSocket hook
 * - 连接时自动订阅 polymarket-refresh
 * - 调用 subscribeEvent(eventId) 订阅指定 event 的价格推送
 */
export function usePolymarketSocket({ baseUrl, enabled, onRefresh, onConnectedChange }) {
  const wsRef = useRef(null);
  const subscribedEventsRef = useRef(new Set());
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
      subscribedEventsRef.current.clear();
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
      // 连接时订阅基础 topic
      const token = getStoredBallToken();
      ws.send(JSON.stringify({
        type: "subscribe",
        topics: ["polymarket-refresh"],
        token: token || "",
      }));
      console.log("[usePolymarketSocket] 已连接，订阅 polymarket-refresh");
    };

    ws.onmessage = (ev) => {
      if (cancelled) return;
      try {
        const msg = JSON.parse(ev.data);
        const type = msg && msg.type;
        if (type === "sub_ack") {
          console.log("[usePolymarketSocket] 收到订阅确认", msg);
          return;
        }
        // 价格/结果/刷新消息都转发
        if (type === "polymarket-price" || type === "polymarket-result" || type === "polymarket-refresh" || type === "polymarket_refresh") {
          if (typeof onRefreshRef.current === "function") {
            onRefreshRef.current(msg);
          }
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

    ws.onerror = (err) => {
      if (cancelled) return;
      setConnected(false);
      if (typeof onConnectedChangeRef.current === "function") {
        onConnectedChangeRef.current(false);
      }
      console.error("[usePolymarketSocket] WebSocket 错误:", err);
    };

    return () => {
      cancelled = true;
      const current = wsRef.current;
      wsRef.current = null;
      subscribedEventsRef.current.clear();
      if (current && current.readyState === WebSocket.OPEN) {
        current.close();
      }
      setConnected(false);
      if (typeof onConnectedChangeRef.current === "function") {
        onConnectedChangeRef.current(false);
      }
    };
  }, [baseUrl, enabled]);

  /**
   * 订阅指定 event 的价格推送
   * @param {string} eventId - polymarket event id
   */
  const subscribeEvent = useCallback((eventId) => {
    if (!eventId) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn("[usePolymarketSocket] WS 未连接，无法订阅 event:", eventId);
      return;
    }
    if (subscribedEventsRef.current.has(eventId)) {
      console.log("[usePolymarketSocket] 已订阅过 event:", eventId);
      return;
    }
    subscribedEventsRef.current.add(eventId);
    const token = getStoredBallToken();
    ws.send(JSON.stringify({
      type: "subscribe_event",
      pmEventId: eventId,
      token: token || "",
    }));
    console.log("[usePolymarketSocket] 订阅 event:", eventId);
  }, []);

  /**
   * 取消订阅指定 event
   * @param {string} eventId - polymarket event id
   */
  const unsubscribeEvent = useCallback((eventId) => {
    if (!eventId) return;
    const ws = wsRef.current;
    subscribedEventsRef.current.delete(eventId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    const token = getStoredBallToken();
    ws.send(JSON.stringify({
      type: "unsubscribe_event",
      pmEventId: eventId,
      token: token || "",
    }));
    console.log("[usePolymarketSocket] 取消订阅 event:", eventId);
  }, []);

  return { connected, subscribeEvent, unsubscribeEvent };
}
