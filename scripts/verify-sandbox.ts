import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { findCodex, verifyCodex } from '../bridge/src/codex.js';

export async function verifySandbox(): Promise<{ passed: boolean; details: string; at: string }> {
  const exe = findCodex();
  verifyCodex(exe);
  const base = await mkdtemp(join(tmpdir(), 'agentdeck-boundary-'));
  const inside = join(base, 'authorized');
  const outside = join(base, 'unauthorized');
  await mkdir(inside);
  await mkdir(outside);
  await writeFile(join(inside, 'sentinel.txt'), 'INSIDE');
  await writeFile(join(outside, 'sentinel.txt'), 'OUTSIDE');
  const runtime = process.execPath.replaceAll('\\', '/');
  const profile = `permissions={agentdeck={extends=":workspace",filesystem={":root"="deny",":minimal"="read",":tmpdir"="deny",":slash_tmp"="deny",${JSON.stringify(runtime)}="read"},network={enabled=false}}}`;
  const code = `const fs=require('node:fs');const path=require('node:path');const inside=process.argv[1],outside=process.argv[2];if(fs.readFileSync(path.join(inside,'sentinel.txt'),'utf8')!=='INSIDE')process.exit(2);fs.writeFileSync(path.join(inside,'written.txt'),'OK');let reads=false,writes=false;try{fs.readFileSync(path.join(outside,'sentinel.txt'));reads=true;}catch{}try{fs.writeFileSync(path.join(outside,'written.txt'),'BAD');writes=true;}catch{}console.log(JSON.stringify({insideRead:true,insideWrite:true,outsideReadDenied:!reads,outsideWriteDenied:!writes}));if(reads||writes)process.exit(3);`;
  const args = [
    '-c',
    'windows.sandbox="mxc"',
    '-c',
    profile,
    'sandbox',
    '--include-managed-config',
    '--permission-profile',
    'agentdeck',
    '--cd',
    inside,
    '--',
    process.execPath,
    '-e',
    code,
    inside,
    outside,
  ];
  const result = await new Promise<{ code: number; out: string }>((resolve, reject) => {
    const child = spawn(exe, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => child.kill(), 30000);
    child.stdout.on('data', (b: Buffer) => {
      if (out.length < 16384) out += b.toString();
    });
    child.stderr.on('data', (b: Buffer) => {
      if (out.length < 16384) out += b.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out });
    });
  });
  let outsideWritten = false;
  try {
    await readFile(join(outside, 'written.txt'));
    outsideWritten = true;
  } catch {
    /* expected */
  }
  return {
    passed:
      result.code === 0 &&
      !outsideWritten &&
      result.out.includes('"outsideReadDenied":true') &&
      result.out.includes('"outsideWriteDenied":true'),
    details: result.out.slice(0, 16000),
    at: new Date().toISOString(),
  };
}
if (process.argv[1]?.endsWith('verify-sandbox.ts')) {
  const result = await verifySandbox();
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
