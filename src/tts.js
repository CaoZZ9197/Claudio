import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import config from "./config.js";

const FISH_AUDIO_BASE = "https://api.fish.audio/v1/tts";

// ── Hashing ───────────────────────────────────────────────────────────────────

export function hashText(text) {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

function cachePath(hash) {
  return join(config.paths.ttsCache, `${hash}.mp3`);
}

// ── Fish Audio API ─────────────────────────────────────────────────────────────

export async function synthesizeText(text) {
  if (!text || text.trim() === "") {
    throw new Error("Text cannot be empty");
  }

  const hash = hashText(text);
  const filePath = cachePath(hash);

  // Cache hit
  if (existsSync(filePath)) {
    console.log(`[tts] Cache hit for hash ${hash.slice(0, 8)}...`);
    return { hash, filePath, cached: true };
  }

  // Cache miss — call Fish Audio
  console.log(`[tts] Cache miss, calling Fish Audio API for "${text.slice(0, 40)}..."`);

  const response = await fetch(FISH_AUDIO_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKeys.fishAudio}`,
    },
    body: JSON.stringify({ text: text.trim() }),
  });

  if (!response.ok) {
    let message = `Fish Audio API error: ${response.status}`;
    try {
      const errBody = await response.json();
      if (errBody.detail) message = errBody.detail;
    } catch {}
    throw new Error(message);
  }

  const audioBuffer = await response.arrayBuffer();

  mkdirSync(config.paths.ttsCache, { recursive: true });
  writeFileSync(filePath, Buffer.from(audioBuffer));

  return { hash, filePath, cached: false };
}

// ── Cache utilities ────────────────────────────────────────────────────────────

export function getAudioUrlPath(hash) {
  return `/audio/tts/${hash}.mp3`;
}

export function isCached(hash) {
  return existsSync(cachePath(hash));
}

export function getCacheFilePath(hash) {
  return cachePath(hash);
}

export default { synthesizeText, hashText, getAudioUrlPath, isCached, getCacheFilePath };