import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchPolymarketCategories,
  fetchPolymarketEvents,
  fetchPolymarketMarkets,
  fetchPolymarketPlays,
  syncPolymarketEvents,
  syncPolymarketMarkets,
  syncPolymarketPlays,
  createPolymarketOrder,
  fetchPolymarketOrders,
} from "./polymarketApi";
import { usePolymarketSocket } from "./usePolymarketSocket";

const PAGE_SIZE = 20;
const PLAYS_PAGE_SIZE = 50;
const TABS = [
  { key: "plays", label: "玩法" },
  { key: "markets", label: "市场" },
  { key: "results", label: "结果" },
  { key: "orders", label: "我的订单" },
];

function parseMaybeJson(value) {
  if (value == null || value === "") return null;
  if (Array.isArray(value) || typeof value === "object") return value;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatPrice(value) {
  if (value == null || value === "") return "-";
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  return num.toFixed(4).replace(/\.?0+$/, "");
}

function formatProbability(value) {
  if (value == null || value === "") return "-";
  const num = Number(value);
  if (Number.isNaN(num)) return "-";
  const percent = num <= 1 ? num * 100 : num;
  return `${percent.toFixed(percent % 1 === 0 ? 0 : 1)}%`;
}

function clampPercent(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num * 100)));
}

function extractOutcomePrice(item, idx) {
  const latestPrices = Array.isArray(item?.latestPrices) ? item.latestPrices : [];
  const priceRow = latestPrices.find((row) => Number(row.outcomeIndex) === Number(idx));
  if (priceRow) {
    return priceRow.price ?? priceRow.bestAsk ?? priceRow.bestBid;
  }
  const rawOutcomePrices = parseMaybeJson(item?.outcomePricesJson);
  if (Array.isArray(rawOutcomePrices) && rawOutcomePrices.length > idx) {
    const candidate = rawOutcomePrices[idx];
    if (candidate && typeof candidate === "object") {
      return candidate.price ?? candidate.value ?? candidate.probability ?? candidate.odds ?? candidate.ask ?? candidate.bid;
    }
    return candidate;
  }
  return null;
}

function deriveDisplayCards(plays, markets) {
  if (Array.isArray(plays) && plays.length > 0) {
    return plays.map((item) => ({ ...item, __kind: "play" }));
  }
  return (Array.isArray(markets) ? markets : []).map((item) => ({ ...item, __kind: "market" }));
}

function upsertByKey(list, keySelector, item) {
  if (!Array.isArray(list) || !item) return Array.isArray(list) ? list : [];
  const next = list.slice();
  const key = keySelector(item);
  const index = next.findIndex((row) => keySelector(row) === key);
  if (index >= 0) {
    next[index] = { ...next[index], ...item };
  } else {
    next.push(item);
  }
  return next;
}

function normalizePricePatch(message) {
  const data = message?.data ?? message ?? {};
  const pmMarketId = data.pmMarketId || data.pm_market_id;
  const outcomeIndex = Number(data.outcomeIndex ?? data.outcome_index ?? 0);
  if (!pmMarketId) {
    return null;
  }
  return {
    pmMarketId,
    outcomeIndex,
    outcomeName: data.outcomeName ?? data.outcome_name ?? null,
    price: data.price ?? null,
    bestBid: data.bestBid ?? data.best_bid ?? null,
    bestAsk: data.bestAsk ?? data.best_ask ?? null,
    sourceType: data.sourceType ?? data.source_type ?? "WS",
    updateAt: data.updateAt ?? data.update_at ?? Date.now(),
    rawJson: data.rawJson ?? data.raw_json ?? null,
  };
}

function normalizeResultPatch(message) {
  const data = message?.data ?? message ?? {};
  const pmMarketId = data.pmMarketId || data.pm_market_id;
  if (!pmMarketId) {
    return null;
  }
  return {
    pmMarketId,
    resolvedOutcome: data.resolvedOutcome ?? data.resolved_outcome ?? null,
    resolvedValue: data.resolvedValue ?? data.resolved_value ?? null,
    resolutionSource: data.resolutionSource ?? data.resolution_source ?? null,
    resolvedAt: data.resolvedAt ?? data.resolved_at ?? null,
    rawJson: data.rawJson ?? data.raw_json ?? null,
  };
}

function buildLatestPrices(prices, pmMarketId) {
  if (!Array.isArray(prices)) return [];
  return prices.filter((row) => row && row.pmMarketId === pmMarketId);
}

