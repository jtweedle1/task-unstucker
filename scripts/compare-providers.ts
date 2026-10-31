// 30-task provider comparison. Calls the real AI through the same proxy handler the app uses,
// so it costs money. It refuses to run without --yes, and --fake runs it offline end to end.
//
//   ANTHROPIC_API_KEY=... MODELS=claude-haiku-5-5,claude-sonnet-5-5 \
//     node --experimental-strip-types scripts/compare-providers.ts --yes
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { BreakdownResult } from '../src/ai/schemas.ts';
import { handleAiRequest, RateLimiter } from '../server/handler.ts';
import type { AiProvider } from '../server/provider.ts';
import { scoreBreakdown, summarize, type EvalTask } from '../server/evals/score.ts';

const tasks = JSON.parse(readFileSync('server/evals/tasks.json', 'utf8')) as EvalTask[];
const fake = process.argv.includes('--fake');
const models = (process.env.MODELS || 'claude-haiku-5-5')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

if (!fake && !process.argv.includes('--yes')) {
  console.log(
    `This sends ${tasks.length} tasks to each of ${models.length} model(s): ${models.join(', ')}.\n` +
      'It uses your API key and is billed to that account. Re-run with --yes to go ahead, or --fake to test the harness offline.',
  );
  process.exit(1);
}
if (!fake && !process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set.');
  process.exit(1);
}

const fakeProvider: AiProvider = {
  name: 'fake',
  async generate() {
    return {
      steps: [
        { text: 'Open what you need', tier: 'required', estimateMin: 2 },
        { text: 'Do the first small part', tier: 'required', estimateMin: 5 },
      ],
      firstStepIndex: 0,
      question: null,
      safetyNote: null,
    };
  },
};

const results: Record<string, unknown>[] = [];
const summaries = [];
for (const model of fake ? ['fake'] : models) {
  const rows = [];
  for (const task of tasks) {
    const body = {
      kind: 'breakdown',
      task: { title: task.title, ...(task.barrier ? { barrier: task.barrier } : {}) },
    };
    const req = new Request('http://local/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const started = performance.now();
    const res = await handleAiRequest(
      req,
      { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? 'fake', AI_MODEL: model },
      { rateLimiter: new RateLimiter(10_000), ...(fake ? { provider: fakeProvider } : {}) },
    );
    const ms = Math.round(performance.now() - started);
    const json = (await res.json()) as {
      ok: boolean;
      result?: BreakdownResult;
      error?: { code: string };
    };
    const score = scoreBreakdown(task, json.ok ? json.result : undefined);
    rows.push({ score, ms });
    results.push({
      model,
      task: task.id,
      ms,
      error: json.error?.code,
      score,
      steps: json.result?.steps,
    });
    process.stdout.write(json.ok ? '.' : 'x');
  }
  process.stdout.write('\n');
  summaries.push(summarize(model, rows));
}

console.table(summaries);
mkdirSync('evals-output', { recursive: true });
const file = `evals-output/compare-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(file, JSON.stringify({ summaries, results }, null, 2));
console.log(`Full results: ${file}`);
