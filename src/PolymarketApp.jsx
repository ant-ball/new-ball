import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchPolymarketEvents,
  fetchPolymarketMarkets,
  fetchPolymarketPlays,
  fetchPolymarketPrices,
  fetchPolymarketResults,
  syncPolymarketEvents,
  syncPolymarketMarkets,
  syncPolymarketPlays,
} from "./polymarketApi";

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

function PolymarketApp({ baseUrl }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState("markets");
  const [error, setError] = useState("");
  const [playSyncing, setPlaySyncing] = useState(false);
  const [playSyncTries, setPlaySyncTries] = useState(0);
  const [data, setData] = useState({
    events: [],
    markets: [],
    plays: [],
    prices: [],
    results: [],
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [eventsRes, marketsRes, playsRes, pricesRes, resultsRes] = await Promise.all([
        fetchPolymarketEvents(baseUrl),
        fetchPolymarketMarkets(baseUrl),
        fetchPolymarketPlays(baseUrl),
        fetchPolymarketPrices(baseUrl),
        fetchPolymarketResults(baseUrl),
      ]);
      setData({
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

  useEffect(() => {
    load();
  }, [load]);

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
          await load();
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
  }, [baseUrl, data.plays.length, data.markets.length, error, load, loading, playSyncing, playSyncTries]);

  const summary = useMemo(() => ([
    { label: "事件", value: data.events.length },
    { label: "市场", value: data.markets.length },
    { label: "玩法", value: data.plays.length },
    { label: "结果", value: data.results.length },
  ]), [data.events.length, data.markets.length, data.plays.length, data.results.length]);

  const currentList = useMemo(() => {
    if (activeTab === "events") return data.events;
    if (activeTab === "markets") return data.markets;
    if (activeTab === "results") return data.results;
    return deriveDisplayCards(data.plays, data.markets);
  }, [activeTab, data.events, data.markets, data.plays, data.results]);

  useEffect(() => {
    if (!loading) {
      if (data.plays.length > 0) {
        setActiveTab("plays");
      } else if (data.markets.length > 0) {
        setActiveTab("plays");
      } else if (data.events.length > 0) {
        setActiveTab("events");
      }
    }
  }, [loading, data.plays.length, data.markets.length, data.events.length]);

  const handleSync = useCallback(async (type) => {
    setRefreshing(true);
    setError("");
    try {
      if (type === "events") {
        await syncPolymarketEvents(baseUrl);
      } else {
        await syncPolymarketMarkets(baseUrl);
      }
      await load();
    } catch (err) {
      setError(err?.message || "同步失败");
    } finally {
      setRefreshing(false);
    }
  }, [baseUrl, load]);

  return (
    <div className="polymarket-shell">
      <section className="polymarket-hero">
        <div>
          <h2 className="polymarket-hero-title">Polymarket 独立视图</h2>
          <div className="polymarket-hero-desc">
            只看事件、市场、玩法、结果和价格，不复用现有球盘组件树。
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
                await load();
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
          <button type="button" className="polymarket-action-btn primary" onClick={load} disabled={loading || refreshing}>
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
      {!error && !loading && data.plays.length === 0 && data.markets.length > 0 ? (
        <div className="pm-empty">
          玩法表暂时还没同步出来，当前用市场数据直接展示赔率。你可以先看市场卡片里的选项和价格。
        </div>
      ) : null}
      {loading ? <div className="pm-empty">正在加载 Polymarket 数据...</div> : null}

      {!loading && !error ? (
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
                          市场：{item.pmMarketId || "-"} · 事件：{item.pmEventId || "-"} · 结果：{item.resolvedOutcome || "-"}
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
                          event：{item.pmEventId || "-"} · condition：{item.conditionId || "-"}
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
                          resolvedAt：{item.resolvedAt || "-"} · source：{item.resolutionSource || "-"}
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
