import { render } from '@creact-labs/creact';
import { FileMemory } from './src/memory';
import { App } from './src/app';

export default async function() {
  const memory = new FileMemory('./.state');
  return render(() => <App />, memory, 'pr-review-bot');
}