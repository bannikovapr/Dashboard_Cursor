param(
  [int]$Port = 5173,
  [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"

$root = (Get-Location).Path

function Get-ContentType([string]$path) {
  switch ([IO.Path]::GetExtension($path).ToLowerInvariant()) {
    ".html" { "text/html; charset=utf-8" }
    ".css"  { "text/css; charset=utf-8" }
    ".js"   { "text/javascript; charset=utf-8" }
    ".json" { "application/json; charset=utf-8" }
    ".svg"  { "image/svg+xml" }
    ".png"  { "image/png" }
    ".jpg"  { "image/jpeg" }
    ".jpeg" { "image/jpeg" }
    ".gif"  { "image/gif" }
    ".ico"  { "image/x-icon" }
    default { "application/octet-stream" }
  }
}

function Resolve-SafePath([string]$requestPath) {
  if ([string]::IsNullOrWhiteSpace($requestPath)) { $requestPath = "index.html" }
  if ($requestPath.Contains("`0")) { return $null }
  $sanitized = $requestPath.TrimStart("/") -replace "/", "\"
  if ($sanitized.StartsWith("\")) { return $null }
  if ($sanitized -match "^\w:") { return $null }
  if ($sanitized.Split("\") -contains "..") { return $null }

  $combined = Join-Path $root $sanitized
  $full = [IO.Path]::GetFullPath($combined)
  $rootFull = [IO.Path]::GetFullPath((Join-Path $root "."))
  if (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) { return $null }
  return $full
}

function Start-StaticServer([int]$p) {
  $listener = New-Object System.Net.HttpListener
  $prefix = "http://localhost:$p/"
  $listener.Prefixes.Add($prefix)
  $listener.Start()

  if ($OpenBrowser) {
    Start-Process $prefix | Out-Null
  }

  Write-Output "Serving $root"
  Write-Output "Listening on $prefix"
  Write-Output "Press Ctrl+C to stop."

  try {
    while ($listener.IsListening) {
      $ctx = $listener.GetContext()
      try {
        $absolutePath = $ctx.Request.Url.AbsolutePath
        $filePath = Resolve-SafePath $absolutePath
        if ($null -eq $filePath) {
          $ctx.Response.StatusCode = 400
          $bytes = [Text.Encoding]::UTF8.GetBytes("Bad request")
          $ctx.Response.ContentType = "text/plain; charset=utf-8"
          $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
          $ctx.Response.OutputStream.Close()
          continue
        }

        if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
          $ctx.Response.StatusCode = 404
          $bytes = [Text.Encoding]::UTF8.GetBytes("Not found")
          $ctx.Response.ContentType = "text/plain; charset=utf-8"
          $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
          $ctx.Response.OutputStream.Close()
          continue
        }

        $ctx.Response.StatusCode = 200
        $ctx.Response.ContentType = (Get-ContentType $filePath)
        $ctx.Response.ContentEncoding = [Text.Encoding]::UTF8
        $bytes = [IO.File]::ReadAllBytes($filePath)
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $ctx.Response.OutputStream.Close()
      } catch {
        try { $ctx.Response.StatusCode = 500 } catch {}
        try { $ctx.Response.OutputStream.Close() } catch {}
      }
    }
  } finally {
    $listener.Stop()
    $listener.Close()
  }
}

for ($i = 0; $i -lt 50; $i++) {
  $tryPort = $Port + $i
  try {
    Start-StaticServer -p $tryPort
    break
  } catch [System.Net.HttpListenerException] {
    continue
  } catch {
    throw
  }
}
