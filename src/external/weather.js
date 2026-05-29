import config from "../config.js";
import { getCached, setCached, isCacheValid } from "../cache.js";

const BASE = "https://api.openweathermap.org/data/2.5";

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    throw new Error(`OpenWeather API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * 获取当前天气（使用缓存，TTL 10 分钟）
 * @param {string} city
 * @param {boolean} forceRefresh - 强制刷新缓存
 */
export async function getCurrentWeather(city = "Beijing", forceRefresh = false) {
  if (!forceRefresh && isCacheValid("weather")) {
    console.log("[weather] Using cached weather data");
    return getCached("weather");
  }

  const key = config.apiKeys.openWeather;
  if (!key) return { error: "OpenWeather API key not configured" };

  console.log("[weather] Fetching fresh weather data");
  const url = `${BASE}/weather?q=${encodeURIComponent(city)}&appid=${key}&units=metric&lang=zh_cn`;
  const data = await fetchJson(url);
  const result = {
    temperature: data.main.temp,
    feelsLike: data.main.feels_like,
    humidity: data.main.humidity,
    condition: data.weather[0].description,
    icon: data.weather[0].icon,
    city: data.name,
  };

  setCached("weather", result);
  return result;
}

export async function getForecast(city = "Beijing") {
  const key = config.apiKeys.openWeather;
  if (!key) return { error: "OpenWeather API key not configured" };

  const url = `${BASE}/forecast?q=${encodeURIComponent(city)}&appid=${key}&units=metric&lang=zh_cn&cnt=24`;
  const data = await fetchJson(url);

  const daily = new Map();
  for (const item of data.list) {
    const date = item.dt_txt.split(" ")[0];
    if (!daily.has(date)) {
      daily.set(date, { date, high: item.main.temp_max, low: item.main.temp_min, condition: item.weather[0].description, icon: item.weather[0].icon });
    } else {
      const d = daily.get(date);
      d.high = Math.max(d.high, item.main.temp_max);
      d.low = Math.min(d.low, item.main.temp_min);
    }
  }

  return Array.from(daily.values()).slice(0, 3);
}

export default { getCurrentWeather, getForecast };
