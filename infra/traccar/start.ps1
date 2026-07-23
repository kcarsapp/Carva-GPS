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
  # Low-memory dev settings: SerialGC + a small capped heap reserve far less
  # virtual memory than the JVM defaults, so Traccar starts reliably alongside
  # the Next dev server on machines with limited RAM / page file.
  & $java -XX:+UseSerialGC -Xms32m -Xmx256m -XX:MaxMetaspaceSize=96m -XX:ReservedCodeCacheSize=48m `
    -jar tracker-server.jar conf/traccar.xml
} finally {
  Pop-Location
}
