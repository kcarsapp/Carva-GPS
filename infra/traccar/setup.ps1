# One-time setup: download a portable Java 21 runtime + Traccar 6.14.5 into runtime/.
# No system install or admin rights needed. Re-run to rebuild a clean runtime/.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$rt = Join-Path $here 'runtime'
$traccarVersion = '6.14.5'

New-Item -ItemType Directory -Force -Path $rt | Out-Null

$jreUrl = 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse?project=jdk'
$traccarUrl = "https://github.com/traccar/traccar/releases/download/v$traccarVersion/traccar-other-$traccarVersion.zip"

Write-Host 'Downloading Traccar...' -ForegroundColor Cyan
Invoke-WebRequest -Uri $traccarUrl -OutFile (Join-Path $rt 'traccar.zip')
Write-Host 'Downloading Java 21 runtime...' -ForegroundColor Cyan
Invoke-WebRequest -Uri $jreUrl -OutFile (Join-Path $rt 'jre.zip')

Write-Host 'Extracting...' -ForegroundColor Cyan
Expand-Archive -Path (Join-Path $rt 'traccar.zip') -DestinationPath (Join-Path $rt 'traccar') -Force
Expand-Archive -Path (Join-Path $rt 'jre.zip') -DestinationPath (Join-Path $rt 'jre') -Force

Write-Host 'Done. Start with: ./start.ps1' -ForegroundColor Green
Write-Host 'Then create the first admin user (becomes administrator):' -ForegroundColor Yellow
Write-Host '  POST http://localhost:8082/api/users {"name","email","password"}'
