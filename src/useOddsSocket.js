import { useEffect, useRef, useState } from "react";

/** 服务端推送 type：与 KafkaWsConstant.WsMassage 一致 */
export const EVENT_IN_PLAY_ODDS_UPDATE = "in_play_odds_update";
export const EVENT_ADD = "event_add";
export const EVENT_REMOVE = "in_play_event_remove";
export const EVENT_CORNERS = "corners_yellow_red_cards";
/** 滚球联赛列表变化（增删联赛） */
export const EVENT_INPLAY_LEAGUE = "inplay_league";
/** 某联赛下赛事列表变化（新增赛事、赛事结束等），data 带 leagueId */
export const EVENT_LEAGUE_EVENTS = "league";
/** 单场比赛的事件/赛况快照（包含时间状态、进行时间、比分等），用于前端时钟展示 */
export const EVENT_EVENT_RESULT = "event_result";

/**
 * 原生 WebSocket 连接 /ws/soccer：
 * 1. 先 REST GET /api/ws/token 拿 token，再带 token 连一条 WS（无 sid 握手）。
 * 2. 连接成功后立即发 {"type":"subscribe","eventIds":[...],"topics":["inplay-league","league:leagueId"]}，服务端不返回 sid，直接等订阅。
 * 3. 服务端推送格式 {"type":"xxx","data":...}，按 type 分发。
 */
import { getStoredBallToken } from "./auth";

export function useOddsSocket({ baseUrl, enabled, eventIds = [], leagueId = null, onOddsUpdate, onCornersCards, onInplayLeagueUpdate, onLeagueEventsUpdate, onEventResult }) {
    const [connected, setConnected] = useState(false);
    const onOddsUpdateRef = useRef(onOddsUpdate);
    onOddsUpdateRef.current = onOddsUpdate;
    const onCornersCardsRef = useRef(onCornersCards);
    onCornersCardsRef.current = onCornersCards;
    const onInplayLeagueRef = useRef(onInplayLeagueUpdate);
    onInplayLeagueRef.current = onInplayLeagueUpdate;
    const onLeagueEventsRef = useRef(onLeagueEventsUpdate);
    onLeagueEventsRef.current = onLeagueEventsUpdate;
    const onEventResultRef = useRef(onEventResult);
    onEventResultRef.current = onEventResult;
    const wsRef = useRef(null);
    const eventIdsRef = useRef(eventIds);
    eventIdsRef.current = eventIds;
    const leagueIdRef = useRef(leagueId);
    leagueIdRef.current = leagueId;

    useEffect(() => {
        if (!enabled || !baseUrl) {
            setConnected(false);
            return;
        }

        const serverUrl = (baseUrl || "").replace(/\/$/, "");
        let cancelled = false;

        (async () => {
            let token = null;
            try {
                const url = `${serverUrl}/api/ws/token`;
                const ballToken = getStoredBallToken();
                const res = await fetch(url, {
                    credentials: "omit",
                    headers: ballToken ? { Authorization: ballToken } : {},
                });
                const json = await res.json();
                if (json?.data?.token) token = json.data.token;
            } catch (e) {
                console.warn("[useOddsSocket] 获取 ws token 失败:", e);
            }
            if (cancelled) return;
            if (!token) {
                console.warn("[useOddsSocket] 无 token，不建立 WebSocket");
                return;
            }

            const wsScheme = serverUrl.startsWith("https") ? "wss" : "ws";
            const wsHost = serverUrl.replace(/^https?:\/\//, "");
            const wsUrl = `${wsScheme}://${wsHost}/ws/soccer?token=${encodeURIComponent(token)}`;
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                if (cancelled) return;
                setConnected(true);
                const ids = Array.isArray(eventIdsRef.current) ? eventIdsRef.current.map(String).sort() : [];
                const topics = ["inplay-league"];
                if (leagueIdRef.current != null && leagueIdRef.current !== "") {
                    topics.push(`league:${leagueIdRef.current}`);
                }
                lastSubscribedRef.current = JSON.stringify({ eventIds: ids, topics });
                ws.send(JSON.stringify({ type: "subscribe", eventIds: ids, topics }));
            };

            ws.onmessage = (ev) => {
                if (cancelled) return;
                try {
                    const msg = JSON.parse(ev.data);
                    const type = msg && msg.type;
                    const data = msg && msg.data;
                    if (type === "sub_ack") return;
                    if (type === "heartbeat") return;
                    if (type === EVENT_IN_PLAY_ODDS_UPDATE && onOddsUpdateRef.current) {
                        onOddsUpdateRef.current(data);
                    }
                    if (type === EVENT_CORNERS && onCornersCardsRef.current) {
                        onCornersCardsRef.current(data);
                    }
                    if ((type === EVENT_INPLAY_LEAGUE || type === "inplay-league") && onInplayLeagueRef.current) {
                        onInplayLeagueRef.current(data);
                    }
                    if ((type === EVENT_LEAGUE_EVENTS || type === "league") && onLeagueEventsRef.current) {
                        onLeagueEventsRef.current(data);
                    }
                    if (type === EVENT_EVENT_RESULT && onEventResultRef.current) {
                        onEventResultRef.current(data);
                    }
                    // 其他 type 如 event_add, in_play_event_remove 可按需处理
                } catch (e) {
                    console.warn("[useOddsSocket] 解析消息失败:", e);
                }
            };

            ws.onclose = () => {
                setConnected(false);
                wsRef.current = null;
                console.warn("[useOddsSocket] WebSocket 已关闭");
            };

            ws.onerror = () => {
                setConnected(false);
            };
        })();

        return () => {
            cancelled = true;
            const ws = wsRef.current;
            wsRef.current = null;
            if (ws && ws.readyState === WebSocket.OPEN) ws.close();
            setConnected(false);
        };
    }, [baseUrl, enabled]);

    // eventIds 或 leagueId 变化时重发订阅
    const lastSubscribedRef = useRef("");
    useEffect(() => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const ids = Array.isArray(eventIds) ? eventIds.map(String).sort() : [];
        const topics = ["inplay-league"];
        if (leagueId != null && leagueId !== "") {
            topics.push(`league:${leagueId}`);
        }
        const key = JSON.stringify({ eventIds: ids, topics });
        if (lastSubscribedRef.current === key) return;
        lastSubscribedRef.current = key;
        ws.send(JSON.stringify({ type: "subscribe", eventIds: ids, topics }));
    }, [eventIds, leagueId]);

    return { connected };
}
