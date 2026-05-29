import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import config from "./config.js";

class EdgeTTS {
  constructor() {
    this._synthesizing = false;
    this._tts = null;
    this._lastVoice = null;
    this._lastRate = null;
    this._lastPitch = null;
  }

  /**
   * 使用 Microsoft Edge TTS 合成语音，流式回调 MP3 Buffer。
   * 复用 MsEdgeTTS 实例以避免重复 WebSocket 握手。
   */
  async synthesize(text, onAudioChunk, emotion) {
    if (!text?.trim()) throw new Error("Text cannot be empty");

    while (this._synthesizing) {
      await new Promise((r) => setTimeout(r, 50));
    }
    this._synthesizing = true;

    try {
      const ttsConfig = config.tts;

      const EMOTION_PROPS = {
        cheerful: { rate: "+8%", pitch: "+10Hz" },
        excited: { rate: "+12%", pitch: "+15Hz" },
        gentle: { rate: "-10%", pitch: "-5Hz" },
      };
      const emotionProps = EMOTION_PROPS[emotion] || null;
      const rate = emotionProps?.rate || ttsConfig.edgeRate;
      const pitch = emotionProps?.pitch || ttsConfig.edgePitch;
      const voice = ttsConfig.edgeVoice;

      const displayText = text.length > 40 ? text.slice(0, 40) + "..." : text;
      const emotionSuffix = emotionProps ? ` (emotion: ${emotion})` : "";
      console.log(`[edge-tts] Synthesizing: "${displayText}" (${text.length} chars)${emotionSuffix}`);

      const paramsChanged = !this._tts || voice !== this._lastVoice || rate !== this._lastRate || pitch !== this._lastPitch;

      if (!this._tts) {
        this._tts = new MsEdgeTTS();
      }

      if (paramsChanged) {
        console.log(`[edge-tts] Voice: ${voice}, Rate: ${rate}, Pitch: ${pitch}`);
        await this._tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {});
        this._lastVoice = voice;
        this._lastRate = rate;
        this._lastPitch = pitch;
      }

      const result = await this._streamWithRetry(text, rate, pitch, onAudioChunk);

      return result;
    } finally {
      this._synthesizing = false;
    }
  }

  async _streamWithRetry(text, rate, pitch, onAudioChunk) {
    try {
      const { audioStream } = this._tts.toStream(text.trim(), { rate, pitch });
      let audioSize = 0;
      for await (const chunk of audioStream) {
        audioSize += chunk.length;
        if (onAudioChunk) onAudioChunk(chunk);
      }
      const audioLength = Math.round((audioSize / 6000) * 1000);
      console.log(`[edge-tts] Synthesis complete: ${audioSize} bytes, ~${audioLength}ms`);
      return { audioSize, audioLength };
    } catch (err) {
      // 连接可能已断开，重建实例重试一次
      console.warn("[edge-tts] Stream error, retrying with new connection:", err.message);
      this._tts = new MsEdgeTTS();
      await this._tts.setMetadata(this._lastVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {});
      this._lastRate = null; // force re-set next time
      this._lastPitch = null;
      const { audioStream } = this._tts.toStream(text.trim(), { rate, pitch });
      let audioSize = 0;
      for await (const chunk of audioStream) {
        audioSize += chunk.length;
        if (onAudioChunk) onAudioChunk(chunk);
      }
      const audioLength = Math.round((audioSize / 6000) * 1000);
      console.log(`[edge-tts] Retry complete: ${audioSize} bytes, ~${audioLength}ms`);
      return { audioSize, audioLength };
    }
  }

  close() {
    if (this._tts) {
      try { this._tts.close(); } catch {}
      this._tts = null;
    }
    this._lastVoice = null;
    this._lastRate = null;
    this._lastPitch = null;
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

let instance = null;

export function getEdgeTTS() {
  if (!instance) {
    instance = new EdgeTTS();
  }
  return instance;
}

export async function initEdgeTTS() {
  return getEdgeTTS();
}

export async function shutdownEdgeTTS() {
  if (instance) {
    instance.close();
    instance = null;
  }
}

export default { getEdgeTTS, initEdgeTTS, shutdownEdgeTTS };
