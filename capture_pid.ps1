param([int]$id = 0, [string]$out = "D:\Desktop\nixiang\聆听\ListenDesktop\shot_final.png", [switch]$max)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Cap3 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
[Win32Cap3]::SetProcessDPIAware() | Out-Null
$proc = if ($id -gt 0) { Get-Process -Id $id -ErrorAction SilentlyContinue } else { $null }
if (-not $proc -or $proc.MainWindowHandle -eq 0) { Write-Output "NO_WINDOW"; exit 1 }
$h = $proc.MainWindowHandle
if ($max) { [Win32Cap3]::ShowWindow($h, 3) | Out-Null } else { [Win32Cap3]::ShowWindow($h, 9) | Out-Null }
Start-Sleep -Milliseconds 300
[Win32Cap3]::SetForegroundWindow($h) | Out-Null
[Win32Cap3]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x0001 -bor 0x0002) | Out-Null
Start-Sleep -Milliseconds 1100
$r = New-Object Win32Cap3+RECT
[Win32Cap3]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
Write-Output "win=$($proc.Id) rect=$($r.Left),$($r.Top),$w,$hh"
$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size $w, $hh))
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
[Win32Cap3]::SetWindowPos($h, [IntPtr](-2), 0, 0, 0, 0, 0x0001 -bor 0x0002) | Out-Null
Write-Output "SAVED $out"
