// Builds a single self-contained HTML file of the app in demo mode, for sharing a preview
// without hosting. No service worker, no AI proxy, in-memory routing.
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = 'preview-dist';
execSync(`npx vite build --outDir ${out} --emptyOutDir`, {
  stdio: 'inherit',
  env: { ...process.env, VITE_PREVIEW: '1' },
});

const assets = join(out, 'assets');
const files = readdirSync(assets);
const js = files.filter((f) => f.startsWith('index-') && f.endsWith('.js'));
const css = files.filter((f) => f.endsWith('.css'));
if (js.length !== 1) throw new Error(`Expected one entry chunk, found ${js.length}`);

const script = readFileSync(join(assets, js[0]), 'utf8').replaceAll('</script', '<\\/script');
const style = css.map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
const icon = readFileSync('public/favicon.svg', 'utf8');

const html = `<title>Task Unstucker</title>
<meta name="theme-color" content="#faf7f2">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(icon)}">
<style>${style}</style>
<div id="root"></div>
<script type="module">${script}</script>
`;
writeFileSync(join(out, 'task-unstucker-preview.html'), html);
console.log(`Wrote ${out}/task-unstucker-preview.html (${Math.round(html.length / 1024)} KB)`);
