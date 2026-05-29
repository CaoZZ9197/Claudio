import express from "express";
import http from "node:http";
import config from "./config.js";
import { closeDb, cleanupOldPlays } from "./db.js";
import routes from "./api/routes.js";
import { setupWebSocket } from "./api/ws.js";
import { initScheduler } from "./scheduler.js";
import { initAuth } from "./music/netease-auth.js";
import { initTTS, shutdownTTS } from "./tts-adapter.js";

const app = express();

app.use(express.json());

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (_req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(express.static(config.paths.frontend, { index: "index.html" }));

// Serve theme CSS files (swappable at runtime via ?theme=dark|light)
app.use("/themes", express.static(config.paths.frontend + "/themes", {
  index: false,
  setHeaders: (res) => {
    res.setHeader("Content-Type", "text/css");
    res.setHeader("Cache-Control", "public, max-age=86400");
  },
}));


app.use("/api", routes);

// Express 错误处理中间件（4 参数签名）
app.use((err, _req, res, _next) => {
  console.error("[express] Unhandled error:", err.message);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

const server = http.createServer(app);
const { wss } = setupWebSocket(server);

// 跟踪所有活跃 TCP 连接，确保关闭时释放端口
const connections = new Set();
server.on("connection", (socket) => {
  connections.add(socket);
  socket.once("close", () => connections.delete(socket));
});

function shutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down...`);

  // 关闭 WebSocket 服务器（阻止新连接）
  wss.close();
  // 关闭数据库
  closeDb();
  // 清理 TTS 引擎
  shutdownTTS().catch(() => {});

  // 销毁所有活跃连接（HTTP keep-alive、SSE、WebSocket 等），立即释放端口
  for (const socket of connections) {
    socket.destroy();
    connections.delete(socket);
  }

  server.close((err) => {
    if (err) console.error("Server close error:", err.message);
    else console.log("Server stopped.");
    process.exit(err ? 1 : 0);
  });

  // 5 秒兜底：强制退出
  setTimeout(() => {
    console.error("Forced shutdown after timeout.");
    for (const socket of connections) {
      socket.destroy();
      connections.delete(socket);
    }
    process.exit(0);
  }, 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// 全局错误兜底：防止未捕获异常/未处理 rejection 导致进程崩溃
process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException:", err.message);
  console.error(err.stack);
});

process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandledRejection:", reason?.message || reason);
  if (reason?.stack) console.error(reason.stack);
});

// 后台初始化网易云音乐认证（不阻塞 HTTP 服务启动）
Promise.resolve(initAuth()).catch((err) => {
  console.error("[auth] initAuth failed:", err.message);
});

// 启动时清理过期的播放历史记录
cleanupOldPlays(config.playHistoryDays);

server.listen(config.port, () => {
    console.log(`Claudio AI Radio — http://localhost:${config.port}`);
    console.log(`  Model:    ${config.model}`);
    console.log(`  Database: ${config.paths.db}`);
    console.log(`  Static:   ${config.paths.frontend}`);
    const routeStack = app._router?.stack
      ?.filter((r) => r.route)
      ?.map((r) => `${Object.keys(r.route.methods)[0].toUpperCase()} ${r.route.path}`) || [];
    if (routeStack.length) {
      console.log("  Routes:");
      routeStack.forEach((r) => console.log(`    ${r}`));
    }
    console.log(`  WebSocket: ws://localhost:${config.port}/stream`);
    initScheduler();
  });

  // 后台初始化 TTS 引擎（不阻塞 HTTP 服务启动）
  Promise.resolve(initTTS()).catch((err) => {
    console.error("[tts] Init failed:", err.message);
    console.warn("[tts] TTS will be unavailable until reconnection succeeds");
  });
