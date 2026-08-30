// Shared by tests/verify.js and tests/smoke.js: builds src/ into a scratch dir with tools/build.py
// and serves it on a random local port, so a check never depends on a stale dist/ or on a server
// someone has to start by hand.
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon' };

// Skins are discovered from src/skins/*.css so new ones are covered without touching any test.
function skinNames() {
  return fs.readdirSync(path.join(ROOT, 'src', 'skins')).filter((f) => f.endsWith('.css')).map((f) => f.replace(/\.css$/, ''));
}

async function startSite(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  console.log(execFileSync('python3', [path.join(ROOT, 'tools', 'build.py'), '--out', dir], { encoding: 'utf8' }).trim());
  const server = http.createServer((req, res) => {
    let file = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file.startsWith(dir) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  console.log('serving', dir, 'at', base);
  return {
    base,
    close() { server.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

module.exports = { ROOT, skinNames, startSite };
