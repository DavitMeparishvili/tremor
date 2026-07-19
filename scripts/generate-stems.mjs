/**
 * Placeholder audio stem generator (M6) — synthesizes the tension-table stems
 * from ART_AUDIO_DIRECTION §5 as plain WAV files so the AudioDirector stack is
 * fully playable before any real audio is sourced. Per §6: "the placeholder
 * tier IS a milestone deliverable"; real stems replace these files 1:1.
 *
 * Loop hygiene (§5): every rhythmic stem is at THUMP_BPM = 60; loops are
 * mathematically seamless — periodic partials use integer cycle counts over
 * the 4 s loop, aperiodic (noise) content is tail-into-head crossfaded.
 *
 * Deterministic on purpose (seeded PRNG): re-running the script reproduces
 * byte-identical files.
 *
 * Usage: node scripts/generate-stems.mjs   (or `npm run gen:stems`)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 22050; // plenty for stems this dark; halves placeholder payload
const TWO_PI = Math.PI * 2;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "audio", "stems");

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const buffer = (seconds) => new Float32Array(Math.round(seconds * SR));

/** One-pole lowpass — cheap, stable, plenty for placeholder tone-shaping. */
function lowpass(x, cutoffHz) {
  const a = 1 - Math.exp((-TWO_PI * cutoffHz) / SR);
  const out = new Float32Array(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y += a * (x[i] - y);
    out[i] = y;
  }
  return out;
}

function highpass(x, cutoffHz) {
  const lp = lowpass(x, cutoffHz);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] - lp[i];
  return out;
}

function normalize(x, peak) {
  let m = 0;
  for (const v of x) m = Math.max(m, Math.abs(v));
  if (m > 0) {
    const g = peak / m;
    for (let i = 0; i < x.length; i++) x[i] *= g;
  }
  return x;
}

/**
 * Render `loopSeconds + fadeSeconds`, then blend the overhang back into the
 * head. Integer-cycle partials pass through unchanged (tail phase === head
 * phase); noise gets a seamless seam.
 */
function crossfadeLoop(x, fadeSeconds) {
  const n = Math.round(fadeSeconds * SR);
  const len = x.length - n;
  const out = new Float32Array(len);
  out.set(x.subarray(0, len));
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i] = x[i] * t + x[len + i] * (1 - t);
  }
  return out;
}

/** Pitch-falling sine burst — heartbeat lub/dub and the drill thump. */
function kick(x, atSeconds, f0, f1, decay, gain) {
  const start = Math.round(atSeconds * SR);
  const n = Math.round(0.4 * SR);
  let phase = 0;
  for (let i = 0; i < n && start + i < x.length; i++) {
    const t = i / SR;
    const f = f1 + (f0 - f1) * Math.exp(-t / 0.05);
    phase += (TWO_PI * f) / SR;
    x[start + i] += Math.sin(phase) * Math.exp(-t / decay) * gain;
  }
}

function writeWav(name, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  writeFileSync(join(OUT_DIR, name), buf);
  console.log(`wrote ${name.padEnd(16)} ${(buf.length / 1024).toFixed(0).padStart(4)} KB`);
}

mkdirSync(OUT_DIR, { recursive: true });

// ---- machinery.wav — engine/factory loop, enters at CALM -------------------
// Low sine stack (integer cycles / 4 s) chugging at 2 Hz over filtered noise.
{
  const rng = mulberry32(101);
  const x = buffer(4.15);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const chug = 0.7 + 0.3 * Math.sin(TWO_PI * 2 * t - Math.PI / 2);
    let v =
      0.45 * Math.sin(TWO_PI * 55 * t) +
      0.22 * Math.sin(TWO_PI * 82.5 * t + 1.1) +
      0.15 * Math.sin(TWO_PI * 110.25 * t + 2.3);
    v += (rng() * 2 - 1) * 0.5;
    x[i] = v * chug;
  }
  writeWav("machinery.wav", normalize(crossfadeLoop(lowpass(x, 400), 0.15), 0.8));
}

// ---- heartbeat.wav — 60 BPM lub-dub, enters at STIRRING --------------------
{
  const x = buffer(4);
  for (let beat = 0; beat < 4; beat++) {
    kick(x, beat, 62, 38, 0.12, 1.0);
    kick(x, beat + 0.22, 55, 36, 0.09, 0.7);
  }
  writeWav("heartbeat.wav", normalize(lowpass(x, 200), 0.85));
}

// ---- bassRumble.wav — subterranean rumble, enters at HUNTED ----------------
// Leaky-integrated (brown) noise, heavily lowpassed, undulating at 0.75 Hz.
{
  const rng = mulberry32(202);
  const x = buffer(4.2);
  let b = 0;
  for (let i = 0; i < x.length; i++) {
    b = b * 0.998 + (rng() * 2 - 1) * 0.02;
    x[i] = b;
  }
  const lp = lowpass(lowpass(x, 90), 90);
  for (let i = 0; i < lp.length; i++) {
    const t = i / SR;
    lp[i] *= 0.75 + 0.25 * Math.sin(TWO_PI * 0.75 * t);
  }
  writeWav("bassRumble.wav", normalize(crossfadeLoop(lp, 0.2), 0.85));
}

