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

const PAGE_SIZE = 80;
const PLAYS_PAGE_SIZE = 100;
const PRICE_STALE_MS = 60 * 1000;
const PRICE_FALLBACK_CHECK_MS = 15 * 1000;
const TABS = [
  { key: "markets", label: "市场" },
  { key: "orders", label: "当前委托" },
  { key: "results", label: "历史记录" },
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
  global: "全球",
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
  trump: "川普",
  commodities: "大宗商品",
  esports: "电竞",
  iran: "伊朗",
  finance: "财经",
  technology: "科技",
  culture: "文化",
  climate: "气候",
};

const CATEGORY_GROUPS = [
  { key: "global", label: "全球", sources: ["global"] },
  { key: "sports", label: "体育", sources: ["sports"] },
  { key: "trump", label: "川普", sources: ["trump"] },
  { key: "crypto", label: "加密", sources: ["crypto"] },
  { key: "commodities", label: "大宗商品", sources: ["commodities"] },
  { key: "esports", label: "电竞", sources: ["esports"] },
  { key: "iran", label: "伊朗", sources: ["iran"] },
  { key: "finance", label: "财经", sources: ["finance"] },
  { key: "technology", label: "科技", sources: ["technology"] },
  { key: "culture", label: "文化", sources: ["culture"] },
  { key: "economy", label: "经济", sources: ["economy"] },
  { key: "climate", label: "气候", sources: ["climate"] },
  { key: "world cup", label: "世界杯", sources: ["world cup"] },
];

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

function resolveSettlementDate(order) {
  if (!order || typeof order !== "object") return null;
  if (order.settledAt) return order.settledAt;
  if (order.marketResolvedAt) return order.marketResolvedAt;
  if (order.eventEndTime) return order.eventEndTime;
  return null;
}

