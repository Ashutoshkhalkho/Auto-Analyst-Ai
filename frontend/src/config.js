// Helper module to manage environment-driven API and WebSocket base URLs
const rawApiUrl = (import.meta.env.VITE_API_URL || '').trim();
const rawWsUrl = (import.meta.env.VITE_WS_URL || '').trim();

// Strip trailing slashes
export const API_BASE_URL = rawApiUrl ? rawApiUrl.replace(/\/+$/, '') : '';

/**
 * Returns the WebSocket URL for a given pipeline run_id.
 * Uses VITE_WS_URL if defined, otherwise derives from VITE_API_URL (http->ws, https->wss),
 * or falls back to relative host for Vite dev proxy.
 */
export const getWsUrl = (runId) => {
  if (rawWsUrl) {
    const base = rawWsUrl.replace(/\/+$/, '');
    return `${base}/ws/pipeline/${runId}`;
  }

  if (rawApiUrl) {
    const isHttps = rawApiUrl.startsWith('https:');
    const host = rawApiUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const wsProtocol = isHttps ? 'wss:' : 'ws:';
    return `${wsProtocol}//${host}/ws/pipeline/${runId}`;
  }

  // Local development fallback (Vite proxy handling relative route)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/pipeline/${runId}`;
};
