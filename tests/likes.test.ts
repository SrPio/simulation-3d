import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIKE_WINDOW, clientAddress, handleLikes, memoryStore, voterId, type LikeStore } from '../api/likes.ts';
import { LIKE_WINDOW_MS, LikeCounter, formatLikes, readReply } from '../src/core/likes.ts';

const SITE = 'https://3d-andres-jaramillo.is-a.dev';
const SECRET = 'test-secret';

function post(ip: string | undefined, headers: Record<string, string> = { origin: SITE, 'sec-fetch-site': 'same-origin' }): Request {
  const all = new Headers({ host: new URL(SITE).host, ...headers });
  if (ip) all.set('x-real-ip', ip);
  return new Request(`${SITE}/api/likes`, { method: 'POST', headers: all });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

test('GET reports the shared count, cached briefly by the CDN', async () => {
  const store = memoryStore();
  const response = await handleLikes(new Request(`${SITE}/api/likes`), store, SECRET);
  assert.equal(response.status, 200);
  assert.deepEqual(await json(response), { likes: 0 });
  assert.match(response.headers.get('cache-control') ?? '', /s-maxage=5/);
  assert.equal(response.headers.get('access-control-allow-origin'), null, 'no CORS: other sites cannot read it');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('a visitor likes once a day; another visitor still can', async () => {
  let now = 1_000_000;
  const store = memoryStore(() => now);
  const first = await handleLikes(post('203.0.113.7'), store, SECRET);
  assert.equal(first.status, 200);
  assert.deepEqual(await json(first), { likes: 1, counted: true, retryAfter: 0 });
  assert.equal(first.headers.get('cache-control'), 'no-store');
  const again = await handleLikes(post('203.0.113.7'), store, SECRET);
  assert.equal(again.status, 429);
  const body = await json(again);
  assert.equal(body.likes, 1);
  assert.equal(body.retryAfter, LIKE_WINDOW);
  assert.equal(again.headers.get('retry-after'), String(LIKE_WINDOW));
  assert.equal((await json(await handleLikes(post('198.51.100.20'), store, SECRET))).likes, 2);
  now += (LIKE_WINDOW - 60) * 1000;
  assert.equal((await handleLikes(post('203.0.113.7'), store, SECRET)).status, 429, 'still within the day');
  now += 61 * 1000;
  assert.equal((await json(await handleLikes(post('203.0.113.7'), store, SECRET))).likes, 3, 'a day later it counts again');
});

test('presses at the same moment from one visitor count once', async () => {
  const store = memoryStore();
  const replies = await Promise.all(Array.from({ length: 8 }, () => handleLikes(post('203.0.113.9'), store, SECRET)));
  assert.equal(replies.filter((reply) => reply.status === 200).length, 1);
  assert.equal(await store.count(), 1);
});

test('a like from another site, or with no origin, is refused and not counted', async () => {
  const store = memoryStore();
  const refused = [
    post('203.0.113.7', {}),
    post('203.0.113.7', { origin: 'https://evil.example' }),
    post('203.0.113.7', { origin: SITE, 'sec-fetch-site': 'cross-site' }),
    post('203.0.113.7', { origin: 'not a url' }),
  ];
  for (const request of refused) assert.equal((await handleLikes(request, store, SECRET)).status, 403);
  assert.equal((await handleLikes(post(undefined), store, SECRET)).status, 400, 'no client address');
  assert.equal((await handleLikes(post('<script>'), store, SECRET)).status, 400);
  assert.equal(await store.count(), 0);
});

test('other methods, a missing store or secret, and store failures say nothing more', async () => {
  const store = memoryStore();
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    assert.equal((await handleLikes(new Request(`${SITE}/api/likes`, { method }), store, SECRET)).status, 405);
  }
  assert.equal((await handleLikes(post('203.0.113.7'), undefined, SECRET)).status, 503);
  assert.equal((await handleLikes(post('203.0.113.7'), store, undefined)).status, 503);
  const broken: LikeStore = { count: () => Promise.reject(new Error('redis://user:password@host')), like: () => Promise.reject(new Error('down')) };
  const errors = console.error;
  console.error = () => {};
  try {
    for (const request of [new Request(`${SITE}/api/likes`), post('203.0.113.7')]) {
      const response = await handleLikes(request, broken, SECRET);
      assert.equal(response.status, 503);
      assert.deepEqual(await json(response), { error: 'unavailable' });
    }
  } finally {
    console.error = errors;
  }
});

test('the client address comes from the platform headers; IPv6 counts by its /64 network', () => {
  const address = (value: Record<string, string>) => clientAddress(new Headers(value));
  assert.equal(address({ 'x-real-ip': '203.0.113.7' }), '203.0.113.7');
  assert.equal(address({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }), '203.0.113.7');
  assert.equal(address({ 'x-real-ip': '::ffff:203.0.113.7' }), '203.0.113.7');
  const a = address({ 'x-real-ip': '2001:db8:aa:bb:1:2:3:4' });
  assert.equal(a, '2001:db8:aa:bb::/64');
  assert.equal(address({ 'x-real-ip': '2001:db8:aa:bb::99' }), a, 'same household network');
  assert.equal(address({ 'x-real-ip': '2001:0db8:00aa:00bb:ffff::' }), a, 'leading zeros');
  assert.notEqual(address({ 'x-real-ip': '2001:db8:aa:cc::1' }), a);
  for (const bad of ['', 'localhost', '1:2:3', '1::2::3', 'g::1', '203.0.113.7; DROP']) assert.equal(address({ 'x-real-ip': bad }), undefined, bad);
});

test('visitors are kept as keyed hashes, never as addresses', async () => {
  const id = await voterId('203.0.113.7', SECRET);
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(await voterId('203.0.113.7', SECRET), id);
  assert.notEqual(await voterId('203.0.113.8', SECRET), id);
  assert.notEqual(await voterId('203.0.113.7', 'another'), id, 'without the secret the hash cannot be rebuilt');
});

test('the page only believes well-formed replies and paints the count short', () => {
  assert.deepEqual(readReply({ likes: 12, retryAfter: 30 }), { likes: 12, retryAfter: 30 });
  for (const bad of [null, 'x', {}, { likes: -1 }, { likes: 1.5 }, { likes: '9' }, { likes: 2 ** 60 }]) assert.equal(readReply(bad), undefined);
  assert.equal(readReply({ likes: 1, retryAfter: 1e12 })?.retryAfter, LIKE_WINDOW_MS / 1000, 'a wait longer than a day is cut');
  assert.equal(formatLikes(undefined), '—');
  assert.equal(formatLikes(0), '0');
  assert.equal(formatLikes(9999), '9999');
  assert.equal(formatLikes(12_345), '12.3k');
  assert.equal(formatLikes(125_900), '125k');
  assert.equal(formatLikes(1_250_000), '1.2M');
});

function fakeStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => { items.delete(key); },
    setItem: (key, value) => { items.set(key, value); },
  };
}

