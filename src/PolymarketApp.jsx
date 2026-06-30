import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchPolymarketMerchantCategories,
  fetchPolymarketMerchantPlays,
  fetchPolymarketMerchantPrices,
  fetchPolymarketGraph,
  createPolymarketOrder,
  createPolymarketMerchantOrder,
  fetchPolymarketMarketPosition,
  fetchPolymarketMerchantMarketPosition,
  fetchPolymarketMarketTranslation,
  closePolymarketPosition,
  closePolymarketMerchantPosition,
  fetchPolymarketPositions,
  fetchPolymarketLocalOrders,
  fetchPolymarketPlayOrders,
  updatePolymarketPlayPin,
} from "./polymarketApi";
import { usePolymarketSocket } from "./usePolymarketSocket";

const PAGE_SIZE = 20;
const ORDER_PAGE_SIZE = 20;
const RESULT_PAGE_SIZE = 20;
const TABS = [
  { key: "markets", label: "市场" },
  { key: "orders", label: "当前持仓" },
  { key: "openOrders", label: "当前委托" },
  { key: "results", label: "历史委托" },
];
const MARKET_VIEW_MODES = [
  { key: "direct", label: "直达市场" },
  { key: "events", label: "事件视图" },
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
const DETAIL_LANGUAGES = [
  { key: "zh-CN", label: "中文" },
  { key: "id-ID", label: "印尼语" },
  { key: "th-TH", label: "泰语" },
  { key: "vi-VN", label: "越南语" },
  { key: "en-US", label: "英文" },
];

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

function formatStatusLabel(status) {
  const normalized = String(status || "").trim().toUpperCase();
  if (!normalized) return "进行中";
  if (normalized === "ACTIVE") return "进行中";
  if (normalized === "CLOSED") return "已关闭";
  if (normalized === "RESOLVED") return "已结算";
  if (normalized === "SETTLED") return "已结算";
  if (normalized === "OPEN") return "待结算";
  if (normalized === "MANUAL_CLOSED") return "已卖出";
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

function formatLiveUpdateLabel(value, nowMs) {
  if (!value) return "暂无";
  const ts = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (Number.isNaN(ts) || ts <= 0) return "暂无";
  const diffSeconds = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSeconds < 1) return "刚刚更新";
  if (diffSeconds < 60) return `${diffSeconds} 秒前更新`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} 分钟前更新`;
  return `更新于 ${formatBeijingTime(ts)}`;
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
  return translateDynamicText(
    item?.marketTitleCn
      || item?.marketQuestion
      || item?.title
      || item?.question
      || item?.content
      || item?.subTitle
      || item?.description
      || item?.slug
      || item?.selectionName
      || item?.selectionCode
      || item?.pmMarketId
      || "预测市场"
  );
}

function getCardSubtitle(item) {
  if (!item || typeof item !== "object") return "";
  const segments = [
    item?.selectionName || item?.selectionCode,
    item?.eventTitle,
    item?.subTitle,
    item?.sourceCategory,
  ]
    .map((value) => translateDynamicText(value))
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  return segments.join(" · ");
}

function getMarketImage(item) {
  if (!item || typeof item !== "object") return "";
  const value = item.displayImage || item.image || item.icon || "";
  return typeof value === "string" ? value.trim() : "";
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
  const endValue = item?.displayEndTime || item?.endDate || item?.endTime || item?.closeTime || item?.closedAt || item?.resolvedAt;
  const dateLabel = formatShortDate(endValue);
  const volumeLabel = formatCompactCurrency(getVolumeValue(item));
  return {
    dateLabel,
    volumeLabel: volumeLabel ? `${volumeLabel} Vol.` : "",
  };
}

function getOutcomeRows(item) {
  const optionRows = parseMaybeJson(item?.options);
  if (Array.isArray(optionRows) && optionRows.length > 0) {
    return optionRows.slice(0, 4).map((row, idx) => {
      const outcomeIndex = Number(row?.outcomeIndex ?? idx);
      const rawLabel = String(row?.outcomeName || row?.label || `选项${idx + 1}`);
      return {
        key: `${item?.merchantPlayId || item?.pmMarketId || item?.id || "market"}-${outcomeIndex}`,
        label: formatOutcomeLabel(rawLabel),
        rawLabel,
        outcomeIndex,
        price: row?.price ?? row?.bestAsk ?? row?.bestBid ?? extractOutcomePrice(item, outcomeIndex),
      };
    });
  }
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

function extractOutcomeQuote(item, idx, side = "BUY") {
  const latestPrices = Array.isArray(item?.latestPrices) ? item.latestPrices : [];
  const priceRow = latestPrices.find((row) => Number(row.outcomeIndex) === Number(idx));
  if (priceRow) {
    const bid = Number(priceRow.bestBid);
    const ask = Number(priceRow.bestAsk);
    const mid = Number(priceRow.price);
    if (String(side).toUpperCase() === "SELL") {
      if (Number.isFinite(bid) && bid > 0) return bid;
      if (Number.isFinite(mid) && mid > 0) return mid;
      if (Number.isFinite(ask) && ask > 0) return ask;
    }
    if (Number.isFinite(ask) && ask > 0) return ask;
    if (Number.isFinite(mid) && mid > 0) return mid;
    if (Number.isFinite(bid) && bid > 0) return bid;
  }
  return Number(extractOutcomePrice(item, idx)) || 0;
}

function findOutcomeIndexByName(item, name) {
  const normalized = String(name || "").trim().toLowerCase();
  if (!normalized) return -1;
  const rows = getOutcomeRows(item);
  return rows.findIndex((row) => String(row.rawLabel || "").trim().toLowerCase() === normalized);
}

function formatCentPrice(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "--";
  return `${Math.round(num * 100)}¢`;
}

function formatSellQuote(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "暂无买盘";
  return `${Math.round(num * 100)}¢`;
}

function formatBillAmount(value, currency = "USDC") {
  const num = Number(value);
  if (!Number.isFinite(num)) return `- ${currency}`;
  return `${num.toFixed(4).replace(/\.?0+$/, "")} ${currency}`;
}

function formatBillPnl(value, currency = "USDC") {
  const num = Number(value);
  if (!Number.isFinite(num)) return `- ${currency}`;
  return `${num > 0 ? "+" : ""}${num.toFixed(4).replace(/\.?0+$/, "")} ${currency}`;
}

function getRemainingOrderSize(order) {
  const candidates = [order?.remainingSize, order?.filledSize, order?.orderSize];
  for (const candidate of candidates) {
    const num = Number(candidate);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return 0;
}

function getRemainingOrderAmount(order) {
  const candidates = [order?.remainingAmount, order?.filledAmount, order?.orderAmount];
  for (const candidate of candidates) {
    const num = Number(candidate);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return 0;
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
    merchantPlayId: data.merchantPlayId ?? data.merchant_play_id ?? message?.merchantPlayId ?? null,
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

function buildLatestPrices(prices, merchantPlayId, pmMarketId) {
  if (!Array.isArray(prices)) return [];
  if (merchantPlayId != null && merchantPlayId !== "") {
    return prices.filter((row) => row && String(row.merchantPlayId || "") === String(merchantPlayId));
  }
  return prices.filter((row) => row && row.pmMarketId === pmMarketId);
}

function attachLatestPrices(item, prices) {
  if (!item) return item;
  const latestPrices = buildLatestPrices(prices, item.merchantPlayId, item.pmMarketId);
  return latestPrices.length > 0 ? { ...item, latestPrices } : item;
}

function pickInitialCategory(categoryRows, requestedCategory = "") {
  const enabledCategories = (Array.isArray(categoryRows) ? categoryRows : [])
    .filter((item) => item && item.id != null)
    .map((item) => String(item.id));
  if (requestedCategory && enabledCategories.includes(requestedCategory)) {
    return requestedCategory;
  }
  return enabledCategories[0] || "";
}

function getPinnedStorageKey(itemOrId) {
  if (itemOrId && typeof itemOrId === "object") {
    return String(itemOrId.merchantPlayId || itemOrId.pmMarketId || itemOrId.id || "");
  }
  return String(itemOrId || "");
}

function sortMarketsByPinned(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  let pinnedMap = {};
  try {
    pinnedMap = JSON.parse(window.localStorage.getItem("polymarketPinnedPlays") || "{}") || {};
  } catch {
    pinnedMap = {};
  }
  return rows.slice().sort((left, right) => {
    const leftPinned = pinnedMap[getPinnedStorageKey(left)] ? 1 : 0;
    const rightPinned = pinnedMap[getPinnedStorageKey(right)] ? 1 : 0;
    if (leftPinned !== rightPinned) return rightPinned - leftPinned;
    return 0;
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

function getOrderDraftKey(item) {
  if (!item) return "";
  return String(
    item.orderNo
    || `${item.pmMarketId || ""}:${item.selectionCode || item.selectionName || item.tokenId || item.id || ""}`
  );
}

function PolymarketApp({ baseUrl, balance }) {
  const availableBalance = parseFloat(balance?.amount || 0) - parseFloat(balance?.froze || 0);
  const lastPriceUpdateRef = useRef(0);
  const marketLoadMoreRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("markets");
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedMerchantPlayId, setSelectedMerchantPlayId] = useState("");
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState("");
  const [socketConnected, setSocketConnected] = useState(false);
  const [lastPriceRefreshAt, setLastPriceRefreshAt] = useState(0);
  const [liveNowMs, setLiveNowMs] = useState(Date.now());
  const [graphRange, setGraphRange] = useState("1h");
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphData, setGraphData] = useState(null);
  const [tradeSide, setTradeSide] = useState("BUY");
  const [tradeOutcomeIndex, setTradeOutcomeIndex] = useState(0);
  const [tradeAmount, setTradeAmount] = useState("100");
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [marketPosition, setMarketPosition] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLang, setDetailLang] = useState("zh-CN");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTranslation, setDetailTranslation] = useState(null);
  const [positions, setPositions] = useState([]);
  const [localOrders, setLocalOrders] = useState([]);
  const [selectedPlayOrders, setSelectedPlayOrders] = useState([]);
  const [selectedPlayOrdersLoading, setSelectedPlayOrdersLoading] = useState(false);
  const [selectedPlayPinned, setSelectedPlayPinned] = useState(false);
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [orderSellDrafts, setOrderSellDrafts] = useState({});
  const [orderSellModes, setOrderSellModes] = useState({});
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [positionsPage, setPositionsPage] = useState(1);
  const [positionsHasMore, setPositionsHasMore] = useState(false);
  const [localOrdersLoading, setLocalOrdersLoading] = useState(false);
  const [localOrdersPage, setLocalOrdersPage] = useState(1);
  const [localOrdersHasMore, setLocalOrdersHasMore] = useState(false);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsPage, setResultsPage] = useState(1);
  const [resultsHasMore, setResultsHasMore] = useState(false);
  const [marketPage, setMarketPage] = useState(1);
  const [marketHasMore, setMarketHasMore] = useState(false);
  const [loadingMoreMarkets, setLoadingMoreMarkets] = useState(false);
  const [data, setData] = useState({
    categories: [],
    markets: [],
    prices: [],
    results: [],
  });

  const loadCategories = useCallback(async () => {
    const response = await fetchPolymarketMerchantCategories(baseUrl);
    const remoteRows = Array.isArray(response?.data) ? response.data : [];
    if (remoteRows.length === 0) {
      return [];
    }
    return remoteRows
      .filter((item) => item && item.id != null)
      .map((item) => ({
        ...item,
        id: String(item.id),
        label: item?.categoryName || item?.subTitle || `分类${item.id}`,
      }));
  }, [baseUrl]);

  const hydrateMarkets = useCallback((marketRows, append = false) => {
    const nextMarkets = Array.isArray(marketRows) ? marketRows : [];
    setData((prev) => {
      const mergedMarkets = append
        ? [
            ...prev.markets,
            ...nextMarkets.filter((item) => item?.pmMarketId && !prev.markets.some((row) => row?.pmMarketId === item.pmMarketId)),
          ]
        : nextMarkets;
      const sortedMarkets = sortMarketsByPinned(mergedMarkets);
      return {
        ...prev,
        markets: sortedMarkets,
      };
    });
    setSelectedMerchantPlayId((prev) => {
      if (prev && nextMarkets.some((item) => String(item?.merchantPlayId || "") === String(prev))) {
        return prev;
      }
      return nextMarkets.find((item) => item?.merchantPlayId != null)?.merchantPlayId || "";
    });
    setSelectedMarketId((prev) => {
      if (prev && nextMarkets.some((item) => item?.pmMarketId === prev)) {
        return prev;
      }
      return nextMarkets.find((item) => item?.pmMarketId)?.pmMarketId || "";
    });
  }, []);

  const loadCategoryMarkets = useCallback(async ({ categoryId = "", page = 1, append = false, keyword = "" } = {}) => {
    if (!categoryId) {
      setSelectedCategory("");
      setSelectedMerchantPlayId("");
      setSelectedMarketId("");
      setMarketPage(1);
      setMarketHasMore(false);
      setData((prev) => ({
        ...prev,
        markets: [],
        prices: [],
      }));
      return;
    }
    if (append) {
      setLoadingMoreMarkets(true);
    } else {
      setLoading(true);
    }
    setError("");
    try {
      const categoryRows = categories.length > 0 ? categories : await loadCategories();
      const resolvedCategoryId = categoryId || pickInitialCategory(categoryRows, "");
      const marketsRes = resolvedCategoryId
        ? await fetchPolymarketMerchantPlays(baseUrl, { categoryId: resolvedCategoryId, keyword, page, size: PAGE_SIZE, lang: "zh-CN" })
        : { data: [], meta: { total: 0 } };
      const markets = Array.isArray(marketsRes.data) ? marketsRes.data : [];
      const total = Number(marketsRes?.meta?.total ?? 0);
      setSelectedCategory(resolvedCategoryId);
      setMarketPage(page);
      setMarketHasMore(page * PAGE_SIZE < total);
      hydrateMarkets(markets, append);
      setData((prev) => ({
        ...prev,
        categories: categoryRows,
      }));
      if (categories.length === 0) {
        setCategories(categoryRows);
      }
    } catch (err) {
      setError(err?.message || "Polymarket 加载失败");
    } finally {
      if (append) {
        setLoadingMoreMarkets(false);
      } else {
        setLoading(false);
      }
    }
  }, [baseUrl, categories, hydrateMarkets, loadCategories]);

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
        const prices = upsertByKey(prev.prices, (row) => `${row.merchantPlayId || row.pmMarketId}:${row.outcomeIndex}`, patch);
        const markets = Array.isArray(prev.markets) ? prev.markets.map((item) => {
          if (!item) {
            return item;
          }
          const matchByPlay = patch.merchantPlayId && String(item.merchantPlayId || "") === String(patch.merchantPlayId);
          const matchByMarket = !patch.merchantPlayId && item.pmMarketId === patch.pmMarketId;
          if (!matchByPlay && !matchByMarket) {
            return item;
          }
          const previousRows = Array.isArray(item.latestPrices) ? item.latestPrices : [];
          const nextRows = upsertByKey(previousRows, (row) => `${row.merchantPlayId || row.pmMarketId}:${row.outcomeIndex}`, patch);
          return {
            ...item,
            latestPrices: nextRows,
          };
        }) : prev.markets;
        return {
          ...prev,
          markets,
          prices,
        };
      });
      setPositions((prev) => prev.map((item) => {
        if (!item || item.pmMarketId !== patch.pmMarketId) {
          return item;
        }
        const previousRows = Array.isArray(item.latestPrices) ? item.latestPrices : [];
        const nextRows = upsertByKey(previousRows, (row) => `${row.pmMarketId}:${row.outcomeIndex}`, patch);
        const currentSelection = String(item.selectionCode || item.selectionName || "").trim().toLowerCase();
        const selectedRow = nextRows.find((row) => String(row.outcomeName || "").trim().toLowerCase() === currentSelection);
        const nextCurrentPrice = selectedRow
          ? (Number(selectedRow.bestBid) > 0 ? Number(selectedRow.bestBid) : Number(selectedRow.price) || 0)
          : Number(item.currentPrice || 0);
        return {
          ...item,
          latestPrices: nextRows,
          currentPrice: nextCurrentPrice > 0 ? nextCurrentPrice : item.currentPrice,
        };
      }));
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
        setSelectedCategory(initialCategory);
        setData({
          categories: categoryRows,
          markets: [],
          prices: [],
          results: [],
        });
        setSelectedMerchantPlayId("");
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
    const timer = window.setInterval(() => {
      setLiveNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedCategory) {
      return;
    }
    loadCategoryMarkets({ categoryId: selectedCategory, page: 1, append: false });
  }, [loadCategoryMarkets, selectedCategory]);

  const { connected: wsConnected, syncSubscriptions } = usePolymarketSocket({
    baseUrl,
    enabled: true,
    onRefresh: applySocketPatch,
    onConnectedChange: setSocketConnected,
  });

  useEffect(() => {
    if (!wsConnected) {
      return;
    }
    const currentPageMarketIds = (() => {
      if (activeTab === "orders") {
        return Array.from(new Set((Array.isArray(positions) ? positions : []).map((item) => item?.pmMarketId).filter(Boolean)));
      }
      if (activeTab === "openOrders") {
        return Array.from(new Set((Array.isArray(localOrders) ? localOrders : []).map((item) => item?.pmMarketId).filter(Boolean)));
      }
    if (activeTab === "results") {
      return Array.from(new Set((Array.isArray(data.results) ? data.results : []).map((item) => item?.pmMarketId).filter(Boolean)));
    }
    return Array.from(new Set((Array.isArray(data.markets) ? data.markets : []).map((item) => item?.pmMarketId).filter(Boolean)));
  })();
  const currentPageMerchantPlayIds = activeTab === "markets"
    ? Array.from(new Set((Array.isArray(data.markets) ? data.markets : []).map((item) => item?.merchantPlayId).filter(Boolean)))
    : [];
  syncSubscriptions({
    pmMarketIds: currentPageMarketIds,
    merchantPlayIds: currentPageMerchantPlayIds,
  });
  }, [activeTab, data.markets, data.results, localOrders, positions, syncSubscriptions, wsConnected]);

  const selectedMarket = useMemo(() => {
    const rows = Array.isArray(data.markets) ? data.markets : [];
    const market = rows.find((item) => item && String(item.merchantPlayId || "") === String(selectedMerchantPlayId))
      || rows.find((item) => item && item.pmMarketId === selectedMarketId)
      || null;
    if (!market) {
      return null;
    }
    return attachLatestPrices(market, data.prices);
  }, [data.markets, data.prices, selectedMarketId, selectedMerchantPlayId]);
  const graphSvg = useMemo(() => buildGraphSeriesSvg(Array.isArray(graphData?.series) ? graphData.series : []), [graphData]);
  const selectedMarketRows = useMemo(() => (
    selectedMarket ? getOutcomeRows(selectedMarket) : []
  ), [selectedMarket]);
  const selectedTradeRow = useMemo(() => (
    selectedMarketRows.find((row) => Number(row.outcomeIndex) === Number(tradeOutcomeIndex)) || selectedMarketRows[0] || null
  ), [selectedMarketRows, tradeOutcomeIndex]);
  const currentTradePrice = useMemo(() => {
    if (!selectedMarket || !selectedTradeRow) return 0;
    return extractOutcomeQuote(selectedMarket, selectedTradeRow.outcomeIndex, tradeSide);
  }, [selectedMarket, selectedTradeRow, tradeSide]);
  const tradeAmountNumber = useMemo(() => {
    const parsed = Number(tradeAmount);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [tradeAmount]);
  const estimatedShares = useMemo(() => (
    currentTradePrice > 0 && tradeAmountNumber > 0 ? tradeAmountNumber / currentTradePrice : 0
  ), [currentTradePrice, tradeAmountNumber]);
  const potentialReturn = useMemo(() => (
    currentTradePrice > 0 && tradeAmountNumber > 0 ? tradeAmountNumber / currentTradePrice : 0
  ), [currentTradePrice, tradeAmountNumber]);
  const maxClosableAmount = useMemo(() => {
    const size = Number(marketPosition?.size || 0);
    if (!Number.isFinite(size) || size <= 0 || currentTradePrice <= 0) return 0;
    return size * currentTradePrice;
  }, [currentTradePrice, marketPosition]);

  useEffect(() => {
    const merchantPlayIds = Array.from(new Set((Array.isArray(data.markets) ? data.markets : []).map((item) => item?.merchantPlayId).filter(Boolean)));
    if (merchantPlayIds.length === 0) {
      setData((prev) => ({
        ...prev,
        prices: [],
      }));
      return;
    }
    let cancelled = false;
    fetchPolymarketMerchantPrices(baseUrl, merchantPlayIds)
      .then((res) => {
        if (cancelled) {
          return;
        }
        const rows = Array.isArray(res?.data) ? res.data : [];
        const latestPriceAt = getLatestPriceUpdateAt(rows);
        if (latestPriceAt > 0) {
          lastPriceUpdateRef.current = latestPriceAt;
          setLastPriceRefreshAt(latestPriceAt);
        }
        setData((prev) => ({
          ...prev,
          prices: rows,
        }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [baseUrl, data.markets]);

  useEffect(() => {
    if (!selectedMarket?.pmMarketId) {
      setMarketPosition(null);
      return;
    }
    let cancelled = false;
    const positionRequest = selectedMarket?.merchantPlayId
      ? fetchPolymarketMerchantMarketPosition(baseUrl, selectedMarket.merchantPlayId)
      : fetchPolymarketMarketPosition(baseUrl, selectedMarket.pmMarketId);
    positionRequest
      .then((res) => {
        if (!cancelled) {
          setMarketPosition(res?.data || null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMarketPosition(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, selectedMarket]);

  useEffect(() => {
    if (!selectedMarket?.pmMarketId) {
      setSelectedPlayOrders([]);
      setSelectedPlayPinned(false);
      return;
    }
    if (!selectedMarket?.merchantPlayId) {
      setSelectedPlayOrders([]);
      return;
    }
    let cancelled = false;
    setSelectedPlayOrdersLoading(true);
    fetchPolymarketPlayOrders(baseUrl, selectedMarket.merchantPlayId)
      .then((res) => {
        if (cancelled) return;
        const rows = Array.isArray(res?.data) ? res.data : [];
        setSelectedPlayOrders(rows);
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedPlayOrders([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSelectedPlayOrdersLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, selectedMarket]);

  useEffect(() => {
    const selectedKey = getPinnedStorageKey(selectedMarket);
    if (!selectedKey) {
      setSelectedPlayPinned(false);
      return;
    }
    try {
      const cache = JSON.parse(window.localStorage.getItem("polymarketPinnedPlays") || "{}");
      setSelectedPlayPinned(Boolean(cache?.[selectedKey]));
    } catch {
      setSelectedPlayPinned(false);
    }
  }, [selectedMarket]);

  useEffect(() => {
    if (!detailOpen || !selectedMarket?.pmMarketId) {
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    fetchPolymarketMarketTranslation(baseUrl, selectedMarket.pmMarketId, detailLang)
      .then((res) => {
        if (!cancelled) {
          setDetailTranslation(res?.data || null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetailTranslation(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, detailLang, detailOpen, selectedMarket]);

  useEffect(() => {
    if (!selectedMarketRows.length) {
      return;
    }
    const desiredIndex = marketPosition
      ? findOutcomeIndexByName(selectedMarket, marketPosition.selectionName || marketPosition.selectionCode)
      : -1;
    if (tradeSide === "SELL" && desiredIndex >= 0) {
      setTradeOutcomeIndex(selectedMarketRows[desiredIndex].outcomeIndex);
      return;
    }
    if (!selectedMarketRows.some((row) => Number(row.outcomeIndex) === Number(tradeOutcomeIndex))) {
      setTradeOutcomeIndex(selectedMarketRows[0].outcomeIndex);
    }
  }, [marketPosition, selectedMarket, selectedMarketRows, tradeOutcomeIndex, tradeSide]);

  const summary = useMemo(() => ([
    { label: "分类", value: categories.length },
    { label: "分页", value: marketPage },
    { label: "玩法", value: data.markets.length },
    { label: "可下单选项", value: data.markets.reduce((count, item) => count + getOutcomeRows(item).length, 0) },
  ]), [categories.length, data.markets, marketPage]);

  const currentList = useMemo(() => {
    if (activeTab === "markets") return data.markets;
    if (activeTab === "graph") return [];
    if (activeTab === "results") return data.results;
    if (activeTab === "openOrders") return localOrders;
    if (activeTab === "orders") return positions;
    return data.markets;
  }, [activeTab, data.markets, data.results, localOrders, positions]);

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
    if (!loading && !error && !["markets", "graph", "results", "orders", "openOrders"].includes(activeTab)) {
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

  const handleCategoryClick = useCallback((category) => {
    if (!category || category === selectedCategory) {
      return;
    }
    setSelectedCategory(category);
    setSelectedMerchantPlayId("");
    setSelectedMarketId("");
    setMarketPage(1);
    setMarketHasMore(false);
    setData((prev) => ({
      ...prev,
      markets: [],
      prices: [],
    }));
  }, [selectedCategory]);

  const handleMarketClick = useCallback((marketId, merchantPlayId = "") => {
    const nextMerchantPlayId = merchantPlayId == null ? "" : String(merchantPlayId);
    if ((!marketId || marketId === selectedMarketId) && nextMerchantPlayId === String(selectedMerchantPlayId || "")) {
      return;
    }
    setSelectedMerchantPlayId(nextMerchantPlayId);
    setSelectedMarketId(marketId);
  }, [selectedMarketId, selectedMerchantPlayId]);

  const handleTogglePlayPin = useCallback(async () => {
    const selectedKey = getPinnedStorageKey(selectedMarket);
    if (!selectedKey || pinSubmitting) {
      return;
    }
    const nextPinned = !selectedPlayPinned;
    try {
      setPinSubmitting(true);
      setSelectedPlayPinned(nextPinned);
      try {
        const cache = JSON.parse(window.localStorage.getItem("polymarketPinnedPlays") || "{}");
        cache[selectedKey] = nextPinned;
        window.localStorage.setItem("polymarketPinnedPlays", JSON.stringify(cache));
      } catch {
        // ignore cache errors
      }
      setData((prev) => ({
        ...prev,
        markets: sortMarketsByPinned(prev.markets),
      }));
    } catch (err) {
      alert(`置顶失败: ${err?.message || "未知错误"}`);
    } finally {
      setPinSubmitting(false);
    }
  }, [pinSubmitting, selectedMarket, selectedPlayPinned]);

  const handleTradeOutcomeClick = useCallback((e, marketId, merchantPlayId, outcomeIndex) => {
    e.stopPropagation();
    if (marketId && marketId !== selectedMarketId) {
      setSelectedMarketId(marketId);
    }
    if (merchantPlayId != null && String(merchantPlayId) !== String(selectedMerchantPlayId || "")) {
      setSelectedMerchantPlayId(String(merchantPlayId));
    }
    setTradeOutcomeIndex(outcomeIndex);
  }, [selectedMarketId, selectedMerchantPlayId]);

  const handleOrderSubmit = useCallback(async () => {
    if (!selectedMarket || !selectedTradeRow || !tradeAmount || orderSubmitting) return;

    const orderAmountNum = tradeAmountNumber;
    if (orderAmountNum <= 0) {
      return;
    }
    if (tradeSide === "BUY" && orderAmountNum > availableBalance) {
      alert(`下单金额超过可用余额，可用余额：${availableBalance.toFixed(2)} USDT`);
      return;
    }
    if (currentTradePrice <= 0) {
      alert("当前价格不可用");
      return;
    }

    setOrderSubmitting(true);
    try {
      const tokenIds = parseTokenIds(selectedMarket);
      const tokenId = tokenIds[selectedTradeRow.outcomeIndex] || "";
      const isMerchantPlay = selectedMarket?.merchantPlayId != null && String(selectedMarket.merchantPlayId) !== "";
      if (tradeSide === "SELL") {
        const positionSize = Number(marketPosition?.size || 0);
        if (!positionSize || positionSize <= 0) {
          throw new Error("当前没有可卖出的持仓");
        }
        const sizeToSell = orderAmountNum / currentTradePrice;
        if (isMerchantPlay) {
          await closePolymarketMerchantPosition(baseUrl, {
            merchantPlayId: selectedMarket.merchantPlayId,
            itemId: selectedMarket.merchantPlayId,
            selectionCode: selectedTradeRow.rawLabel,
            selectionName: selectedTradeRow.rawLabel,
            size: sizeToSell,
            price: currentTradePrice,
          });
        } else {
          await closePolymarketPosition(baseUrl, {
            pmMarketId: selectedMarket.pmMarketId,
            selectionCode: selectedTradeRow.rawLabel,
            selectionName: selectedTradeRow.rawLabel,
            size: sizeToSell,
            price: currentTradePrice,
          });
        }
      } else {
        if (isMerchantPlay) {
          await createPolymarketMerchantOrder(baseUrl, {
            merchantPlayId: selectedMarket.merchantPlayId,
            itemId: selectedMarket.merchantPlayId,
            pmEventId: selectedMarket.pmEventId,
            pmMarketId: selectedMarket.pmMarketId,
            tokenId,
            selectionCode: selectedTradeRow.rawLabel,
            selectionName: selectedTradeRow.rawLabel,
            orderSide: "BUY",
            orderType: "MARKET",
            orderPrice: currentTradePrice,
            orderAmount: orderAmountNum,
            orderSize: estimatedShares,
          });
        } else {
          await createPolymarketOrder(baseUrl, {
            pmEventId: selectedMarket.pmEventId,
            pmMarketId: selectedMarket.pmMarketId,
            tokenId,
            selectionCode: selectedTradeRow.rawLabel,
            selectionName: selectedTradeRow.rawLabel,
            orderSide: "BUY",
            orderType: "MARKET",
            orderPrice: currentTradePrice,
            orderAmount: orderAmountNum,
            orderSize: estimatedShares,
          });
        }
      }
      alert(`${tradeSide === "BUY" ? "买入" : "卖出"}成功`);
      setActiveTab("orders");
      const positionRes = isMerchantPlay
        ? await fetchPolymarketMerchantMarketPosition(baseUrl, selectedMarket.merchantPlayId)
        : await fetchPolymarketMarketPosition(baseUrl, selectedMarket.pmMarketId);
      await loadLocalOrders({ page: 1, append: false, scope: "current" });
      setMarketPosition(positionRes?.data || null);
      if (typeof window.refreshBalance === "function") {
        window.refreshBalance();
      }
    } catch (err) {
      alert(`${tradeSide === "BUY" ? "买入" : "卖出"}失败: ` + (err?.message || "未知错误"));
    } finally {
      setOrderSubmitting(false);
    }
  }, [availableBalance, baseUrl, currentTradePrice, estimatedShares, marketPosition, orderSubmitting, selectedMarket, selectedTradeRow, tradeAmount, tradeAmountNumber, tradeSide]);

  const loadPositions = useCallback(async ({ page = 1, append = false } = {}) => {
    setPositionsLoading(true);
    try {
      const res = await fetchPolymarketPositions(baseUrl, page, ORDER_PAGE_SIZE);
      const rows = Array.isArray(res.data) ? res.data : [];
      const total = Number(res?.meta?.total ?? 0);
      setPositionsPage(page);
      setPositionsHasMore(page * ORDER_PAGE_SIZE < total);
      setPositions((prev) => (append ? [...prev, ...rows] : rows));
    } catch (err) {
      console.warn("加载 Tiger 持仓失败:", err);
    } finally {
      setPositionsLoading(false);
    }
  }, [baseUrl]);

  const loadLocalOrders = useCallback(async ({ page = 1, append = false, scope = "current" } = {}) => {
    const history = scope === "history";
    const setLoadingState = history ? setResultsLoading : setLocalOrdersLoading;
    const setPageState = history ? setResultsPage : setLocalOrdersPage;
    const setHasMoreState = history ? setResultsHasMore : setLocalOrdersHasMore;
    const setRowsState = history
      ? ((rows) => setData((prev) => ({ ...prev, results: rows })))
      : setLocalOrders;
    setLoadingState(true);
    try {
      const res = await fetchPolymarketLocalOrders(baseUrl, { page, size: RESULT_PAGE_SIZE, scope });
      const rows = Array.isArray(res.data) ? res.data : [];
      const total = Number(res?.meta?.total ?? 0);
      setPageState(page);
      setHasMoreState(page * RESULT_PAGE_SIZE < total);
      if (history) {
        setData((prev) => ({
          ...prev,
          results: append ? [...prev.results, ...rows] : rows,
        }));
      } else {
        setRowsState((prev) => (append ? [...prev, ...rows] : rows));
      }
    } catch (err) {
      console.warn(history ? "加载历史委托失败:" : "加载当前委托失败:", err);
    } finally {
      setLoadingState(false);
    }
  }, [baseUrl]);

  const handleOrderSellDraftChange = useCallback((draftKey, value) => {
    setOrderSellDrafts((prev) => ({
      ...prev,
      [draftKey]: value,
    }));
  }, []);

  const handleOrderSellModeChange = useCallback((draftKey, mode) => {
    setOrderSellModes((prev) => ({
      ...prev,
      [draftKey]: mode,
    }));
    setOrderSellDrafts((prev) => ({
      ...prev,
      [draftKey]: "",
    }));
  }, []);

  const handleOrderSell = useCallback(async (order) => {
    if (!order || !order.pmMarketId) {
      return;
    }
    const draftKey = getOrderDraftKey(order);
    const currentPrice = Number(order.currentPrice || 0);
    const remainingSize = getRemainingOrderSize(order);
    const maxAmount = currentPrice > 0 ? remainingSize * currentPrice : 0;
    const sellMode = orderSellModes[draftKey] === "amount" ? "amount" : "size";
    const draftValue = Number(orderSellDrafts[draftKey] || 0);
    if (!(draftValue > 0)) {
      alert(sellMode === "amount" ? "请输入卖出金额" : "请输入卖出份额");
      return;
    }
    if (!(currentPrice > 0)) {
      alert("当前卖价不可用");
      return;
    }
    let draftSize = sellMode === "amount" ? draftValue / currentPrice : draftValue;
    if (draftSize > remainingSize && draftSize - remainingSize <= 1e-6) {
      draftSize = remainingSize;
    }
    if (draftSize > remainingSize + 1e-8) {
      alert(sellMode === "amount"
        ? `卖出金额超过可卖上限，当前最多可卖 ${maxAmount.toFixed(2)} ${order.currency || "USDC"}`
        : `卖出份额超过可卖上限，当前最多可卖 ${remainingSize.toFixed(4)} 份`);
      return;
    }
    try {
      setOrderSubmitting(true);
      const isMerchantPlay = order?.merchantPlayId != null && String(order.merchantPlayId) !== "";
      if (isMerchantPlay) {
        await closePolymarketMerchantPosition(baseUrl, {
          merchantPlayId: order.merchantPlayId,
          itemId: order.merchantPlayId,
          selectionCode: order.selectionCode,
          selectionName: order.selectionName,
          sourceOrderNo: order.orderNo,
          size: draftSize,
          price: currentPrice,
        });
      } else {
        await closePolymarketPosition(baseUrl, {
          pmMarketId: order.pmMarketId,
          selectionCode: order.selectionCode,
          selectionName: order.selectionName,
          sourceOrderNo: order.orderNo,
          size: draftSize,
          price: currentPrice,
        });
      }
      setOrderSellDrafts((prev) => ({
        ...prev,
        [draftKey]: "",
      }));
      await loadPositions({ page: 1, append: false });
      await loadLocalOrders({ page: 1, append: false, scope: "current" });
      if (selectedMarket?.pmMarketId === order.pmMarketId) {
        const positionRes = isMerchantPlay
          ? await fetchPolymarketMerchantMarketPosition(baseUrl, order.merchantPlayId, order.selectionCode || order.selectionName || "")
          : await fetchPolymarketMarketPosition(baseUrl, order.pmMarketId, order.selectionCode || order.selectionName || "");
        setMarketPosition(positionRes?.data || null);
      }
      if (typeof window.refreshBalance === "function") {
        window.refreshBalance();
      }
      alert("卖出成功");
    } catch (err) {
      alert(`卖出失败: ${err?.message || "未知错误"}`);
    } finally {
      setOrderSubmitting(false);
    }
  }, [baseUrl, loadLocalOrders, loadPositions, orderSellDrafts, orderSellModes, selectedMarket?.pmMarketId]);

  const loadResults = useCallback(async ({ page = 1, append = false } = {}) => {
    await loadLocalOrders({ page, append, scope: "history" });
  }, [loadLocalOrders]);

  useEffect(() => {
    if (activeTab === "orders") {
      loadPositions({ page: 1, append: false });
    }
  }, [activeTab, loadPositions]);

  useEffect(() => {
    if (activeTab === "openOrders") {
      loadLocalOrders({ page: 1, append: false, scope: "current" });
    }
  }, [activeTab, loadLocalOrders]);

  useEffect(() => {
    if (activeTab === "results") {
      loadResults({ page: 1, append: false });
    }
  }, [activeTab, loadResults]);

  const handleLoadMore = useCallback(() => {
    if (activeTab === "markets" && !loadingMoreMarkets && marketHasMore) {
      loadCategoryMarkets({ categoryId: selectedCategory, page: marketPage + 1, append: true });
      return;
    }
    if (activeTab === "orders" && !positionsLoading && positionsHasMore) {
      loadPositions({ page: positionsPage + 1, append: true });
      return;
    }
    if (activeTab === "openOrders" && !localOrdersLoading && localOrdersHasMore) {
      loadLocalOrders({ page: localOrdersPage + 1, append: true, scope: "current" });
      return;
    }
    if (activeTab === "results" && !resultsLoading && resultsHasMore) {
      loadResults({ page: resultsPage + 1, append: true });
    }
  }, [
    activeTab,
    loadCategoryMarkets,
    loadLocalOrders,
    loadPositions,
    loadResults,
    loadingMoreMarkets,
    marketHasMore,
    marketPage,
    localOrdersHasMore,
    localOrdersLoading,
    localOrdersPage,
    positionsHasMore,
    positionsLoading,
    positionsPage,
    resultsHasMore,
    resultsLoading,
    resultsPage,
    selectedCategory,
  ]);

  useEffect(() => {
    if (activeTab !== "markets" || loading || loadingMoreMarkets || !marketHasMore) {
      return undefined;
    }
    const target = marketLoadMoreRef.current;
    if (!target) {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting) {
          return;
        }
        loadCategoryMarkets({ categoryId: selectedCategory, page: marketPage + 1, append: true });
      },
      {
        root: null,
        rootMargin: "400px 0px",
        threshold: 0,
      }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [activeTab, loadCategoryMarkets, loading, loadingMoreMarkets, marketHasMore, marketPage, selectedCategory]);

  return (
    <div className="polymarket-shell pm-board-shell">
      <section className="pm-board-head">
        <div>
          <h2 className="pm-board-title">所有盘口</h2>
          <div className="pm-board-subtitle">
            {selectedCategory
              ? `${categories.find((item) => String(item?.id) === String(selectedCategory))?.label || "当前分类"} · 商户玩法展示`
              : "选择分类后查看盘口"}
          </div>
        </div>
        <div className="pm-board-tools">
          <div className="pm-board-balance">可用余额 {availableBalance.toFixed(2)} USDT</div>
          <button
            type="button"
            className="pm-board-icon"
            onClick={() => loadCategoryMarkets({ categoryId: selectedCategory, page: 1, append: false })}
            disabled={loading || loadingMoreMarkets}
          >
            {loading || loadingMoreMarkets ? "刷新中" : "刷新"}
          </button>
        </div>
      </section>

      <section className="pm-board-categories" role="tablist" aria-label="分类">
        {categories.map((item) => {
          const category = String(item?.id || "");
          return (
            <button
              key={category}
              type="button"
              className={selectedCategory === category ? "pm-board-category active" : "pm-board-category"}
              onClick={() => handleCategoryClick(category)}
            >
              {item?.label || item?.categoryName || item?.subTitle || category}
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
          placeholder="搜索市场问题或选项"
        />
        <div className="pm-board-search-meta">
          最新价格：{formatLiveUpdateLabel(lastPriceRefreshAt, liveNowMs)} · {socketConnected ? "WS 已连接" : "WS 未连接"}
        </div>
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

      {!loading && !error && activeTab !== "markets" ? (
        <section className="pm-board-history-filters">
          <div className="pm-board-search-meta">
            {activeTab === "orders"
              ? "数据源：Tiger 持仓"
              : activeTab === "openOrders"
                ? "数据源：本地订单（当前委托）"
                : "数据源：本地订单（历史委托）"}
          </div>
        </section>
      ) : null}

      {error ? <div className="pm-empty" style={{ color: "#dc2626" }}>{error}</div> : null}
      {!error && !loading && !selectedCategory ? <div className="pm-empty">当前没有已开启的商户分类。</div> : null}
      {!error && !loading && selectedCategory && data.markets.length === 0 && activeTab === "markets" ? (
        <div className="pm-empty">当前分类下还没有可展示的玩法数据。</div>
      ) : null}
      {loading ? <div className="pm-empty">正在加载数据...</div> : null}

      {!loading && !error && activeTab === "markets" ? (
        <section className="pm-board-market-layout">
          <div className="pm-board-market-main">
            {filteredCurrentList.length > 0 ? (
              <section className="pm-board-grid">
                {filteredCurrentList.map((item, index) => {
                  const displayItem = attachLatestPrices(item, data.prices);
                  const rows = getOutcomeRows(displayItem);
                  const cardMeta = getCardMeta(item);
                  const closedMarket = isClosedStatus(item.status);
                  return (
                    <article
                      className={String(selectedMerchantPlayId || "") === String(displayItem.merchantPlayId || "") ? "pm-board-card selected" : "pm-board-card"}
                      key={displayItem.pmMarketId || displayItem.id || index}
                      onClick={() => handleMarketClick(displayItem.pmMarketId, displayItem.merchantPlayId)}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="pm-board-card-top">
                        <div className="pm-board-card-title-wrap">
                          <div className="pm-board-card-title-row">
                            {getMarketImage(displayItem) ? (
                              <img
                                src={getMarketImage(displayItem)}
                                alt=""
                                className="pm-board-card-avatar"
                                loading="lazy"
                                referrerPolicy="no-referrer"
                              />
                            ) : null}
                            <h3 className="pm-board-card-title">{getCardTitle(displayItem)}</h3>
                          </div>
                          <div className="pm-board-card-meta">
                            {cardMeta.volumeLabel ? `交易额 ${cardMeta.volumeLabel}` : "交易额 -"} {cardMeta.dateLabel ? `· ${cardMeta.dateLabel}` : ""} {displayItem?.pmEventId ? `· 事件 ${displayItem.pmEventId}` : ""}
                          </div>
                        </div>
                        {selectedPlayPinned && String(selectedMerchantPlayId || "") === String(displayItem.merchantPlayId || "") ? (
                          <div className="pm-board-card-pin">已置顶</div>
                        ) : null}
                        <div className={`pm-board-status ${closedMarket ? "closed" : ""}`}>
                          {formatStatusLabel(displayItem.status || "ACTIVE")}
                        </div>
                      </div>
                      <div className="pm-board-rows">
                        {rows.slice(0, 4).map((row) => {
                          const selectedOutcome =
                            String(selectedMerchantPlayId || "") === String(displayItem.merchantPlayId || "") && Number(row.outcomeIndex) === Number(selectedTradeRow?.outcomeIndex);
                          return (
                            <button
                              type="button"
                              className={selectedOutcome ? "pm-board-row is-selected" : "pm-board-row"}
                              key={row.key}
                              onClick={(e) => handleTradeOutcomeClick(e, displayItem.pmMarketId, displayItem.merchantPlayId, row.outcomeIndex)}
                              disabled={closedMarket}
                            >
                              <div className="pm-board-row-main">
                                <div className="pm-board-row-name">{translateDynamicText(row.label)}</div>
                                <div className="pm-board-row-sub">{formatOutcomeLabel(row.rawLabel)}</div>
                              </div>
                              <div className="pm-board-row-price">{closedMarket ? "-" : formatCentPrice(row.price)}</div>
                              <div className="pm-board-row-prob">{closedMarket ? "-" : formatProbability(row.price)}</div>
                            </button>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
              </section>
            ) : (
              <div className="pm-empty">当前没有可展示的数据。</div>
            )}
            <div ref={marketLoadMoreRef} className="pm-board-scroll-sentinel" aria-hidden="true" />
          </div>
          <aside className="pm-trade-panel-wrap">
            {selectedMarket && selectedTradeRow ? (
              <section className="pm-trade-panel">
                <div className="pm-trade-panel-head">
                  <div className="pm-trade-tabs">
                    <button
                      type="button"
                      className={tradeSide === "BUY" ? "pm-trade-tab active" : "pm-trade-tab"}
                      onClick={() => setTradeSide("BUY")}
                    >
                      买入
                    </button>
                    <button
                      type="button"
                      className={tradeSide === "SELL" ? "pm-trade-tab active" : "pm-trade-tab"}
                      onClick={() => setTradeSide("SELL")}
                    >
                      卖出
                    </button>
                  </div>
                  <div className="pm-trade-market-tag">盘口</div>
                </div>
                <div className="pm-trade-title">{getCardTitle(selectedMarket)}</div>
                <div className="pm-trade-detail-entry">
                  <button
                    type="button"
                    className={selectedPlayPinned ? "pm-trade-pin-btn active" : "pm-trade-pin-btn"}
                    onClick={handleTogglePlayPin}
                    disabled={pinSubmitting}
                  >
                    {pinSubmitting ? "处理中..." : selectedPlayPinned ? "取消置顶" : "置顶玩法"}
                  </button>
                  <button
                    type="button"
                    className="pm-trade-detail-btn"
                    onClick={() => setDetailOpen(true)}
                  >
                    查看详情
                  </button>
                </div>
                <div className="pm-trade-options">
                  {selectedMarketRows.map((row) => {
                    const active = Number(row.outcomeIndex) === Number(selectedTradeRow.outcomeIndex);
                    return (
                      <button
                        key={`trade-${row.key}`}
                        type="button"
                        className={active ? "pm-trade-option active" : "pm-trade-option"}
                        onClick={() => setTradeOutcomeIndex(row.outcomeIndex)}
                      >
                        <span>{formatOutcomeLabel(row.rawLabel)}</span>
                        <strong>{formatCentPrice(extractOutcomeQuote(selectedMarket, row.outcomeIndex, tradeSide))}</strong>
                      </button>
                    );
                  })}
                </div>
                <div className="pm-trade-amount-wrap">
                  <div className="pm-trade-amount-head">
                    <div className="pm-trade-label">金额</div>
                    <div className="pm-trade-amount">${tradeAmountNumber > 0 ? tradeAmountNumber.toFixed(0) : "0"}</div>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={tradeAmount}
                    onChange={(e) => setTradeAmount(e.target.value)}
                    className="pm-trade-input"
                    placeholder="输入金额"
                  />
                  <div className="pm-trade-quick-actions">
                    {[1, 5, 10, 100].map((value) => (
                      <button key={value} type="button" className="pm-trade-quick-btn" onClick={() => setTradeAmount(String(Math.max(0, tradeAmountNumber) + value))}>
                        +${value}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="pm-trade-quick-btn"
                      onClick={() => setTradeAmount(String(tradeSide === "SELL" ? Math.max(0, Math.floor(maxClosableAmount)) : Math.max(0, Math.floor(availableBalance))))}
                    >
                      最大
                    </button>
                  </div>
                </div>
                <div className="pm-trade-summary">
                  <div>
                    <div className="pm-trade-summary-label">{tradeSide === "BUY" ? "赢取" : "卖出回收"}</div>
                    <div className="pm-trade-summary-sub">
                      当前价格 {formatCentPrice(currentTradePrice)} · {tradeSide === "BUY" ? `约 ${estimatedShares.toFixed(2)} 份` : `持仓 ${Number(marketPosition?.size || 0).toFixed(4)} 份`}
                    </div>
                  </div>
                  <div className="pm-trade-summary-value">
                    ${tradeSide === "BUY" ? potentialReturn.toFixed(2) : tradeAmountNumber.toFixed(2)}
                  </div>
                </div>
                <div className="pm-trade-play-orders">
                  <div className="pm-trade-play-orders-head">
                    <span>当前玩法订单</span>
                    <strong>{selectedPlayOrdersLoading ? "加载中..." : `${selectedPlayOrders.length} 笔`}</strong>
                  </div>
                  {selectedPlayOrders.length > 0 ? (
                    <div className="pm-trade-play-orders-list">
                      {selectedPlayOrders.slice(0, 3).map((order) => (
                        <div className="pm-trade-play-order-row" key={order.orderNo || order.id}>
                          <span>{formatOutcomeLabel(order.selectionName || order.selectionCode || "-")}</span>
                          <span>{order.orderAmount || 0} {order.currency || "USDC"}</span>
                          <span>{formatStatusLabel(order.settleStatus || order.orderStatus || "OPEN")}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="pm-trade-play-orders-empty">当前玩法暂无未结算订单</div>
                  )}
                </div>
                {tradeSide === "SELL" ? (
                  <div className="pm-trade-position-note">
                    持仓均价 {formatCentPrice(marketPosition?.avgEntryPrice)} · 浮盈 {marketPosition?.unrealizedPnL != null ? `$${Number(marketPosition.unrealizedPnL).toFixed(2)}` : "$0.00"}
                  </div>
                ) : (
                  <div className="pm-trade-position-note">
                    买入按当前实时赔率成交，提交后会立即按最新价格写入订单。
                  </div>
                )}
                <button
                  type="button"
                  className="pm-trade-submit"
                  onClick={handleOrderSubmit}
                  disabled={
                    orderSubmitting ||
                    currentTradePrice <= 0 ||
                    tradeAmountNumber <= 0 ||
                    (tradeSide === "BUY" && tradeAmountNumber > availableBalance) ||
                    (tradeSide === "SELL" && (!marketPosition?.size || maxClosableAmount <= 0 || tradeAmountNumber > maxClosableAmount))
                  }
                >
                  {orderSubmitting ? "提交中..." : "交易"}
                </button>
                <div className="pm-trade-footnote">交易即表示你同意使用条款。</div>
              </section>
            ) : (
              <section className="pm-trade-panel pm-trade-panel-empty">
                <div className="pm-trade-empty-title">选择一个市场开始交易</div>
                <div className="pm-trade-empty-text">左侧点击任意市场选项后，右侧会按实时 WS 价格展示买入/卖出面板。</div>
              </section>
            )}
          </aside>
        </section>
      ) : null}

      {!loading && !error && activeTab !== "markets" && filteredCurrentList.length > 0 ? (
        <section className="pm-board-grid">
          {filteredCurrentList.map((item, index) => {
            if (activeTab === "orders" || activeTab === "openOrders") {
              const isTigerPosition = activeTab === "orders";
              const draftKey = getOrderDraftKey(item);
              const currentPrice = Number(item.currentPrice || 0);
              const remainingSize = getRemainingOrderSize(item);
              const maxSellAmount = currentPrice > 0 ? remainingSize * currentPrice : 0;
              const sellDraft = orderSellDrafts[draftKey] ?? "";
              const sellMode = orderSellModes[draftKey] === "amount" ? "amount" : "size";
              const canManualClose = !!item.canManualClose && currentPrice > 0 && remainingSize > 0;
              return (
                <article className="pm-board-card" key={item.orderNo || item.id || index}>
                  <div className="pm-board-card-top">
                    <div className="pm-board-card-title-wrap">
                      <h3 className="pm-board-card-title">{getCardTitle(item)}</h3>
                      {getCardSubtitle(item) ? (
                        <div className="pm-board-card-subtitle">{getCardSubtitle(item)}</div>
                      ) : null}
                      <div className="pm-board-card-meta">
                        {isTigerPosition ? "Tiger 持仓" : "本地订单"} · {formatBeijingTime(item.createdAt)} · {formatStatusLabel(item.settleStatus || "OPEN")}
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
                      <span>下单价格</span>
                      <strong>{item.orderPrice ? formatCentPrice(item.orderPrice) : "-"}</strong>
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
                      <span>数据源</span>
                      <strong>{isTigerPosition ? "Tiger Position" : "Local Order"}</strong>
                    </div>
                    <div className="pm-board-order-cell">
                      <span>{String(item.settleStatus || "").toUpperCase() === "SETTLED" || String(item.settleStatus || "").toUpperCase() === "WIN" || String(item.settleStatus || "").toUpperCase() === "LOSE" ? "结算时间" : "预计结算"}</span>
                      <strong>{formatSettlementDateLabel(item)}</strong>
                    </div>
                    <div className="pm-board-order-cell">
                      <span>结算盈亏</span>
                      <strong>{item.settlePnl != null ? `${item.settlePnl > 0 ? "+" : ""}${item.settlePnl}` : "-"}</strong>
                    </div>
                    <div className="pm-board-order-cell">
                      <span>剩余份额</span>
                      <strong>{remainingSize > 0 ? remainingSize.toFixed(4) : "-"}</strong>
                    </div>
                    <div className="pm-board-order-cell">
                      <span>当前卖价</span>
                      <strong>{formatSellQuote(currentPrice)}</strong>
                    </div>
                    <div className="pm-board-order-cell">
                      <span>卖出价格</span>
                      <strong>{item.sellPrice ? formatSellQuote(Number(item.sellPrice || 0)) : "-"}</strong>
                    </div>
                  </div>
                  {canManualClose ? (
                    <div className="pm-order-sell-box">
                      <div className="pm-order-sell-meta">
                        <div>
                          {currentPrice > 0
                            ? (sellMode === "amount"
                              ? `最多可卖 ${maxSellAmount.toFixed(2)} ${item.currency || "USDC"}`
                              : `最多可卖 ${remainingSize.toFixed(4)} 份`)
                            : "当前暂无买盘，暂时不能卖出"}
                        </div>
                        <div>均价 {item.orderPrice ? formatCentPrice(item.orderPrice) : "-"} · 公式：卖出盈亏 = 卖出份额 × (卖价 - 买价)</div>
                      </div>
                      <div className="pm-order-sell-mode">
                        <button
                          type="button"
                          className={sellMode === "size" ? "pm-order-sell-mode-btn active" : "pm-order-sell-mode-btn"}
                          onClick={() => handleOrderSellModeChange(draftKey, "size")}
                        >
                          按份额
                        </button>
                        <button
                          type="button"
                          className={sellMode === "amount" ? "pm-order-sell-mode-btn active" : "pm-order-sell-mode-btn"}
                          onClick={() => handleOrderSellModeChange(draftKey, "amount")}
                        >
                          按USDT
                        </button>
                      </div>
                      <div className="pm-order-sell-actions">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          className="pm-order-sell-input"
                          value={sellDraft}
                          onChange={(e) => handleOrderSellDraftChange(draftKey, e.target.value)}
                          placeholder={currentPrice > 0 ? (sellMode === "amount" ? "输入卖出金额" : "输入卖出份额") : "暂无买盘"}
                          disabled={currentPrice <= 0}
                        />
                        <button
                          type="button"
                          className="pm-order-sell-ghost"
                          onClick={() => handleOrderSellDraftChange(
                            draftKey,
                            sellMode === "amount"
                              ? (maxSellAmount > 0 ? maxSellAmount.toFixed(8) : "")
                              : (remainingSize > 0 ? remainingSize.toFixed(8) : "")
                          )}
                          disabled={currentPrice <= 0}
                        >
                          最大
                        </button>
                        <button
                          type="button"
                          className="pm-order-sell-btn"
                          disabled={orderSubmitting || currentPrice <= 0 || !(Number(sellDraft) > 0)}
                          onClick={() => handleOrderSell(item)}
                        >
                          {orderSubmitting ? "卖出中..." : "卖出"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            }

            if (activeTab === "results") {
              return (
                <article className="pm-board-card" key={item.orderNo || item.id || index}>
                  <div className="pm-board-card-top">
                    <div className="pm-board-card-title-wrap">
                      <h3 className="pm-board-card-title">{getCardTitle(item)}</h3>
                      {getCardSubtitle(item) ? (
                        <div className="pm-board-card-subtitle">{getCardSubtitle(item)}</div>
                      ) : null}
                      <div className="pm-board-card-meta">
                        本地订单 · 北京时间 {formatBeijingTime(item.createdAt)}
                      </div>
                    </div>
                    <div className="pm-board-status">
                      {formatStatusLabel(item.settleStatus || item.orderStatus || "-")}
                    </div>
                  </div>
                  <div className="pm-board-order-grid">
                    <div className="pm-board-order-cell">
                      <span>订单号</span>
                      <strong>{item.orderNo || "-"}</strong>
                    </div>
                    <div className="pm-board-order-cell">
                      <span>玩法</span>
                      <strong>{formatOutcomeLabel(item.selectionName || item.selectionCode || "-")}</strong>
                    </div>
                    <div className="pm-board-order-cell">
                      <span>订单金额</span>
                      <strong>{item.orderAmount || 0} {item.currency || "USDT"}</strong>
                    </div>
                    <div className="pm-board-order-cell">
                      <span>结算盈亏</span>
                      <strong>{item.settlePnl != null ? `${item.settlePnl > 0 ? "+" : ""}${item.settlePnl}` : "-"}</strong>
                    </div>
                    <div className="pm-board-order-cell">
                      <span>下单价格</span>
                      <strong>{item.orderPrice ? formatCentPrice(item.orderPrice) : "-"}</strong>
                    </div>
                    <div className="pm-board-order-cell">
                      <span>卖出价格</span>
                      <strong>{item.sellPrice ? formatSellQuote(item.sellPrice) : "-"}</strong>
                    </div>
                    <div className="pm-board-order-cell">
                      <span>状态</span>
                      <strong>{formatStatusLabel(item.settleStatus || item.orderStatus || "-")}</strong>
                    </div>
                    <div className="pm-board-order-cell">
                      <span>结算结果</span>
                      <strong>{formatOutcomeLabel(item.resolvedOutcome || "-")}</strong>
                    </div>
                  </div>
                </article>
              );
            }
            const rows = getOutcomeRows(item);
            const cardMeta = getCardMeta(item);
            return (
              <article className="pm-board-card closed" key={item.pmMarketId || item.id || index}>
                <div className="pm-board-card-top">
                  <div className="pm-board-card-title-wrap">
                    <div className="pm-board-card-title-row">
                      {getMarketImage(item) ? (
                        <img
                          src={getMarketImage(item)}
                          alt=""
                          className="pm-board-card-avatar"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : null}
                      <h3 className="pm-board-card-title">{getCardTitle(item)}</h3>
                    </div>
                    <div className="pm-board-card-meta">
                      {cardMeta.volumeLabel ? `交易额 ${cardMeta.volumeLabel}` : "交易额 -"} {cardMeta.dateLabel ? `· ${cardMeta.dateLabel}` : ""} {item?.pmEventId ? `· 事件 ${item.pmEventId}` : ""}
                    </div>
                  </div>
                  <div className="pm-board-status closed">{formatStatusLabel(item.status || "CLOSED")}</div>
                </div>
                <div className="pm-board-rows">
                  {rows.slice(0, 4).map((row) => (
                    <div className="pm-board-row closed" key={row.key}>
                      <div className="pm-board-row-main">
                        <div className="pm-board-row-name">{translateDynamicText(row.label)}</div>
                        <div className="pm-board-row-sub">{formatOutcomeLabel(row.rawLabel)}</div>
                      </div>
                      <div className="pm-board-row-price">{formatCentPrice(row.price)}</div>
                      <div className="pm-board-row-prob">{formatProbability(row.price)}</div>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      {!loading && !error && activeTab !== "markets" && filteredCurrentList.length === 0 ? (
        <div className="pm-empty">
          {activeTab === "orders"
            ? (positionsLoading ? "加载 Tiger 持仓中..." : "暂无 Tiger 持仓")
            : activeTab === "openOrders"
              ? (localOrdersLoading ? "加载当前委托中..." : "暂无当前委托")
              : activeTab === "results"
                ? (resultsLoading ? "加载历史委托中..." : "暂无历史委托")
                : "当前没有可展示的数据。"}
        </div>
      ) : null}

      {!loading && !error && (
        <div className="pm-board-pagination">
          {(activeTab === "orders" && positionsHasMore)
            || (activeTab === "openOrders" && localOrdersHasMore)
            || (activeTab === "results" && resultsHasMore) ? (
            <button
              type="button"
              className="pm-board-load-more"
              onClick={handleLoadMore}
              disabled={loadingMoreMarkets || positionsLoading || localOrdersLoading || resultsLoading}
            >
              {loadingMoreMarkets || positionsLoading || localOrdersLoading || resultsLoading ? "加载中..." : "加载更多"}
            </button>
          ) : null}
        </div>
      )}

      {detailOpen && selectedMarket ? (
        <div className="pm-detail-overlay" onClick={() => setDetailOpen(false)}>
          <section className="pm-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pm-detail-head">
              <div>
                <div className="pm-detail-kicker">市场详情</div>
                <h3 className="pm-detail-title">{getCardTitle(selectedMarket)}</h3>
                <div className="pm-detail-meta">
                  市场 {selectedMarket.pmMarketId || "-"} · 事件 {selectedMarket.pmEventId || "-"}
                </div>
              </div>
              <button type="button" className="pm-detail-close" onClick={() => setDetailOpen(false)}>关闭</button>
            </div>
            <div className="pm-detail-langs">
              {DETAIL_LANGUAGES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={detailLang === item.key ? "pm-detail-lang active" : "pm-detail-lang"}
                  onClick={() => setDetailLang(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="pm-detail-block">
              <div className="pm-detail-label">标题</div>
              <div className="pm-detail-text">
                {detailLoading ? "翻译加载中..." : (detailTranslation?.question || selectedMarket.question || "-")}
              </div>
            </div>
            <div className="pm-detail-block">
              <div className="pm-detail-label">描述</div>
              <div className="pm-detail-text">
                {detailLoading ? "翻译加载中..." : (detailTranslation?.description || selectedMarket.description || "暂无描述")}
              </div>
            </div>
            <div className="pm-detail-block">
              <div className="pm-detail-label">选项</div>
              <div className="pm-detail-text">
                {detailLoading ? "翻译加载中..." : (() => {
                  try {
                    const raw = detailTranslation?.outcomesJson || selectedMarket.outcomesJson || "[]";
                    const rows = typeof raw === "string" ? JSON.parse(raw) : raw;
                    return Array.isArray(rows) && rows.length > 0 ? rows.join(" / ") : "暂无选项";
                  } catch {
                    return detailTranslation?.outcomesJson || selectedMarket.outcomesJson || "暂无选项";
                  }
                })()}
              </div>
            </div>
            <div className="pm-detail-foot">
              {detailTranslation?.translated ? `当前展示 ${detailLang} 翻译内容` : `当前无 ${detailLang} 翻译，已回退原文`}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

export default PolymarketApp;
