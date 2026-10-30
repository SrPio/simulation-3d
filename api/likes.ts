/**
 * The like counter of the room page: one number shared by every visitor, kept in Upstash Redis.
 *
 * GET  /api/likes → { likes } (cached a few seconds by Vercel's CDN, so polling visitors barely reach Redis).
 * POST /api/likes → { likes, counted, retryAfter }: adds exactly one like, at most once a day per visitor.
 *
 * Nothing the client sends is trusted or even read: no body, no amount, no visitor id. A visitor is the client's IP
 * as Vercel reports it (an IPv6 address by its /64 network, which one household usually holds whole), turned into
 * an HMAC with a server secret so no address is ever stored. Taking the visitor's slot and adding the like happen in
 * one Redis script, so two presses at once cannot both count. Likes are only ever added one at a time; nothing
 * here sets, lowers or deletes the total. A POST must come from a page of this same site (Origin and
 * Sec-Fetch-Site), so no other site can make its visitors like this one. No CORS headers: other sites cannot read
 * the replies either. Errors say nothing about the reason.
 *
 * This file imports nothing local: Vercel builds it on its own. `vite.config.ts` serves the same handler with an
 * in-memory store for `pnpm dev` and `pnpm preview`, and `tests/likes.test.ts` checks it.
 */

declare const process: { env: Record<string, string | undefined> };

/** One like per visitor per day (s). */
export const LIKE_WINDOW = 24 * 60 * 60;
const TOTAL_KEY = 'likes:total';
const VOTER_PREFIX = 'likes:voter:';

export type LikeResult = { total: number; counted: boolean; retryAfter: number };

export type LikeStore = {
  count(): Promise<number>;
  /** One more like unless `voter` already liked within `window` seconds (then `retryAfter` says how long is left). */
  like(voter: string, window: number): Promise<LikeResult>;
};

export const GET = serve;
export const POST = serve;

function serve(request: Request): Promise<Response> {
  // The hashing secret: its own variable if set, else the Redis token (also secret, and only on the server).
  const secret = process.env.LIKES_SECRET ?? process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return handleLikes(request, upstashStore(), secret);
}

/** The whole endpoint, with the store and the hashing secret passed in (for the dev server and the tests). */
export async function handleLikes(request: Request, store: LikeStore | undefined, secret: string | undefined): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return reply(405, { error: 'method' }, { Allow: 'GET, POST' });
  if (!store || !secret) return reply(503, { error: 'unavailable' });
  try {
    if (request.method === 'GET') {
      // Shared by everyone: the CDN keeps it 5 s and serves the old value while it asks again.
      return reply(200, { likes: await store.count() }, { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=25' });
    }
    if (!sameSite(request)) return reply(403, { error: 'origin' });
    const address = clientAddress(request.headers);
    if (!address) return reply(400, { error: 'client' });
    const result = await store.like(await voterId(address, secret), LIKE_WINDOW);
    const body = { likes: result.total, counted: result.counted, retryAfter: result.retryAfter };
    return result.counted ? reply(200, body) : reply(429, body, { 'Retry-After': String(result.retryAfter) });
  } catch {
    // The reason (Redis down, bad credentials…) stays on the server.
    console.error('likes: store unavailable');
    return reply(503, { error: 'unavailable' });
  }
}

function reply(status: number, body: object, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

/** Whether a POST comes from a page of this same site: its Origin is this host, and the browser does not call it cross-site. */
export function sameSite(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') return false;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const host = request.headers.get('host') ?? new URL(request.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * The client's address as Vercel sets it (Vercel overwrites these headers, a client cannot choose them), an IPv6
 * address cut to its /64 network. Undefined when there is none or it does not look like an address.
 */
export function clientAddress(headers: Headers): string | undefined {
  const raw = (headers.get('x-real-ip') ?? headers.get('x-forwarded-for')?.split(',')[0] ?? '').trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(raw)) return raw;
  if (!raw.includes(':') || !/^[0-9a-f:.]+$/i.test(raw)) return undefined;
  // An IPv4 address carried in IPv6 (::ffff:1.2.3.4) is that IPv4 address.
  const mapped = /^::ffff:(\d{1,3}(\.\d{1,3}){3})$/i.exec(raw);
  if (mapped) return mapped[1];
  const groups = expandIpv6(raw);
  return groups ? `${groups.slice(0, 4).join(':')}::/64` : undefined;
}

function expandIpv6(address: string): string[] | undefined {
  const halves = address.toLowerCase().split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return undefined;
  return groups.map((group) => group.replace(/^0+(?=.)/, ''));
}

/** The visitor's key: an HMAC of the address with the server secret, so the store never holds an address. */
export async function voterId(address: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`likes:${address}`)));
  return Array.from(signature.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Takes the visitor's slot for the window and adds the like in one step, or reports how long the slot has left.
const LIKE_SCRIPT = `
if redis.call('SET', KEYS[2], '1', 'NX', 'EX', ARGV[1]) then
  return {redis.call('INCR', KEYS[1]), 1, 0}
end
return {tonumber(redis.call('GET', KEYS[1]) or '0'), 0, redis.call('TTL', KEYS[2])}`;

/** Upstash Redis over its REST API (the variables Vercel's Upstash integration adds); undefined when not set up. */
function upstashStore(): LikeStore | undefined {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return undefined;
  const command = async (args: (string | number)[]): Promise<unknown> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(4000),
    });
    const data = await response.json() as { result?: unknown; error?: string };
    if (!response.ok || data.error !== undefined) throw new Error('upstash');
    return data.result;
  };
  return {
    async count() {
      return toCount(await command(['GET', TOTAL_KEY]));
    },
    async like(voter, window) {
      const result = await command(['EVAL', LIKE_SCRIPT, 2, TOTAL_KEY, VOTER_PREFIX + voter, window]);
      if (!Array.isArray(result) || result.length !== 3) throw new Error('upstash');
      return { total: toCount(result[0]), counted: result[1] === 1, retryAfter: Math.max(0, Number(result[2]) || 0) };
    },
  };
}

function toCount(value: unknown): number {
  const count = Number(value ?? 0);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('count');
  return count;
}

/** The same store kept in memory, for the local dev and preview servers and the tests. */
export function memoryStore(now: () => number = Date.now): LikeStore {
  let total = 0;
  const voters = new Map<string, number>();
  return {
    async count() {
      return total;
    },
    async like(voter, window) {
      const until = voters.get(voter);
      const left = until === undefined ? 0 : Math.ceil((until - now()) / 1000);
      if (left > 0) return { total, counted: false, retryAfter: left };
      voters.set(voter, now() + window * 1000);
      total += 1;
      return { total, counted: true, retryAfter: 0 };
    },
  };
}
