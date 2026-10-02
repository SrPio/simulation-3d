import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Two pages: the room at / and the character studio at /study/.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        study: fileURLToPath(new URL('study/index.html', import.meta.url)),
      },
    },
  },
});
