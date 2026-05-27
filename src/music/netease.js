import { execNcm, escapeShellArg } from "./ncm-exec.js";
import { getCachedCookie, getOrRefreshCookie } from "./netease-auth.js";
import neteaseApi from "@neteasecloudmusicapienhanced/api";

const { song_url, song_url_v1, cloudsearch, lyric } = neteaseApi;

// ── URL 缓存（避免同一 trackId 重复解锁）──────────────────────────────────────
const audioUrlCache = new Map();

// ── Helpers ────────────────────────────────────────────────────────────────────

function isTrialOrVip(urlData) {
  const hasTrial = urlData.freeTrialInfo !== null && urlData.freeTrialInfo !== "null";
  // fee: 0=免费, 1=VIP, 4=付费单曲, 8=VIP独占/云盘
  const isVip = [1, 4, 8].includes(urlData.fee);
  return hasTrial || isVip;
}

/**
 * 获取请求用的 Cookie：有缓存立即返回，否则等待进行中的登录（最多 5 秒）。
 */
async function getCookieForRequest() {
  const cached = getCachedCookie();
  if (cached) return cached;

  const result = await Promise.race([
    getOrRefreshCookie(),
    new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
  ]);
  return result;
}

/**
 * Map cloudsearch API results to Claudio's internal song shape.
 * cloudsearch returns: { code, result: { songs: [{id, name, ar: [{name}], al: {name}, dt}] } }
 */
function normalizeSearchResults(raw) {
  const items =
    raw?.result?.songs
    ?? raw?.data?.records
    ?? raw?.data
    ?? raw?.result?.songs
    ?? (Array.isArray(raw) ? raw : []);
  return items
    .map((s) => ({
      id: String(s.id ?? s.songId ?? ""),
      encryptedId: s.encryptedId ?? String(s.id ?? ""),
      originalId: String(s.originalId ?? s.id ?? ""),
      title: s.name ?? s.title ?? "Unknown",
      artist: Array.isArray(s.ar)
        ? s.ar.map((a) => (typeof a === "string" ? a : a.name)).join(", ")
        : Array.isArray(s.artists)
          ? s.artists.map((a) => (typeof a === "string" ? a : a.name)).join(", ")
          : s.artist ?? "Unknown",
      album: typeof s.al === "object" ? s.al?.name ?? "" : typeof s.album === "string" ? s.album : s.album?.name ?? "",
      coverUrl: typeof s.al === "object" ? s.al?.picUrl ?? "" : s.picUrl ?? s.coverUrl ?? "",
      duration: (s.dt ?? s.duration) ? Math.floor((s.dt ?? s.duration) / 1000) : 0,
    }));
}

function normalizePlaylistResult(raw) {
  const list = Array.isArray(raw) ? raw : raw?.data ?? raw?.result?.playlists ?? [];
  return list.map((p) => ({
    id: String(p.id ?? ""),
    name: p.name ?? "Unknown",
    description: p.description ?? "",
    coverUrl: p.coverImgUrl ?? p.coverUrl ?? "",
    trackCount: p.trackCount ?? 0,
    tracks: (p.tracks ?? []).map((t) => ({
      id: String(t.id),
      encryptedId: t.encryptedId ?? t.encryptId ?? "",
      originalId: String(t.originalId ?? t.id ?? ""),
      title: t.name ?? t.title ?? "Unknown",
      artist: Array.isArray(t.artists ?? t.ar)
        ? (t.artists ?? t.ar).map((a) => (typeof a === "string" ? a : a.name)).join(", ")
        : t.artist ?? "Unknown",
      album: typeof t.album === "string" ? t.album : t.album?.name ?? t.al?.name ?? "",
      duration: (t.duration ?? t.dt) ? Math.floor((t.duration ?? t.dt) / 1000) : 0,
    })),
  }));
}

// ── Search ────────────────────────────────────────────────────────────────────

export async function searchSongs(keyword, limit = 30, excludeIds = []) {
  if (!keyword || keyword.trim() === "") {
    return { status: "no_results", songs: [] };
  }

  const excludeSet = new Set(excludeIds.map(String));

  try {
    const result = await cloudsearch({ keywords: keyword.trim(), type: 1, limit });

    if (result.status !== 200 || result.body?.code !== 200) {
      return { status: "error", error: `cloudsearch API error: code ${result.body?.code}` };
    }

    let songs = normalizeSearchResults(result.body);

    // 过滤已播放歌曲
    if (excludeSet.size > 0) {
      songs = songs.filter((s) => !excludeSet.has(s.id));
    }

    if (songs.length === 0) {
      return { status: "no_results", songs: [] };
    }

    return { status: "ok", songs: songs.slice(0, limit) };
  } catch (err) {
    console.error(`[netease] Search failed for "${keyword}": ${err.message}`);
    return { status: "error", error: err.message };
  }
}

