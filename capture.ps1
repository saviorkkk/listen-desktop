param([string]$out = "D:\Desktop\nixiang\聆听\ListenDesktop\shot_discover.png")
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Cap {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int w, int h, bool repaint);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
[Win32Cap]::SetProcessDPIAware() | Out-Null
$proc = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match '聆听' } | Select-Object -First 1
if (-not $proc) { $proc = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }
if (-not $proc) { Write-Output "NO_WINDOW"; exit 1 }
$h = $proc.MainWindowHandle
[Win32Cap]::ShowWindow($h, 9) | Out-Null
[Win32Cap]::MoveWindow($h, 40, 40, 1280, 820, $true) | Out-Null
[Win32Cap]::SetWindowPos($h, [IntPtr](-1), 40, 40, 1280, 820, 0x0040) | Out-Null
[Win32Cap]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 800
$r = New-Object Win32Cap+RECT
[Win32Cap]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
Write-Output "win=$($proc.Id) rect=$($r.Left),$($r.Top),$w,$hh"
$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size $w, $hh))
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
[Win32Cap]::SetWindowPos($h, [IntPtr](-2), 40, 40, 1280, 820, 0x0040) | Out-Null
Write-Output "SAVED $out"
