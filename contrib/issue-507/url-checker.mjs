import fs from 'fs/promises';
import path from 'path';
import http from 'http';
import https from 'https';

const TARGET_DIRS = ['../../website/content/docs', '../../src'];
const URL_REGEX = /https?:\/\/[^\s"'`<>)]+/g;

async function* walk(dir) {
  try {
    const files = await fs.readdir(dir, { withFileTypes: true });
    for (const file of files) {
      const res = path.resolve(dir, file.name);
      if (file.isDirectory()) yield* walk(res);
      else yield res;
    }
  } catch (e) {
    // Ignore missing directories if executed from different relative paths
  }
}

async function checkUrl(url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 5000 }, (res) => {
      // 402 Payment Required is treated as success for paid endpoints
      if ((res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 402) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, status: res.statusCode });
      }
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

async function run() {
  console.log('Scanning for documented URLs...');
  let failed = 0;

  for (const dir of TARGET_DIRS) {
    const resolvedDir = path.resolve(process.cwd(), dir);
    for await (const filepath of walk(resolvedDir)) {
      const content = await fs.readFile(filepath, 'utf8');
      const urls = [...new Set(content.match(URL_REGEX) || [])];
      
      for (const url of urls) {
        const result = await checkUrl(url);
        if (!result.ok) {
          console.error(`❌ Broken URL: ${url}`);
          console.error(`   File: ${filepath}`);
          console.error(`   Reason: ${result.status || result.error}\n`);
          failed++;
        }
      }
    }
  }

  if (failed > 0) {
    console.error(`\nFailed: ${failed} dead URLs found.`);
    process.exit(1);
  }
  console.log('✅ All documented URLs resolved successfully.');
}

run();