const DEFAULT_BACKEND_ORIGIN = "http://localhost:8000";

const getBrowserOrigin = () => {
  if (typeof window === "undefined") return DEFAULT_BACKEND_ORIGIN;
  const { protocol, hostname, port } = window.location;
  return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
};

export const normalizeBackendUrl = (rawValue) => {
  if (!rawValue || typeof rawValue !== "string") {
    return getBrowserOrigin();
  }

  const value = rawValue.trim();
  if (!value) return getBrowserOrigin();

  try {
    const url = new URL(value);
    if (!url.protocol || !url.host) {
      throw new Error("Backend URL is missing protocol or host");
    }
    return `${url.protocol}//${url.host}`.replace(/\/$/, "");
  } catch (error) {
    console.warn("REACT_APP_BACKEND_URL is invalid; falling back to current browser origin.", {
      rawValue,
      error: error?.message || String(error),
    });
    return getBrowserOrigin();
  }
};

export const BACKEND_URL = normalizeBackendUrl(process.env.REACT_APP_BACKEND_URL);
export const API_BASE = `${BACKEND_URL}/api`;

export const getBackendApiBase = () => API_BASE;
