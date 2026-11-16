import axios from "axios";
import { toast } from "sonner";

// Shared API client. Interceptors are installed on this instance and on the
// global axios default so legacy `axios.get(...)` callers get the same policy.
const SESSION_TOKEN_KEY = "aegis_session_token";
const OFFLINE_SESSION_KEY = "aegis_offline_workspace_v1";
const FORBIDDEN_MESSAGE = "Access restricted to Supervisor / Management";
const NO_REFRESH = /\/auth\/(refresh|me|logout|login)/;

let refreshInFlight = null;
let refreshUrl = null;

export const configureRefresh = (url) => { refreshUrl = url; };

const clearSession = () => {
  try { localStorage.removeItem(SESSION_TOKEN_KEY); localStorage.removeItem(OFFLINE_SESSION_KEY); } catch { /* storage unavailable */ }
};

export const isNetworkError = (error) => !!error && !error.response && !axios.isCancel?.(error);

// Silent refresh: only when a refresh endpoint is configured and answers with a new token.
export async function trySilentRefresh(http = axios) {
  if (!refreshUrl) return false;
  if (!refreshInFlight) {
    refreshInFlight = http.post(refreshUrl, {}, { withCredentials: true, _skipAuthHandling: true })
      .then((res) => {
        const token = res?.data?.session_token || res?.data?.access_token;
        if (token) { try { localStorage.setItem(SESSION_TOKEN_KEY, token); } catch { /* ignore */ } }
        return true;
      })
      .catch(() => false)
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export const redirectToLogin = () => {
  if (typeof window !== "undefined" && window.location.pathname !== "/login") window.location.assign("/login");
};

export function installInterceptors(instance) {
  if (!instance?.interceptors?.response || instance.__aegisInstalled) return instance;
  instance.__aegisInstalled = true;
  instance.interceptors.response.use((r) => r, async (error) => {
    const status = error?.response?.status;
    const config = error?.config || {};
    if (!status || config._skipAuthHandling) return Promise.reject(error); // network drops never touch auth
    if (status === 403) {
      toast.error(FORBIDDEN_MESSAGE, { id: "rbac-403" });
    } else if (status === 401 && !NO_REFRESH.test(String(config.url || ""))) {
      if (!config._retried && await trySilentRefresh(instance)) {
        config._retried = true;
        return instance.request(config);
      }
      if (refreshUrl) { clearSession(); redirectToLogin(); }
    }
    return Promise.reject(error);
  });
  return instance;
}

// Drop the JSON content type for FormData so the browser sets the multipart boundary.
export const formDataSafe = (config) => {
  if (typeof FormData !== "undefined" && config?.data instanceof FormData && config.headers) {
    if (typeof config.headers.delete === "function") config.headers.delete("Content-Type");
    else delete config.headers["Content-Type"];
  }
  return config;
};

export const api = (typeof axios.create === "function" ? axios.create({ withCredentials: true }) : axios);
[...new Set([api, axios])].forEach((inst) => {
  inst.interceptors?.request?.use(formDataSafe);
  installInterceptors(inst);
});

export default api;
