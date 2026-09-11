const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

// Explicit routes keep this static server from exposing project or source files.
const assets = {
  '/': ['index.html', 'text/html'],
  '/styles.css': ['styles.css', 'text/css'],
  '/app.js': ['app.js', 'text/javascript'],
};

function createServer() {
  return http.createServer(async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
      return;
    }
    const asset = assets[req.url.split('?')[0]];
    if (!asset) {
      res.writeHead(404).end('Not found');
      return;
    }
    try {
      const body = await readFile(path.join(__dirname, 'public', asset[0]));
      res.writeHead(200, {
        'Content-Type': `${asset[1]}; charset=utf-8`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(500).end('Unable to load the configurator');
    }
  });
}

if (require.main === module) {
  const server = createServer();
  server.on('error', (error) => {
    console.error(`Cannot start configurator: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => {
    console.log(`Configurator: http://127.0.0.1:${server.address().port}`);
  });
}

module.exports = { createServer };
