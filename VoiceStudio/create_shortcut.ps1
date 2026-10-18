$WshShell = New-Object -comObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
$ShortcutPath = Join-Path -Path $DesktopPath -ChildPath "Ahmad Voice Studio.lnk"
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$TargetPath = Join-Path -Path $AppDir -ChildPath "run.bat"

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $TargetPath
$Shortcut.WorkingDirectory = $AppDir
$Shortcut.Description = "Ahmad Voice Studio - Neural Voice Cloning Desktop App"
$Shortcut.Save()

Write-Host "[OK] Desktop shortcut created at: $ShortcutPath"
