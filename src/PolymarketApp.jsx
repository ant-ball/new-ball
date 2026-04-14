import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchPolymarketCategories,
  fetchPolymarketEvents,
  fetchPolymarketMarkets,
  fetchPolymarketPlays,
  fetchPolymarketGraph,
  syncPolymarketEvents,
  syncPolymarketMarkets,
  syncPolymarketPlays,
  syncPolymarketPrice,
  createPolymarketOrder,
  fetchPolymarketOrders,
} from "./polymarketApi";
import { usePolymarketSocket } from "./usePolymarketSocket";

const PAGE_SIZE = 20;
const PLAYS_PAGE_SIZE = 50;
const PRICE_STALE_MS = 60 * 1000;
const PRICE_FALLBACK_CHECK_MS = 15 * 1000;
const TABS = [
  { key: "plays", label: "玩法" },
  { key: "markets", label: "市场" },
  { key: "graph", label: "图表" },
  { key: "results", label: "结果" },
  { key: "orders", label: "我的订单" },
];
const GRAPH_RANGES = [
  { key: "1h", label: "1小时" },
  { key: "6h", label: "6小时" },
  { key: "1d", label: "1天" },
  { key: "1w", label: "1周" },
  { key: "1m", label: "1个月" },
  { key: "all", label: "全部" },
];
const GRAPH_COLORS = ["#f97316", "#dc2626", "#2563eb", "#16a34a", "#7c3aed", "#0f766e"];

const CATEGORY_LABELS = {
  business: "商业",
  chatgpt: "ChatGPT",
  crypto: "加密",
  "global gdp": "全球GDP",
  russia: "俄罗斯",
  sports: "体育",
  "trump presidency": "特朗普任期",
  "ukraine & russia": "乌克兰与俄罗斯",
  world: "世界",
  "world cup": "世界杯",
  politics: "政治",
  weather: "天气",
  finance: "金融",
  soccer: "足球",
  tennis: "网球",
  economy: "经济",
  elections: "选举",
};

function formatStatusLabel(status) {
  const normalized = String(status || "").trim().toUpperCase();
  if (!normalized) return "进行中";
  if (normalized === "ACTIVE") return "进行中";
  if (normalized === "CLOSED") return "已关闭";
  if (normalized === "RESOLVED") return "已结算";
  if (normalized === "OPEN") return "待结算";
  if (normalized === "WIN") return "已中奖";
  if (normalized === "LOSE") return "未命中";
  if (normalized === "PENDING") return "处理中";
  return status;
}

function formatOutcomeLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "yes") return "是";
  if (normalized === "no") return "否";
  if (normalized === "over") return "大";
  if (normalized === "under") return "小";
  return value;
}

function isYesLikeOutcome(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "yes";
}

function translateCategoryLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  return CATEGORY_LABELS[raw.toLowerCase()] || raw;
}

