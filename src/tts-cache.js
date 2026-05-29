import { createHash } from "node:crypto";
import { readFile, writeFile, unlink, readdir, stat, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

const CACHE_DIR = resolve(homedir(), ".claude", "tts-cache");
const MAX_FILES = 200;
const MAX_SIZE_MB = 100;
const MP3_HEADER = Buffer.from([0xff, 0xfb]); // MP3 frame sync (basic check)

export function getCacheKey(text, voiceId, speed, pitch, vol) {
  const raw = `${text}|${voiceId}|${speed}|${pitch}|${vol}`;
  return createHash("md5").update(raw).digest("hex");
}

function cachePath(key) {
  return join(CACHE_DIR, `${key}.mp3`);
}

async function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    await mkdir(CACHE_DIR, { recursive: true });
  }
}

export async function getFromCache(key) {
  await ensureCacheDir();
  const path = cachePath(key);
  if (!existsSync(path)) return null;
  const buffer = await readFile(path);
  // 快速校验: 检查文件是否以有效 MP3 帧起始
  if (buffer.length < 2 || !buffer.subarray(0, 2).equals(MP3_HEADER)) {
    await unlink(path).catch(() => {});
    return null;
  }
  return buffer;
}

export async function saveToCache(key, buffer) {
  await ensureCacheDir();
  await writeFile(cachePath(key), buffer);
  await enforceCacheLimits();
}

export async function enforceCacheLimits(maxFiles = MAX_FILES, maxSizeMB = MAX_SIZE_MB) {
  await ensureCacheDir();
  const entries = await readdir(CACHE_DIR);
  const mp3Files = entries.filter((f) => f.endsWith(".mp3"));
  if (mp3Files.length === 0) return;

  const stats = await Promise.all(
    mp3Files.map(async (name) => {
      const path = join(CACHE_DIR, name);
      const s = await stat(path);
      return { name, path, size: s.size, atime: s.atimeMs };
    })
  );

  const totalSize = stats.reduce((sum, f) => sum + f.size, 0);
  const maxBytes = maxSizeMB * 1024 * 1024;

  if (mp3Files.length <= maxFiles && totalSize <= maxBytes) return;

  // 按 atime 升序（最久未用的在前）
  stats.sort((a, b) => a.atime - b.atime);

  let remaining = mp3Files.length;
  let currentSize = totalSize;

  for (const f of stats) {
    if (remaining <= maxFiles && currentSize <= maxBytes) break;
    await unlink(f.path).catch(() => {});
    remaining--;
    currentSize -= f.size;
  }

  if (mp3Files.length - remaining > 0) {
    console.log(`[tts-cache] Cleaned up ${mp3Files.length - remaining} expired cache files`);
  }
}

export async function getCacheStats() {
  await ensureCacheDir();
  const entries = await readdir(CACHE_DIR);
  const mp3Files = entries.filter((f) => f.endsWith(".mp3"));

  let totalSize = 0;
  for (const name of mp3Files) {
    const s = await stat(join(CACHE_DIR, name));
    totalSize += s.size;
  }

  const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);
  return { files: mp3Files.length, sizeMB };
}

export { CACHE_DIR };
