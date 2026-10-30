import { handleStory } from '../server/story.js';

export function POST(request: Request): Promise<Response> {
  return handleStory(request);
}

export function OPTIONS(request: Request): Promise<Response> {
  return handleStory(request);
}
