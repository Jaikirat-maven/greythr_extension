# Builds a distributable zip of the extension into ./dist
# Usage:  powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
New-Item -ItemType Directory -Force dist | Out-Null
$ver = (Get-Content manifest.json -Raw | ConvertFrom-Json).version
$items = 'manifest.json','background.js','shared.js','autologin.js','snake.js','tetris.js','breakout.js','flappy.js','wordguess.js','popup.html','popup.js','popup.css','options.html','options.js','README.md','icons'
$zip = "dist\greythr-time-remaining-v$ver.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path $items -DestinationPath $zip
Write-Output "Built $zip"
