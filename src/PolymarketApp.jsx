import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchPolymarketEvents,
  fetchPolymarketMarkets,
  fetchPolymarketPlays,
  fetchPolymarketPrices,
  fetchPolymarketResults,
  syncPolymarketEvents,
  syncPolymarketMarkets,
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

function PolymarketApp({ baseUrl }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState("plays");
  const [error, setError] = useState("");
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
    return data.plays;
  }, [activeTab, data]);

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
      {loading ? <div className="pm-empty">正在加载 Polymarket 数据...</div> : null}

      {!loading && !error ? (
        currentList.length ? (
          <section className="polymarket-grid">
            {currentList.map((item, index) => {
              if (activeTab === "plays") {
                const latestPrices = Array.isArray(item.latestPrices) ? item.latestPrices : [];
                return (
                  <article className="polymarket-card" key={item.pmPlayId || item.id || index}>
                    <div className="polymarket-card-head">
                      <div>
                        <h3 className="polymarket-card-title">{item.title || item.question || item.pmPlayId || "Polymarket 玩法"}</h3>
                        <div className="polymarket-card-subtitle">
                          市场：{item.pmMarketId || "-"} · 事件：{item.pmEventId || "-"} · 结果：{item.resolvedOutcome || "-"}
                        </div>
                      </div>
                      <div className={item.status === "RESOLVED" ? "polymarket-pill green" : "polymarket-pill"}>
                        {item.status || "ACTIVE"}
                      </div>
                    </div>
                    <div className="pm-options">
                      {(parseMaybeJson(item.outcomesJson) || []).map?.((name, idx) => {
                        const priceRow = latestPrices.find((row) => Number(row.outcomeIndex) === Number(idx));
                        return (
                          <div className="pm-option" key={`${name}-${idx}`}>
                            <div className="pm-option-name">{String(name)}</div>
                            <div className="pm-option-price">{formatPrice(priceRow?.price ?? priceRow?.bestAsk ?? priceRow?.bestBid)}</div>
                          </div>
                        );
                      }) || (
                        <div className="pm-option">
                          <div className="pm-option-name">未配置选项</div>
                          <div className="pm-option-price">—</div>
                        </div>
                      )}
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
                    <div className="pm-options">
                      <div className="pm-option">
                        <div className="pm-option-name">流动性</div>
                        <div className="pm-option-price">{formatPrice(item.liquidity)}</div>
                      </div>
                      <div className="pm-option">
                        <div className="pm-option-name">成交量</div>
                        <div className="pm-option-price">{formatPrice(item.volume)}</div>
                      </div>
                      <div className="pm-option">
                        <div className="pm-option-name">结果</div>
                        <div className="pm-option-price">{item.resolvedOutcome || "—"}</div>
                      </div>
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
