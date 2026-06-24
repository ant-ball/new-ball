import { clearBallToken, getBallToken, getUrlToken, persistBallToken } from "./session";
import { getBallApiBaseUrl } from "./config";

export function getStoredBallToken() {
  try {
    return getBallToken();
  } catch {
    return "";
  }
}

export function setStoredBallToken(token) {
  try {
    if (token) persistBallToken(token);
    else clearBallToken();
  } catch {
    // ignore
  }
}

export function getExternalTokenFromUrl() {
  try {
    return getUrlToken();
  } catch {
    return "";
  }
}

export function buildAuthHeaders(extra = {}) {
  const token = getStoredBallToken();
  return {
    ...(token ? { Authorization: token } : {}),
    ...extra,
  };
}

async function parseJsonResponse(res, requestName) {
  const text = await res.text();

  if (!text) {
    if (!res.ok) {
      throw new Error(`${requestName} 服务暂时不可用（HTTP ${res.status}）`);
    }
    throw new Error(`${requestName} 返回空响应`);
  }

  try {
    return JSON.parse(text);
  } catch {
    if (!res.ok) {
      throw new Error(`${requestName} 服务暂时不可用（HTTP ${res.status}）`);
    }
    throw new Error(`${requestName} 返回格式异常（HTTP ${res.status}）`);
  }
}

export async function tokenLogin(baseUrl, externalToken) {
  if (!externalToken) throw new Error("缺少外部 token");
  const url = `${(baseUrl || getBallApiBaseUrl()).replace(/\/$/, "")}/user/token-login`;
  const params = new URLSearchParams();
  params.append("token", externalToken);
  const res = await fetch(url, {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const json = await parseJsonResponse(res, "token-login");
  if (!res.ok || json?.code !== 0 || !json?.data) {
    throw new Error(json?.msg || json?.message || `token-login 失败 HTTP ${res.status}`);
  }
  setStoredBallToken(json.data);
  return json?.data;
}

export async function fetchUserInfo(baseUrl) {
  const url = `${(baseUrl || getBallApiBaseUrl()).replace(/\/$/, "")}/user/info`;
  const res = await fetch(url, { credentials: "omit", headers: buildAuthHeaders() });
  const json = await parseJsonResponse(res, "user/info");
  if (!res.ok || json?.code !== 0) {
    throw new Error(json?.msg || json?.message || `user/info 失败 HTTP ${res.status}`);
  }
  return json?.data || null;
}

export async function fetchUserBalance(baseUrl) {
  const url = `${(baseUrl || getBallApiBaseUrl()).replace(/\/$/, "")}/user/balance`;
  const res = await fetch(url, { credentials: "omit", headers: buildAuthHeaders() });
  const json = await parseJsonResponse(res, "user/balance");
  if (!res.ok || json?.code !== 0) {
    throw new Error(json?.msg || json?.message || `user/balance 失败 HTTP ${res.status}`);
  }
  return json?.data || null;
}