function translateDynamicText(value) {
  const raw = String(value || "").trim();
  if (!raw) return raw;

  const directMap = {
    "Which banks will fail by end of 2026?": "到2026年底哪些银行会倒闭？",
    "How many Tesla deliveries in Q2 2026?": "2026年第二季度特斯拉交付量是多少？",
    "Which DCMs self-certify sports event contracts by June 30?": "到6月30日哪些DCM会自行认证体育赛事合约？",
    "How much will SpaceX raise in its IPO?": "SpaceX 在 IPO 中将融资多少？",
    "Will Stripe acquire any part of Paypal in 2026?": "Stripe 会在 2026 年收购 PayPal 的任何业务吗？",
    "Will RBC fail by end of 2026?": "RBC 会在 2026 年底前倒闭吗？",
  };
  if (directMap[raw]) {
    return directMap[raw];
  }

  let text = raw;

  text = text
    .replace(/\bBusiness\b/gi, "商业")
    .replace(/\bSports\b/gi, "体育")
    .replace(/\bCrypto\b/gi, "加密")
    .replace(/\bWorld\b/gi, "世界")
    .replace(/\bRussia\b/gi, "俄罗斯")
    .replace(/\bGlobal GDP\b/gi, "全球GDP")
    .replace(/\bTrump Presidency\b/gi, "特朗普任期")
    .replace(/\bUkraine & Russia\b/gi, "乌克兰与俄罗斯")
    .replace(/\bworld cup\b/gi, "世界杯")
    .replace(/\bPaypal\b/g, "PayPal")
    .replace(/\bchatgpt\b/gi, "ChatGPT")
    .replace(/\bIPO\b/g, "IPO")
    .replace(/\bQ1\b/g, "第一季度")
    .replace(/\bQ2\b/g, "第二季度")
    .replace(/\bQ3\b/g, "第三季度")
    .replace(/\bQ4\b/g, "第四季度")
    .replace(/\bby end of (\d{4})\b/gi, "到 $1 年底")
    .replace(/\bend of April\b/gi, "到 4 月底")
    .replace(/\bby June 30\b/gi, "到 6 月 30 日")
    .replace(/\bacquire any part of\b/gi, "收购")
    .replace(/\braise in its IPO\b/gi, "在 IPO 中融资")
    .replace(/\bdeliveries\b/gi, "交付量")
    .replace(/\bself-certify sports event contracts\b/gi, "自行认证体育赛事合约")
    .replace(/\bbanks\b/gi, "银行")
    .replace(/\bfail\b/gi, "倒闭")
    .replace(/\bHow many\b/gi, "多少")
    .replace(/\bHow much\b/gi, "多少")
    .replace(/\bWhich\b/gi, "哪些")
    .replace(/\bWill\b/gi, "是否会");

  text = text
    .replace(/^是否会\s+(.+?)\s+倒闭\s+到\s+(\d{4})\s+年底\?$/i, "$1 会在 $2 年底前倒闭吗？")
    .replace(/^多少\s+Tesla\s+交付量\s+in\s+第二季度\s+(\d{4})\?$/i, "$1 年第二季度 Tesla 交付量是多少？")
    .replace(/^多少\s+will\s+SpaceX\s+在 IPO 中融资\?$/i, "SpaceX 在 IPO 中将融资多少？")
    .replace(/^哪些\s+DCMs\s+自行认证体育赛事合约\s+到 6 月 30 日\?$/i, "到 6 月 30 日哪些 DCM 会自行认证体育赛事合约？")
    .replace(/^是否会\s+(.+?)\s+收购\s+(.+?)\s+in\s+(\d{4})\?$/i, "$1 会在 $3 年收购 $2 吗？")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

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

function formatBeijingTime(value) {
  if (!value) return "暂无";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无";
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function getPriceRowTime(priceRow) {
  if (!priceRow) return 0;
  const candidate = priceRow.updateAt ?? priceRow.updatedAt ?? priceRow.createdAt;
  if (candidate == null || candidate === "") return 0;
  if (typeof candidate === "number") {
    return candidate > 1000000000000 ? candidate : candidate * 1000;
  }
  const parsed = new Date(candidate).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getLatestPriceUpdateAt(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  return rows.reduce((max, row) => Math.max(max, getPriceRowTime(row)), 0);
}

function isClosedStatus(status) {
  const normalized = String(status || "").trim().toUpperCase();
  return normalized === "CLOSED" || normalized === "RESOLVED";
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

function formatGraphRangeLabel(value) {
  const row = GRAPH_RANGES.find((item) => item.key === value);
  return row ? row.label : value;
}

function buildGraphSeriesSvg(series = [], width = 960, height = 320) {
  const allPoints = series.flatMap((item) => Array.isArray(item?.points) ? item.points : []);
  if (allPoints.length === 0) {
    return { paths: [], labels: [], minTs: 0, maxTs: 0, minPrice: 0, maxPrice: 1 };
  }
  const prices = allPoints.map((point) => Number(point.price)).filter((value) => !Number.isNaN(value));
  const timestamps = allPoints.map((point) => Number(point.ts)).filter((value) => !Number.isNaN(value));
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  let minPrice = Math.min(...prices);
  let maxPrice = Math.max(...prices);
  if (minPrice === maxPrice) {
    minPrice = Math.max(0, minPrice - 0.05);
    maxPrice = Math.min(1, maxPrice + 0.05);
  }
  const padX = 30;
  const padY = 20;
  const innerWidth = width - padX * 2;
  const innerHeight = height - padY * 2;
  const mapX = (ts) => padX + ((ts - minTs) / Math.max(1, maxTs - minTs)) * innerWidth;
  const mapY = (price) => padY + (1 - ((price - minPrice) / Math.max(0.0001, maxPrice - minPrice))) * innerHeight;
  const paths = series.map((item, index) => {
    const points = (Array.isArray(item?.points) ? item.points : [])
      .map((point) => ({ x: mapX(Number(point.ts)), y: mapY(Number(point.price)), raw: point }))
      .filter((point) => !Number.isNaN(point.x) && !Number.isNaN(point.y));
    const d = points.map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
    const lastPoint = points[points.length - 1] || null;
    return {
      key: `${item.outcomeIndex}-${index}`,
      d,
      color: GRAPH_COLORS[index % GRAPH_COLORS.length],
      outcomeIndex: item.outcomeIndex,
      outcomeName: formatOutcomeLabel(item.outcomeName || `选项${index + 1}`),
      lastPoint,
    };
  });
  const labels = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    y: padY + innerHeight * ratio,
    value: (maxPrice - (maxPrice - minPrice) * ratio) * 100,
  }));
  return { paths, labels, minTs, maxTs, minPrice, maxPrice };
}

function mergeGraphPatch(graphData, patch) {
  if (!graphData || !patch || !patch.pmMarketId || graphData.pmMarketId !== patch.pmMarketId) {
    return graphData;
  }
  const bucketMs = Number(graphData.bucketMs || 60000);
  const bucketAt = bucketMs > 0 ? Math.floor(Number(patch.updateAt || Date.now()) / bucketMs) * bucketMs : Number(patch.updateAt || Date.now());
  const series = Array.isArray(graphData.series) ? graphData.series.map((item) => ({ ...item, points: Array.isArray(item.points) ? item.points.slice() : [] })) : [];
  let matched = false;
  series.forEach((item) => {
    if (Number(item.outcomeIndex) !== Number(patch.outcomeIndex)) {
      return;
    }
    matched = true;
    const pointIndex = item.points.findIndex((point) => Number(point.ts) === bucketAt);
    const nextPoint = {
      ts: bucketAt,
      price: patch.price ?? patch.bestAsk ?? patch.bestBid ?? null,
      bestBid: patch.bestBid ?? null,
      bestAsk: patch.bestAsk ?? null,
      updateAt: patch.updateAt ?? Date.now(),
    };
    if (pointIndex >= 0) {
      item.points[pointIndex] = nextPoint;
    } else {
      item.points.push(nextPoint);
      item.points.sort((left, right) => Number(left.ts) - Number(right.ts));
    }
    if (!item.outcomeName && patch.outcomeName) {
      item.outcomeName = patch.outcomeName;
    }
  });
  if (!matched) {
    series.push({
      outcomeIndex: Number(patch.outcomeIndex),
      outcomeName: patch.outcomeName || `选项${patch.outcomeIndex}`,
      points: [{
        ts: bucketAt,
        price: patch.price ?? patch.bestAsk ?? patch.bestBid ?? null,
        bestBid: patch.bestBid ?? null,
        bestAsk: patch.bestAsk ?? null,
        updateAt: patch.updateAt ?? Date.now(),
      }],
    });
  }
  return {
    ...graphData,
    latestUpdateAt: Math.max(Number(graphData.latestUpdateAt || 0), Number(patch.updateAt || Date.now())),
    series,
  };
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
  const lastPriceUpdateRef = useRef(0);
  const staleRefreshInFlightRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState("markets");
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [error, setError] = useState("");
  const [socketConnected, setSocketConnected] = useState(false);
  const [lastPriceRefreshAt, setLastPriceRefreshAt] = useState(0);
  const [eventSyncing, setEventSyncing] = useState(false);
  const [graphRange, setGraphRange] = useState("1h");
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphData, setGraphData] = useState(null);
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
      const priceRows = plays.flatMap((item) => (Array.isArray(item?.latestPrices) ? item.latestPrices : []));
      const latestPriceAt = getLatestPriceUpdateAt(priceRows);
      lastPriceUpdateRef.current = latestPriceAt;
      setLastPriceRefreshAt(latestPriceAt);
      setSelectedCategory(resolvedCategory);
      setSelectedEventId(resolvedEventId);
      setSelectedMarketId(markets.find((item) => item && item.pmMarketId)?.pmMarketId || "");
      setData((prev) => ({
        ...prev,
        categories: categoryRows,
        events: eventRows,
        markets: markets.map((item) => ({ ...item, latestPrices: buildLatestPrices(priceRows, item.pmMarketId) })),
        plays: plays.map((item) => ({ ...item, latestPrices: buildLatestPrices(priceRows, item.pmMarketId) })),
        prices: priceRows,
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
      const priceRows = plays.flatMap((item) => (Array.isArray(item?.latestPrices) ? item.latestPrices : []));
      const latestPriceAt = getLatestPriceUpdateAt(priceRows);
      lastPriceUpdateRef.current = latestPriceAt;
      setLastPriceRefreshAt(latestPriceAt);
      setSelectedEventId(nextEventId);
      setSelectedMarketId(markets.find((item) => item && item.pmMarketId)?.pmMarketId || "");
      setData((prev) => ({
        ...prev,
        markets: markets.map((item) => ({ ...item, latestPrices: buildLatestPrices(priceRows, item.pmMarketId) })),
        plays: plays.map((item) => ({ ...item, latestPrices: buildLatestPrices(priceRows, item.pmMarketId) })),
        prices: priceRows,
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
      const patchTime = getPriceRowTime(patch);
      if (patchTime > 0) {
        lastPriceUpdateRef.current = patchTime;
        setLastPriceRefreshAt(patchTime);
      }
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
      setGraphData((prev) => mergeGraphPatch(prev, patch));
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
        const priceRows = plays.flatMap((item) => (Array.isArray(item?.latestPrices) ? item.latestPrices : []));
        const latestPriceAt = getLatestPriceUpdateAt(priceRows);
        lastPriceUpdateRef.current = latestPriceAt;
        setLastPriceRefreshAt(latestPriceAt);
        setSelectedCategory(initialCategory);
        setSelectedEventId(initialEventId);
        setSelectedMarketId(markets.find((item) => item && item.pmMarketId)?.pmMarketId || "");
        setData({
          categories: categoryRows,
          events: eventRows,
          markets: markets.map((item) => ({ ...item, latestPrices: buildLatestPrices(priceRows, item.pmMarketId) })),
          plays: plays.map((item) => ({ ...item, latestPrices: buildLatestPrices(priceRows, item.pmMarketId) })),
          prices: priceRows,
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

  useEffect(() => {
    if (!selectedEventId || !socketConnected || loading) {
      return undefined;
    }
    const timer = window.setInterval(async () => {
      const marketIds = (Array.isArray(data.markets) ? data.markets : []).map((item) => item?.pmMarketId).filter(Boolean);
      if (marketIds.length === 0 || staleRefreshInFlightRef.current) {
        return;
      }
      const latestKnownAt = Math.max(lastPriceUpdateRef.current || 0, getLatestPriceUpdateAt(data.prices));
      if (latestKnownAt > 0 && Date.now() - latestKnownAt < PRICE_STALE_MS) {
        return;
      }
      staleRefreshInFlightRef.current = true;
      try {
        await Promise.all(marketIds.map((marketId) => syncPolymarketPrice(baseUrl, marketId)));
        await loadSelectedEvent(selectedEventId, selectedCategory);
      } catch (err) {
        console.warn("兜底刷新价格失败:", err);
      } finally {
        staleRefreshInFlightRef.current = false;
      }
    }, PRICE_FALLBACK_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [baseUrl, data.markets, data.prices, loadSelectedEvent, loading, selectedCategory, selectedEventId, socketConnected]);

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
  const selectedMarket = useMemo(() => (
    (Array.isArray(data.markets) ? data.markets : []).find((item) => item && item.pmMarketId === selectedMarketId) || null
  ), [data.markets, selectedMarketId]);
  const graphSvg = useMemo(() => buildGraphSeriesSvg(Array.isArray(graphData?.series) ? graphData.series : []), [graphData]);

  const summary = useMemo(() => ([
    { label: "分类", value: categories.length },
    { label: "事件", value: data.events.length },
    { label: "市场", value: data.markets.length },
    { label: "玩法", value: visiblePlays.length },
  ]), [categories.length, data.events.length, data.markets.length, visiblePlays.length]);

  const currentList = useMemo(() => {
    if (activeTab === "markets") return data.markets;
    if (activeTab === "graph") return [];
    if (activeTab === "results") return resolvedPlays;
    if (activeTab === "orders") return orders;
    return visiblePlays;
  }, [activeTab, data.markets, resolvedPlays, visiblePlays, orders]);

  useEffect(() => {
    if (!loading && !error && !["markets", "plays", "graph", "results", "orders"].includes(activeTab)) {
      setActiveTab("markets");
    }
  }, [activeTab, error, loading]);

  const loadGraph = useCallback(async (marketId, range = graphRange) => {
    if (!marketId) {
      setGraphData(null);
      return;
    }
    setGraphLoading(true);
    try {
      const graphRes = await fetchPolymarketGraph(baseUrl, marketId, range);
      setGraphData(graphRes.data || null);
    } catch (err) {
      setError(err?.message || "图表加载失败");
    } finally {
      setGraphLoading(false);
    }
  }, [baseUrl, graphRange]);

  useEffect(() => {
    if (activeTab !== "graph" || !selectedMarketId) {
      return;
    }
    loadGraph(selectedMarketId, graphRange);
  }, [activeTab, graphRange, loadGraph, selectedMarketId]);

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

  const syncCurrentEventMarkets = useCallback(async () => {
    if (!selectedEventId || eventSyncing) {
      return;
    }
    setEventSyncing(true);
    setError("");
    try {
      await syncPolymarketMarkets(baseUrl, selectedEventId);
      await loadSelectedEvent(selectedEventId, selectedCategory);
    } catch (err) {
      setError(err?.message || "当前事件市场同步失败");
    } finally {
      setEventSyncing(false);
    }
  }, [baseUrl, eventSyncing, loadSelectedEvent, selectedCategory, selectedEventId]);

  useEffect(() => {
    if (loading || eventSyncing || !selectedEventId) {
      return;
    }
    if (data.markets.length === 0) {
      syncCurrentEventMarkets();
    }
  }, [data.markets.length, eventSyncing, loading, selectedEventId, syncCurrentEventMarkets]);

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
          plays: plays.map((item) => ({
            ...item,
            latestPrices: buildLatestPrices(prev.prices, item.pmMarketId),
          })),
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
      alert(`下单金额超过可用余额，可用余额：${availableBalance.toFixed(2)} USDT`);
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
      alert("下单成功");
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
          <h2 className="polymarket-hero-title">预测市场独立视图</h2>
          <div className="polymarket-hero-desc">
            先选分类，再选事件，再看市场和玩法。首屏只加载当前路径需要的数据。
          </div>
          <div className="polymarket-hero-desc" style={{ marginTop: 10, opacity: 0.9 }}>
            实时通道：{socketConnected ? "原生 WS 已连接" : "原生 WS 未连接"}，价格变化会自动刷新。
          </div>
          <div className="polymarket-hero-desc" style={{ marginTop: 10, opacity: 0.9 }}>
            最新价格时间：北京时间 {formatBeijingTime(lastPriceRefreshAt)}
          </div>
          {balance && (
            <div className="polymarket-hero-desc" style={{ marginTop: 10, padding: "8px 12px", background: "#f1f5f9", borderRadius: 6, fontSize: 14 }}>
              <span style={{ fontWeight: 600 }}>可用余额：{availableBalance.toFixed(2)} USDT</span>
              <span style={{ marginLeft: 16, opacity: 0.7 }}>总余额：{parseFloat(balance.amount || 0).toFixed(2)}</span>
              <span style={{ marginLeft: 16, opacity: 0.7 }}>冻结：{parseFloat(balance.froze || 0).toFixed(2)}</span>
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

      <section className="polymarket-tabs" role="tablist" aria-label="Polymarket 分类">
        {categories.map((item) => {
          const category = item?.category || "";
          return (
            <button
              key={category}
              type="button"
              className={selectedCategory === category ? "polymarket-tab active" : "polymarket-tab"}
              onClick={() => handleCategoryClick(category)}
            >
              {translateCategoryLabel(category)}
            </button>
          );
        })}
      </section>

      <section className="polymarket-event-rail" aria-label="Polymarket 事件列表">
        {(Array.isArray(data.events) ? data.events : []).map((item) => {
          const eventId = item?.pmEventId || "";
          return (
            <button
              key={eventId}
              type="button"
              className={selectedEventId === eventId ? "polymarket-event-chip active" : "polymarket-event-chip"}
              onClick={() => handleEventClick(eventId)}
            >
              <span className="polymarket-event-chip-title">{translateDynamicText(item?.title || item?.slug || eventId)}</span>
              <span className="polymarket-event-chip-meta">{translateCategoryLabel(item?.category || selectedCategory || "-")} · {formatStatusLabel(item?.status || "ACTIVE")}</span>
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
          当前路径：{translateCategoryLabel(selectedCategory || "-")} / {translateDynamicText(selectedEvent?.title || selectedEvent?.slug || selectedEventId || "未选择事件")} / {selectedMarketId || "未选择市场"}
        </div>
      ) : null}

      <section className="polymarket-tabs" role="tablist" aria-label="Polymarket 标签页">
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
        <div className="pm-empty">当前没有已开启的分类，请先在管理后台开启分类。</div>
      ) : null}
      {!error && !loading && selectedCategory && selectedEventId && data.markets.length === 0 ? (
        <div className="pm-empty">{eventSyncing ? "当前事件市场同步中..." : "当前事件下还没有市场，正在尝试补同步当前事件市场。"}</div>
      ) : null}
      {!error && !loading && selectedCategory && selectedEventId && activeTab === "plays" && visiblePlays.length === 0 ? (
        <div className="pm-empty">当前事件下还没有玩法，或者玩法还在同步中。</div>
      ) : null}
      {loading ? <div className="pm-empty">正在加载 Polymarket 数据...</div> : null}

      {!loading && !error && activeTab === "graph" ? (
        selectedMarketId ? (
          <section className="pm-graph-card">
            <div className="pm-graph-head">
              <div>
                <h3 className="polymarket-card-title">{translateDynamicText(selectedMarket?.question || selectedMarket?.description || selectedMarket?.pmMarketId || selectedMarketId)}</h3>
                <div className="polymarket-card-subtitle">
                  市场：{selectedMarketId} · 区间：{formatGraphRangeLabel(graphRange)} · 最近更新：北京时间 {formatBeijingTime(graphData?.latestUpdateAt)}
                </div>
              </div>
              <div className="pm-graph-range-group">
                {GRAPH_RANGES.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={graphRange === item.key ? "pm-graph-range active" : "pm-graph-range"}
                    onClick={() => setGraphRange(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            {graphLoading ? (
              <div className="pm-empty">图表加载中...</div>
            ) : Array.isArray(graphData?.series) && graphData.series.length > 0 ? (
              <div className="pm-graph-wrap">
                <svg viewBox="0 0 960 320" className="pm-graph-svg" preserveAspectRatio="none">
                  {graphSvg.labels.map((item, index) => (
                    <g key={`grid-${index}`}>
                      <line x1="30" y1={item.y} x2="930" y2={item.y} className="pm-graph-grid" />
                      <text x="938" y={item.y + 4} className="pm-graph-axis-label">{item.value.toFixed(0)}%</text>
                    </g>
                  ))}
                  {graphSvg.paths.map((path) => (
                    <g key={path.key}>
                      <path d={path.d} fill="none" stroke={path.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      {path.lastPoint ? (
                        <circle cx={path.lastPoint.x} cy={path.lastPoint.y} r="5" fill={path.color} />
                      ) : null}
                    </g>
                  ))}
                </svg>
                <div className="pm-graph-legend">
                  {graphSvg.paths.map((path) => (
                    <div className="pm-graph-legend-item" key={`legend-${path.key}`}>
                      <span className="pm-graph-legend-dot" style={{ background: path.color }} />
                      <span>{path.outcomeName}</span>
                      <strong>{path.lastPoint?.raw?.price != null ? formatProbability(path.lastPoint.raw.price) : "-"}</strong>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="pm-empty">当前市场还没有足够的历史价格数据，图表会在后续价格变动后逐步形成。</div>
            )}
          </section>
        ) : (
          <div className="pm-empty">请先选择一个市场，再查看图表。</div>
        )
      ) : null}

      {!loading && !error && (selectedCategory || activeTab === "orders") ? (
        activeTab !== "graph" && currentList.length ? (
          <section className="polymarket-grid">
            {currentList.map((item, index) => {
              if (activeTab === "plays") {
                const outcomeNames = parseMaybeJson(item.outcomesJson);
                const displayName = item.__kind === "market" ? "市场玩法" : translateDynamicText(item.title || item.question || item.pmPlayId || "预测玩法");
                const outcomeList = Array.isArray(outcomeNames) && outcomeNames.length > 0
                  ? outcomeNames
                  : Array.isArray(parseMaybeJson(item.outcomePricesJson)) && parseMaybeJson(item.outcomePricesJson).length > 0
                    ? parseMaybeJson(item.outcomePricesJson)
                    : [];
                const latestUpdateAt = getLatestPriceUpdateAt(item.latestPrices);
                const closedMarket = isClosedStatus(item.status);
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
                          分类：{translateCategoryLabel(item.category || selectedCategory || "-")} · 事件：{item.pmEventId || "-"}
                        </div>
                        <div className="polymarket-card-subtitle">
                          Token ID：{parseTokenIds(item).length > 0 ? parseTokenIds(item).join(", ") : "-"}
                        </div>
                        <div className="polymarket-card-subtitle">
                          Asset ID：{parseAssetIds(item).length > 0 ? parseAssetIds(item).join(", ") : "-"} · 结果：{formatOutcomeLabel(item.resolvedOutcome) || "-"}
                        </div>
                        <div className="polymarket-card-subtitle">
                          最近更新：北京时间 {formatBeijingTime(latestUpdateAt)}
                        </div>
                      </div>
                      <div className={item.status === "RESOLVED" ? "polymarket-pill green" : "polymarket-pill"}>
                        {formatStatusLabel(item.status || "ACTIVE")}
                      </div>
                    </div>
                    <div className="card-hint">
                      {closedMarket ? "已关闭，无实时价格。" : item.__kind === "market"
                        ? "玩法表还没同步完成，当前先用市场数据生成玩法视图。"
                        : "当前展示的是真实玩法数据，已从玩法表读取。"}
                    </div>
                    <div className="pm-options">
                      {outcomeList.map((name, idx) => {
                        const price = extractOutcomePrice(item, idx);
                        const rawOptionName = typeof name === "object" ? (name?.name || name?.label || name?.outcome || `选项${idx + 1}`) : String(name);
                        const optionName = formatOutcomeLabel(rawOptionName);
                        return (
                          <div className="pm-option" key={`${optionName}-${idx}`}>
                            <div className="pm-option-name">{optionName}</div>
                            <div className="pm-option-price">
                              <div>{closedMarket ? "已关闭" : formatPrice(price)}</div>
                              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                                {closedMarket ? "无实时价格" : `概率 ${formatProbability(price)}`}
                              </div>
                            </div>
                            <div style={{ marginTop: 10, height: 8, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
                              <div
                                style={{
                                  width: closedMarket ? "5%" : `${clampPercent(price) || 5}%`,
                                  height: "100%",
                                  borderRadius: 999,
                                  background: "linear-gradient(90deg, #2563eb 0%, #60a5fa 100%)",
                                }}
                              />
                            </div>
                            <div style={{ marginTop: 12 }}>
                              <button
                                type="button"
                                onClick={(e) => handleOrderClick(e, item, idx, rawOptionName, "BUY")}
                                disabled={closedMarket}
                                style={{
                                  width: "100%",
                                  padding: "10px 12px",
                                  borderRadius: 6,
                                  border: "none",
                                  background: closedMarket ? "#94a3b8" : (isYesLikeOutcome(rawOptionName) ? "#22c55e" : "#3b82f6"),
                                  color: "#fff",
                                  fontWeight: 600,
                                  fontSize: 14,
                                  cursor: closedMarket ? "not-allowed" : "pointer",
                                }}
                              >
                                {closedMarket ? "已关闭" : `买入 ${optionName}`}
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
                const latestUpdateAt = getLatestPriceUpdateAt(prices);
                const closedMarket = isClosedStatus(item.status);
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
                        <h3 className="polymarket-card-title">{translateDynamicText(item.question || item.description || item.pmMarketId || "预测市场")}</h3>
                        <div className="polymarket-card-subtitle">
                          分类：{translateCategoryLabel(item.category || selectedCategory || "-")} · 事件：{item.pmEventId || "-"}
                        </div>
                        <div className="polymarket-card-subtitle">
                          Token ID：{parseTokenIds(item).length > 0 ? parseTokenIds(item).join(", ") : "-"}
                        </div>
                        <div className="polymarket-card-subtitle">
                          Asset ID：{parseAssetIds(item).length > 0 ? parseAssetIds(item).join(", ") : "-"} · 条件：{item.conditionId || "-"}
                        </div>
                        <div className="polymarket-card-subtitle">
                          最近更新：北京时间 {formatBeijingTime(latestUpdateAt)}
                        </div>
                      </div>
                      <div className={item.status === "RESOLVED" ? "polymarket-pill green" : "polymarket-pill"}>
                        {formatStatusLabel(item.status || "ACTIVE")}
                      </div>
                    </div>
                    <div className="card-hint">{closedMarket ? "已关闭，无实时价格。" : "选中一个市场后，玩法列表会自动聚焦到这个市场。"}</div>
                    <div className="pm-options">
                      {(Array.isArray(parseMaybeJson(item.outcomesJson)) ? parseMaybeJson(item.outcomesJson) : []).map((name, idx) => {
                        const priceRow = prices.find((row) => row.pmMarketId === item.pmMarketId && Number(row.outcomeIndex) === Number(idx));
                        const price = priceRow?.price ?? priceRow?.bestAsk ?? priceRow?.bestBid;
                        return (
                          <div className="pm-option" key={`${item.pmMarketId}-${name}-${idx}`}>
                            <div className="pm-option-name">{formatOutcomeLabel(String(name))}</div>
                            <div className="pm-option-price">
                              <div>{closedMarket ? "已关闭" : formatPrice(price)}</div>
                              <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                                {closedMarket ? "无实时价格" : `概率 ${formatProbability(price)}`}
                              </div>
                            </div>
                            <div style={{ marginTop: 10, height: 8, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
                              <div
                                style={{
                                  width: closedMarket ? "5%" : `${clampPercent(price) || 5}%`,
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
                          市场：{item.pmMarketId || "-"} · 事件：{item.pmEventId || "-"}
                        </div>
                        <div className="polymarket-card-subtitle">
                          下单时间:{formatBeijingTime(item.createdAt)}
                        </div>
                      </div>
                      <div className={`polymarket-pill ${item.settleStatus === "WIN" ? "green" : item.settleStatus === "LOSE" ? "red" : ""}`}>
                        {formatStatusLabel(item.settleStatus || "OPEN")}
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
                      <h3 className="polymarket-card-title">{item.pmMarketId || item.marketId || "预测结果"}</h3>
                      <div className="polymarket-card-subtitle">
                        分类：{translateCategoryLabel(item.category || selectedCategory || "-")} · 事件：{item.pmEventId || "-"}
                      </div>
                      <div className="polymarket-card-subtitle">
                        Token ID：{parseTokenIds(item).length > 0 ? parseTokenIds(item).join(", ") : "-"}
                      </div>
                      <div className="polymarket-card-subtitle">
                        Asset ID：{parseAssetIds(item).length > 0 ? parseAssetIds(item).join(", ") : "-"} · 结算时间：北京时间 {formatBeijingTime(item.resolvedAt)} · 来源：{item.resolutionSource || "-"}
                      </div>
                    </div>
                    <div className="polymarket-pill green">{formatOutcomeLabel(item.resolvedOutcome) || "已结算"}</div>
                  </div>
                  <div className="pm-options">
                    <div className="pm-option">
                      <div className="pm-option-name">结算值</div>
                      <div className="pm-option-price">{item.resolvedValue || "-"}</div>
                    </div>
                    <div className="pm-option">
                      <div className="pm-option-name">市场编号</div>
                      <div className="pm-option-price">{item.pmMarketId || "-"}</div>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        ) : activeTab !== "graph" ? (
          <div className="pm-empty">
            {activeTab === "orders" 
              ? (ordersLoading ? "加载订单中..." : "暂无订单记录") 
              : "当前没有数据，可以先点“同步事件”或“同步市场”。"}
          </div>
        ) : null
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
              买入 {formatOutcomeLabel(orderModal.outcomeName)}
            </h3>
            <div style={{ marginBottom: 12, fontSize: 14, color: "#64748b" }}>
              市场：{orderModal.play?.question || orderModal.play?.pmMarketId}
            </div>
            <div style={{ marginBottom: 12, padding: "10px 12px", background: "#f1f5f9", borderRadius: 8, fontSize: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>可用余额：</span>
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
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: orderSubmitting || !orderAmount || parseFloat(orderAmount) > availableBalance ? "not-allowed" : "pointer",
                  opacity: orderSubmitting || !orderAmount || parseFloat(orderAmount) > availableBalance ? 0.6 : 1,
                  background: isYesLikeOutcome(orderModal.outcomeName) ? "#22c55e" : "#3b82f6",
                }}
              >
                {orderSubmitting ? "提交中..." : "确认下单"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PolymarketApp;
