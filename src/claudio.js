import Anthropic from "@anthropic-ai/sdk";
import config from "./config.js";

const TIMEOUT_MS = parseInt(process.env.CLAUDE_TIMEOUT_MS, 10) || 30000;

const SUPPORTED_ACTIONS = new Set([
  "play_music",
  "say",
  "announce_weather",
  "announce_schedule",
  "mood_check",
  "control_player",
]);

let client;

function getClient() {
  if (!client) {
    const opts = {
      apiKey: config.apiKeys.anthropic,
      timeout: TIMEOUT_MS,
    };
    // 三方大模型 API 代理地址（MiniMax 等 Anthropic 兼容 API）
    if (config.anthropicBaseUrl) {
      opts.baseURL = config.anthropicBaseUrl;
    }
    client = new Anthropic(opts);
  }
  return client;
}

function extractTextFromContent(content) {
  if (!Array.isArray(content)) return null;
  // Find first text block, skip thinking blocks (third-party models may return them)
  const textBlock = content.find((block) => block.type === "text");
  return textBlock ? textBlock.text : null;
}

export async function sendToClaude(systemPrompt, userMessage) {
  const anthropic = getClient();

  const response = await anthropic.messages.create({
    model: config.model,
    max_tokens: 512,  // DJ JSON 响应通常不到 500 字符
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    thinking: { type: "disabled" },
  });

  return extractTextFromContent(response.content);
}

function extractJsonFromResponse(text) {
  if (!text) return null;

  // Try fenced JSON block first
  const fenceMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Try finding a balanced JSON object
  let start = text.indexOf("{");
  while (start !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    start = text.indexOf("{", start + 1);
  }

  return null;
}

function parseAction(text) {
  const jsonStr = extractJsonFromResponse(text);
  if (!jsonStr) return null;

  try {
    const parsed = JSON.parse(jsonStr);
    // 接受任何有效的 JSON 对象（DJ 格式或 action 格式均可）
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    console.warn("[claudio] JSON parse error:", jsonStr.slice(0, 200));
    return null;
  }
}

function validateAction(action) {
  if (!SUPPORTED_ACTIONS.has(action.action)) {
    console.warn(`[claudio] Unknown action type: ${action.action}`);
    return false;
  }
  return true;
}

export function parseResponse(text) {
  const action = parseAction(text);

  if (!action) {
    return { action: "say", params: { text: text.trim() } };
  }

  // 检测 DJ 复合响应格式 {say, play[], reason, segue}
  if (action.say || action.play || action.reason || action.segue) {
    return {
      action: "dj_response",
      params: {
        say: action.say || null,
        play: action.play || null,
        reason: action.reason || null,
        segue: action.segue || null,
      },
    };
  }

  // 标准 action 格式 {action: "...", params: {...}}
  if (action.action) {
    if (!validateAction(action)) {
      return { action: "say", params: { text: text.trim() } };
    }
    return {
      action: action.action,
      params: action.params || {},
    };
  }

  // 无法识别的 JSON，作为纯文本 say
  return { action: "say", params: { text: text.trim() } };
}

export class ClaudeError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export async function callClaudeStream(systemPrompt, userMessage, { onTextDelta }) {
  const anthropic = getClient();
  const stream = await anthropic.messages.stream({
    model: config.model,
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    thinking: { type: "disabled" },
  });

  for await (const chunk of stream) {
    if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
      onTextDelta(chunk.delta.text);
    }
  }
}

export async function callClaude(systemPrompt, userMessage) {
  try {
    const text = await sendToClaude(systemPrompt, userMessage);
    return parseResponse(text);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes("timeout") || err.code === "ETIMEDOUT") {
        throw new ClaudeError("Claude API request timed out", "TIMEOUT");
      }
      if (err.status === 429) {
        throw new ClaudeError("Claude API rate limit exceeded", "RATE_LIMIT");
      }
      if (err.status === 401) {
        throw new ClaudeError("Claude API authentication failed", "AUTH_ERROR");
      }
      if (err.status === 403) {
        throw new ClaudeError("Claude API access forbidden", "AUTH_ERROR");
      }
    }
    throw new ClaudeError(`Claude API error: ${err.message}`, "API_ERROR");
  }
}

export default { callClaude, callClaudeStream, parseResponse, sendToClaude };
