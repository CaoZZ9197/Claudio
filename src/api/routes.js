import { Router } from "express";
import { routeMessage, routeMessageStream, dispatchAction } from "../router.js";
import { searchSongs, getPlaylist, controlPlayback, getAudioUrl } from "../music/netease.js";
import { getRecentPlays, getRecentMessages, getAllPreferences, setPreference } from "../db.js";
import { broadcastState } from "./ws.js";
import { discoverDevices, castAudio } from "../external/upnp.js";

const router = Router();

// ── SSE Emitter ────────────────────────────────────────────────────────────────

class SSEEmitter {
  constructor(res) {
    this.res = res;
    this.closed = false;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    if (res.socket) {
      res.socket.setNoDelay(true);
    }
  }

  emit(event, data) {
    if (this.closed) return;
    this.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  fail(message) {
    if (this.closed) return;
    this.closed = true;
    this.res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
    this.res.end();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.res.end();
  }
}

// ── Player state ───────────────────────────────────────────────────────────────

const playerState = {
  playing: null,
  position: 0,
  volume: 80,
  state: "stopped",
};

// ── GET /api/now ───────────────────────────────────────────────────────────────

router.get("/now", (_req, res) => {
  res.json({
    playing: playerState.playing,
    position: playerState.position,
    volume: playerState.volume,
    state: playerState.state,
  });
});

// ── POST /api/chat ─────────────────────────────────────────────────────────────

// 流式版本：通过 SSE 推送 text delta，返回 action
router.post("/chat/stream", async (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({ error: "message is required" });
  }

  const emitter = new SSEEmitter(res);

  try {
    await routeMessageStream(message.trim(), emitter);
  } catch (err) {
    console.error(`[api/chat/stream] Error: ${err.message}`);
    emitter.fail(err.message);
  }
});

// 原有非流式版本（保持向后兼容）
router.post("/chat", async (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== "string" || message.trim() === "") {
    return res.status(400).json({ error: "message is required" });
  }

  try {
    const result = await routeMessage(message.trim());

    // 从所有 action 结果中提取播放状态更新
    const actionResults = result.actionResults || [];
    if (result.actionResult && !actionResults.includes(result.actionResult)) {
      actionResults.unshift(result.actionResult);
    }

    for (const ar of actionResults) {
      if (!ar || !ar.ok) continue;

      if (ar.type === "music" && ar.song) {
        playerState.playing = ar.song;
        playerState.state = "playing";
        playerState.position = 0;
        broadcastState({ state: "playing", track: ar.song, position: 0 });
      }

      if (ar.type === "control") {
        const { command, volume: vol } = ar;
        if (command === "pause" || command === "stop") playerState.state = "paused";
        if (command === "resume" || command === "play") playerState.state = "playing";
        if (vol !== undefined) playerState.volume = vol;
      }
    }

    // 构建增强响应：包含所有 DJ 步骤
    const response = {
      intent: result.intent,
      response: result.response?.params?.text
        || result.response?.params?.say
        || result.response?.params?.reason
        || result.response?.action
        || null,
      actionResult: result.actionResult || null,
      actionResults: actionResults.length > 0 ? actionResults : undefined,
    };

    res.json(response);
  } catch (err) {
    console.error(`[api/chat] Error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/playlists ─────────────────────────────────────────────────────────

router.get("/playlists", async (_req, res) => {
  const playlistId = getAllPreferences()["default_playlist_id"];
  if (!playlistId) {
    return res.json({ playlists: [] });
  }

  try {
    const result = await getPlaylist(playlistId);
    if (result.status === "ok") {
      res.json({ playlists: [result.playlist] });
    } else {
      res.json({ playlists: [] });
    }
  } catch (err) {
    console.error(`[api/playlists] Error: ${err.message}`);
    res.json({ playlists: [], error: err.message });
  }
});

// ── POST /api/player/control ──────────────────────────────────────────────────

router.post("/player/control", async (req, res) => {
  const { command, volume } = req.body;

  try {
    if (command) {
      switch (command) {
        case "play":
        case "resume":
          playerState.state = "playing";
          await controlPlayback("resume").catch(() => {});
          break;
        case "pause":
          playerState.state = "paused";
          await controlPlayback("pause").catch(() => {});
          break;
        case "stop":
          playerState.state = "stopped";
          playerState.playing = null;
          playerState.position = 0;
          await controlPlayback("stop").catch(() => {});
          break;
        case "next":
          await controlPlayback("next").catch(() => {});
          break;
        case "prev":
          await controlPlayback("prev").catch(() => {});
          break;
      }
      broadcastState({ state: playerState.state, track: playerState.playing, position: playerState.position });
    }

    if (volume !== undefined) {
      playerState.volume = Math.max(0, Math.min(100, Number(volume)));
      await controlPlayback(`volume ${playerState.volume}`).catch(() => {});
    }

    res.json({ ok: true, state: playerState });
  } catch (err) {
    console.error(`[api/player/control] Error: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// ── GET /api/audio/:trackId ────────────────────────────────────────────────────

router.get("/audio/:trackId", async (req, res) => {
  const { trackId } = req.params;
  if (!trackId) {
    return res.status(400).json({ error: "trackId required" });
  }

  try {
    const urlResult = await getAudioUrl(trackId);
    if (urlResult.status !== "ok" || !urlResult.url) {
      return res.status(404).json({ error: urlResult.error || "audio not available" });
    }

    const audioRes = await fetch(urlResult.url);
    if (!audioRes.ok) {
      return res.status(502).json({ error: `upstream audio fetch failed: ${audioRes.status}` });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Accept-Ranges", "bytes");

    const contentLength = audioRes.headers.get("content-length");
    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }

    const reader = audioRes.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (err) {
    console.error(`[api/audio] Stream error for ${trackId}: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.end();
    }
  }
});

// ── GET /api/history ───────────────────────────────────────────────────────────

router.get("/history", (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const plays = getRecentPlays(limit);
  const messages = getRecentMessages(limit);
  res.json({ plays, messages });
});

// ── GET/POST /api/settings ─────────────────────────────────────────────────────

router.get("/settings", (_req, res) => {
  const prefs = getAllPreferences();
  res.json({
    ...prefs,
    playerVolume: playerState.volume,
  });
});

router.post("/settings", (req, res) => {
  const settings = req.body;
  for (const [key, value] of Object.entries(settings)) {
    setPreference(key, String(value));
  }
  res.json({ ok: true });
});

// ── UPnP Casting ─────────────────────────────────────────────────────────────

// 发现局域网内的 UPnP/DLNA 设备
router.get("/cast/devices", async (_req, res) => {
  try {
    const devices = await discoverDevices();
    res.json({ devices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 将音频推送到指定 UPnP 设备
router.post("/cast", async (req, res) => {
  const { url, device } = req.body;
  if (!url) {
    return res.status(400).json({ error: "url is required" });
  }
  if (!device?.location) {
    return res.status(400).json({ error: "device with location is required" });
  }

  try {
    const result = await castAudio(url, device);
    if (result.error) {
      return res.status(500).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
