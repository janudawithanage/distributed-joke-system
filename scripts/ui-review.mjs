import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewUI } from './ui-checks.mjs';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'test-results', 'ui');
await mkdir(output, { recursive: true });
const config = {
  base: (process.env.UI_BASE_URL || 'http://localhost:8000').replace(/\/$/, ''),
  output,
  axePath: require.resolve('axe-core/axe.min.js')
};
const args = [path.join(path.dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js'), '--headless', '--isolated',
  '--browser', 'chrome', '--viewport-size', '1440,1000', '--output-dir', output,
  '--image-responses', 'omit', '--timeout-navigation', '20000'];
if (process.env.UI_BROWSER_PATH) args.push('--executable-path', process.env.UI_BROWSER_PATH);
const client = new Client({ name: 'jokeplatform-ui-review', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args, stderr: 'pipe' });
try {
  await client.connect(transport);
  const available = (await client.listTools()).tools;
  const name = available.some(tool => tool.name === 'browser_run_code') ? 'browser_run_code' : 'browser_run_code_unsafe';
  const result = await client.callTool({ name, arguments: {
    code: `async (page) => { const review = ${reviewUI.toString()}; return review(page, ${JSON.stringify(config)}); }`
  } }, undefined, { timeout: 240000 });
  await writeFile(path.join(output, 'mcp-results.json'), JSON.stringify(result, null, 2));
  const content = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
  const json = content.split('### Result\n')[1]?.split('\n### ')[0];
  if (result.isError || !json) throw new Error(content.slice(0, 3000));
  const report = JSON.parse(json);
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  for (const check of report.checks) console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}${check.detail ? `: ${check.detail}` : ''}`);
  console.log(`\n${report.checks.filter(check => check.pass).length}/${report.checks.length} checks passed. Screenshots and report: ${output}`);
  if (report.checks.some(check => !check.pass)) process.exitCode = 1;
} finally {
  await client.close();
}
