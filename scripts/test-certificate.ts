import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { nativeHelper } from '../bridge/src/native.js';
// Only the public certificate is saved. The ephemeral private key is discarded.
const sample = JSON.parse(
  execFileSync(nativeHelper('Certificate'), ['test-public'], {
    input: JSON.stringify(['127.0.0.1']),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000,
  }),
) as { cert: string };
writeFileSync('android/app/src/test/resources/bridge.crt', sample.cert);
