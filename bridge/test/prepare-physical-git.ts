import { realpath, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.js';
import { ProjectRegistry, within } from '../src/projects.js';
import { gitCommand } from '../src/git.js';

// Local fixture preparation only. Never accepts a remote path or runs inside business projects.
const root = await realpath(process.env.AGENTDECK_PHYSICAL_RESUME_ROOT ?? '');
if (!within(await realpath(tmpdir()), root) || !basename(root).startsWith('agentdeck-physical-'))
  throw new Error('Expected a temporary physical test harness directory');
const store = new Store(join(root, 'state.db'));
try {
  if (store.meta('physicalTestHarness') !== '1') throw new Error('Not a physical test harness');
  const registry = new ProjectRegistry(store);
  const project = await registry.root(store.projects()[0]!.projectId);
  async function git(args: string[]) {
    const result = await gitCommand(project, args);
    if (result.code !== 0) throw new Error('Fixture Git setup failed');
  }
  await writeFile(join(project, 'original-name.txt'), 'Real staged rename fixture\n');
  await writeFile(join(project, 'tracked-binary.bin'), Buffer.from([0, 1, 2, 0, 3]));
  await git(['add', '--', 'original-name.txt', 'tracked-binary.bin']);
  await git([
    '-c',
    'user.name=AgentDeck Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    'commit',
    '-m',
    'Physical Git review fixtures',
  ]);
  await git(['mv', '--', 'original-name.txt', 'renamed-name.txt']);
  await writeFile(join(project, 'tracked-binary.bin'), Buffer.from([0, 7, 8, 0, 9]));
  await writeFile(join(project, 'large-external.txt'), 'External fixture change\n'.repeat(20000));
  console.log(
    'Prepared real staged rename, binary change and oversized untracked file in temporary project',
  );
} finally {
  store.close();
}
