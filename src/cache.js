// 统一缓存管理模块
// 各缓存默认 TTL：
//   - weather: 10 分钟
//   - calendar: 15 分钟
//   - feishuToken: 使用服务端返回的 expire 时间（通常 2 小时）

const caches = {
  weather: { data: null, timestamp: 0, ttl: 10 * 60 * 1000 },
  calendar: { data: null, timestamp: 0, ttl: 15 * 60 * 1000 },
  feishuToken: { data: null, expiresAt: 0 },
};

/**
 * 获取缓存数据（如果有效）
 * @param {string} name - 缓存名称
 * @returns {any} 缓存的数据，或 null
 */
export function getCached(name) {
  const cache = caches[name];
  if (!cache) return null;

  if (name === "feishuToken") {
    if (cache.data && Date.now() < cache.expiresAt) {
      return cache.data;
    }
    return null;
  }

  if (cache.data && Date.now() - cache.timestamp < cache.ttl) {
    return cache.data;
  }
  return null;
}

/**
 * 设置缓存数据
 * @param {string} name - 缓存名称
 * @param {any} data - 要缓存的数据
 * @param {number} [ttl] - TTL（毫秒），仅 weather/calendar 使用
 */
export function setCached(name, data, ttl) {
  const cache = caches[name];
  if (!cache) return;

  cache.data = data;

  if (name === "feishuToken") {
    cache.expiresAt = Date.now() + (ttl || 2 * 60 * 60 * 1000); // 默认 2 小时
  } else {
    cache.timestamp = Date.now();
    if (ttl) cache.ttl = ttl;
  }
}

/**
 * 检查缓存是否有效
 * @param {string} name - 缓存名称
 * @returns {boolean}
 */
export function isCacheValid(name) {
  return getCached(name) !== null;
}

/**
 * 使缓存失效
 * @param {string} name - 缓存名称
 */
export function invalidateCache(name) {
  const cache = caches[name];
  if (cache) {
    cache.data = null;
    cache.timestamp = 0;
    if (name === "feishuToken") {
      cache.expiresAt = 0;
    }
  }
}

/**
 * 获取缓存时间戳（用于调试）
 * @param {string} name
 */
export function getCacheMeta(name) {
  const cache = caches[name];
  if (!cache) return null;
  return {
    hasData: cache.data !== null,
    age: cache.timestamp ? Date.now() - cache.timestamp : null,
    ttl: cache.ttl || null,
    expiresAt: cache.expiresAt || null,
  };
}

export default { getCached, setCached, isCacheValid, invalidateCache, getCacheMeta };