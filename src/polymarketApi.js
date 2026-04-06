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

export async function fetchPolymarketCategories(baseUrl) {
  const { url, json } = await requestJson(baseUrl, "/polymarket/categories");
  return { url, data: unwrapData(json) || [] };
}

export async function fetchPolymarketEvents(baseUrl, category, limit = 20, offset = 0) {
  const suffix = category ? `&category=${encodeURIComponent(category)}` : "";
  const { url, json } = await requestJson(baseUrl, `/polymarket/events?offset=${offset}&limit=${limit}${suffix}`);
  return { url, data: unwrapData(json) || [] };
}

export async function fetchPolymarketMarkets(baseUrl, pmEventId, category, limit = 20, offset = 0) {
  const suffix = `${pmEventId ? `&pmEventId=${encodeURIComponent(pmEventId)}` : ""}${category ? `&category=${encodeURIComponent(category)}` : ""}`;
  const { url, json } = await requestJson(baseUrl, `/polymarket/markets?offset=${offset}&limit=${limit}${suffix}`);
  return { url, data: unwrapData(json) || [] };
}

export async function fetchPolymarketPlays(baseUrl, pmEventId, limit = 20, offset = 0, pmMarketId = null) {
  const eventSuffix = pmEventId ? `&pmEventId=${encodeURIComponent(pmEventId)}` : "";
  const marketSuffix = pmMarketId ? `&pmMarketId=${encodeURIComponent(pmMarketId)}` : "";
  const { url, json } = await requestJson(baseUrl, `/polymarket/plays?offset=${offset}&limit=${limit}${eventSuffix}${marketSuffix}`);
  return { url, data: unwrapData(json) || [] };
}

export async function fetchPolymarketPrices(baseUrl, offset = 0, limit = 20) {
  const { url, json } = await requestJson(baseUrl, `/polymarket/prices?offset=${offset}&limit=${limit}`);
  return { url, data: unwrapData(json) || [] };
}

export async function fetchPolymarketResults(baseUrl, offset = 0, limit = 20) {
  const { url, json } = await requestJson(baseUrl, `/polymarket/results?offset=${offset}&limit=${limit}`);
  return { url, data: unwrapData(json) || [] };
}

export async function syncPolymarketEvents(baseUrl) {
  const { url, json } = await requestJson(baseUrl, "/polymarket/sync/events?offset=0&limit=200", {
    method: "POST",
  });
  return { url, data: unwrapData(json) || json };
}

export async function syncPolymarketMarkets(baseUrl) {
  const { url, json } = await requestJson(baseUrl, "/polymarket/sync/markets?offset=0&limit=200", {
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
