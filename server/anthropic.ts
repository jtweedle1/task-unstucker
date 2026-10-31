// Anthropic adapter. The only file that imports the vendor SDK.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { InvalidOutputError } from '../src/ai/schemas.ts';
import { ProviderError, type AiProvider, type StructuredRequest } from './provider.ts';

// The plan chose the small, fast tier: these are short structured jobs where speed and cost matter.
export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5';

export function createAnthropicProvider(opts: {
  apiKey: string;
  model?: string;
  /** Tests only: replaces the network layer. */
  fetch?: typeof fetch;
  maxRetries?: number;
}): AiProvider {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    timeout: 25_000,
    maxRetries: opts.maxRetries ?? 1,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  const model = opts.model || DEFAULT_ANTHROPIC_MODEL;

  return {
    name: 'anthropic',
    async generate<T>(req: StructuredRequest<T>): Promise<unknown> {
      try {
        const format = betaZodOutputFormat(req.schema);
        // create() rather than parse(): parse() throws before we can see a refusal, so we
        // check stop_reason first and validate the JSON ourselves.
        const response = await client.beta.messages.create(
          {
            model,
            max_tokens: req.maxTokens,
            // Short, structured jobs: keep thinking light for speed and cost.
            thinking: { type: 'adaptive' },
            output_config: { effort: 'low', format },
            // If a safety classifier declines, let the API retry on a suitable model.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            system: req.system,
            messages: [{ role: 'user', content: req.user }],
          },
          { signal: req.signal },
        );
        if (response.stop_reason === 'refusal') {
          throw new ProviderError('refused', 'The AI declined this request.');
        }
        if (response.stop_reason === 'max_tokens') {
          throw new InvalidOutputError('Response was cut off');
        }
        const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
        try {
          return format.parse(text);
        } catch {
          throw new InvalidOutputError('Structured output did not match the schema');
        }
      } catch (err) {
        throw mapError(err);
      }
    },
  };
}

function retryAfter(headers: Headers | undefined): number | undefined {
  const v = headers?.get('retry-after');
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function mapError(err: unknown): unknown {
  if (err instanceof ProviderError || err instanceof InvalidOutputError) return err;
  if (err instanceof Anthropic.APIUserAbortError)
    return new ProviderError('timeout', 'Request cancelled');
  if (err instanceof Anthropic.APIConnectionTimeoutError)
    return new ProviderError('timeout', 'AI timed out');
  if (err instanceof Anthropic.APIConnectionError) {
    return new ProviderError('provider_unavailable', 'Could not reach the AI service');
  }
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  ) {
    return new ProviderError('auth_failed', 'AI credentials were rejected');
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ProviderError('rate_limited', 'AI is busy', retryAfter(err.headers));
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new ProviderError('invalid_request', 'The AI service rejected the request');
  }
  if (err instanceof Anthropic.APIError) {
    return new ProviderError(
      'provider_unavailable',
      `AI service error (${err.status ?? 'unknown'})`,
    );
  }
  if (err instanceof Error && err.name === 'SyntaxError') return new InvalidOutputError('Bad JSON');
  return err;
}
