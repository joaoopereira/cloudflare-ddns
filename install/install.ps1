# cloudflare-ddns client installer for Windows (runs as a Windows service).
#
#   irm __DDNS_SERVER_URL__/install.ps1 | iex
#   & ([scriptblock]::Create((irm __DDNS_SERVER_URL__/install.ps1))) uninstall
#
# Run from an elevated PowerShell. No questions are asked: the machine
# registers itself and shows up in the dashboard as a pending client.
# Running it again upgrades/repairs the install.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Server = if ($env:DDNS_SERVER) { $env:DDNS_SERVER } else { '__DDNS_SERVER_URL__' }
$Action = if ($args.Count -gt 0) { $args[0] } else { 'install' }
$Name = 'ddns-client'
$InstallDir = Join-Path $env:ProgramFiles $Name
$Exe = Join-Path $InstallDir "$Name.exe"
$ConfigDir = Join-Path $env:ProgramData $Name

function Log($msg) { Write-Host "ddns: $msg" }
function Fail($msg) { Write-Error "ddns: error: $msg"; exit 1 }

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Fail 'run this from an elevated PowerShell (Run as Administrator)'
}
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Stop-DdnsService {
  $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -ne 'Stopped') { Stop-Service -Name $Name -Force; $svc.WaitForStatus('Stopped', '00:00:30') }
}

function Uninstall-Ddns {
  Stop-DdnsService
  if (Get-Service -Name $Name -ErrorAction SilentlyContinue) { & sc.exe delete $Name | Out-Null }
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $InstallDir, $ConfigDir
  Log 'uninstalled. Delete the client in the dashboard to remove it there too.'
}

function Install-Ddns {
  $arch = switch ($env:PROCESSOR_ARCHITECTURE) {
    'AMD64' { 'amd64' }
    'ARM64' { 'arm64' }
    default { Fail "unsupported architecture: $env:PROCESSOR_ARCHITECTURE" }
  }
  $asset = "${Name}_windows_$arch.exe"
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ([IO.Path]::GetRandomFileName())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try {
    Log "downloading $asset"
    $res = Invoke-WebRequest -UseBasicParsing -Uri "$Server/download/latest/$asset" -OutFile (Join-Path $tmp $asset) -PassThru
    $version = "$($res.Headers['X-Release-Version'])"
    if (-not $version) { Fail 'server did not report the release version' }
    $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$Server/download/$version/checksums.txt").Content
    if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
    $want = ($sums -split "`n" | ForEach-Object { $f = $_.Trim() -split '\s+'; if ($f.Count -eq 2 -and $f[1].TrimStart('*') -eq $asset) { $f[0] } }) | Select-Object -First 1
    $got = (Get-FileHash -Algorithm SHA256 (Join-Path $tmp $asset)).Hash.ToLower()
    if (-not $want -or $want.ToLower() -ne $got) { Fail "checksum mismatch for $asset" }

    Stop-DdnsService
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    Remove-Item -Force -ErrorAction SilentlyContinue "$Exe.old"
    Copy-Item -Force (Join-Path $tmp $asset) $Exe
    Log "installed $Name $version to $Exe"
  } finally {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp
  }

  # The config holds the client secret: only SYSTEM and Administrators may read it
  # (ProgramData would otherwise let every local user read it).
  New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
  & icacls.exe $ConfigDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /Q | Out-Null
  if ($LASTEXITCODE -ne 0) { Fail "could not restrict access to $ConfigDir" }

  $binPath = "`"$Exe`" --server $Server"
  if (Get-Service -Name $Name -ErrorAction SilentlyContinue) {
    & sc.exe config $Name binPath= $binPath start= auto | Out-Null
  } else {
    New-Service -Name $Name -BinaryPathName $binPath -DisplayName 'Cloudflare DDNS client' `
      -Description 'Keeps this machine''s DNS record pointed at its public IP (cloudflare-ddns).' -StartupType Automatic | Out-Null
  }
  # Restart automatically if the process exits (including after a self-upgrade).
  & sc.exe failure $Name reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null
  Start-Service -Name $Name
  Log "service started (logs: Event Viewer > Windows Logs > Application)"
  Log "done. Approve this machine in the dashboard: $Server"
}

switch ($Action) {
  'install' { Install-Ddns }
  'uninstall' { Uninstall-Ddns }
  default { Fail "unknown action: $Action (use install or uninstall)" }
}
