import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";

export default async (_req: Request, _context: Context) => {
  const store = getStore("trackcare-relay", { consistency: "strong" });
  const latest = await store.get("latest", { type: "json" });
  return Response.json(latest || { v: "", s: "", i: "", d: "", updatedAt: null }, { headers: { "cache-control": "no-store, max-age=0" } });
};

export const config: Config = { path: "/latest" };
