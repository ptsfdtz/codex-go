import { expect, it } from 'vitest';
import { displayCommand } from './command-display';

it('shows the script instead of repeated Windows shell launch arguments', () => {
  const script = 'Get-Content README.md; rg --files -g AGENTS.md -g build.gradle*';
  expect(
    displayCommand(
      `"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command '${script}'`,
    ),
  ).toBe(script);
  expect(
    displayCommand(
      `& 'C:/Program Files/PowerShell/7/pwsh.exe' -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "${script}"`,
    ),
  ).toBe(script);
  expect(displayCommand('cmd.exe /d /s /c "git status --short"')).toBe('git status --short');
});
it('handles nested shells, multiline scripts and shell-escaped embedded quotes', () => {
  expect(displayCommand(`/bin/bash -lc 'git status --short'`)).toBe('git status --short');
  expect(displayCommand(`sh -c 'pwsh -c "Get-Date"'`)).toBe('Get-Date');
  expect(displayCommand(`pwsh -Command 'Write-Output '"'hello world'"'; Get-Date'`)).toBe(
    "Write-Output 'hello world'; Get-Date",
  );
  expect(displayCommand(`powershell -Command 'Get-Content README.md\nGet-Date'`)).toBe(
    'Get-Content README.md\nGet-Date',
  );
});
it('retains meaningful arguments and does not guess at encoded or unknown wrappers', () => {
  for (const command of [
    'git -c core.quotePath=false status',
    'python -c "print(42)"',
    'powershell -EncodedCommand ZQBjAGgAbwA=',
    'pwsh -File script.ps1',
    'bash -c "echo hello" extra-argument',
    'pwsh -Command "unterminated',
  ]) {
    expect(displayCommand(command)).toBe(command);
  }
  expect(
    displayCommand(String.raw`powershell -Command 'Remove-Item C:\temp -Recurse; exit 1'`),
  ).toBe(String.raw`Remove-Item C:\temp -Recurse; exit 1`);
});
