import config from "../config.js";
import { getCached, setCached, isCacheValid } from "../cache.js";

const BASE = "https://open.feishu.cn/open-apis";

// Feishu token 缓存
let tokenCache = { token: null, expiresAt: 0 };

async function getTenantAccessToken() {
  // 检查缓存的 token 是否有效（预留 5 分钟 buffer）
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 5 * 60 * 1000) {
    console.log("[calendar] Using cached Feishu token");
    return tokenCache.token;
  }

  const { feishuAppId, feishuAppSecret } = config.apiKeys;
  if (!feishuAppId || !feishuAppSecret) {
    throw new Error("Feishu API credentials not configured");
  }

  console.log("[calendar] Fetching new Feishu token");
  const res = await fetch(`${BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: feishuAppId, app_secret: feishuAppSecret }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Feishu auth error: ${data.msg}`);

  // 缓存 token，使用 API 返回的 expire 时间
  const expireMs = (data.expire || 7200) * 1000;
  tokenCache = { token: data.tenant_access_token, expiresAt: Date.now() + expireMs };

  return data.tenant_access_token;
}

/**
 * 获取今日日历事件（使用缓存，TTL 15 分钟）
 * @param {boolean} forceRefresh - 强制刷新缓存
 */
export async function getTodayEvents(forceRefresh = false) {
  if (!forceRefresh && isCacheValid("calendar")) {
    console.log("[calendar] Using cached calendar data");
    return getCached("calendar");
  }

  try {
    const { feishuAppId } = config.apiKeys;
    if (!feishuAppId) return [];

    console.log("[calendar] Fetching fresh calendar data");
    const token = await getTenantAccessToken();
    const today = new Date().toISOString().split("T")[0];

    const res = await fetch(
      `${BASE}/calendar/v4/calendars/primary/events?start_time=${today}T00:00:00&end_time=${today}T23:59:59`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) }
    );
    const data = await res.json();

    if (data.code !== 0) {
      console.warn(`Feishu calendar error: ${data.msg}`);
      return [];
    }

    const events = (data.data?.items || []).map((e) => ({
      title: e.summary || "(untitled)",
      startTime: e.start_time?.date_time || e.start_time?.date,
      endTime: e.end_time?.date_time || e.end_time?.date,
      location: e.location || "",
    }));

    setCached("calendar", events);
    return events;
  } catch (err) {
    console.warn(`Failed to fetch calendar events: ${err.message}`);
    return [];
  }
}

export default { getTodayEvents };
