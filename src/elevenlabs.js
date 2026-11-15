// ElevenLabs pieces: verifying the post-call webhook signature, and
// turning Juno's confirmation into an mp3 with text-to-speech.

import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const TOLERANCE_MS = 30 * 60 * 1000;

// Signature header format: "t=<unix seconds>,v0=<hex hmac-sha256 of `${t}.${rawBody}`>".
export function signWebhook(rawBody, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const hmac = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v0=${hmac}`;
}

// Returns true only for a fresh, correctly signed body.
export function verifyWebhook(rawBody, header, secret, now = Date.now()) {
  if (!secret || !header) return false;
  const parts = String(header).split(",");
  const t = parts.find((p) => p.startsWith("t="))?.slice(2);
  const v0 = parts.find((p) => p.startsWith("v0="))?.slice(3);
  if (!t || !v0) return false;
  if (Number(t) * 1000 < now - TOLERANCE_MS) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "hex"), b = Buffer.from(v0, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// Text-to-speech. Saves public/audio/<id>.mp3 and returns its public URL, or "" on failure.
export async function makeVoiceMessage(text, id, { publicDir = "public" } = {}) {
  const apiKey = process.env.ELEVENLABS_API_KEY, voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId || !text) return "";
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) { console.warn("tts: failed", res.status, (await res.text()).slice(0, 200)); return ""; }
    const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, "");
    const dir = path.join(publicDir, "audio");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${safeId}.mp3`), Buffer.from(await res.arrayBuffer()));
    return `${process.env.PUBLIC_URL || ""}/audio/${safeId}.mp3`;
  } catch (e) {
    console.warn("tts: failed", e.message);
    return "";
  }
}
