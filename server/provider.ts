// Provider-independent adapter interface. Only adapter files know about a specific vendor.
import type { z } from 'zod';
import type { AiErrorCode } from '../src/ai/schemas.ts';

export interface StructuredRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface AiProvider {
  name: string;
  generate<T>(req: StructuredRequest<T>): Promise<unknown>;
}

export class ProviderError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    public readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
