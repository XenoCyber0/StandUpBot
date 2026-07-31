# Drives tests/e2e-run.js for a given PR with the LLM endpoint injected
# only into the child process env (proxying via parent env vars).
param(
  [Parameter(Mandatory=$true)][string]$Owner,
  [Parameter(Mandatory=$true)][string]$Repo,
  [Parameter(Mandatory=$true)][int]$Pr
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $MyInvocation.MyCommand.Path
Set-Location (Split-Path $root) # repo root

# These three are currently set in MY interactive shell where you told me, not in this session;
# but for a one-command user workflow, we RE-READ them into this session from the secure vars
# set by the OS when the bash.exe instance started. If unset here, stop loudly.
$needed = 'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'
foreach ($k in $needed) {
  $v = [Environment]::GetEnvironmentVariable($k, 'Process')
  if (-not $v) { throw "Set $k in the shell env before invoking; not in config." }
}

$env:SB_E2E = '1'
$env:SB_E2E_OUT_PATH = "$env:TEMP\sb-e2e-out-$Owner-$Repo-$Pr.md"

Write-Host "--- E2E: $Owner/$Repo#$Pr ---"
node tests/e2e-run.js $Owner $Repo $Pr
exit $LASTEXITCODE
