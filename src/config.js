export const BALL_API_ORIGIN = "https://ball-stack.skybit.shop";

export function getBallApiBaseUrl() {
  const configuredBaseUrl = process.env.REACT_APP_BALL_API_BASE_URL;
  if (configuredBaseUrl) return configuredBaseUrl.replace(/\/$/, "");

  if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
    return window.location.origin;
  }

  return BALL_API_ORIGIN;
}
