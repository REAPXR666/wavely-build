# Wavely Ableton Live 12 Studio Injection Script
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "       WAVELY -> ABLETON LIVE 12 INJECTION ENGINE    " -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Cyan

$distSource = "$PSScriptRoot\dist"
$targetDir = "$env:LOCALAPPDATA\Ableton\Splice\1\SpliceAbletonLive.vst3\Contents\dist"

if (!(Test-Path $distSource)) {
    Write-Host "Dist folder not found! Building React project first..." -ForegroundColor Yellow
    Set-Location $PSScriptRoot
    npm run build
}

if (!(Test-Path (Split-Path $targetDir))) {
    Write-Host "Creating target plugin directory: $targetDir" -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

Write-Host "Injecting Wavely Studio UI into Ableton Live 12..." -ForegroundColor Green
Copy-Item -Path "$distSource\*" -Destination $targetDir -Recurse -Force

Write-Host "Wavely successfully injected into Ableton Live 12!" -ForegroundColor Green
Write-Host "Open Ableton Live 12, click 'Splice' under Places in the Browser sidebar to enjoy Wavely natively inside Ableton!" -ForegroundColor Cyan
