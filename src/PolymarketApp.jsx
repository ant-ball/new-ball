import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchPolymarketCategories,
  fetchPolymarketEvents,
  fetchPolymarketMarkets,
  fetchPolymarketPlays,
  fetchPolymarketPrices,
  fetchPolymarketResults,
  syncPolymarketEvents,
  syncPolymarketMarkets,
  syncPolymarketPlays,
} from "./polymarketApi";
import { usePolymarketSocket } from "./usePolymarketSocket";

const TABS = [
  { key: "plays", label: "玩法" },
  { key: "markets", label: "市场" },
  { key: "events", label: "事件" },
  { key: "results", label: "结果" },
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
  if (value == null || value === "") return "—";
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  return num.toFixed(4).replace(/\.?0+$/, "");
}

function formatProbability(value) {
  if (value == null || value === "") return "—";
  const num = Number(value);
  if (Number.isNaN(num)) return "—";
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

function PolymarketApp({ baseUrl }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState("markets");
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [error, setError] = useState("");
  const [playSyncing, setPlaySyncing] = useState(false);
  const [playSyncTries, setPlaySyncTries] = useState(0);
  const [socketConnected, setSocketConnected] = useState(false);
  const reloadTimerRef = useRef(null);
  const [data, setData] = useState({
    categories: [],
    events: [],
    markets: [],
    plays: [],
    prices: [],
    results: [],
  });

  const loadAll = useCallback(async ({ category = "", resetCategory = false } = {}) => {
    setLoading(true);
    setError("");
    try {
      const categoriesRes = await fetchPolymarketCategories(baseUrl);
      const categoryRows = Array.isArray(categoriesRes.data) ? categoriesRes.data : [];
      const enabledCategories = categoryRows
        .filter((item) => item && item.category)
        .map((item) => item.category);
      const requestedCategory = category || "";
      const resolvedCategory = resetCategory
        ? (enabledCategories[0] || "")
        : (enabledCategories.includes(requestedCategory) ? requestedCategory : (enabledCategories[0] || ""));
      setSelectedCategory((prev) => (prev === resolvedCategory ? prev : resolvedCategory));
      setCategories(categoryRows);
      const [eventsRes, marketsRes, playsRes, pricesRes, resultsRes] = await Promise.all([
        fetchPolymarketEvents(baseUrl, resolvedCategory),
        fetchPolymarketMarkets(baseUrl, null, resolvedCategory),
        fetchPolymarketPlays(baseUrl),
        fetchPolymarketPrices(baseUrl),
        fetchPolymarketResults(baseUrl),
      ]);
      setData({
        categories: categoryRows,
        events: Array.isArray(eventsRes.data) ? eventsRes.data : [],
        markets: Array.isArray(marketsRes.data) ? marketsRes.data : [],
        plays: Array.isArray(playsRes.data) ? playsRes.data : [],
        prices: Array.isArray(pricesRes.data) ? pricesRes.data : [],
        results: Array.isArray(resultsRes.data) ? resultsRes.data : [],
      });
    } catch (err) {
      setError(err?.message || "Polymarket 加载失败");
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  const loadLive = useCallback(async () => {
    setError("");
    try {
      const currentCategory = selectedCategory;
      const [marketsRes, playsRes, pricesRes, resultsRes] = await Promise.all([
        fetchPolymarketMarkets(baseUrl, null, currentCategory),
        fetchPolymarketPlays(baseUrl),
        fetchPolymarketPrices(baseUrl),
        fetchPolymarketResults(baseUrl),
      ]);
      setData((prev) => ({
        ...prev,
        markets: Array.isArray(marketsRes.data) ? marketsRes.data : [],
        plays: Array.isArray(playsRes.data) ? playsRes.data : [],
        prices: Array.isArray(pricesRes.data) ? pricesRes.data : [],
        results: Array.isArray(resultsRes.data) ? resultsRes.data : [],
      }));
    } catch (err) {
      setError(err?.message || "Polymarket 刷新失败");
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
      setData((prev) => {
        const results = upsertByKey(prev.results, (row) => row.pmMarketId || row.marketId, patch);
        return {
          ...prev,
          results,
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
        };
      });
      return;
    }
    if (type === "polymarket-refresh" || type === "polymarket_refresh") {
      const reason = payload?.reason ?? payload?.data?.reason ?? "";
      if (reason === "subscribe") {
        return;
      }
      if (reason.startsWith("price") || reason === "result") {
        return;
      }
      // 其他刷新信号先忽略，避免整页重拉；如果后续需要可在这里补局部 patch。
      return;
    }
  }, []);

  useEffect(() => {
    loadAll({ resetCategory: true });
    return () => {
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
    };
  }, [loadAll]);

  useEffect(() => {
    if (loading || error || playSyncing) {
      return;
    }
    if (data.plays.length > 0 || data.markets.length === 0) {
      return;
    }
    if (playSyncTries >= 1) {
      return;
    }
    let cancelled = false;
    (async () => {
      setPlaySyncing(true);
      try {
        await syncPolymarketPlays(baseUrl);
        if (!cancelled) {
          setPlaySyncTries((prev) => prev + 1);
          await loadAll({ resetCategory: true });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || "同步玩法失败");
        }
      } finally {
        if (!cancelled) {
          setPlaySyncing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, data.plays.length, data.markets.length, error, loadAll, loading, playSyncing, playSyncTries]);

  usePolymarketSocket({
    baseUrl,
    enabled: true,
    onRefresh: applySocketPatch,
    onConnectedChange: setSocketConnected,
  });

  const visibleEventIds = useMemo(() => new Set((Array.isArray(data.events) ? data.events : []).map((item) => item.pmEventId).filter(Boolean)), [data.events]);

  const filteredPlays = useMemo(() => {
    const plays = Array.isArray(data.plays) ? data.plays : [];
    if (!visibleEventIds.size) {
      return [];
    }
    return plays.filter((item) => item && item.pmEventId && visibleEventIds.has(item.pmEventId));
  }, [data.plays, visibleEventIds]);

  const filteredResults = useMemo(() => {
    const marketIds = new Set((Array.isArray(data.markets) ? data.markets : []).map((item) => item.pmMarketId).filter(Boolean));
    const results = Array.isArray(data.results) ? data.results : [];
    if (!marketIds.size) {
      return [];
    }
    return results.filter((item) => item && item.pmMarketId && marketIds.has(item.pmMarketId));
  }, [data.markets, data.results]);

  const summary = useMemo(() => ([
    { label: "分类", value: categories.length },
    { label: "事件", value: data.events.length },
    { label: "市场", value: data.markets.length },
    { label: "玩法", value: filteredPlays.length },
  ]), [categories.length, data.events.length, data.markets.length, filteredPlays.length]);

  const currentList = useMemo(() => {
    if (activeTab === "events") return data.events;
    if (activeTab === "markets") return data.markets;
    if (activeTab === "results") return filteredResults;
    return deriveDisplayCards(filteredPlays, data.markets);
  }, [activeTab, data.events, data.markets, filteredPlays, filteredResults]);

  useEffect(() => {
    if (!loading) {
      if (filteredPlays.length > 0) {
        setActiveTab("plays");
      } else if (data.markets.length > 0) {
        setActiveTab("plays");
      } else if (data.events.length > 0) {
        setActiveTab("events");
      }
    }
  }, [loading, filteredPlays.length, data.markets.length, data.events.length]);

  const handleSync = useCallback(async (type) => {
    setRefreshing(true);
    setError("");
    try {
      if (type === "events") {
        await syncPolymarketEvents(baseUrl);
      } else {
        await syncPolymarketMarkets(baseUrl);
      }
      await loadAll({ resetCategory: true });
    } catch (err) {
      setError(err?.message || "同步失败");
    } finally {
      setRefreshing(false);
    }
  }, [baseUrl, loadAll]);

  return (
    <div className="polymarket-shell">
      <section className="polymarket-hero">
        <div>
          <h2 className="polymarket-hero-title">Polymarket 独立视图</h2>
          <div className="polymarket-hero-desc">
            只看事件、市场、玩法、结果和价格，不复用现有球盘组件树。
          </div>
          <div className="polymarket-hero-desc" style={{ marginTop: 10, opacity: 0.9 }}>
            实时通道：{socketConnected ? "原生 WS 已连接" : "原生 WS 未连接"}，价格变化会自动刷新。
          </div>
        </div>
        <div className="polymarket-actions">
          <button type="button" className="polymarket-action-btn secondary" onClick={() => handleSync("events")} disabled={refreshing}>
            同步事件
          </button>
          <button type="button" className="polymarket-action-btn secondary" onClick={() => handleSync("markets")} disabled={refreshing}>
            同步市场
          </button>
          <button
            type="button"
            className="polymarket-action-btn secondary"
            onClick={async () => {
              setPlaySyncing(true);
              setError("");
              try {
                await syncPolymarketPlays(baseUrl);
                await loadAll({ resetCategory: true });
                setActiveTab("plays");
              } catch (err) {
                setError(err?.message || "同步玩法失败");
              } finally {
                setPlaySyncing(false);
              }
            }}
            disabled={refreshing || playSyncing}
          >
            {playSyncing ? "同步玩法中..." : "同步玩法"}
          </button>
          <button type="button" className="polymarket-action-btn primary" onClick={loadAll} disabled={loading || refreshing}>
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
              onClick={() => {
                if (category && category !== selectedCategory) {
                  setSelectedCategory(category);
                  loadAll({ category });
                }
              }}
            >
              {category}
            </button>
          );
        })}
      </section>

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
        <div className="pm-empty">当前没有已开启的分类，请先在管理后台开启 category。</div>
      ) : null}
      {!error && !loading && filteredPlays.length === 0 && data.markets.length > 0 ? (
        <div className="pm-empty">
          玩法表暂时还没同步出来，当前用市场数据直接展示赔率。你可以先看市场卡片里的选项和价格。
        </div>
      ) : null}
      {loading ? <div className="pm-empty">正在加载 Polymarket 数据...</div> : null}

      {!loading && !error && selectedCategory ? (
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
                  <article className="polymarket-card" key={item.pmPlayId || item.id || index}>
                    <div className="polymarket-card-head">
                      <div>
                        <h3 className="polymarket-card-title">{displayName}</h3>
                        <div className="polymarket-card-subtitle">
                          token ids：{parseTokenIds(item).length > 0 ? parseTokenIds(item).join(", ") : "-"}
                        </div>
                        <div className="polymarket-card-subtitle">
                          asset ids：{parseAssetIds(item).length > 0 ? parseAssetIds(item).join(", ") : "-"} · 结果：{item.resolvedOutcome || "-"}
                        </div>
                      </div>
                      <div className={item.status === "RESOLVED" ? "polymarket-pill green" : "polymarket-pill"}>
                        {item.status || "ACTIVE"}
                      </div>
                    </div>
                    <div className="card-hint">
                      {item.__kind === "market"
                        ? "玩法表还没同步完，先用市场数据生成玩法视图。"
                        : "真实玩法表数据，已从 tbl_polymarket_play 读取。"}
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
                          </div>
                        );
                      })}
                      {outcomeList.length === 0 ? (
                        <div className="pm-option">
                          <div className="pm-option-name">未配置选项</div>
                          <div className="pm-option-price">—</div>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              }

              if (activeTab === "markets") {
                return (
                  <article className="polymarket-card" key={item.pmMarketId || item.id || index}>
                    <div className="polymarket-card-head">
                      <div>
                        <h3 className="polymarket-card-title">{item.question || item.description || item.pmMarketId || "Polymarket 市场"}</h3>
                        <div className="polymarket-card-subtitle">
                          token ids：{parseTokenIds(item).length > 0 ? parseTokenIds(item).join(", ") : "-"}
                        </div>
                        <div className="polymarket-card-subtitle">
                          asset ids：{parseAssetIds(item).length > 0 ? parseAssetIds(item).join(", ") : "-"} · condition：{item.conditionId || "-"}
                        </div>
                      </div>
                      <div className={item.status === "RESOLVED" ? "polymarket-pill green" : "polymarket-pill"}>
                        {item.status || "ACTIVE"}
                      </div>
                    </div>
                    <div className="card-hint">市场卡片可直接查看选项和赔率条，适合当前玩法表还未同步完的情况。</div>
                    <div className="pm-options">
                      {(Array.isArray(parseMaybeJson(item.outcomesJson)) ? parseMaybeJson(item.outcomesJson) : []).map((name, idx) => {
                        const prices = Array.isArray(data.prices) ? data.prices : [];
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

              if (activeTab === "results") {
                return (
                  <article className="polymarket-card" key={item.pmMarketId || item.id || index}>
                    <div className="polymarket-card-head">
                      <div>
                        <h3 className="polymarket-card-title">{item.pmMarketId || item.marketId || "Polymarket 结果"}</h3>
                        <div className="polymarket-card-subtitle">
                          token ids：{parseTokenIds(item).length > 0 ? parseTokenIds(item).join(", ") : "-"}
                        </div>
                        <div className="polymarket-card-subtitle">
                          asset ids：{parseAssetIds(item).length > 0 ? parseAssetIds(item).join(", ") : "-"} · resolvedAt：{item.resolvedAt || "-"} · source：{item.resolutionSource || "-"}
                        </div>
                      </div>
                      <div className="polymarket-pill green">{item.resolvedOutcome || "RESOLVED"}</div>
                    </div>
                    <div className="pm-options">
                      <div className="pm-option">
                        <div className="pm-option-name">resolved value</div>
                        <div className="pm-option-price">{item.resolvedValue || "—"}</div>
                      </div>
                      <div className="pm-option">
                        <div className="pm-option-name">market</div>
                        <div className="pm-option-price">{item.pmMarketId || "—"}</div>
                      </div>
                    </div>
                  </article>
                );
              }

              return (
                <article className="polymarket-card" key={item.pmEventId || item.id || index}>
                  <div className="polymarket-card-head">
                    <div>
                      <h3 className="polymarket-card-title">{item.title || item.slug || item.pmEventId || "Polymarket 事件"}</h3>
                      <div className="polymarket-card-subtitle">
                        category：{item.category || "-"} · sub：{item.subCategory || item.sub_category || "-"}
                      </div>
                    </div>
                    <div className={item.status === "RESOLVED" ? "polymarket-pill green" : "polymarket-pill"}>
                      {item.status || "ACTIVE"}
                    </div>
                  </div>
                  <div className="pm-options">
                    <div className="pm-option">
                      <div className="pm-option-name">开始时间</div>
                      <div className="pm-option-price" style={{ fontSize: 14 }}>{item.startTime || item.start_time || "—"}</div>
                    </div>
                    <div className="pm-option">
                      <div className="pm-option-name">结束时间</div>
                      <div className="pm-option-price" style={{ fontSize: 14 }}>{item.endTime || item.end_time || "—"}</div>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        ) : (
          <div className="pm-empty">当前没有数据，可以先点“同步事件”或“同步市场”。</div>
        )
      ) : null}
    </div>
  );
}

export default PolymarketApp;
