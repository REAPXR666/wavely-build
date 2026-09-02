# Wavely Ableton Live 12 Sidebar Renamer Script
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "     RENAME SIDEBAR 'SPLICE' -> 'WAVELY' IN ABLETON  " -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Cyan

# 1. Check if Ableton Live is running
$abletonProc = Get-Process -Name "*Ableton Live*" -ErrorAction SilentlyContinue
if ($abletonProc) {
    Write-Host "Closing running Ableton Live process to unlock plugin binary..." -ForegroundColor Yellow
    Stop-Process -Name "*Ableton Live*" -Force
    Start-Sleep -Seconds 2
}

$vstPath = "$env:LOCALAPPDATA\Ableton\Splice\1\SpliceAbletonLive.vst3\Contents\x86_64-win\SpliceAbletonLive.vst3"
$backupPath = "$vstPath.bak"

if (Test-Path $vstPath) {
    if (!(Test-Path $backupPath)) {
        Copy-Item -Path $vstPath -Destination $backupPath -Force
        Write-Host "Created binary backup: $backupPath" -ForegroundColor Cyan
    }

    $bytes = [System.IO.File]::ReadAllBytes($vstPath)
    $spliceBytes = [System.Text.Encoding]::UTF8.GetBytes("Splice`0`0`0`0`0`0`0`0`0`0")
    $wavelyBytes = [System.Text.Encoding]::UTF8.GetBytes("Wavely`0`0`0`0`0`0`0`0`0`0")

    $patched = 0
    for ($i = 0; $i -le ($bytes.Length - $spliceBytes.Length); $i++) {
        $match = $true
        for ($j = 0; $j -lt $spliceBytes.Length; $j++) {
            if ($bytes[$i + $j] -ne $spliceBytes[$j]) {
                $match = $false
                break
            }
        }
        if ($match) {
            for ($k = 0; $k -lt $wavelyBytes.Length; $k++) {
                $bytes[$i + $k] = $wavelyBytes[$k]
            }
            $patched++
            $i += $spliceBytes.Length - 1
        }
    }

    [System.IO.File]::WriteAllBytes($vstPath, $bytes)
    Write-Host "Successfully patched $patched plugin class definitions to 'Wavely'!" -ForegroundColor Green
} else {
    Write-Host "Target VST3 not found at: $vstPath" -ForegroundColor Red
}

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host "Renaming complete! Please launch Ableton Live 12." -ForegroundColor Green
