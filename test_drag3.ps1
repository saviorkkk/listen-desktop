Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public class G1{
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int cx,int cy,uint f);
 [StructLayout(LayoutKind.Sequential)] public struct RECT{public int L,T,R,B;}
}
'@
[void][G1]::SetProcessDPIAware()
$h = [IntPtr]$args[0]
function GR(){ $q=New-Object G1+RECT; [void][G1]::GetWindowRect($h,[ref]$q); return ,@($q.L,$q.T,($q.R-$q.L),($q.B-$q.T)) }

function Reset(){
  [void][G1]::SetWindowPos($h,[IntPtr]::Zero,120,80,1600,970,0x0040); Start-Sleep -Milliseconds 450
  [void][G1]::SetForegroundWindow($h); Start-Sleep -Milliseconds 400
}

Write-Host "=== 1) 单击后隔 600ms 再按住拖 ==="
Reset
$b = GR
$x = [int]($b[0]+985*1.25); $y = [int]($b[1]+40*1.25)
[void][G1]::SetCursorPos($x,$y); Start-Sleep -Milliseconds 200
[G1]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 80; [G1]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 600
[G1]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 200
for($i=1;$i -le 12;$i++){ [void][G1]::SetCursorPos($x-[int](60*$i/12), $y+[int](40*$i/12)); Start-Sleep -Milliseconds 45 }
[G1]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 500
$a = GR
Write-Host ("  dx={0} dy={1} dw={2} dh={3}  W={4} H={5}" -f ($a[0]-$b[0]),($a[1]-$b[1]),($a[2]-$b[2]),($a[3]-$b[3]),$a[2],$a[3])

Write-Host "=== 2) 快速双击（应为无动作，不最大化） ==="
Reset
$b = GR
$x = [int]($b[0]+985*1.25); $y = [int]($b[1]+40*1.25)
[void][G1]::SetCursorPos($x,$y); Start-Sleep -Milliseconds 200
[G1]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); [G1]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 80
[G1]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); [G1]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)
Start-Sleep -Milliseconds 700
$a = GR
Write-Host ("  dx={0} dy={1} dw={2} dh={3}  W={4} H={5}  (期望 dw=0 dh=0)" -f ($a[0]-$b[0]),($a[1]-$b[1]),($a[2]-$b[2]),($a[3]-$b[3]),$a[2],$a[3])

Write-Host "=== 3) 顶栏快速连拖 5 次，看尺寸是否漂移 ==="
Reset
$b = GR
for($k=1;$k -le 5;$k++){
  $p = GR
  $px = [int]($p[0]+985*1.25); $py = [int]($p[1]+40*1.25)
  [void][G1]::SetCursorPos($px,$py); Start-Sleep -Milliseconds 180
  [G1]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 180
  for($i=1;$i -le 8;$i++){ [void][G1]::SetCursorPos($px-[int](20*$i/8), $py+[int](15*$i/8)); Start-Sleep -Milliseconds 40 }
  [G1]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero); Start-Sleep -Milliseconds 400
  $q = GR
  Write-Host ("  #{0} W={1} H={2}  dw={3} dh={4}" -f $k,$q[2],$q[3],($q[2]-$b[2]),($q[3]-$b[3]))
}
