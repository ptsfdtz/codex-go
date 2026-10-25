$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'agentdeck.exe') start
if ($LASTEXITCODE -ne 0) { throw 'Host startup failed. Run agentdeck logs or doctor.' }
