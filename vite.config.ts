import { fileURLToPath } from 'node:url';
import { defineConfig, type Connect, type Plugin } from 'vite';
import { handleLikes, memoryStore } from './api/likes.ts';

/**
 * /api/likes on the local dev and preview servers: the deployed function's own handler with a counter kept in
 * memory (it starts at 0 and never touches the real one). On Vercel the `api/` folder serves it instead.
 */
function localLikes(): Plugin {
  const store = memoryStore();
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    if (req.url?.split('?')[0] !== '/api/likes') return next();
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(name, value);
    }
    // As on Vercel, the address is the connection's, never a header the client sent.
    headers.set('x-real-ip', req.socket.remoteAddress ?? '');
    headers.delete('x-forwarded-for');
    const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, { method: req.method, headers });
    void handleLikes(request, store, 'local-dev-secret').then(async (response) => {
      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      res.end(await response.text());
    });
  };
  return {
    name: 'local-likes',
    configureServer: (server) => { server.middlewares.use(middleware); },
    configurePreviewServer: (server) => { server.middlewares.use(middleware); },
  };
}

// Two pages: the room at / and the character studio at /study/.
export default defineConfig({
  plugins: [localLikes()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        study: fileURLToPath(new URL('study/index.html', import.meta.url)),
      },
    },
  },
});
