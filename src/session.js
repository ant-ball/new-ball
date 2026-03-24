export const EXTERNAL_TOKEN_COOKIE = "external_token";
export const BALL_TOKEN_KEY = "ball_token";

export function getUrlToken() {
  const params = new URLSearchParams(window.location.search);
  return params.get("token") || params.get("authToken") || "";
}

export function setCookie(name, value, days = 7) {
  if (!value) return;
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

export function getCookie(name) {
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix))
    ?.slice(prefix.length) || "";
}

export function getExternalToken() {
  return getUrlToken() || decodeURIComponent(getCookie(EXTERNAL_TOKEN_COOKIE) || "");
}

export function persistExternalToken(token) {
  if (!token) return;
  setCookie(EXTERNAL_TOKEN_COOKIE, token, 7);
}

export function persistBallToken(token) {
  if (!token) return;
  localStorage.setItem(BALL_TOKEN_KEY, token);
}

export function getBallToken() {
  return localStorage.getItem(BALL_TOKEN_KEY) || "";
}

export function clearBallToken() {
  localStorage.removeItem(BALL_TOKEN_KEY);
}
