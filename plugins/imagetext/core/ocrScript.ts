// Windows PowerShell 5.1 OCR worker using WinRT. Reads JSON {id,path} lines; emits readiness, then {id,text} or {id,error} per image.
export const OCR_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
function Say($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1' } | Select-Object -First 1
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if (-not $engine) { Say @{ ready = $false; error = 'No OCR language is installed (Windows Settings, Time & Language, Language).' }; exit 1 }
  Say @{ ready = $true; language = $engine.RecognizerLanguage.LanguageTag }
} catch { Say @{ ready = $false; error = $_.Exception.Message }; exit 1 }
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
$max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $req = $line | ConvertFrom-Json
  $stream = $null
  try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($req.path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $w = $decoder.PixelWidth; $h = $decoder.PixelHeight
    $transform = [Windows.Graphics.Imaging.BitmapTransform]::new()
    # OCR refuses larger images; scaled to fit, keeping the aspect ratio.
    $scale = [Math]::Min(1.0, $max / [double][Math]::Max($w, $h))
    $transform.ScaledWidth = [uint32][Math]::Max(1, [Math]::Floor($w * $scale))
    $transform.ScaledHeight = [uint32][Math]::Max(1, [Math]::Floor($h * $scale))
    $bmp = Await ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied, $transform, [Windows.Graphics.Imaging.ExifOrientationMode]::RespectExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
    Say @{ id = $req.id; text = (($result.Lines | ForEach-Object { $_.Text }) -join [char]10) }
  } catch {
    Say @{ id = $req.id; error = $_.Exception.Message }
  } finally {
    if ($stream) { $stream.Dispose() }
  }
}
`;
