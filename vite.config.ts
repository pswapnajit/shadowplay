/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { fileURLToPath } from 'node:url';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Serves the story and voice endpoints (api/story.ts and api/voice.ts on
 * Vercel) from the dev server, so the Lantern can be tested locally with the
 * keys in .env.
 */
function storyApi(): Plugin {
  return {
    name: 'shadowplay-story-api',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '');
      for (const k of ['ANTHROPIC_API_KEY', 'STORY_MODEL', 'STORY_EFFORT', 'STORY_SECRET', 'STORY_DISABLED', 'OPENAI_API_KEY', 'VOICE_MODEL', 'VOICE_NAME', 'VOICE_DISABLED']) {
        if (env[k] && !process.env[k]) process.env[k] = env[k];
      }
      process.env.STORY_RATE_PER_HOUR ??= '2000';
      process.env.VOICE_RATE_PER_HOUR ??= '5000';
      type Handler = (request: Request) => Promise<Response>;
      const route = (path: string, module: string, name: string) =>
        server.middlewares.use(path, async (req, res) => {
          try {
            const handle = (await server.ssrLoadModule(module))[name] as Handler;
            const chunks: Buffer[] = [];
            for await (const c of req) chunks.push(c as Buffer);
            // Same origin by construction (this dev server's own page, possibly opened by IP on a headset).
            const request = new Request(`http://localhost${path}`, {
              method: req.method,
              headers: { 'content-type': 'application/json', origin: 'http://localhost' },
              body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
            });
            const response = await handle(request);
            res.statusCode = response.status;
            response.headers.forEach((v, k) => {
              if (!k.startsWith('access-control-')) res.setHeader(k, v);
            });
            const reader = response.body?.getReader();
            res.on('close', () => void reader?.cancel().catch(() => {}));
            while (reader) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(value);
            }
            res.end();
          } catch (error) {
            res.statusCode = 500;
            res.end(JSON.stringify({ type: 'error', code: 'unavailable', message: (error as Error).message }));
          }
        });
      route('/api/story', '/server/story.ts', 'handleStory');
      route('/api/voice', '/server/voice.ts', 'handleVoice');
    },
  };
}

export default defineConfig({
  plugins: [iwsdkDev(), storyApi()],
  server: { host: '0.0.0.0', port: 8081, open: false },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (three@0.185 vs app super-three@0.181). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    alias: {
      // see src/stubs/uikit-lucide.ts
      '@pmndrs/uikit-lucide': fileURLToPath(new URL('./src/stubs/uikit-lucide.ts', import.meta.url)),
    },
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
