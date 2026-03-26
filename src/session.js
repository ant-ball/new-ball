export const BALL_TOKEN_KEY = "ball_token";

export function getUrlToken() {
  const params = new URLSearchParams(window.location.search);
  return params.get("token") || params.get("authToken") || "";
}

export function getExternalToken() {
  return getUrlToken();
}

export function persistExternalToken(token) {
  return token;
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
