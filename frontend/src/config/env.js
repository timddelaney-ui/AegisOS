const getBrowserOrigin = () => {
  if (typeof window === 'undefined') return "http://localhost:3000";
  const { protocol, hostname, port } = window.location;
  return `${protocol}//${hostname}${port ? `:${port}` : ""}`;
};

const normalizeBackendUrl = (rawValue) => {
  if (!rawValue || typeof rawValue !== 'string') return getBrowserOrigin();
  const value = rawValue.trim();
  if (!value) return getBrowserOrigin();

  try {
    const url = new URL(value);
    if (!url.protocol || !url.host) throw new Error("Invalid backend URL");
    return `${url.protocol}//${url.host}`.replace(/\/$/, "");
  } catch {
    console.warn("REACT_APP_BACKEND_URL is not a valid absolute URL. Falling back to browser origin.", { value });
    return getBrowserOrigin();
  }
};

export const BACKEND_URL = normalizeBackendUrl(process.env.REACT_APP_BACKEND_URL);
export const API = `${BACKEND_URL}/api`;

export const getApiBaseUrl = () => BACKEND_URL;
