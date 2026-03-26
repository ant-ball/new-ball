const BALL_TOKEN_KEY = "ball_auth_token";

export function clearLegacyExternalTokenCookie() {
  try {
    document.cookie = "external_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  } catch {
    // ignore
  }
}

export function getStoredBallToken() {
  try {
    return localStorage.getItem(BALL_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setStoredBallToken(token) {
  try {
    if (token) localStorage.setItem(BALL_TOKEN_KEY, token);
    else localStorage.removeItem(BALL_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function getExternalTokenFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    return params.get("token") || "";
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

export async function tokenLogin(baseUrl, externalToken) {
  if (!externalToken) throw new Error("缺少外部 token");
  const url = `${(baseUrl || "https://ball.skybit.shop").replace(/\/$/, "")}/user/token-login`;
  const params = new URLSearchParams();
  params.append("token", externalToken);
  const res = await fetch(url, {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const json = await res.json();
  if (!res.ok || json?.code !== 0 || !json?.data) {
    throw new Error(json?.msg || json?.message || `token-login 失败 HTTP ${res.status}`);
  }
  setStoredBallToken(json.data);
  return json?.data;
}

export async function fetchUserInfo(baseUrl) {
  const url = `${(baseUrl || "https://ball.skybit.shop").replace(/\/$/, "")}/user/info`;
  const res = await fetch(url, { credentials: "omit", headers: buildAuthHeaders() });
  const json = await res.json();
  if (!res.ok || json?.code !== 0) {
    throw new Error(json?.msg || json?.message || `user/info 失败 HTTP ${res.status}`);
  }
  return json?.data || null;
}

export async function fetchUserBalance(baseUrl) {
  const url = `${(baseUrl || "https://ball.skybit.shop").replace(/\/$/, "")}/user/balance`;
  const res = await fetch(url, { credentials: "omit", headers: buildAuthHeaders() });
  const json = await res.json();
  if (!res.ok || json?.code !== 0) {
    throw new Error(json?.msg || json?.message || `user/balance 失败 HTTP ${res.status}`);
  }
  return json?.data || null;
}