function formatSettlementDateLabel(order) {
  const value = resolveSettlementDate(order);
  if (!value) return "-";
  return formatBeijingTime(value);
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

function getCategoryGroup(tabKey) {
  return CATEGORY_GROUPS.find((item) => item.key === tabKey) || null;
}

function buildVisibleCategoryTabs() {
  return CATEGORY_GROUPS.map((item) => ({
    category: item.key,
    label: item.label,
    sources: item.sources,
  }));
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

function formatCompactCurrency(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "";
  if (num >= 1000000) return `$${(num / 1000000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (num >= 1000) return `$${(num / 1000).toFixed(2).replace(/\.?0+$/, "")}K`;
  return `$${num.toFixed(2).replace(/\.?0+$/, "")}`;
}

function formatShortDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
  });
}

function getEventTitle(item) {
  return translateDynamicText(item?.title || item?.slug || item?.question || item?.description || item?.pmEventId || "预测市场");
}

function getCardTitle(item) {
  return translateDynamicText(item?.question || item?.description || item?.title || item?.slug || item?.selectionName || item?.selectionCode || item?.pmMarketId || "预测市场");
}

function getVolumeValue(item) {
  const candidates = [
    item?.volume,
    item?.volumeUsd,
    item?.turnover,
    item?.liquidity,
    item?.liquidityNum,
    item?.totalVolume,
    item?.totalAmount,
  ];
  for (const candidate of candidates) {
    const num = Number(candidate);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return 0;
}

function getCardMeta(item) {
  const endValue = item?.endDate || item?.endTime || item?.closeTime || item?.closedAt || item?.resolvedAt;
  const dateLabel = formatShortDate(endValue);
  const volumeLabel = formatCompactCurrency(getVolumeValue(item));
  return {
    dateLabel,
    volumeLabel: volumeLabel ? `${volumeLabel} Vol.` : "",
  };
}

function getOutcomeRows(item) {
  const outcomes = parseMaybeJson(item?.outcomesJson);
  if (Array.isArray(outcomes) && outcomes.length > 0) {
    return outcomes.slice(0, 4).map((row, idx) => {
      const rawLabel = typeof row === "object" ? (row?.name || row?.label || row?.outcome || `选项${idx + 1}`) : String(row);
      return {
        key: `${item?.pmMarketId || item?.id || "market"}-${idx}`,
        label: formatOutcomeLabel(rawLabel),
        rawLabel,
        outcomeIndex: idx,
        price: extractOutcomePrice(item, idx),
      };
    });
  }
  if (item?.selectionName || item?.selectionCode) {
    return [{
      key: `${item?.orderNo || item?.id || "order"}-0`,
      label: formatOutcomeLabel(item.selectionName || item.selectionCode),
      rawLabel: item.selectionName || item.selectionCode,
      outcomeIndex: 0,
      price: item?.orderPrice ?? null,
    }];
  }
  return [];
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

async function fetchEventsForCategoryTab(baseUrl, tabKey, limit = PAGE_SIZE) {
  const group = getCategoryGroup(tabKey);
  const sources = Array.isArray(group?.sources) ? group.sources : [];
  if (sources.length === 0) {
    return [];
  }
  const results = await Promise.all(
    sources.map((category) => fetchPolymarketEvents(baseUrl, category, limit, 0).catch(() => ({ data: [] })))
  );
  const mergedMap = new Map();
  results.forEach((response) => {
    const rows = Array.isArray(response?.data) ? response.data : [];
    rows.forEach((row) => {
      if (!row?.pmEventId) return;
      if (!mergedMap.has(row.pmEventId)) {
        mergedMap.set(row.pmEventId, row);
      }
    });
  });
  return Array.from(mergedMap.values()).sort((left, right) => Number(right?.priceCount || 0) - Number(left?.priceCount || 0));
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
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState("");
  const [socketConnected, setSocketConnected] = useState(false);
  const [lastPriceRefreshAt, setLastPriceRefreshAt] = useState(0);
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
    await fetchPolymarketCategories(baseUrl);
    return buildVisibleCategoryTabs();
  }, [baseUrl]);

  const loadCategoryPath = useCallback(async ({ category = "", eventId = "" } = {}) => {
    setLoading(true);
    setError("");
    try {
      const categoryRows = categories.length > 0 ? categories : await loadCategories();
      const resolvedCategory = category || pickInitialCategory(categoryRows, "");
      const eventsRes = resolvedCategory
        ? { data: await fetchEventsForCategoryTab(baseUrl, resolvedCategory, PAGE_SIZE) }
        : { data: [] };
      const eventRows = Array.isArray(eventsRes.data) ? eventsRes.data : [];
      const resolvedEventId = eventId || pickInitialEventId(eventRows, "");
      let markets = [];
      let plays = [];
      if (resolvedEventId) {
        const [marketsRes, playsRes] = await Promise.all([
          fetchPolymarketMarkets(baseUrl, resolvedEventId, "", PAGE_SIZE, 0),
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
        fetchPolymarketMarkets(baseUrl, nextEventId, "", PAGE_SIZE, 0),
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
        const eventsRes = { data: await fetchEventsForCategoryTab(baseUrl, initialCategory, PAGE_SIZE) };
        if (cancelled) return;
        const eventRows = Array.isArray(eventsRes.data) ? eventsRes.data : [];
        const initialEventId = pickInitialEventId(eventRows, "");
        setSelectedCategory(initialCategory);
        setSelectedEventId(initialEventId);
        setData({
          categories: categoryRows,
          events: eventRows,
          markets: [],
          plays: [],
          prices: [],
          results: [],
        });
        setSelectedMarketId("");
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

  useEffect(() => {
    if (loading || !selectedEventId) {
      return;
    }
    loadSelectedEvent(selectedEventId, selectedCategory);
  }, [loadSelectedEvent, loading, selectedCategory, selectedEventId]);

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

  const eventList = useMemo(() => {
    const list = Array.isArray(data.events) ? data.events : [];
    const keyword = String(searchQuery || "").trim().toLowerCase();
    if (!keyword) return list;
    return list.filter((item) => getEventTitle(item).toLowerCase().includes(keyword));
  }, [data.events, searchQuery]);

  const currentList = useMemo(() => {
    if (activeTab === "markets") return deriveDisplayCards(visiblePlays, data.markets);
    if (activeTab === "graph") return [];
    if (activeTab === "results") return resolvedPlays;
    if (activeTab === "orders") return orders;
    return visiblePlays;
  }, [activeTab, data.markets, resolvedPlays, visiblePlays, orders]);

  const filteredCurrentList = useMemo(() => {
    const keyword = String(searchQuery || "").trim().toLowerCase();
    if (!keyword) return currentList;
    return currentList.filter((item) => {
      const title = getCardTitle(item).toLowerCase();
      const rows = getOutcomeRows(item).some((row) => String(row.label || "").toLowerCase().includes(keyword));
      return title.includes(keyword) || rows;
    });
  }, [currentList, searchQuery]);

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

  const handleMarketClick = useCallback(async (marketId) => {
    if (!marketId || marketId === selectedMarketId) {
      return;
    }
    setSelectedMarketId(marketId);
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
    <div className="polymarket-shell pm-board-shell">
      <section className="pm-board-head">
        <div>
          <h2 className="pm-board-title">所有盘口</h2>
          <div className="pm-board-subtitle">
            {selectedCategory ? `${translateCategoryLabel(selectedCategory)} · ${translateDynamicText(selectedEvent?.title || selectedEvent?.slug || "全部事件")}` : "选择分类和事件后查看盘口"}
          </div>
        </div>
        <div className="pm-board-tools">
          <div className="pm-board-balance">可用余额 {availableBalance.toFixed(2)} USDT</div>
          <button type="button" className="pm-board-icon" onClick={() => loadCategoryPath({ category: selectedCategory, eventId: selectedEventId })} disabled={loading || refreshing}>
            {loading || refreshing ? "刷新中" : "刷新"}
          </button>
        </div>
      </section>

      <section className="pm-board-categories" role="tablist" aria-label="分类">
        {categories.map((item) => {
          const category = item?.category || "";
          return (
            <button
              key={category}
              type="button"
              className={selectedCategory === category ? "pm-board-category active" : "pm-board-category"}
              onClick={() => handleCategoryClick(category)}
            >
              {item?.label || translateCategoryLabel(category)}
            </button>
          );
        })}
      </section>

      <section className="pm-board-search">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pm-board-search-input"
          placeholder="搜索事件、问题或选项"
        />
        <div className="pm-board-search-meta">
          最新价格：北京时间 {formatBeijingTime(lastPriceRefreshAt)} · {socketConnected ? "WS 已连接" : "WS 未连接"}
        </div>
      </section>

      <section className="pm-board-events" aria-label="事件列表">
        {eventList.map((item) => {
          const eventId = item?.pmEventId || "";
          return (
            <button
              key={eventId}
              type="button"
              className={selectedEventId === eventId ? "pm-board-event active" : "pm-board-event"}
              onClick={() => handleEventClick(eventId)}
            >
              {getEventTitle(item)}
            </button>
          );
        })}
      </section>

      <section className="pm-board-tabs" role="tablist" aria-label="标签页">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={activeTab === tab.key ? "pm-board-tab active" : "pm-board-tab"}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </section>

      {error ? <div className="pm-empty" style={{ color: "#dc2626" }}>{error}</div> : null}
      {!error && !loading && !selectedCategory ? <div className="pm-empty">当前没有已开启的分类。</div> : null}
      {!error && !loading && selectedCategory && selectedEventId && data.markets.length === 0 && activeTab === "markets" ? (
        <div className="pm-empty">当前事件下还没有可展示的市场数据。</div>
      ) : null}
      {loading ? <div className="pm-empty">正在加载数据...</div> : null}

      {!loading && !error && filteredCurrentList.length > 0 ? (
        <section className="pm-board-grid">
          {filteredCurrentList.map((item, index) => {
            if (activeTab === "orders") {
              return (
                <article className="pm-board-card" key={item.orderNo || item.id || index}>
                  <div className="pm-board-card-top">
                    <div className="pm-board-card-title-wrap">
                      <h3 className="pm-board-card-title">{translateDynamicText(item.selectionName || item.selectionCode || "当前委托")}</h3>
                      <div className="pm-board-card-meta">
                        {formatBeijingTime(item.createdAt)} · {formatStatusLabel(item.settleStatus || "OPEN")}
                      </div>
                    </div>
                    <div className={`pm-board-status ${String(item.settleStatus || "").toUpperCase() === "WIN" ? "win" : String(item.settleStatus || "").toUpperCase() === "LOSE" ? "lose" : ""}`}>
                      {formatStatusLabel(item.settleStatus || "OPEN")}
                    </div>
                  </div>
                    <div className="pm-board-order-grid">
                    <div className="pm-board-order-cell">
                      <span>下单金额</span>
                      <strong>{item.orderAmount || 0} {item.currency || "USDT"}</strong>
                    </div>
                    <div className="pm-board-order-cell">
                      <span>下单概率</span>
                      <strong>{item.orderPrice ? formatProbability(item.orderPrice) : "-"}</strong>
                    </div>
                      <div className="pm-board-order-cell">
                        <span>市场</span>
                        <strong>{item.pmMarketId || "-"}</strong>
                      </div>
                      <div className="pm-board-order-cell">
                        <span>{String(item.settleStatus || "").toUpperCase() === "SETTLED" || String(item.settleStatus || "").toUpperCase() === "WIN" || String(item.settleStatus || "").toUpperCase() === "LOSE" ? "结算时间" : "预计结算"}</span>
                        <strong>{formatSettlementDateLabel(item)}</strong>
                      </div>
                      <div className="pm-board-order-cell">
                        <span>结算盈亏</span>
                        <strong>{item.settlePnl != null ? `${item.settlePnl > 0 ? "+" : ""}${item.settlePnl}` : "-"}</strong>
                      </div>
                    </div>
                </article>
              );
            }

            if (activeTab === "results") {
              return (
                <article className="pm-board-card" key={item.pmMarketId || item.marketId || index}>
                  <div className="pm-board-card-top">
                    <div className="pm-board-card-title-wrap">
                      <h3 className="pm-board-card-title">{getCardTitle(item)}</h3>
                      <div className="pm-board-card-meta">
                        北京时间 {formatBeijingTime(item.resolvedAt)} · {translateCategoryLabel(item.category || selectedCategory || "-")}
                      </div>
                    </div>
                    <div className="pm-board-status win">{formatOutcomeLabel(item.resolvedOutcome) || "已结算"}</div>
                  </div>
                  <div className="pm-board-order-grid">
                    <div className="pm-board-order-cell">
                      <span>结算结果</span>
                      <strong>{formatOutcomeLabel(item.resolvedOutcome) || "-"}</strong>
                    </div>
                    <div className="pm-board-order-cell">
                      <span>结算值</span>
                      <strong>{item.resolvedValue || "-"}</strong>
                    </div>
                    <div className="pm-board-order-cell">
                      <span>市场ID</span>
                      <strong>{item.pmMarketId || "-"}</strong>
                    </div>
                    <div className="pm-board-order-cell">
                      <span>来源</span>
                      <strong>{item.resolutionSource || "-"}</strong>
                    </div>
                  </div>
                </article>
              );
            }

            const prices = Array.isArray(item.latestPrices) && item.latestPrices.length > 0
              ? item.latestPrices
              : buildLatestPrices(data.prices, item.pmMarketId);
            const latestUpdateAt = getLatestPriceUpdateAt(prices);
            const rows = getOutcomeRows({ ...item, latestPrices: prices });
            const cardMeta = getCardMeta(item);
            const closedMarket = isClosedStatus(item.status);
            return (
              <article
                className={selectedMarketId === item.pmMarketId ? "pm-board-card selected" : "pm-board-card"}
                key={item.pmMarketId || item.id || index}
                onClick={() => handleMarketClick(item.pmMarketId)}
                role="button"
                tabIndex={0}
              >
                <div className="pm-board-card-top">
                  <div className="pm-board-card-title-wrap">
                    <h3 className="pm-board-card-title">{getCardTitle(item)}</h3>
                    <div className="pm-board-card-meta">
                      {cardMeta.volumeLabel ? `交易额 ${cardMeta.volumeLabel}` : "交易额 -"} {cardMeta.dateLabel ? `· ${cardMeta.dateLabel}` : ""} {latestUpdateAt ? `· 更新于 ${formatBeijingTime(latestUpdateAt)}` : ""}
                    </div>
                  </div>
                  <div className={`pm-board-status ${closedMarket ? "closed" : ""}`}>
                    {formatStatusLabel(item.status || "ACTIVE")}
                  </div>
                </div>
                <div className="pm-board-rows">
                  {rows.slice(0, 4).map((row) => (
                    <div className="pm-board-row" key={row.key}>
                      <div className="pm-board-row-name">{translateDynamicText(row.label)}</div>
                      <div className="pm-board-row-prob">{closedMarket ? "-" : formatProbability(row.price)}</div>
                      <div className="pm-board-row-actions">
                        <button
                          type="button"
                          className="pm-board-action yes"
                          onClick={(e) => handleOrderClick(e, item, row.outcomeIndex, row.rawLabel, "BUY")}
                          disabled={closedMarket}
                        >
                          {formatOutcomeLabel(row.rawLabel)}
                        </button>
                        <button
                          type="button"
                          className="pm-board-action no"
                          onClick={(e) => {
                            e.stopPropagation();
                            const fallbackIndex = rows.findIndex((candidate) => String(candidate.rawLabel || "").toLowerCase() === "no");
                            if (fallbackIndex >= 0) {
                              handleOrderClick(e, item, rows[fallbackIndex].outcomeIndex, rows[fallbackIndex].rawLabel, "BUY");
                            }
                          }}
                          disabled={closedMarket || String(row.rawLabel || "").toLowerCase() === "no"}
                        >
                          否
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      {!loading && !error && filteredCurrentList.length === 0 ? (
        <div className="pm-empty">
          {activeTab === "orders" ? (ordersLoading ? "加载订单中..." : "暂无订单记录") : "当前没有可展示的数据。"}
        </div>
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
