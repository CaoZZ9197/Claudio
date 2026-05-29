import config from "./config.js";

const MINIMAX_HTTP_URL = "https://api.minimaxi.com/v1/t2a_v2";

class MiniMaxTTS {
  constructor() {
    this._synthesizing = false;
  }

  /**
   * 合成语音文本，通过 onAudioChunk 回调返回解码后的音频 Buffer
   * 使用 HTTP 流式 API，边接收边回调
   * @param {string} text - 要合成的文本
   * @param {(chunk: Buffer) => void} onAudioChunk - 音频数据回调
   * @returns {Promise<{audioSize: number, audioLength: number}>}
   */
  async synthesize(text, onAudioChunk, emotion) {
    if (!text?.trim()) throw new Error("Text cannot be empty");

    // 串行锁：同一时间只允许一个合成任务
    while (this._synthesizing) {
      await new Promise((r) => setTimeout(r, 50));
    }
    this._synthesizing = true;

    try {
      const apiKey = config.apiKeys.minimax;
      if (!apiKey) {
        throw new Error("MiniMax API key not configured");
      }

      const voiceSettings = config.tts;

      // 情感映射：DJ emotion → MiniMax emotion
      const EMOTION_MAP = {
        cheerful: "happy",
        excited: "surprised",
        gentle: "sad",
        calm: "calm",
      };
      const minimaxEmotion = EMOTION_MAP[emotion] || null;

      const displayText = text.length > 40 ? text.slice(0, 40) + "..." : text;
      const emotionSuffix = minimaxEmotion ? ` (emotion: ${emotion}→${minimaxEmotion})` : "";
      console.log(`[minimax-tts] Synthesizing: "${displayText}" (${text.length} chars)${emotionSuffix}`);

      const voiceSetting = {
        voice_id: voiceSettings.voiceId,
        speed: voiceSettings.speed,
        vol: voiceSettings.vol,
        pitch: voiceSettings.pitch,
        english_normalization: false,
      };
      if (minimaxEmotion) {
        voiceSetting.emotion = minimaxEmotion;
      }

      const response = await fetch(MINIMAX_HTTP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({

          model: "speech-2.8-hd",
          text: text.trim(),
          stream: false,
          voice_setting: voiceSetting,
          audio_setting: {
            sample_rate: 32000,
            bitrate: 128000,
            format: "mp3",
            channel: 1,
          },
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText}`);
      }

      const json = await response.json();

      if (json.base_resp && json.base_resp.status_code !== 0) {
        const errMsg = json.base_resp.status_msg || `MiniMax TTS error (code=${json.base_resp.status_code})`;
        console.error(`[minimax-tts] API error: ${errMsg}`);
        throw new Error(errMsg);
      }

      const audioBuffer = Buffer.from(json.data.audio, "hex");
      if (onAudioChunk) onAudioChunk(audioBuffer);

      const audioLength = json.extra_info?.audio_length || 0;
      console.log(`[minimax-tts] Synthesis complete: ${audioBuffer.length} bytes, ${audioLength}ms`);
      return { audioSize: audioBuffer.length, audioLength };
    } finally {
      this._synthesizing = false;
    }
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

let instance = null;

export function getMiniMaxTTS() {
  if (!instance) {
    instance = new MiniMaxTTS();
  }
  return instance;
}

export async function initMiniMaxTTS() {
  // HTTP API 无需初始化连接，跳过
  return getMiniMaxTTS();
}

export async function shutdownMiniMaxTTS() {
  if (instance) {
    instance = null;
  }
}

export default { getMiniMaxTTS, initMiniMaxTTS, shutdownMiniMaxTTS };