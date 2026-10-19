# Windows launcher: switch the console to the UTF-8 code page, then invoke alice-experts.mjs
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CliArgs
)

$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try { chcp 65001 | Out-Null } catch {}

# Strip JS literals undefined / null that some Agent terminals append (tool bug).
$FilteredArgs = @($CliArgs | Where-Object { $_ -ne 'undefined' -and $_ -ne 'null' })

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& node (Join-Path $scriptDir "alice-experts.mjs") @FilteredArgs
exit $LASTEXITCODE
