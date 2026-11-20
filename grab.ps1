param([string]$Out = "D:\Desktop\nixiang\聆听\shot.png")

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Drawing;
public class Cap {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }

  public static string Grab(IntPtr hwnd, string path, int x, int y, int w, int h) {
    if (hwnd == IntPtr.Zero) return "no hwnd";
    ShowWindow(hwnd, 9);
    SetWindowPos(hwnd, IntPtr.Zero, x, y, w, h, 0x0040);
    System.Threading.Thread.Sleep(500);
    SetForegroundWindow(hwnd);
    System.Threading.Thread.Sleep(400);
    RECT r;
    GetWindowRect(hwnd, out r);
    int ww = r.R - r.L, hh = r.B - r.T;
    if (ww <= 0 || hh <= 0) return "bad size";
    using (Bitmap bmp = new Bitmap(ww, hh))
    using (Graphics g = Graphics.FromImage(bmp)) {
      IntPtr hdc = g.GetHdc();
      PrintWindow(hwnd, hdc, 2);
      g.ReleaseHdc(hdc);
      bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
    }
    return "ok " + ww + "x" + hh;
  }
}
'@ -ReferencedAssemblies System.Drawing

$procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.ProcessName -match '\u542c' }
if (-not $procs) {
  $procs = Get-Process | Where-Object { $_.MainWindowTitle.Length -gt 0 -and $_.MainWindowHandle -ne 0 } | Where-Object { $_.MainWindowTitle -match '^\u542c' }
}
$target = $procs | Select-Object -First 1
if (-not $target) {
  Write-Output "NOT FOUND"
  Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object ProcessName, MainWindowTitle | Format-Table -AutoSize
  exit 1
}
Write-Output ("target: " + $target.Id + " " + $target.ProcessName)
[Cap]::Grab($target.MainWindowHandle, $Out, 40, 40, 1290, 830)