/** The page's counter talking to the real handler, as from one address. */
function counter(store: LikeStore, storage = fakeStorage(), now = () => 1_000_000, ip = '203.0.113.7'): LikeCounter {
  return new LikeCounter({
    url: '/api/likes',
    storage,
    now,
    fetch: (_input, init) => handleLikes(init?.method === 'POST' ? post(ip) : new Request(`${SITE}/api/likes`), store, SECRET),
  });
}

test('the page shows its like at once, keeps it lit for the day and cannot like twice', async () => {
  const store = memoryStore();
  const storage = fakeStorage();
  const page = counter(store, storage);
  await page.refresh();
  assert.equal(page.likes, 0);
  const liking = page.like();
  assert.equal(page.likes, 1, 'shown before the server answers');
  assert.equal(await liking, true);
  assert.equal(page.liked, true);
  assert.equal(await page.like(), false);
  assert.equal(await store.count(), 1);
  // A new visit from the same connection with its storage cleared: the server still says no, and the key lights.
  const cleared = counter(store);
  await cleared.refresh();
  assert.equal(await cleared.like(), true);
  assert.equal(cleared.likes, 1);
  assert.equal(cleared.liked, true);
  assert.equal(await store.count(), 1);
});

test('when the server is out of reach the like is taken back and the count is a dash', async () => {
  const page = new LikeCounter({ url: '/api/likes', fetch: () => Promise.reject(new Error('offline')) });
  await page.refresh();
  assert.equal(page.likes, undefined);
  assert.equal(await page.like(), false);
  assert.equal(page.liked, false);
  assert.equal(page.likes, undefined);
});

test('a stored like time from the far future is not believed, and blocked storage is fine', () => {
  const storage = fakeStorage();
  storage.setItem('simulation-3d:liked-until', String(1_000_000 + LIKE_WINDOW_MS * 10));
  assert.equal(counter(memoryStore(), storage).liked, false);
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
  assert.equal(counter(memoryStore(), blocked).liked, false);
});
