import { WebSocketServer } from "ws";
import { createReadStream } from "node:fs";

const clients = new Set();
let currentStreamState = { state: "stopped", track: null, position: 0 };

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, path: "/stream" });

  wss.on("error", (err) => {
    console.error("[ws] Server error:", err.message);
  });

  wss.on("connection", (ws) => {
    clients.add(ws);

    // Send current state to newly connected client
    sendToClient(ws, currentStreamState);

    ws.on("close", () => {
      clients.delete(ws);
    });

    ws.on("error", (err) => {
      console.error(`[ws] Client error: ${err.message}`);
      clients.delete(ws);
    });
  });

  return { wss, clients };
}

function sendToClient(ws, state) {
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify({ type: "state", ...state }));
    } catch (err) {
      console.error("[ws] sendToClient error:", err.message);
      clients.delete(ws);
    }
  }
}

export function broadcast(data) {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(payload);
      } catch (err) {
        console.error("[ws] send error in broadcast:", err.message);
        clients.delete(ws);
      }
    }
  }
}

export function broadcastAudio(chunk) {
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(chunk, { binary: true });
      } catch (err) {
        console.error("[ws] send error in broadcastAudio:", err.message);
        clients.delete(ws);
      }
    }
  }
}

export function broadcastState(state) {
  currentStreamState = state;
  broadcast({ type: "state", ...state });
}

const CHUNK_SIZE = 32 * 1024; // 32KB chunks

export async function streamAudioFile(filePath, track = null) {
  broadcastState({ state: "playing", track, position: 0 });

  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
    let byteCount = 0;

    stream.on("data", (chunk) => {
      byteCount += chunk.length;
      broadcastAudio(chunk);
    });

    stream.on("end", () => {
      console.log(`[ws] Streamed ${byteCount} bytes to ${clients.size} client(s)`);
      broadcastState({ state: "stopped", track: null, position: 0 });
      resolve();
    });

    stream.on("error", (err) => {
      console.error(`[ws] Stream error: ${err.message}`);
      broadcastState({ state: "stopped", track: null, position: 0 });
      reject(err);
    });
  });
}

export { clients };