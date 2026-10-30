import { handleVoice } from '../server/voice.js';

export function POST(request: Request): Promise<Response> {
  return handleVoice(request);
}

export function OPTIONS(request: Request): Promise<Response> {
  return handleVoice(request);
}
