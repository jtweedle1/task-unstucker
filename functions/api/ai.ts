// Cloudflare Pages Function: POST /api/ai. Secrets come from the Pages project settings.
import { handleAiRequest, type ProxyEnv } from '../../server/handler.ts';

export const onRequestPost = (context: { request: Request; env: ProxyEnv }) =>
  handleAiRequest(context.request, context.env);
