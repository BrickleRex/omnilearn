// Copy the bundled example skill courses into the data dir so the Skills track
// has something to open before your own research run finishes.
//   npm run seed:skills            -> data/skills/<slug>/  (skips slugs that already exist)
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.env.OMNILEARN_DATA ?? 'data');
const src = path.resolve('examples/skills');
mkdirSync(path.join(dataDir, 'skills'), { recursive: true });
for (const slug of readdirSync(src)) {
  const to = path.join(dataDir, 'skills', slug);
  if (existsSync(to)) { console.log(`skip ${slug}: already in ${to}`); continue; }
  cpSync(path.join(src, slug), to, { recursive: true });
  console.log(`seeded ${slug} -> ${to}`);
}