function pickInitialCategory(categoryRows, requestedCategory = "") {
  const enabledCategories = (Array.isArray(categoryRows) ? categoryRows : [])
    .filter((item) => item && item.category)
    .map((item) => item.category);
  if (requestedCategory && enabledCategories.includes(requestedCategory)) {
    return requestedCategory;
  }
  return enabledCategories[0] || "";
}

function pickInitialEventId(eventRows, preferredEventId = "") {
  const list = Array.isArray(eventRows) ? eventRows : [];
  if (preferredEventId && list.some((item) => item && item.pmEventId === preferredEventId)) {
    return preferredEventId;
  }
  return list.length > 0 ? (list[0]?.pmEventId || "") : "";
}

function attachLatestPricesToMarkets(markets, plays) {
  if (!Array.isArray(markets) || markets.length === 0) {
    return [];
  }
  const priceMap = new Map();
  (Array.isArray(plays) ? plays : []).forEach((play) => {
    if (!play || !play.pmMarketId || !Array.isArray(play.latestPrices)) {
      return;
    }
    if (!priceMap.has(play.pmMarketId)) {
      priceMap.set(play.pmMarketId, play.latestPrices);
    }
  });
  return markets.map((market) => {
    if (!market || !market.pmMarketId) {
      return market;
    }
    const latestPrices = priceMap.get(market.pmMarketId);
    return latestPrices ? { ...market, latestPrices } : market;
  });
}

function parseAssetIds(item) {
  const raw = parseMaybeJson(item?.assetIdsJson ?? item?.asset_ids_json ?? item?.assetIds ?? item?.asset_ids);
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value)).filter(Boolean);
  }
  return [];
}

function parseTokenIds(item) {
  const raw = parseMaybeJson(item?.tokenIdsJson ?? item?.token_ids_json ?? item?.tokenIds ?? item?.token_ids);
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value)).filter(Boolean);
  }
  return [];
}

