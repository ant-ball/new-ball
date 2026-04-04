import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { getStoredBallToken } from "./auth";

function resolveSocketBaseUrl(baseUrl) {
  const fallback = typeof window !== "undefined" && window.location && window.location.origin
    ? window.location.origin
    : (baseUrl || "https://ball.skybit.shop");
  try {
    const parsed = new URL(baseUrl || fallback);
    const protocol = parsed.protocol === "https:" ? "https:" : "http:";
    return `${protocol}//${parsed.hostname}:48080`;
  } catch {
    const match = String(baseUrl || fallback).match(/^https?:\/\/([^/]+)/i);
    const host = match ? match[1].split(":")[0] : "ball.skybit.shop";
    const protocol = String(baseUrl || fallback).startsWith("https:") ? "https:" : "http:";
    return `${protocol}//${host}:48080`;
  }
}

export function usePolymarketSocket({ baseUrl, enabled, onRefresh, onConnectedChange }) {
  const socketRef = useRef(null);
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
      if (socketRef.current) {
        try {
          socketRef.current.disconnect();
        } catch {
          // ignore
        }
        socketRef.current = null;
      }
      if (typeof onConnectedChangeRef.current === "function") {
        onConnectedChangeRef.current(false);
      }
      return;
    }

    const socketUrl = resolveSocketBaseUrl(baseUrl);
    const socket = io(`${socketUrl}/user`, {
      path: "/socket.io",
      transports: ["websocket"],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 3,
      timeout: 10000,
    });
    socketRef.current = socket;

    const handleConnect = () => {
      setConnected(true);
      if (typeof onConnectedChangeRef.current === "function") {
        onConnectedChangeRef.current(true);
      }
      const token = getStoredBallToken();
      if (token) {
        socket.emit("user", { token });
      }
    };

    const handleDisconnect = () => {
      setConnected(false);
      if (typeof onConnectedChangeRef.current === "function") {
        onConnectedChangeRef.current(false);
      }
    };

    const handleRefresh = (payload) => {
      if (typeof onRefreshRef.current === "function") {
        onRefreshRef.current(payload);
      }
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleDisconnect);
    socket.on("polymarket_refresh", handleRefresh);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleDisconnect);
      socket.off("polymarket_refresh", handleRefresh);
      try {
        socket.disconnect();
      } catch {
        // ignore
      }
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [baseUrl, enabled]);

  return { connected };
}
