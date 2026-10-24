import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const DB_FILE = path.resolve(process.cwd(), '.wumun-db.json');

function loadDiskTree(): Record<string, any> {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch {
    // ignore read error
  }
  return {};
}

function saveDiskTree(tree: Record<string, any>): void {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(tree, null, 2), 'utf8');
  } catch {
    // ignore write error
  }
}

function mergeTrees(
  target: Record<string, any>,
  incoming: Record<string, any>
): Record<string, any> {
  const deletedSet = new Set<string>([
    ...(Array.isArray(target.__deletedCommittees) ? target.__deletedCommittees : []),
    ...(Array.isArray(incoming.__deletedCommittees) ? incoming.__deletedCommittees : []),
  ]);

  const mergedCommittees: Record<string, any> = {
    ...(target.committees || {}),
    ...(incoming.committees || {}),
  };
  delete mergedCommittees.__wumun_hub__;
  deletedSet.forEach(id => {
    delete mergedCommittees[id];
  });

  const targetConf = target.conference || {};
  const incomingConf = incoming.conference || {};
  const mergedConference: Record<string, any> = {
    ...targetConf,
    ...incomingConf,
    admins: { ...(targetConf.admins || {}), ...(incomingConf.admins || {}) },
    approvedUsers: {
      ...(targetConf.approvedUsers || {}),
      ...(incomingConf.approvedUsers || {}),
    },
    settings: { ...(targetConf.settings || {}), ...(incomingConf.settings || {}) },
    notifications: {
      ...(targetConf.notifications || {}),
      ...(incomingConf.notifications || {}),
    },
  };

  const mergedUsers: Record<string, any> = {
    ...(target.users || {}),
    ...(incoming.users || {}),
  };

  return {
    ...target,
    ...incoming,
    committees: mergedCommittees,
    conference: mergedConference,
    users: mergedUsers,
    __deletedCommittees: Array.from(deletedSet),
  };
}

function applySetAt(tree: Record<string, any>, segments: string[], value: any): void {
  if (segments.length === 2 && segments[0] === 'committees') {
    const commId = segments[1];
    const deleted = new Set<string>(
      Array.isArray(tree.__deletedCommittees) ? tree.__deletedCommittees : []
    );
    if (value === null || value === undefined) {
      deleted.add(commId);
    } else {
      deleted.delete(commId);
    }
    tree.__deletedCommittees = Array.from(deleted);
  }

  if (segments.length === 0) {
    Object.keys(tree).forEach(k => delete tree[k]);
    if (value && typeof value === 'object') {
      Object.assign(tree, value);
    }
    return;
  }

  let curr: any = tree;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (curr[seg] === null || curr[seg] === undefined || typeof curr[seg] !== 'object') {
      curr[seg] = {};
    }
    curr = curr[seg];
  }
  const last = segments[segments.length - 1];
  if (value === null || value === undefined) {
    delete curr[last];
  } else {
    curr[last] = value;
  }
}

function createWumunSyncMiddleware() {
  let serverTree: Record<string, any> = loadDiskTree();
  const sseClients = new Set<ServerResponse>();

  const broadcast = () => {
    const payload = `data: ${JSON.stringify({ tree: serverTree, ts: Date.now() })}\n\n`;
    sseClients.forEach(res => {
      try {
        res.write(payload);
      } catch {
        sseClients.delete(res);
      }
    });
  };

  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url || '';
    if (!url.startsWith('/__wumun_sync__')) {
      return next();
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (url.startsWith('/__wumun_sync__/events') && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify({ tree: serverTree, ts: Date.now() })}\n\n`);
      sseClients.add(res);
      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ tree: serverTree, ts: Date.now() }));
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body || '{}');
          if (parsed.op === 'set' && Array.isArray(parsed.segments)) {
            applySetAt(serverTree, parsed.segments, parsed.value);
          } else if (parsed.op === 'merge' && parsed.tree && typeof parsed.tree === 'object') {
            serverTree = mergeTrees(serverTree, parsed.tree);
          }
          saveDiskTree(serverTree);
          broadcast();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, tree: serverTree, ts: Date.now() }));
        } catch (err) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });
      return;
    }

    next();
  };
}

function wumunSyncPlugin() {
  const middleware = createWumunSyncMiddleware();
  return {
    name: 'wumun-global-sync',
    configureServer(server: any) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(middleware);
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), wumunSyncPlugin()],
  build: {
    outDir: 'build',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    css: true,
    reporters: ['verbose'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*'],
      exclude: [],
    },
  },
});
