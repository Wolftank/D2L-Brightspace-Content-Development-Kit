<#
    Packages a SCORM folder into an uploadable .zip.

    The one thing that breaks SCORM packaging on Windows: imsmanifest.xml must
    sit at the ROOT of the zip. Compress-Archive on a *folder path* nests
    everything one level down and D2L rejects the package with an unhelpful
    error. Passing "folder\*" is what keeps the manifest at the root.

    Usage:
        .\build-scorm.ps1
        .\build-scorm.ps1 -Source probes\scorm12-probe -Out dist\my-package.zip
#>

[CmdletBinding()]
param(
    [string]$Source = "probes\scorm12-probe",
    [string]$Out    = "dist\scsu-tenant-probe-scorm12.zip"
)

$ErrorActionPreference = "Stop"

$root       = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourcePath = Join-Path $root $Source
$outPath    = Join-Path $root $Out

if (-not (Test-Path $sourcePath)) {
    throw "Source folder not found: $sourcePath"
}

$manifest = Join-Path $sourcePath "imsmanifest.xml"
if (-not (Test-Path $manifest)) {
    throw "No imsmanifest.xml in $sourcePath. A SCORM package requires one at its root."
}

# Validate the manifest parses and that every <file href> it declares exists.
[xml]$xml = Get-Content $manifest -Raw
$declared = $xml.GetElementsByTagName("file") | ForEach-Object { $_.GetAttribute("href") }
$missing  = $declared | Where-Object { -not (Test-Path (Join-Path $sourcePath $_)) }
if ($missing) {
    throw "Manifest declares files that do not exist: $($missing -join ', ')"
}

$outDir = Split-Path -Parent $outPath
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
if (Test-Path $outPath) { Remove-Item $outPath -Force }

# The trailing \* is load-bearing: it puts the manifest at the zip root.
Compress-Archive -Path (Join-Path $sourcePath "*") -DestinationPath $outPath -CompressionLevel Optimal

$zip = Get-Item $outPath
Write-Host ""
Write-Host "Built: $($zip.FullName)"
Write-Host "Size:  $([math]::Round($zip.Length / 1KB, 1)) KB"
Write-Host "Files declared in manifest: $($declared.Count)"
Write-Host ""
Write-Host "Upload via: Course Admin -> Course Content / SCORM -> upload this zip."
Write-Host ""
