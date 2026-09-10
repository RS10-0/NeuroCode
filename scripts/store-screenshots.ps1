# Chrome Web Store screenshots, at exactly the size it asks for.
#
# The Store accepts 1280x800 or 640x400 and nothing else, and it
# rejects rather than resizes. A snip is never that size, so this
# scales each image to fit and centres it on a canvas of exactly
# the right dimensions.
#
# The padding colour is sampled from the image's own top-left
# pixel rather than being white, so the band reads as part of the
# screenshot instead of a frame around it — light for a page
# capture, dark for one of the side panel.
#
#   powershell -ExecutionPolicy Bypass -File scripts/store-screenshots.ps1
#
# Reads  dist-extension/screenshots-src/*.png|jpg
# Writes dist-extension/screenshots/*.png at 1280x800.

param(
  [string] $Source = "dist-extension/screenshots-src",
  [string] $Out    = "dist-extension/screenshots",
  [int]    $Width  = 1280,
  [int]    $Height = 800,
  # Small captures are scaled up to fill the frame. Pass this to
  # centre them at their own size instead, which is sharper but
  # leaves more empty canvas.
  [switch] $NoUpscale
)

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$srcDir = Join-Path $root $Source
$outDir = Join-Path $root $Out

if (-not (Test-Path $srcDir)) {
  New-Item -ItemType Directory -Path $srcDir -Force | Out-Null
  Write-Host "created $srcDir - put your screenshots in it and run this again"
  exit 0
}

New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$files = Get-ChildItem -Path $srcDir -Include *.png, *.jpg, *.jpeg -File -Recurse

if ($files.Count -eq 0) {
  Write-Host "no images in $srcDir"
  exit 0
}

foreach ($file in $files) {
  $image = [System.Drawing.Image]::FromFile($file.FullName)

  try {
    $scale = [Math]::Min($Width / $image.Width, $Height / $image.Height)

    if ($NoUpscale -and $scale -gt 1) { $scale = 1 }

    $drawW = [int][Math]::Round($image.Width * $scale)
    $drawH = [int][Math]::Round($image.Height * $scale)
    $x = [int](($Width - $drawW) / 2)
    $y = [int](($Height - $drawH) / 2)

    # The background, taken from the capture itself.
    $bitmapIn = New-Object System.Drawing.Bitmap $image
    $corner = $bitmapIn.GetPixel(0, 0)
    $brush = New-Object System.Drawing.SolidBrush $corner

    # 24-bit, NO ALPHA, which the Store asks for by name.
    #
    # `New-Object Bitmap $w, $h` gives Format32bppArgb, and
    # saving that writes a PNG with an alpha channel that the
    # upload refuses. The pixel format has to be asked for.
    $canvas = New-Object System.Drawing.Bitmap(
      $Width, $Height,
      [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
    )
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.FillRectangle($brush, 0, 0, $Width, $Height)
    $g.DrawImage($image, $x, $y, $drawW, $drawH)

    $target = Join-Path $outDir ($file.BaseName + ".png")
    $canvas.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)

    Write-Host ("{0,-34} {1}x{2} -> {3}x{4}  (scaled {5:P0})" -f `
      $file.Name, $image.Width, $image.Height, $Width, $Height, $scale)

    $g.Dispose()
    $canvas.Dispose()
    $brush.Dispose()
    $bitmapIn.Dispose()
  }
  finally {
    $image.Dispose()
  }
}

Write-Host ""
Write-Host "written to $outDir"
