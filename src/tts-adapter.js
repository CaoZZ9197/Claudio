import config from "./config.js";
import { getMiniMaxTTS, initMiniMaxTTS, shutdownMiniMaxTTS } from "./minimax-tts.js";
import { getEdgeTTS, initEdgeTTS, shutdownEdgeTTS } from "./edge-tts.js";
import { getCacheKey, getFromCache, saveToCache, getCacheStats, enforceCacheLimits } from "./tts-cache.js";

const MINIMAX = "minimax";
const EDGE_TTS = "edge-tts";

const ENGINES = {
  [MINIMAX]: { get: getMiniMaxTTS, init: initMiniMaxTTS, shutdown: shutdownMiniMaxTTS },
  [EDGE_TTS]: { get: getEdgeTTS, init: initEdgeTTS, shutdown: shutdownEdgeTTS },
};

const PROVIDER = (() => {
  const raw = (config.tts.provider || MINIMAX).toLowerCase();
  if (!ENGINES[raw]) {
    console.warn(`[tts-adapter] Unknown TTS provider "${raw}", falling back to minimax`);
    return MINIMAX;
  }
  return raw;
})();

function makeCacheKey(text, emotion) {
  const tc = config.tts;
  const voiceId = tc.voiceId || tc.edgeVoice || "default";
  const speed = tc.speed || tc.edgeRate || "1.0";
  const pitch = tc.pitch || tc.edgePitch || "0";
  const vol = tc.vol || "1.0";
  return getCacheKey(PROVIDER + "|" + text, voiceId, speed, pitch, vol, emotion || "");
}

/**
 * 返回带缓存代理的 TTS 引擎实例。
 * synthesize() 被包装，命中缓存时直接返回已合成的音频。
 */
export function getTTS() {
  const engine = ENGINES[PROVIDER].get();

  // 已包装过则直接返回
  if (engine._cached) return engine;

  const rawSynthesize = engine.synthesize.bind(engine);

  const cachedEngine = Object.create(engine);
  cachedEngine._cached = true;
  cachedEngine.synthesize = async function (text, onAudioChunk, emotion) {
    const key = makeCacheKey(text, emotion);
    const cached = await getFromCache(key);

    if (cached) {
      const display = text.length > 40 ? text.slice(0, 40) + "..." : text;
      console.log(`[tts-cache] Hit: "${display}" (${cached.length} bytes)`);
      onAudioChunk(cached);
      return { audioSize: cached.length, audioLength: 0 };
    }

    const chunks = [];
    const result = await rawSynthesize(text, (chunk) => {
      chunks.push(chunk);
      onAudioChunk(chunk);
    }, emotion);

    // 后台写入缓存，不阻塞返回
    if (chunks.length > 0) {
      const fullBuffer = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
      saveToCache(key, fullBuffer).catch((e) =>
        console.warn("[tts-cache] Save failed:", e.message)
      );
    }

    return result;
  };

  // 转发原始属性
  Object.setPrototypeOf(cachedEngine, engine);

  return cachedEngine;
}

export async function initTTS() {
  console.log(`[tts-adapter] Initializing TTS engine: ${PROVIDER}`);
  const engine = ENGINES[PROVIDER].init();
  try {
    const stats = await getCacheStats();
    console.log(`[tts-adapter] TTS cache: ${stats.files} files, ${stats.sizeMB} MB`);
    await enforceCacheLimits();
  } catch (e) {
    // 缓存目录首次创建时可能出错，忽略
  }
  return engine;
}

export async function shutdownTTS() {
  return ENGINES[PROVIDER].shutdown();
}

export default { getTTS, initTTS, shutdownTTS };