// ---- klaxon.wav — low distant alarm, enters at FRENZY ----------------------
// Slow 0.5 Hz siren sweep; phase integral is integer cycles over 4 s, so the
// loop is exact with no crossfade.
{
  const x = buffer(4);
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    phase += (TWO_PI * (300 + 45 * Math.sin(TWO_PI * 0.5 * t))) / SR;
    const v = Math.sin(phase) + 0.35 * Math.sin(2 * phase) + 0.15 * Math.sin(3 * phase);
    x[i] = v * (0.5 + 0.5 * Math.sin(TWO_PI * 0.5 * t - Math.PI / 2));
  }
  writeWav("klaxon.wav", normalize(lowpass(x, 700), 0.7));
}

// ---- subDrone.wav — sub-bass dread, enters at APEX -------------------------
// Two close sines beating at 0.5 Hz; all partials integer-cycle over 4 s.
{
  const x = buffer(4);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    x[i] =
      0.5 * Math.sin(TWO_PI * 41.25 * t) +
      0.45 * Math.sin(TWO_PI * 41.75 * t + 0.7) +
      0.18 * Math.sin(TWO_PI * 27.5 * t);
  }
  writeWav("subDrone.wav", normalize(x, 0.9));
}

// ---- thump.wav — drill impact one-shot (rhythm anchor) ---------------------
{
  const rng = mulberry32(303);
  const x = buffer(0.45);
  kick(x, 0, 90, 42, 0.11, 1.0);
  const clickN = Math.round(0.02 * SR);
  for (let i = 0; i < clickN; i++) {
    x[i] += (rng() * 2 - 1) * Math.exp(-(i / SR) / 0.006) * 0.5;
  }
  writeWav("thump.wav", normalize(lowpass(x, 900), 0.9));
}

// ---- podLaunch.wav — cashout sting: hydraulic whoosh + rising sweep --------
{
  const rng = mulberry32(404);
  const n = buffer(0.9);
  for (let i = 0; i < n.length; i++) n[i] = rng() * 2 - 1;
  const whoosh = highpass(lowpass(n, 2200), 350);
  const x = buffer(0.9);
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const f = 180 * Math.pow(4.5, Math.min(t, 0.55) / 0.55);
    phase += (TWO_PI * f) / SR;
    const env = t < 0.4 ? t / 0.4 : Math.exp(-(t - 0.4) / 0.18);
    let v = Math.sin(phase) * env * 0.6 + whoosh[i] * env * 0.5;
    if (t > 0.35) v += Math.sin(TWO_PI * 1320 * (t - 0.35)) * Math.exp(-(t - 0.35) / 0.12) * 0.25;
    x[i] = v;
  }
  writeWav("podLaunch.wav", normalize(x, 0.85));
}

// ---- betLock.wav — bet-accepted confirm: cargo clamp + rising two-note chirp
// The fiction: your stake latches onto the crawler. A short mechanical clunk
// grounds it; the ascending pings make it catchy without reading as a "win".
{
  const rng = mulberry32(606);
  const x = buffer(0.42);
  // Clamp clunk: quick pitch-falling thud + metal tick.
  kick(x, 0, 130, 62, 0.045, 0.85);
  const tickN = Math.round(0.012 * SR);
  for (let i = 0; i < tickN; i++) {
    x[i] += (rng() * 2 - 1) * Math.exp(-(i / SR) / 0.004) * 0.45;
  }
  // Two ascending pings, slightly detuned pairs for shimmer.
  const ping = (at, f, gain) => {
    const start = Math.round(at * SR);
    for (let i = 0; start + i < x.length; i++) {
      const t = i / SR;
      const env = Math.min(t / 0.004, 1) * Math.exp(-t / 0.07);
      x[start + i] +=
        (Math.sin(TWO_PI * f * t) + 0.6 * Math.sin(TWO_PI * f * 1.007 * t)) * env * gain;
    }
  };
  ping(0.05, 784, 0.4); // G5
  ping(0.14, 1175, 0.45); // D6
  writeWav("betLock.wav", normalize(x, 0.85));
}

// ---- chipTick.wav — chip-select UI tick; played at varying rates ----------
// A crisp tick: noise transient + bright ping + faint low body. BetPanel bends
// the playback rate so heavier stakes tick lower.
{
  const rng = mulberry32(707);
  const x = buffer(0.12);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    let v = Math.sin(TWO_PI * 1050 * t) * Math.exp(-t / 0.03) * 0.7;
    v += Math.sin(TWO_PI * 240 * t) * Math.exp(-t / 0.045) * 0.35;
    if (t < 0.004) v += (rng() * 2 - 1) * Math.exp(-t / 0.0015) * 0.6;
    x[i] = v;
  }
  writeWav("chipTick.wav", normalize(x, 0.8));
}

// ---- eruption.wav — the roar: sub drop + growl-modulated roar + grit -------
{
  const rng = mulberry32(505);
  const n = buffer(2.6);
  for (let i = 0; i < n.length; i++) n[i] = rng() * 2 - 1;
  const roarNoise = lowpass(n, 450);
  const grit = highpass(n, 1200);
  const x = buffer(2.6);
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const f = 30 + 90 * Math.exp(-t / 0.22);
    phase += (TWO_PI * f) / SR;
    const subEnv = Math.min(t / 0.02, 1) * Math.exp(-t / 0.9);
    const roarEnv = Math.min(t / 0.05, 1) * Math.exp(-t / 0.85);
    const growl = 0.55 + 0.45 * Math.sin(TWO_PI * 27 * t);
    x[i] =
      Math.sin(phase) * subEnv +
      Math.tanh(3.5 * roarNoise[i]) * growl * roarEnv * 0.8 +
      grit[i] * Math.exp(-t / 0.5) * 0.12;
  }
  writeWav("eruption.wav", normalize(x, 0.95));
}
