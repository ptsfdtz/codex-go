import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { invariant } from './errors.js';

export function nativeHelper(name: 'Dpapi' | 'HostUi' | 'Certificate'): string {
  invariant(process.platform === 'win32', 'UNSUPPORTED_PLATFORM', 'Native helpers require Windows');
  const source = resolve('scripts/native', `${name}.cs`);
  const hash = createHash('sha256')
    .update('native-build-v2')
    .update(readFileSync(source))
    .digest('hex')
    .slice(0, 20);
  const directory = join(process.env.LOCALAPPDATA!, 'AgentDeck', 'bin');
  mkdirSync(directory, { recursive: true });
  const output = join(directory, `${name}-${hash}.exe`);
  if (!existsSync(output)) {
    const compiler = join(
      process.env.WINDIR ?? 'C:\\Windows',
      'Microsoft.NET',
      'Framework64',
      'v4.0.30319',
      'csc.exe',
    );
    invariant(
      existsSync(compiler),
      'NATIVE_HELPER_UNAVAILABLE',
      '.NET Framework 4 C# compiler is required',
    );
    execFileSync(
      compiler,
      [
        '/nologo',
        '/optimize+',
        name === 'HostUi' ? '/target:winexe' : '/target:exe',
        `/out:${output}`,
        '/reference:System.Security.dll',
        '/reference:System.Windows.Forms.dll',
        '/reference:System.Drawing.dll',
        '/reference:System.Web.Extensions.dll',
        source,
      ],
      { shell: false, windowsHide: true, timeout: 30000, maxBuffer: 65536 },
    );
  }
  return output;
}
