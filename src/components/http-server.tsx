// ─────────────────────────────────────────────────────────────────────────────
// HttpServer Component
//
// Serves the static dashboard UI and exposes JSON API endpoints the
// frontend calls to fetch review data.
//
// Pattern taken directly from the CReact docs (Chapter 5: Giving It a
// Pretty Face). Uses Hono + @hono/node-server instead of raw http.createServer.
//
// Why Hono over raw Node http?
// - Clean route definitions instead of manual if/else URL matching
// - Proper MIME type handling built in
// - Same onMount/onCleanup lifecycle pattern as Channel
// - Aligns with the idiomatic CReact example project structure
//
// Two responsibilities:
//   1. Serve static files from resources/dashboard/ (the Preact UI)
//   2. JSON API routes the frontend polls for live data
// ─────────────────────────────────────────────────────────────────────────────

import { onMount, onCleanup } from '@creact-labs/creact';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { getReviewHistory } from './state';

interface HttpServerProps {
  port: number;
  /** Path to the static files directory, e.g. "./resources/dashboard" */
  path: string;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

export function HttpServer(props: HttpServerProps) {
  let server: ReturnType<typeof serve> | null = null;

  onMount(() => {
    const { port, path: staticPath } = props;
    const app = new Hono();

    // ── JSON API routes ────────────────────────────────────────────────────
    // These are what the Preact dashboard polls to render live data.
    // Keeping them here (co-located with the server) rather than in a
    // separate router keeps the surface area small and obvious.

    app.get('/api/health', (c) => {
      return c.json({ status: 'ok', uptime: process.uptime() });
    });

    app.get('/api/reviews', (c) => {
      const history = getReviewHistory();
      return c.json({
        reviews: history,
        total: history.length,
        stats: {
          approve: history.filter(r => r.verdict === 'approve').length,
          request_changes: history.filter(r => r.verdict === 'request_changes').length,
          comment: history.filter(r => r.verdict === 'comment').length,
        },
      });
    });

    // ── Static file server ─────────────────────────────────────────────────
    // Serves everything in resources/dashboard/.
    // Wildcard route is last so API routes above take priority.
    app.get('/*', (c) => {
      const url = c.req.path === '/' ? '/index.html' : c.req.path;
      const filePath = join(staticPath, url);

      if (!existsSync(filePath)) {
        return c.text('Not Found', 404);
      }

      const content = readFileSync(filePath);
      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      return c.body(content, 200, { 'Content-Type': contentType });
    });

    server = serve({ fetch: app.fetch, port }, () => {
      console.log(
        `[HttpServer] 🖥️  Dashboard running at http://localhost:${port} (serving ${staticPath})`
      );
    });
  });

  onCleanup(() => {
    if (server) {
      server.close();
      console.log('[HttpServer] 🛑 Dashboard server stopped');
    }
  });

  return <></>;
}