// ── Playlist ──────────────────────────────────────────────────────────────────

export async function getPlaylist(playlistId) {
  if (!playlistId) {
    return { status: "error", error: "playlist ID required" };
  }

  try {
    const raw = await execNcm("playlist list");
    const playlists = normalizePlaylistResult(raw);

    const found = playlists.find((p) => p.id === String(playlistId));
    if (!found) {
      return { status: "error", error: `playlist ${playlistId} not found in user playlists` };
    }

    return { status: "ok", playlist: found };
  } catch (err) {
    console.error(`[netease] Playlist fetch failed for ${playlistId}: ${err.message}`);
    return { status: "error", error: err.message };
  }
}

// ── Lyrics ────────────────────────────────────────────────────────────────────

export async function getLyrics(trackId) {
  if (!trackId) {
    return { status: "error", error: "track ID required" };
  }

  try {
    const cookie = await getCookieForRequest();
    const result = await lyric({ id: trackId, cookie });
    if (result.status !== 200 || result.body.code !== 200) {
      return { status: "no_lyrics", lyrics: "" };
    }
    const lrc = result.body.lrc?.lyric || "";
    const tlrc = result.body.tlyric?.lyric || "";
    return { status: "ok", lyrics: lrc, translatedLyrics: tlrc };
  } catch (err) {
    console.error(`[netease] Lyrics fetch failed for ${trackId}: ${err.message}`);
    return { status: "error", error: err.message };
  }
}

// ── Audio URL / Playback ──────────────────────────────────────────────────────

/**
 * Get a streaming audio URL via the community API.
 * Returns a browser-playable URL for the given numeric track ID.
 */
export async function getAudioUrl(trackId) {
  if (!trackId) {
    return { status: "error", error: "track ID required" };
  }

  // 命中缓存则直接返回，避免重复解锁
  if (audioUrlCache.has(trackId)) {
    const cached = audioUrlCache.get(trackId);
    console.log(`[netease] 歌曲 ${trackId} URL 命中缓存`);
    return cached;
  }

  try {
    const cookie = await getCookieForRequest();
    const params = { id: String(trackId), br: 320000 };
    if (cookie) {
      params.cookie = cookie;
    }

    // 使用 song_url (标准 endpoint，兼容性更好)
    let result = await song_url(params);
    if (result.status !== 200 || result.body?.code !== 200) {
      throw new Error(`API returned status ${result.status}, code ${result.body?.code}`);
    }

    let urlData = result.body.data?.[0];

    // 诊断日志
    if (cookie) {
      const hasMusU = cookie.includes("MUSIC_U");
      console.log(`[netease] Cookie 诊断: MUSIC_U=${hasMusU}, id=${trackId}, br=${urlData?.br}, fee=${urlData?.fee}, freeTrial=${urlData?.freeTrialInfo ? "YES" : "none"}, url=${urlData?.url ? urlData.url.substring(0, 60) + "..." : "null"}`);
    }

    if (!urlData?.url) {
      // song_url 失败，尝试 song_url_v1 作为回退
      console.log(`[netease] song_url 无结果，尝试 song_url_v1...`);
      const v1Result = await song_url_v1({
        id: String(trackId),
        level: "standard",
        cookie,
      });
      if (v1Result.status === 200 && v1Result.body?.data?.[0]?.url) {
        urlData = v1Result.body.data[0];
        console.log(`[netease] song_url_v1 回退成功`);
      } else {
        return {
          status: "unavailable",
          error: "track not playable (copyright or region restriction)",
        };
      }
    }

    // 检测试听/VIP 片段，尝试 unblock 解锁
    if (isTrialOrVip(urlData) && cookie) {
      console.log(`[netease] 歌曲 ${trackId} 受限（fee=${urlData.fee}），尝试解锁...`);
      try {
        const unblockResult = await song_url_v1({
          id: String(trackId),
          level: "standard",
          cookie,
          unblock: "true",
        });
        if (unblockResult.status === 200 && unblockResult.body?.data?.[0]?.url) {
          const unblocked = unblockResult.body.data[0];
          if (!isTrialOrVip(unblocked)) {
            console.log(`[netease] 歌曲 ${trackId} 解锁成功`);
            const result = { status: "ok", url: unblocked.url, duration: unblocked.time || 0 };
            audioUrlCache.set(trackId, result);
            return result;
          }
        }
      } catch (e) {
        console.warn(`[netease] 解锁尝试失败: ${e.message}`);
      }
    }

    // 最终检测
    if (isTrialOrVip(urlData)) {
      console.warn(`[netease] 歌曲 ${trackId} 为付费/VIP 歌曲，仅返回试听片段`);
      return {
        status: "vip_only",
        url: urlData.url,
        duration: urlData.time || 0,
        error: "此歌曲为 VIP 付费歌曲，仅可试听 30 秒",
      };
    }

    return (() => {
      const result = { status: "ok", url: urlData.url, duration: urlData.time || 0 };
      audioUrlCache.set(trackId, result);
      return result;
    })();
  } catch (err) {
    console.error(`[netease] Audio URL fetch failed for ${trackId}: ${err.message}`);
    return { status: "error", error: err.message };
  }
}

