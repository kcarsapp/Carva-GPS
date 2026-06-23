# Start the local Carva Traccar server (portable Java, embedded H2 DB).
# Binaries live under runtime/ (gitignored). Run setup.ps1 first if missing.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$traccar = Join-Path $here 'runtime\traccar'
$jreDir = Get-ChildItem (Join-Path $here 'runtime\jre') -Directory | Select-Object -First 1
if (-not $jreDir) { throw 'No JRE found under runtime/jre. Run setup.ps1.' }
$java = Join-Path $jreDir.FullName 'bin\java.exe'

Write-Host "Starting Traccar on http://localhost:8082 ..." -ForegroundColor Cyan
Push-Location $traccar
try {
  & $java -jar tracker-server.jar conf/traccar.xml
} finally {
  Pop-Location
}
