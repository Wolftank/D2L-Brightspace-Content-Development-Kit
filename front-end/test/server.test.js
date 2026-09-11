const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('../src/server');

test('serves the configurator and assets without exposing project files', async (t) => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [route, type] of [['/', 'text/html'], ['/styles.css', 'text/css'], ['/app.js', 'text/javascript']]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith(type));
    assert.ok((await response.text()).length > 0);
  }
  for (const route of ['/package.json', '/server.js', '/%2e%2e/server.js', '/api/builds']) {
    assert.equal((await fetch(base + route)).status, 404);
  }
  const head = await fetch(base, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const post = await fetch(base, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});
