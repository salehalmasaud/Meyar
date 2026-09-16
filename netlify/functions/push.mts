import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

function b64urlToBytes(input: string): Uint8Array {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}
function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(sig));
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
  const secret = Netlify.env.get("TRACKCARE_SECRET");
  if (!secret) return new Response("Server not configured", { status: 500 });
  const url = new URL(req.url);
  const v = url.searchParams.get("v") || "";
  const s = url.searchParams.get("s") || "";
  const i = url.searchParams.get("i") || "";
  const d = url.searchParams.get("d") || "";
  const sig = (url.searchParams.get("sig") || "").toLowerCase();
  if (!v || !s || !i || !d || !sig) return new Response("Missing parameters", { status: 400 });
  if (v.length > 32 || s.length > 64 || i.length > 64 || d.length > 12000 || sig.length !== 64) return new Response("Invalid parameters", { status: 400 });
  try {
    if (b64urlToBytes(s).length !== 16 || b64urlToBytes(i).length !== 12 || b64urlToBytes(d).length < 17) return new Response("Invalid payload", { status: 400 });
  } catch { return new Response("Invalid payload", { status: 400 }); }
  const message = `${v}.${s}.${i}.${d}`;
  const expected = await hmacHex(secret, message);
  if (!timingSafeEqual(expected, sig)) return new Response("Unauthorized", { status: 401 });
  const store = getStore("trackcare-relay", { consistency: "strong" });
  await store.setJSON("latest", { v, s, i, d, updatedAt: new Date().toISOString() });
  return new Response("OK", { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
};

export const config: Config = { path: "/push" };
