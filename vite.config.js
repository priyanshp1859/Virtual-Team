import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export default defineConfig(({ mode }) => ({
  // Keep CSS configuration inside this repository, including isolated agent clones.
  css: { postcss: {} },
  plugins: [{
    name: 'virtual-team-local-api',
    configureServer(server) {
      const environment = loadEnv(mode, process.cwd(), '');
      for (const key of ['DATABASE_URL', 'POSTGRES_URL', 'WORKSPACE_ACCESS_CODE', 'SESSION_SECRET', 'SAM_RUNTIME_ENABLED']) {
        if (!process.env[key] && environment[key]) process.env[key] = environment[key];
      }
      server.middlewares.use(async (request, response, next) => {
        const path = request.url?.split('?')[0];
        const routes = { '/api/session': './api/session.js', '/api/workspace': './api/workspace.js', '/api/projects': './api/projects.js' };
        if (!routes[path]) return next();
        try {
          const { default: handler } = await import(pathToFileURL(resolve(process.cwd(), routes[path])).href);
          await handler(request, response);
        } catch (error) {
          console.error('Local API request failed:', error.name);
          response.statusCode = 503;
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(JSON.stringify({ error: 'The workspace service is unavailable.' }));
        }
      });
    },
  }],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules') && id.includes('three')) return 'three';
        },
      },
    },
  },
}));
