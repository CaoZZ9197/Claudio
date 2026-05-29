// ── Radio Session State ────────────────────────────────────────────────────────
// 跟踪当前电台模式，用于自动续播、场景变更检测和队列管理

let currentSession = null;

export function getSession() {
  return currentSession;
}

export function setSession(session) {
  currentSession = {
    scene: session.scene || null,
    mood: session.mood || null,
    description: session.description || null,
    context: session.context || null,
    playedIds: session.playedIds || [],
    queue: session.queue || [],
    currentTrack: session.currentTrack || null,
    searchContext: session.searchContext || null,
    startedAt: Date.now(),
  };
}

export function clearSession() {
  currentSession = null;
}

export function addPlayedSong(id) {
  if (!currentSession || !id) return;
  if (!currentSession.playedIds) currentSession.playedIds = [];
  currentSession.playedIds.push(String(id));
  // 最多保留 200 条，超过则移除最旧的
  if (currentSession.playedIds.length > 200) {
    currentSession.playedIds = currentSession.playedIds.slice(-200);
  }
}

// ── Queue management ───────────────────────────────────────────────────────────

export function setQueue(queue) {
  if (!currentSession) return;
  currentSession.queue = queue;
}

export function getQueue() {
  return currentSession?.queue || [];
}

export function dequeueNext() {
  if (!currentSession || currentSession.queue.length === 0) return null;
  const next = currentSession.queue.shift();
  if (next?.song?.originalId) {
    addPlayedSong(next.song.originalId);
  }
  currentSession.currentTrack = next?.song || null;
  return next;
}

export function clearQueue() {
  if (!currentSession) return;
  currentSession.queue = [];
  currentSession.currentTrack = null;
}

export function needsRefill() {
  return currentSession && currentSession.queue.length < 2;
}

export function getPlayedIds() {
  return currentSession?.playedIds || [];
}

export default { getSession, setSession, clearSession, addPlayedSong, setQueue, getQueue, dequeueNext, clearQueue, needsRefill, getPlayedIds };
