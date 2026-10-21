// Read-only installed host audit. Only the exact matched rename method executes.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { runInNewContext } from 'node:vm';

const [archivePath, destination] = process.argv.slice(2);
if (![archivePath, destination].every((p) => p && isAbsolute(p)))
  throw new Error('Expected absolute archive and report paths');
const archive = readFileSync(archivePath);
const tree = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString());
const entries = tree.files?.['.vite']?.files?.build?.files;
const names = Object.keys(entries ?? {}).filter((name) => /^main-.*\.js$/.test(name));
if (names.length !== 1) throw new Error('Unknown desktop host bundle');
const entry = entries[names[0]];
if (
  entry.unpacked ||
  !/^\d+$/.test(entry.offset) ||
  !Number.isSafeInteger(entry.size) ||
  entry.size < 1 ||
  entry.size > 32 * 1024 * 1024
)
  throw new Error('Unsupported desktop host entry');
const start = 8 + archive.readUInt32LE(4) + Number(entry.offset);
if (!Number.isSafeInteger(start) || start + entry.size > archive.length)
  throw new Error('Desktop host entry out of bounds');
const bytes = archive.subarray(start, start + entry.size);
const source = bytes.toString();
const method =
  'async renameLocal(e){let t=p2.safeParse(e);if(!t.success)throw Error(`Invalid local project rename request`);let{name:n,projectId:r}=t.data,i=this.getLocalProjects()[r],a=n.trim();i!=null&&a.length!==0&&a!==i.name&&(await this.projectBackend.updateProject(r,{name:a}),this.#h(),this.#_())}';
const offset = source.indexOf(method);
if (offset < 0 || source.indexOf(method, offset + 1) >= 0)
  throw new Error('Host project rename baseline changed');
const markers = {
  rendererProjectsService: 'projects:this.projectsManager',
  cacheIsLocalSource: 'getLocalProjects(){return vr(this.globalState)}',
  localProjectPublication: '#h(){this.#y([i.vs.LOCAL_PROJECTS])}',
  workspacePublication:
    '#_(){this.windowManager.sendMessageToAllWindows({type:`workspace-root-options-updated`})}',
  nativeProjectBackendInstalled: 'this.projectsManager.setProjectBackend(f)',
};
for (const marker of Object.values(markers))
  if (!source.includes(marker)) throw new Error('Host project integration baseline changed');

// Dependencies are synthetic: this does not test the real Zod validator, storage,
// permissions, native backend, Electron RPC or rendering.
const cases = [
  {
    name: 'rename-trims-and-publishes-after-write',
    input: { projectId: 'seed', name: ' renamed ' },
    expected: ['write', 'projects', 'workspace'],
  },
  { name: 'unchanged-is-no-op', input: { projectId: 'seed', name: ' original ' }, expected: [] },
  { name: 'blank-is-no-op', input: { projectId: 'seed', name: '  ' }, expected: [] },
  {
    name: 'unknown-local-project-is-no-op',
    input: { projectId: 'other', name: 'renamed' },
    expected: [],
  },
  { name: 'invalid-input-rejected', invalid: true, expected: [], rejected: true },
  {
    name: 'backend-failure-does-not-publish',
    input: { projectId: 'seed', name: 'renamed' },
    failWrite: true,
    expected: ['write'],
    rejected: true,
  },
];
const results = [];
for (const scenario of cases) {
  const result = await runInNewContext(
    `(async()=>{
    const events=[];
    const p2={safeParse:()=>scenario.invalid?{success:false}:{success:true,data:scenario.input}};
    class Host {
      projectBackend={updateProject:async(id,patch)=>{
        events.push('write');
        if(id!=='seed'||patch.name!=='renamed')throw Error('Unexpected synthetic write');
        await Promise.resolve();
        if(events.length!==1)throw Error('Publication preceded completion');
        if(scenario.failWrite)throw Error('Synthetic backend failure');
      }};
      getLocalProjects(){return {seed:{name:'original'}}}
      #h(){events.push('projects')}
      #_(){events.push('workspace')}
      ${method}
    }
    let rejected=false;
    try{await new Host().renameLocal(scenario.input)}catch{rejected=true}
    return {events,rejected};
  })()`,
    { scenario },
    { timeout: 1000 },
  );
  if (
    JSON.stringify(result.events) !== JSON.stringify(scenario.expected) ||
    result.rejected !== (scenario.rejected ?? false)
  )
    throw new Error('Unexpected synthetic host rename behavior');
  results.push({ name: scenario.name, passed: true });
}
const report = {
  evidenceLevel: 'installed-host-method-with-synthetic-dependencies',
  bundle: {
    name: names[0],
    sha256: createHash('sha256').update(bytes).digest('hex'),
    renameMethodOffset: offset,
  },
  markers: Object.fromEntries(Object.keys(markers).map((key) => [key, true])),
  productionStateRead: false,
  productionStateModified: false,
  realValidatorVerified: false,
  externalHostEndpointVerified: false,
  guiAcceptance: false,
  cases: results,
  passed: true,
};
writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