/**
 * 后台预解锁：并行执行 mpv 播放（触发 ncm-cli 解锁）和获取浏览器音频 URL。
 * 不阻塞调用者，用于在 TTS 播报期间后台预热歌曲。
 */
export function unlockSong(song) {
  if (!song?.encryptedId || !song?.originalId) {
    return Promise.resolve();
  }

  const mpvCmd = `play --song --encrypted-id ${escapeShellArg(song.encryptedId)} --original-id ${escapeShellArg(song.originalId)}`;

  // 并行执行：mpv 触发解锁 + 获取浏览器音频 URL（可能触发 unblock）
  return Promise.all([
    execNcm(mpvCmd).catch(() => {}),
    getAudioUrl(song.originalId),
  ]);
}

/**
 * Play a song both server-side (ncm-cli mpv) and provide browser audio URL.
 * Accepts a song object from searchSongs result.
 */
export async function playSong(song) {
  if (!song?.encryptedId || !song?.originalId) {
    return { status: "error", error: "encryptedId and originalId required for playback" };
  }

  // 非阻塞执行 mpv 服务端播放，不等待其完成
  execNcm(
    `play --song --encrypted-id ${escapeShellArg(song.encryptedId)} --original-id ${escapeShellArg(song.originalId)}`
  ).catch((err) => {
    console.warn(`[netease] Server-side mpv playback failed (non-critical): ${err.message}`);
  });

  // 获取浏览器可播放 URL（已缓存则直接返回）
  const urlResult = await getAudioUrl(song.originalId);

  if (urlResult.status === "ok") {
    return { status: "ok", url: `/api/audio/${song.originalId}` };
  }

  // VIP 歌曲虽然有完整播放限制，但试听 URL 仍可播放（通常 30 秒）
  if (urlResult.status === "vip_only" && urlResult.url) {
    console.warn(`[netease] 歌曲 ${song.originalId} 为 VIP 歌曲，提供试听 URL`);
    return { status: "ok", url: `/api/audio/${song.originalId}` };
  }

  console.error(`[netease] Browser audio URL failed: ${urlResult.error || "unknown"}`);
  return { status: "error", error: urlResult.error || "failed to get audio URL" };
}

// ── Playback Control ──────────────────────────────────────────────────────────

/**
 * Control server-side playback via ncm-cli.
 * Supported commands: pause, resume, next, prev, stop, volume <0-100>
 */
export async function controlPlayback(command) {
  const validCommands = ["pause", "resume", "next", "prev", "stop"];

  if (!validCommands.includes(command) && !command.startsWith("volume ")) {
    return { status: "error", error: `unsupported command: ${command}` };
  }

  try {
    await execNcm(command);
    return { status: "ok" };
  } catch (err) {
    console.error(`[netease] Playback control "${command}" failed: ${err.message}`);
    return { status: "error", error: err.message };
  }
}

/**
 * Get current playback state from ncm-cli.
 */
export async function getPlaybackState() {
  try {
    const state = await execNcm("state");
    return { status: "ok", state };
  } catch (err) {
    return { status: "error", error: err.message };
  }
}

export default { searchSongs, getPlaylist, getLyrics, getAudioUrl, playSong, controlPlayback, getPlaybackState, unlockSong };
