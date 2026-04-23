import { buildAuthHeaders } from "./auth";

const DEFAULT_BASE_URL = "https://ball.skybit.shop";

function normalizeBaseUrl(baseUrl) {
  return (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
}

async function requestJson(baseUrl, path, options = {}) {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`;
  const response = await fetch(url, {
    ...options,
    credentials: "omit",
    headers: {
      ...buildAuthHeaders(),
      ...(options.headers || {}),
    },
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json?.msg || json?.message || `${path} 失败 HTTP ${response.status}`);
  }
  return { url, response, json };
}

function unwrapData(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object") return json;
  if (json.data !== undefined) return json.data;
  return json;
}

function unwrapPageRows(json) {
  const payload = unwrapData(json);
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.list)) return payload.list;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

function unwrapPageMeta(json) {
  const payload = unwrapData(json);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { page: 1, size: 0, total: 0 };
  }
  const pageRequest = payload.pageRequest && typeof payload.pageRequest === "object" ? payload.pageRequest : {};
  return {
    page: Number(payload.page ?? pageRequest.page ?? 1) || 1,
    size: Number(payload.size ?? payload.limit ?? pageRequest.size ?? 0) || 0,
    total: Number(payload.total ?? 0) || 0,
  };
}

export async function fetchPolymarketCategories(baseUrl) {
  const { url, json } = await requestJson(baseUrl, "/polymarket/categories?page=1&size=50");
  return { url, data: unwrapPageRows(json), meta: unwrapPageMeta(json) };
}

export async function fetchPolymarketEvents(baseUrl, category, page = 1, size = 20) {
  const suffix = category ? `&category=${encodeURIComponent(category)}` : "";
  const { url, json } = await requestJson(baseUrl, `/polymarket/events?page=${page}&size=${size}${suffix}`);
  return { url, data: unwrapPageRows(json), meta: unwrapPageMeta(json) };
}

export async function fetchPolymarketMarkets(baseUrl, { pmEventId = "", category = "", page = 1, size = 20, keyword = "" } = {}) {
  const suffix = `${pmEventId ? `&pmEventId=${encodeURIComponent(pmEventId)}` : ""}${category ? `&category=${encodeURIComponent(category)}` : ""}${keyword ? `&keyword=${encodeURIComponent(keyword)}` : ""}`;
  const { url, json } = await requestJson(baseUrl, `/polymarket/markets?page=${page}&size=${size}${suffix}`);
  return { url, data: unwrapPageRows(json), meta: unwrapPageMeta(json) };
}

export async function fetchPolymarketPlays(baseUrl, pmEventId, page = 1, size = 20, pmMarketId = null) {
  const eventSuffix = pmEventId ? `&pmEventId=${encodeURIComponent(pmEventId)}` : "";
  const marketSuffix = pmMarketId ? `&pmMarketId=${encodeURIComponent(pmMarketId)}` : "";
  const { url, json } = await requestJson(baseUrl, `/polymarket/plays?page=${page}&size=${size}${eventSuffix}${marketSuffix}`);
  return { url, data: unwrapPageRows(json), meta: unwrapPageMeta(json) };
}

export async function fetchPolymarketPrices(baseUrl, page = 1, size = 20) {
  let query = `/polymarket/prices?page=${page}&size=${size}`;
  if (typeof page === "object" && page !== null) {
    const options = page;
    const nextPage = Number(options.page ?? 1);
    const nextSize = Number(options.size ?? 20);
    query = `/polymarket/prices?page=${nextPage}&size=${nextSize}`;
    if (options.pmMarketId) {
      query += `&pmMarketId=${encodeURIComponent(options.pmMarketId)}`;
    }
    if (Array.isArray(options.pmMarketIds) && options.pmMarketIds.length > 0) {
      query += `&pmMarketIds=${encodeURIComponent(options.pmMarketIds.join(","))}`;
    }
  }
  const { url, json } = await requestJson(baseUrl, query);
  return { url, data: unwrapPageRows(json), meta: unwrapPageMeta(json) };
}

export async function fetchPolymarketGraph(baseUrl, pmMarketId, range = "1h") {
  const { url, json } = await requestJson(
    baseUrl,
    `/polymarket/graph?pmMarketId=${encodeURIComponent(pmMarketId)}&range=${encodeURIComponent(range)}`
  );
  return { url, data: unwrapData(json) || {} };
}

export async function syncPolymarketPrice(baseUrl, pmMarketId) {
  const { url, json } = await requestJson(baseUrl, `/polymarket/sync/prices?pmMarketId=${encodeURIComponent(pmMarketId)}`, {
    method: "POST",
  });
  return { url, data: unwrapData(json) || json };
}

export async function fetchPolymarketResults(baseUrl, page = 1, size = 20) {
  const { url, json } = await requestJson(baseUrl, `/polymarket/results?page=${page}&size=${size}`);
  return { url, data: unwrapPageRows(json), meta: unwrapPageMeta(json) };
}

export async function syncPolymarketEvents(baseUrl) {
  const { url, json } = await requestJson(baseUrl, "/polymarket/sync/events?offset=0&limit=200", {
    method: "POST",
  });
  return { url, data: unwrapData(json) || json };
}

export async function syncPolymarketMarkets(baseUrl, pmEventId = "") {
  const suffix = pmEventId ? `?pmEventId=${encodeURIComponent(pmEventId)}` : "?offset=0&limit=200";
  const { url, json } = await requestJson(baseUrl, `/polymarket/sync/markets${suffix}`, {
    method: "POST",
  });
  return { url, data: unwrapData(json) || json };
}

export async function syncPolymarketPlays(baseUrl) {
  const { url, json } = await requestJson(baseUrl, "/polymarket/sync/plays?offset=0&limit=200", {
    method: "POST",
  });
  return { url, data: unwrapData(json) || json };
}

export async function createPolymarketOrder(baseUrl, orderData) {
  const { url, json } = await requestJson(baseUrl, "/polymarket/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(orderData),
  });
  return { url, data: unwrapData(json) || json };
}

export async function fetchPolymarketMarketPosition(baseUrl, pmMarketId, selectionCode = "") {
  const query = selectionCode
    ? `/polymarket/market-position?pmMarketId=${encodeURIComponent(pmMarketId)}&selectionCode=${encodeURIComponent(selectionCode)}`
    : `/polymarket/market-position?pmMarketId=${encodeURIComponent(pmMarketId)}`;
  const { url, json } = await requestJson(baseUrl, query);
  return { url, data: unwrapData(json) || null };
}

export async function fetchPolymarketMarketTranslation(baseUrl, pmMarketId, lang = "zh-CN") {
  const query = `/polymarket/market-translation?pmMarketId=${encodeURIComponent(pmMarketId)}&lang=${encodeURIComponent(lang)}`;
  const { url, json } = await requestJson(baseUrl, query);
  return { url, data: unwrapData(json) || null };
}

export async function closePolymarketPosition(baseUrl, payload) {
  const { url, json } = await requestJson(baseUrl, "/polymarket/close-position", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { url, data: unwrapData(json) || json };
}

export async function fetchPolymarketOrders(baseUrl, page = 1, size = 50) {
  const { url, json } = await requestJson(baseUrl, `/polymarket/orders?page=${page}&size=${size}`);
  return { url, data: unwrapPageRows(json), meta: unwrapPageMeta(json) };
}