function PolymarketApp({ baseUrl, balance }) {
  const availableBalance = parseFloat(balance?.amount || 0) - parseFloat(balance?.froze || 0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState("markets");
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [error, setError] = useState("");
  const [socketConnected, setSocketConnected] = useState(false);
  const [orderModal, setOrderModal] = useState(null); // { play, outcomeIndex, outcomeName, side }
  const [orderAmount, setOrderAmount] = useState("");
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [data, setData] = useState({
    categories: [],
    events: [],
    markets: [],
    plays: [],
    prices: [],
    results: [],
  });

  const loadCategories = useCallback(async () => {
    const categoriesRes = await fetchPolymarketCategories(baseUrl);
    return Array.isArray(categoriesRes.data) ? categoriesRes.data : [];
  }, [baseUrl]);

  const loadCategoryPath = useCallback(async ({ category = "", eventId = "" } = {}) => {
    setLoading(true);
    setError("");
    try {
      const categoryRows = categories.length > 0 ? categories : await loadCategories();
      const resolvedCategory = category || pickInitialCategory(categoryRows, "");
      const eventsRes = resolvedCategory
        ? await fetchPolymarketEvents(baseUrl, resolvedCategory, PAGE_SIZE, 0)
        : { data: [] };
      const eventRows = Array.isArray(eventsRes.data) ? eventsRes.data : [];
      const resolvedEventId = eventId || pickInitialEventId(eventRows, "");
      let markets = [];
      let plays = [];
      if (resolvedEventId) {
        const [marketsRes, playsRes] = await Promise.all([
          fetchPolymarketMarkets(baseUrl, resolvedEventId, resolvedCategory, PAGE_SIZE, 0),
          fetchPolymarketPlays(baseUrl, resolvedEventId, PLAYS_PAGE_SIZE, 0),
        ]);
        markets = Array.isArray(marketsRes.data) ? marketsRes.data : [];
        plays = Array.isArray(playsRes.data) ? playsRes.data : [];
      }
      setSelectedCategory(resolvedCategory);
      setSelectedEventId(resolvedEventId);
      setSelectedMarketId(markets.find((item) => item && item.pmMarketId)?.pmMarketId || "");
      setData((prev) => ({
        ...prev,
        categories: categoryRows,
        events: eventRows,
        markets: attachLatestPricesToMarkets(markets, plays),
        plays,
        prices: [],
        results: [],
      }));
      if (categories.length === 0) {
        setCategories(categoryRows);
      }
    } catch (err) {
      setError(err?.message || "Polymarket 加载失败");
    } finally {
      setLoading(false);
    }
  }, [baseUrl, categories, loadCategories]);

  const loadSelectedEvent = useCallback(async (nextEventId, nextCategory = selectedCategory) => {
    if (!nextEventId) {
      setSelectedEventId("");
      setSelectedMarketId("");
      setData((prev) => ({
        ...prev,
        markets: [],
        plays: [],
        prices: [],
        results: [],
      }));
      return;
    }
    setRefreshing(true);
    setError("");
    try {
      const [marketsRes, playsRes] = await Promise.all([
        fetchPolymarketMarkets(baseUrl, nextEventId, nextCategory, PAGE_SIZE, 0),
        fetchPolymarketPlays(baseUrl, nextEventId, PLAYS_PAGE_SIZE, 0),
      ]);
      const markets = Array.isArray(marketsRes.data) ? marketsRes.data : [];
      const plays = Array.isArray(playsRes.data) ? playsRes.data : [];
      setSelectedEventId(nextEventId);
      setSelectedMarketId(markets.find((item) => item && item.pmMarketId)?.pmMarketId || "");
      setData((prev) => ({
        ...prev,
        markets: attachLatestPricesToMarkets(markets, plays),
        plays,
        prices: [],
        results: [],
      }));
    } catch (err) {
      setError(err?.message || "Polymarket 刷新失败");
    } finally {
      setRefreshing(false);
    }
  }, [baseUrl, selectedCategory]);

  const applySocketPatch = useCallback((message) => {
    if (!message || typeof message !== "object") {
      return;
    }
    const type = message.type;
    const payload = message.data ?? message;
    if (type === "polymarket-price") {
      const patch = normalizePricePatch(message);
      if (!patch) return;
      setData((prev) => {
        const prices = upsertByKey(prev.prices, (row) => `${row.pmMarketId}:${row.outcomeIndex}`, patch);
        const next = {
          ...prev,
          prices,
        };
        const latestPrices = buildLatestPrices(prices, patch.pmMarketId);
        next.markets = prev.markets.map((item) => (item.pmMarketId === patch.pmMarketId ? { ...item, latestPrices } : item));
        next.plays = prev.plays.map((item) => (item.pmMarketId === patch.pmMarketId ? { ...item, latestPrices } : item));
        return next;
      });
      return;
    }
    if (type === "polymarket-result") {
      const patch = normalizeResultPatch(message);
      if (!patch) return;
      setData((prev) => ({
        ...prev,
        markets: prev.markets.map((item) => (
          item.pmMarketId === patch.pmMarketId
            ? {
                ...item,
                status: "RESOLVED",
                resolvedOutcome: patch.resolvedOutcome ?? item.resolvedOutcome,
                resolvedAt: patch.resolvedAt ?? item.resolvedAt,
              }
            : item
        )),
        plays: prev.plays.map((item) => (
          item.pmMarketId === patch.pmMarketId
            ? {
                ...item,
                status: "RESOLVED",
                resolvedOutcome: patch.resolvedOutcome ?? item.resolvedOutcome,
                resolvedAt: patch.resolvedAt ?? item.resolvedAt,
              }
            : item
        )),
      }));
      return;
    }
    if (type === "polymarket-refresh" || type === "polymarket_refresh") {
      const reason = payload?.reason ?? payload?.data?.reason ?? "";
      if (reason === "subscribe" || reason.startsWith("price") || reason === "result") {
        return;
      }
      return;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const categoryRows = await loadCategories();
        if (cancelled) return;
        setCategories(categoryRows);
        const initialCategory = pickInitialCategory(categoryRows, "");
        if (!initialCategory) {
          setLoading(false);
          return;
        }
        const eventsRes = await fetchPolymarketEvents(baseUrl, initialCategory, PAGE_SIZE, 0);
        if (cancelled) return;
        const eventRows = Array.isArray(eventsRes.data) ? eventsRes.data : [];
        const initialEventId = pickInitialEventId(eventRows, "");
        let markets = [];
        let plays = [];
        if (initialEventId) {
          const [marketsRes, playsRes] = await Promise.all([
            fetchPolymarketMarkets(baseUrl, initialEventId, initialCategory, PAGE_SIZE, 0),
            fetchPolymarketPlays(baseUrl, initialEventId, PLAYS_PAGE_SIZE, 0),
          ]);
          markets = Array.isArray(marketsRes.data) ? marketsRes.data : [];
          plays = Array.isArray(playsRes.data) ? playsRes.data : [];
        }
        if (cancelled) return;
        setSelectedCategory(initialCategory);
        setSelectedEventId(initialEventId);
        setSelectedMarketId(markets.find((item) => item && item.pmMarketId)?.pmMarketId || "");
        setData({
          categories: categoryRows,
          events: eventRows,
          markets: attachLatestPricesToMarkets(markets, plays),
          plays,
          prices: [],
          results: [],
        });
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || "Polymarket 加载失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, loadCategories]);

  const { connected: wsConnected, subscribeEvent } = usePolymarketSocket({
    baseUrl,
    enabled: true,
    onRefresh: applySocketPatch,
    onConnectedChange: setSocketConnected,
  });

  // 当选中 event 变化时,订阅该 event 的价格推送
  useEffect(() => {
    if (selectedEventId && wsConnected) {
      subscribeEvent(selectedEventId);
    }
  }, [selectedEventId, wsConnected, subscribeEvent]);

  const selectedEvent = useMemo(() => (
    (Array.isArray(data.events) ? data.events : []).find((item) => item && item.pmEventId === selectedEventId) || null
  ), [data.events, selectedEventId]);

  const visiblePlays = useMemo(() => {
    const plays = Array.isArray(data.plays) ? data.plays : [];
    if (!selectedMarketId) {
      return plays;
    }
    return plays.filter((item) => item && item.pmMarketId === selectedMarketId);
  }, [data.plays, selectedMarketId]);

  const resolvedPlays = useMemo(() => visiblePlays.filter((item) => item && (item.status === "RESOLVED" || item.resolvedOutcome)), [visiblePlays]);

  const summary = useMemo(() => ([
    { label: "分类", value: categories.length },
    { label: "事件", value: data.events.length },
    { label: "市场", value: data.markets.length },
    { label: "玩法", value: visiblePlays.length },
  ]), [categories.length, data.events.length, data.markets.length, visiblePlays.length]);

  const currentList = useMemo(() => {
    if (activeTab === "markets") return data.markets;
    if (activeTab === "results") return resolvedPlays;
    if (activeTab === "orders") return orders;
    return visiblePlays;
  }, [activeTab, data.markets, resolvedPlays, visiblePlays, orders]);

  useEffect(() => {
    if (!loading && !error && !["markets", "plays", "results", "orders"].includes(activeTab)) {
      setActiveTab("markets");
    }
  }, [activeTab, error, loading]);

  const handleSync = useCallback(async (type) => {
    setRefreshing(true);
    setError("");
    try {
      if (type === "events") {
        await syncPolymarketEvents(baseUrl);
      } else if (type === "markets") {
        await syncPolymarketMarkets(baseUrl);
      } else {
        await syncPolymarketPlays(baseUrl);
      }
      if (selectedCategory) {
        await loadCategoryPath({ category: selectedCategory, eventId: selectedEventId });
      }
    } catch (err) {
      setError(err?.message || "同步失败");
    } finally {
      setRefreshing(false);
    }
  }, [baseUrl, loadCategoryPath, selectedCategory, selectedEventId]);

  const handleCategoryClick = useCallback((category) => {
    if (!category || category === selectedCategory) {
      return;
    }
    loadCategoryPath({ category });
  }, [loadCategoryPath, selectedCategory]);

  const handleEventClick = useCallback((eventId) => {
    if (!eventId || eventId === selectedEventId) {
      return;
    }
    loadSelectedEvent(eventId, selectedCategory);
  }, [loadSelectedEvent, selectedCategory, selectedEventId]);

  const handleMarketClick = useCallback(async (marketId) => {
    if (!marketId || marketId === selectedMarketId) {
      setActiveTab("plays");
      return;
    }
    setSelectedMarketId(marketId);
    setActiveTab("plays");
    // 重新请求带 pmMarketId 的 plays,确保能获取到该 market 的玩法
    try {
      const playsRes = await fetchPolymarketPlays(baseUrl, selectedEventId, PLAYS_PAGE_SIZE, 0, marketId);
      const plays = Array.isArray(playsRes.data) ? playsRes.data : [];
      if (plays.length > 0) {
        setData((prev) => ({
          ...prev,
          plays,
        }));
      }
    } catch (err) {
      console.warn("加载 market plays 失败:", err);
    }
  }, [baseUrl, selectedEventId, selectedMarketId]);

  const handleOrderClick = useCallback((e, play, outcomeIndex, outcomeName, side) => {
    e.stopPropagation();
    const tokenIds = parseTokenIds(play);
    const tokenId = tokenIds[outcomeIndex] || "";
    setOrderModal({ play, outcomeIndex, outcomeName, side, tokenId });
    setOrderAmount("");
  }, []);

  const handleOrderSubmit = useCallback(async () => {
    if (!orderModal || !orderAmount || orderSubmitting) return;
    
    const orderAmountNum = parseFloat(orderAmount);
    
    // 余额校验
    if (orderAmountNum > availableBalance) {
      alert(`下单金额超过可用余额！可用余额：${availableBalance.toFixed(2)} USDT`);
      return;
    }
    
    setOrderSubmitting(true);
    try {
      const { play, outcomeIndex, outcomeName, side, tokenId } = orderModal;
      const price = extractOutcomePrice(play, outcomeIndex);
      await createPolymarketOrder(baseUrl, {
        pmEventId: play.pmEventId,
        pmMarketId: play.pmMarketId,
        tokenId,
        selectionCode: outcomeName,
        selectionName: outcomeName,
        orderSide: side,
        orderType: "MARKET",
        orderPrice: price || 0,
        orderAmount: orderAmountNum,
      });
      alert("下单成功!");
      setOrderModal(null);
      // 切换到订单 tab，会自动加载订单
      setActiveTab("orders");
      // 通知父组件刷新余额
      if (typeof window.refreshBalance === "function") {
        window.refreshBalance();
      }
    } catch (err) {
      alert("下单失败: " + (err?.message || "未知错误"));
    } finally {
      setOrderSubmitting(false);
    }
  }, [baseUrl, orderModal, orderAmount, orderSubmitting, availableBalance]);

  const handleOrderClose = useCallback(() => {
    setOrderModal(null);
    setOrderAmount("");
  }, []);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      const res = await fetchPolymarketOrders(baseUrl, 0, 50);
      setOrders(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.warn("加载订单失败:", err);
    } finally {
      setOrdersLoading(false);
    }
  }, [baseUrl]);

  // 切换到订单 tab 时加载订单
  useEffect(() => {
    if (activeTab === "orders") {
      loadOrders();
    }
  }, [activeTab, loadOrders]);

  return (
    <div className="polymarket-shell">
      <section className="polymarket-hero">
        <div>
          <h2 className="polymarket-hero-title">Polymarket 独立视图</h2>
          <div className="polymarket-hero-desc">
            先选 category，再选 event，再看 market / play。首屏只加载当前路径需要的数据。
          </div>
          <div className="polymarket-hero-desc" style={{ marginTop: 10, opacity: 0.9 }}>
            实时通道：{socketConnected ? "原生 WS 已连接" : "原生 WS 未连接"}，价格变化会自动刷新。
          </div>
          {balance && (
            <div className="polymarket-hero-desc" style={{ marginTop: 10, padding: "8px 12px", background: "#f1f5f9", borderRadius: 6, fontSize: 14 }}>
              <span style={{ fontWeight: 600 }}>可用余额: {availableBalance.toFixed(2)} USDT</span>
              <span style={{ marginLeft: 16, opacity: 0.7 }}>总余额: {parseFloat(balance.amount || 0).toFixed(2)}</span>
              <span style={{ marginLeft: 16, opacity: 0.7 }}>冻结: {parseFloat(balance.froze || 0).toFixed(2)}</span>
            </div>
          )}
        </div>
        <div className="polymarket-actions">
          <button type="button" className="polymarket-action-btn secondary" onClick={() => handleSync("events")} disabled={refreshing}>
            同步事件
          </button>
          <button type="button" className="polymarket-action-btn secondary" onClick={() => handleSync("markets")} disabled={refreshing}>
            同步市场
          </button>
          <button type="button" className="polymarket-action-btn secondary" onClick={() => handleSync("plays")} disabled={refreshing}>
            同步玩法
          </button>
          <button type="button" className="polymarket-action-btn primary" onClick={() => loadCategoryPath({ category: selectedCategory, eventId: selectedEventId })} disabled={loading || refreshing}>
            {loading || refreshing ? "刷新中..." : "刷新"}
          </button>
        </div>
      </section>

      <section className="polymarket-summary">
        {summary.map((item) => (
          <div className="pm-stat" key={item.label}>
            <div className="pm-stat-label">{item.label}</div>
            <div className="pm-stat-value">{item.value}</div>
          </div>
        ))}
      </section>

      <section className="polymarket-tabs" role="tablist" aria-label="Polymarket category tabs">
        {categories.map((item) => {
          const category = item?.category || "";
          return (
            <button
              key={category}
              type="button"
              className={selectedCategory === category ? "polymarket-tab active" : "polymarket-tab"}
              onClick={() => handleCategoryClick(category)}
            >
              {category}
            </button>
          );
        })}
      </section>

      <section className="polymarket-event-rail" aria-label="Polymarket event rail">
        {(Array.isArray(data.events) ? data.events : []).map((item) => {
          const eventId = item?.pmEventId || "";
          return (
            <button
              key={eventId}
              type="button"
              className={selectedEventId === eventId ? "polymarket-event-chip active" : "polymarket-event-chip"}
              onClick={() => handleEventClick(eventId)}
            >
              <span className="polymarket-event-chip-title">{item?.title || item?.slug || eventId}</span>
              <span className="polymarket-event-chip-meta">{item?.category || selectedCategory || "-"} · {item?.status || "ACTIVE"}</span>
            </button>
          );
        })}
      </section>

      {selectedCategory ? (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 14,
            background: "rgba(255,255,255,0.72)",
            border: "1px solid rgba(148,163,184,0.18)",
            color: "#334155",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          当前路径:{selectedCategory || "-"} / {selectedEvent?.title || selectedEvent?.slug || selectedEventId || "未选择 event"} / {selectedMarketId || "未选择 market"}
        </div>
      ) : null}

      <section className="polymarket-tabs" role="tablist" aria-label="Polymarket tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={activeTab === tab.key ? "polymarket-tab active" : "polymarket-tab"}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </section>

      {error ? <div className="pm-empty" style={{ color: "#dc2626" }}>{error}</div> : null}
      {!error && !loading && !selectedCategory ? (
        <div className="pm-empty">当前没有已开启的分类,请先在管理后台开启 category。</div>
      ) : null}
      {!error && !loading && selectedCategory && selectedEventId && data.markets.length === 0 ? (
        <div className="pm-empty">当前 event 下还没有 market,或者 market 还在同步中。</div>
      ) : null}
      {!error && !loading && selectedCategory && selectedEventId && activeTab === "plays" && visiblePlays.length === 0 ? (
        <div className="pm-empty">当前 event 下还没有玩法,或者玩法还在同步中。</div>
      ) : null}
      {loading ? <div className="pm-empty">正在加载 Polymarket 数据...</div> : null}

      {!loading && !error && (selectedCategory || activeTab === "orders") ? (
        currentList.length ? (
          <section className="polymarket-grid">
            {currentList.map((item, index) => {
              if (activeTab === "plays") {
                const outcomeNames = parseMaybeJson(item.outcomesJson);
                const displayName = item.__kind === "market" ? "市场玩法" : item.title || item.question || item.pmPlayId || "Polymarket 玩法";
                const outcomeList = Array.isArray(outcomeNames) && outcomeNames.length > 0
                  ? outcomeNames
                  : Array.isArray(parseMaybeJson(item.outcomePricesJson)) && parseMaybeJson(item.outcomePricesJson).length > 0
                    ? parseMaybeJson(item.outcomePricesJson)
                    : [];
                return (
                  <article
                    className={selectedMarketId === item.pmMarketId ? "polymarket-card selected" : "polymarket-card"}
                    key={item.pmPlayId || item.id || index}
                    onClick={() => handleMarketClick(item.pmMarketId)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="polymarket-card-head">
                      <div>
                        <h3 className="polymarket-card-title">{displayName}</h3>
                        <div className="polymarket-card-subtitle">
                          category:{item.category || selectedCategory || "-"} · event:{item.pmEventId || "-"}
                        </div>
                        <div className="polymarket-card-subtitle">
                          token ids:{parseTokenIds(item).length > 0 ? parseTokenIds(item).join(", ") : "-"}
                        </div>
                        <div className="polymarket-card-subtitle">
                          asset ids:{parseAssetIds(item).length > 0 ? parseAssetIds(item).join(", ") : "-"} · 结果:{item.resolvedOutcome || "-"}
                        </div>
                      </div>
                      <div className={item.status === "RESOLVED" ? "polymarket-pill green" : "polymarket-pill"}>
                        {item.status || "ACTIVE"}
                      </div>
                    </div>
                    <div className="card-hint">
                      {item.__kind === "market"
                        ? "玩法表还没同步完,先用市场数据生成玩法视图。"
                        : "真实玩法表数据,已从 tbl_polymarket_play 读取。"}
                    </div>
                    <div className="pm-options">
                      {outcomeList.map((name, idx) => {
                        const price = extractOutcomePrice(item, idx);
                        const optionName = typeof name === "object" ? (name?.name || name?.label || name?.outcome || `选项${idx + 1}`) : String(name);
                        return (
                          <div className="pm-option" key={`${optionName}-${idx}`}>
                            <div className="pm-option-name">{optionName}</div>
                            <div className="pm-option-price">
                              <div>{formatPrice(price)}</div>
                              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                                概率 {formatProbability(price)}
                              </div>
                            </div>
                            <div style={{ marginTop: 10, height: 8, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
                              <div
                                style={{
                                  width: `${clampPercent(price) || 5}%`,
                                  height: "100%",
                                  borderRadius: 999,
                                  background: "linear-gradient(90deg, #2563eb 0%, #60a5fa 100%)",
                                }}
                              />
                            </div>
                            <div style={{ marginTop: 12 }}>
                              <button
                                type="button"
                                onClick={(e) => handleOrderClick(e, item, idx, optionName, "BUY")}
                                style={{
                                  width: "100%",
                                  padding: "10px 12px",
                                  borderRadius: 6,
                                  border: "none",
                                  background: optionName.toLowerCase() === "yes" ? "#22c55e" : "#3b82f6",
                                  color: "#fff",
                                  fontWeight: 600,
                                  fontSize: 14,
                                  cursor: "pointer",
                                }}
                              >
                                买入 {optionName}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {outcomeList.length === 0 ? (
                        <div className="pm-option">
                          <div className="pm-option-name">未配置选项</div>
                          <div className="pm-option-price">-</div>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              }

              if (activeTab === "markets") {
                const prices = Array.isArray(item.latestPrices) && item.latestPrices.length > 0
                  ? item.latestPrices
                  : buildLatestPrices(data.prices, item.pmMarketId);
                return (
                  <article
                    className={selectedMarketId === item.pmMarketId ? "polymarket-card selected" : "polymarket-card"}
                    key={item.pmMarketId || item.id || index}
                    onClick={() => handleMarketClick(item.pmMarketId)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="polymarket-card-head">
                      <div>
                        <h3 className="polymarket-card-title">{item.question || item.description || item.pmMarketId || "Polymarket 市场"}</h3>
                        <div className="polymarket-card-subtitle">
                          category:{item.category || selectedCategory || "-"} · event:{item.pmEventId || "-"}
                        </div>
                        <div className="polymarket-card-subtitle">
                          token ids:{parseTokenIds(item).length > 0 ? parseTokenIds(item).join(", ") : "-"}
                        </div>
                        <div className="polymarket-card-subtitle">
                          asset ids:{parseAssetIds(item).length > 0 ? parseAssetIds(item).join(", ") : "-"} · condition:{item.conditionId || "-"}
                        </div>
                      </div>
                      <div className={item.status === "RESOLVED" ? "polymarket-pill green" : "polymarket-pill"}>
                        {item.status || "ACTIVE"}
                      </div>
                    </div>
                    <div className="card-hint">选中一个 market 后,玩法会自动聚焦到这个 market。</div>
                    <div className="pm-options">
                      {(Array.isArray(parseMaybeJson(item.outcomesJson)) ? parseMaybeJson(item.outcomesJson) : []).map((name, idx) => {
                        const priceRow = prices.find((row) => row.pmMarketId === item.pmMarketId && Number(row.outcomeIndex) === Number(idx));
                        const price = priceRow?.price ?? priceRow?.bestAsk ?? priceRow?.bestBid;
                        return (
                          <div className="pm-option" key={`${item.pmMarketId}-${name}-${idx}`}>
                            <div className="pm-option-name">{String(name)}</div>
                            <div className="pm-option-price">
                              <div>{formatPrice(price)}</div>
                              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                                概率 {formatProbability(price)}
                              </div>
                            </div>
                            <div style={{ marginTop: 10, height: 8, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
                              <div
                                style={{
                                  width: `${clampPercent(price) || 5}%`,
                                  height: "100%",
                                  borderRadius: 999,
                                  background: "linear-gradient(90deg, #7c3aed 0%, #a78bfa 100%)",
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              }

              if (activeTab === "orders") {
                return (
                  <article className="polymarket-card" key={item.orderNo || item.id || index}>
                    <div className="polymarket-card-head">
                      <div>
                        <h3 className="polymarket-card-title">{item.selectionName || item.selectionCode || "订单"}</h3>
                        <div className="polymarket-card-subtitle">
                          订单号:{item.orderNo || "-"}
                        </div>
                        <div className="polymarket-card-subtitle">
                          市场:{item.pmMarketId || "-"} · 事件:{item.pmEventId || "-"}
                        </div>
                        <div className="polymarket-card-subtitle">
                          下单时间:{item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}
                        </div>
                      </div>
                      <div className={`polymarket-pill ${item.settleStatus === "WIN" ? "green" : item.settleStatus === "LOSE" ? "red" : ""}`}>
                        {item.settleStatus || "OPEN"}
                      </div>
                    </div>
                    <div className="pm-options">
                      <div className="pm-option">
                        <div className="pm-option-name">下单金额</div>
                        <div className="pm-option-price">{item.orderAmount || 0} {item.currency || "USDT"}</div>
                      </div>
                      <div className="pm-option">
                        <div className="pm-option-name">下单概率</div>
                        <div className="pm-option-price">{item.orderPrice ? (item.orderPrice * 100).toFixed(1) + "%" : "-"}</div>
                      </div>
                      <div className="pm-option">
                        <div className="pm-option-name">潜在收益</div>
                        <div className="pm-option-price">
                          {item.orderAmount && item.orderPrice
                            ? (item.orderAmount / item.orderPrice).toFixed(2) + " " + (item.currency || "USDT")
                            : "-"}
                        </div>
                      </div>
                      {item.settlePnl != null && (
                        <div className="pm-option">
                          <div className="pm-option-name">结算盈亏</div>
                          <div className="pm-option-price" style={{ color: item.settlePnl > 0 ? "#22c55e" : item.settlePnl < 0 ? "#ef4444" : "inherit" }}>
                            {item.settlePnl > 0 ? "+" : ""}{item.settlePnl} {item.currency || "USDT"}
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                );
              }

              return (
                <article className="polymarket-card" key={item.pmMarketId || item.marketId || index}>
                  <div className="polymarket-card-head">
                    <div>
                      <h3 className="polymarket-card-title">{item.pmMarketId || item.marketId || "Polymarket 结果"}</h3>
                      <div className="polymarket-card-subtitle">
                        category:{item.category || selectedCategory || "-"} · event:{item.pmEventId || "-"}
                      </div>
                      <div className="polymarket-card-subtitle">
                        token ids:{parseTokenIds(item).length > 0 ? parseTokenIds(item).join(", ") : "-"}
                      </div>
                      <div className="polymarket-card-subtitle">
                        asset ids:{parseAssetIds(item).length > 0 ? parseAssetIds(item).join(", ") : "-"} · resolvedAt:{item.resolvedAt || "-"} · source:{item.resolutionSource || "-"}
                      </div>
                    </div>
                    <div className="polymarket-pill green">{item.resolvedOutcome || "RESOLVED"}</div>
                  </div>
                  <div className="pm-options">
                    <div className="pm-option">
                      <div className="pm-option-name">resolved value</div>
                      <div className="pm-option-price">{item.resolvedValue || "-"}</div>
                    </div>
                    <div className="pm-option">
                      <div className="pm-option-name">market</div>
                      <div className="pm-option-price">{item.pmMarketId || "-"}</div>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        ) : (
          <div className="pm-empty">
            {activeTab === "orders" 
              ? (ordersLoading ? "加载订单中..." : "暂无订单记录") 
              : "当前没有数据，可以先点\"同步事件\"或\"同步市场\"。"}
          </div>
        )
      ) : null}

      {/* 下单弹窗 */}
      {orderModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={handleOrderClose}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 24,
              minWidth: 320,
              maxWidth: 400,
              boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 700 }}>
              买入 {orderModal.outcomeName}
            </h3>
            <div style={{ marginBottom: 12, fontSize: 14, color: "#64748b" }}>
              市场: {orderModal.play?.question || orderModal.play?.pmMarketId}
            </div>
            <div style={{ marginBottom: 12, padding: "10px 12px", background: "#f1f5f9", borderRadius: 8, fontSize: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>可用余额:</span>
                <span style={{ fontWeight: 600 }}>{availableBalance.toFixed(2)} USDT</span>
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 6, fontWeight: 600, fontSize: 14 }}>
                金额 (USDT)
              </label>
              <input
                type="number"
                value={orderAmount}
                onChange={(e) => setOrderAmount(e.target.value)}
                placeholder="输入金额"
                max={availableBalance}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: parseFloat(orderAmount) > availableBalance ? "1px solid #ef4444" : "1px solid #e2e8f0",
                  fontSize: 16,
                  boxSizing: "border-box",
                }}
              />
              {parseFloat(orderAmount) > availableBalance && (
                <div style={{ color: "#ef4444", fontSize: 12, marginTop: 4 }}>
                  下单金额不能超过可用余额
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                type="button"
                onClick={handleOrderClose}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  background: "#fff",
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleOrderSubmit}
                disabled={orderSubmitting || !orderAmount || parseFloat(orderAmount) > availableBalance}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 8,
                  border: "none",
                  background: orderModal.outcomeName?.toLowerCase() === "yes" ? "#22c55e" : "#3b82f6",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: orderSubmitting || !orderAmount || parseFloat(orderAmount) > availableBalance ? "not-allowed" : "pointer",
                  opacity: orderSubmitting || !orderAmount || parseFloat(orderAmount) > availableBalance ? 0.6 : 1,
                }}
              >
                {orderSubmitting ? "提交中..." : "确认"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PolymarketApp;
