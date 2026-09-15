# Cuts a new release: bumps manifest version, builds the zip, commits, tags, pushes.
# Usage:  powershell -ExecutionPolicy Bypass -File release.ps1 0.11.0
param([Parameter(Mandatory = $true)][string]$Version)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must look like 1.2.3 (got '$Version')" }

# Update version in manifest.json (write UTF-8 without BOM so Chrome can parse it)
$manifest = Get-Content manifest.json -Raw
$manifest = $manifest -replace '("version":\s*")[^"]+(")', "`${1}$Version`${2}"
[IO.File]::WriteAllText("$PSScriptRoot\manifest.json", $manifest, (New-Object System.Text.UTF8Encoding $false))

# Build the distributable zip
& "$PSScriptRoot\build.ps1"

# Commit, tag, push
git add -A
git commit -m "Release v$Version"
git tag -a "v$Version" -m "v$Version"
git push origin main
git push origin "v$Version"

Write-Output ""
Write-Output "Released v$Version"
Write-Output "Now draft a GitHub release for tag v$Version and attach dist\greythr-time-remaining-v$Version.zip"
