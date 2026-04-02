param(
  [int]$Port = 5173
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

function Start-StaticServer([int]$p) {
  $listener = New-Object System.Net.HttpListener
  $prefix = "http://localhost:$p/"
  $listener.Prefixes.Add($prefix)
  $listener.Start()

  Write-Output "Serving $root"
  Write-Output "Listening on $prefix"
  Write-Output "Press Ctrl+C to stop."

  try {
    while ($listener.IsListening) {
      $ctx = $listener.GetContext()
      try {
        $reqPath = $ctx.Request.Url.AbsolutePath.TrimStart("/")
        if ([string]::IsNullOrWhiteSpace($reqPath)) { $reqPath = "index.html" }
        $reqPath = $reqPath -replace "/", "\"
        $filePath = Join-Path $root $reqPath

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
  } catch {
    if ($_.Exception.Message -match "access is denied|failed to listen|actively refused|cannot access") {
      continue
    }
    throw
  }
}
