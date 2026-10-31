import { UnstuckerDB, setDatabase } from '../data/db';

let counter = 0;
/** Fresh, isolated IndexedDB (fake-indexeddb) per test. */
export async function freshDb(): Promise<UnstuckerDB> {
  const d = new UnstuckerDB(`test-${Date.now()}-${++counter}`);
  setDatabase(d);
  await d.open();
  return d;
}
