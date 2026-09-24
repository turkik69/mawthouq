import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { Script } from 'node:vm';
import { execFileSync } from 'node:child_process';

const files = readdirSync('.').filter(name => name.endsWith('.html'));
let scriptsChecked = 0;
for (const file of files) {
  const html = readFileSync(file, 'utf8');
  if (!html.includes('lang="ar"') || !html.includes('dir="rtl"')) throw new Error(`${file}: Arabic document metadata missing`);
  for (const [, src] of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (!src.trim()) continue;
    new Script(src, { filename: `${file}:inline` });
    scriptsChecked++;
  }
  for (const target of ['assets/style.css', 'assets/refresh.css', 'mawthouq-logo.png']) {
    if (html.includes(target) && !existsSync(target)) throw new Error(`${file}: missing ${target}`);
  }
}
for (const file of readdirSync('assets').filter(name => name.endsWith('.js'))) execFileSync(process.execPath, ['--check', `assets/${file}`]);
execFileSync(process.execPath, ['--check', 'sw.js']);
for (const file of ['index.html','login.html','register.html','messages.html','admin.html','privacy.html','terms.html','payment-guide.html']) {
  if (!existsSync(file)) throw new Error(`Required page missing: ${file}`);
}
console.log(`Validated ${files.length} Arabic pages, ${scriptsChecked} inline scripts, shared JavaScript, and required pages.`);
