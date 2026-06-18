import { describe, it, expect } from "vitest";

import {
  loadVoiceWorkerConfig,
  VoiceWorkerConfigError,
} from "@/workers/voice-agent";

/**
 * Unit tests for the voice worker config validation (S6 task 10.4).
 *
 * Validates: Requirement 9.3 — `loadVoiceWorkerConfig()` throws a named
 * {@link VoiceWorkerConfigError} listing each missing required env var, and
 * succeeds when all are present.
 */

const REQUIRED = [
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "LIVEKIT_AGENT_NAME",
  "DEEPGRAM_API_KEY",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
  "AGENT_SERVICE_TOKEN",
  "INTERNAL_API_URL",
] as const;

function fullEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    REQUIRED.map((k) => [k, `value-${k}`]),
  ) as NodeJS.ProcessEnv;
}

describe("loadVoiceWorkerConfig", () => {
  it("returns a structured config when every required var is present", () => {
    const cfg = loadVoiceWorkerConfig(fullEnv());
    expect(cfg.livekit.url).toBe("value-LIVEKIT_URL");
    expect(cfg.livekit.agentName).toBe("value-LIVEKIT_AGENT_NAME");
    expect(cfg.deepgram.apiKey).toBe("value-DEEPGRAM_API_KEY");
    expect(cfg.elevenlabs.voiceId).toBe("value-ELEVENLABS_VOICE_ID");
    expect(cfg.agentServiceToken).toBe("value-AGENT_SERVICE_TOKEN");
    expect(cfg.internalApiUrl).toBe("value-INTERNAL_API_URL");
  });

  it("throws a named error listing each missing required var", () => {
    for (const missing of REQUIRED) {
      const env = fullEnv();
      delete env[missing];
      try {
        loadVoiceWorkerConfig(env);
        throw new Error(`expected a throw for missing ${missing}`);
      } catch (err) {
        expect(err).toBeInstanceOf(VoiceWorkerConfigError);
        expect((err as VoiceWorkerConfigError).missing).toContain(missing);
        expect((err as VoiceWorkerConfigError).message).toContain(missing);
      }
    }
  });

  it("treats a blank/whitespace value as missing", () => {
    const env = fullEnv();
    env.DEEPGRAM_API_KEY = "   ";
    expect(() => loadVoiceWorkerConfig(env)).toThrow(VoiceWorkerConfigError);
  });
});
