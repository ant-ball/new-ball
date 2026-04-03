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

export async function fetchPolymarketEvents(baseUrl) {
  const { url, json } = await requestJson(baseUrl, "/polymarket/events?offset=0&limit=100");
  return { url, data: unwrapData(json) || [] };
}

export async function fetchPolymarketMarkets(baseUrl, pmEventId) {
  const suffix = pmEventId ? `&pmEventId=${encodeURIComponent(pmEventId)}` : "";
  const { url, json } = await requestJson(baseUrl, `/polymarket/markets?offset=0&limit=100${suffix}`);
  return { url, data: unwrapData(json) || [] };
}

export async function fetchPolymarketPlays(baseUrl, pmEventId) {
  const suffix = pmEventId ? `&pmEventId=${encodeURIComponent(pmEventId)}` : "";
  const { url, json } = await requestJson(baseUrl, `/polymarket/plays?offset=0&limit=100${suffix}`);
  return { url, data: unwrapData(json) || [] };
}

export async function fetchPolymarketPrices(baseUrl) {
  const { url, json } = await requestJson(baseUrl, "/polymarket/prices?offset=0&limit=100");
  return { url, data: unwrapData(json) || [] };
}

export async function fetchPolymarketResults(baseUrl) {
  const { url, json } = await requestJson(baseUrl, "/polymarket/results?offset=0&limit=100");
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

