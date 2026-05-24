import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { existsSync } from "node:fs";
import neteaseApi from "@neteasecloudmusicapienhanced/api";

const { login_qr_key, login_qr_create, login_qr_check, login_refresh } = neteaseApi;

const COOKIE_FILE = join(homedir(), ".claudio", "netease-cookie.json");
const QR_POLL_INTERVAL_MS = 3000;
const QR_TIMEOUT_MS = 5 * 60 * 1000;

// ── File I/O ────────────────────────────────────────────────────────────────────

function readStoredCookie() {
  try {
    if (existsSync(COOKIE_FILE)) {
      const data = readFileSync(COOKIE_FILE, "utf-8");
      const parsed = JSON.parse(data);
      if (parsed.cookie && typeof parsed.cookie === "string") {
        return parsed.cookie;
      }
    }
  } catch {
    console.warn("[netease-auth] Cookie 文件损坏，将重新登录");
    try { unlinkSync(COOKIE_FILE); } catch {}
  }
  return null;
}

function saveCookie(cookie) {
  try {
    writeFileSync(COOKIE_FILE, JSON.stringify({ cookie, savedAt: Date.now() }), "utf-8");
    console.log("[netease-auth] Cookie 已保存到", COOKIE_FILE);
  } catch (err) {
    console.error("[netease-auth] 保存 Cookie 失败:", err.message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Cookie 缓存 ─────────────────────────────────────────────────────────────────

let cachedCookie = null;
let pendingLogin = null;

// ── QR 码登录 ───────────────────────────────────────────────────────────────────

async function loginViaQRCode() {
  console.log("\n[netease-auth] 开始 QR 码登录流程...");
  console.log("[netease-auth] 请使用网易云音乐 App 扫码登录\n");

  let key;
  try {
    const keyResult = await login_qr_key();
    key = keyResult.body?.data?.unikey;
    if (!key) throw new Error("无法获取二维码 key");
  } catch (err) {
    console.error("[netease-auth] 获取二维码 key 失败:", err.message);
    return null;
  }

  try {
    const qrResult = await login_qr_create({ key, qrimg: true });
    const qrUrl = qrResult.body?.data?.qrurl;
    if (qrUrl) {
      console.log("[netease-auth] 二维码链接:", qrUrl);
      console.log("[netease-auth] 请在浏览器中打开上述链接，用网易云音乐 App 扫描二维码\n");
    }
  } catch {
    // QR 生成失败不影响登录流程
  }

  const startTime = Date.now();

  console.log("[netease-auth] 等待扫码中...（每 3 秒检查一次）");
  let pollCount = 0;

  while (Date.now() - startTime < QR_TIMEOUT_MS) {
    await sleep(QR_POLL_INTERVAL_MS);
    pollCount++;

    try {
      const checkResult = await login_qr_check({ key });
      const code = checkResult.body?.code;
      console.log(`[netease-auth] 第 ${pollCount} 次检查: code=${code}`);

      if (code === 800) {
        console.warn("[netease-auth] 二维码已过期，请重新启动服务");
        return null;
      }

      if (code === 801) {
        console.log("[netease-auth] 等待确认...");
        continue;
      }

      if (code === 802) {
        // 等待扫码中，静默
        continue;
      }

      if (code === 803) {
        const cookie = checkResult.body?.cookie;
        console.log(`[netease-auth] 登录成功! cookie=${cookie ? cookie.substring(0, 30) + "..." : "EMPTY"}`);
        if (cookie) {
          saveCookie(cookie);
          return cookie;
        }
        console.warn("[netease-auth] 登录成功但 cookie 为空!");
      }
    } catch (err) {
      console.warn(`[netease-auth] 第 ${pollCount} 次检查失败: ${err.message || err}`);
    }
  }

  console.warn("[netease-auth] QR 码登录超时（5 分钟）");
  return null;
}

// ── 后台刷新 ────────────────────────────────────────────────────────────────────

async function tryRefresh() {
  if (!cachedCookie) return;
  try {
    const refreshResult = await login_refresh({ cookie: cachedCookie });
    if (refreshResult.body?.code === 200 && refreshResult.body?.cookie) {
      const newCookie = refreshResult.body.cookie;
      if (newCookie !== cachedCookie) {
        cachedCookie = newCookie;
        saveCookie(newCookie);
        console.log("[netease-auth] Cookie 已自动刷新");
      }
    }
  } catch {
    // 刷新失败静默忽略，继续使用现有 Cookie
  }
}

// ── Public API ──────────────────────────────────────────────────────────────────

/**
 * 后台初始化认证（服务启动时调用，不阻塞）。
 * 优先级：NETEASE_COOKIE 环境变量 > 已存储文件 > QR 码登录
 */
export function initAuth() {
  // 0. 检查环境变量 NETEASE_COOKIE
  const envCookie = process.env.NETEASE_COOKIE;
  if (envCookie && envCookie.trim()) {
    cachedCookie = envCookie.trim();
    console.log("[netease-auth] 从环境变量 NETEASE_COOKIE 加载 Cookie");
    return;
  }

  // 1. 读取已存储的 Cookie
  const stored = readStoredCookie();

  if (stored) {
    cachedCookie = stored;
    console.log("[netease-auth] 已加载存储的 Cookie");
    // 后台尝试刷新（不阻塞）
    tryRefresh().catch(() => {});
  } else {
    console.log("[netease-auth] 未检测到 Cookie，启动后台 QR 登录...");
    // 后台启动 QR 登录（不阻塞）
    pendingLogin = loginViaQRCode().then((cookie) => {
      if (cookie) cachedCookie = cookie;
      pendingLogin = null;
      if (cookie) tryRefresh().catch(() => {});
    }).catch(() => { pendingLogin = null; });
  }
}

/**
 * 获取当前缓存的 Cookie（同步，永不阻塞）。
 * @returns {string|null}
 */
export function getCachedCookie() {
  return cachedCookie || process.env.NETEASE_COOKIE?.trim() || null;
}

/**
 * 获取或等待 Cookie（用于需要确保认证就绪的场景）。
 * 如果已有缓存立即返回；如果 QR 登录进行中则等待其结果。
 * @returns {Promise<string|null>}
 */
export async function getOrRefreshCookie() {
  if (cachedCookie) return cachedCookie;
  if (pendingLogin) return pendingLogin;

  // 最后尝试：启动 QR 登录
  pendingLogin = loginViaQRCode().then((cookie) => {
    if (cookie) cachedCookie = cookie;
    pendingLogin = null;
    return cookie;
  }).catch(() => { pendingLogin = null; return null; });

  return pendingLogin;
}
