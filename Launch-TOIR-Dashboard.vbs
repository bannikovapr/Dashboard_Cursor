' Тихий запуск дашборда (без окна консоли).
' Доп. аргументы wscript передаются в start-dashboard-quiet.ps1, например:
'   wscript.exe Launch-TOIR-Dashboard.vbs -NoRefresh
Option Explicit

Dim fso, root, ps1, psArgs, cmd, extra, i
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = fso.BuildPath(fso.BuildPath(root, "scripts"), "start-dashboard-quiet.ps1")

extra = ""
For i = 0 To WScript.Arguments.Count - 1
  extra = extra & " " & WScript.Arguments(i)
Next

psArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """" & extra
cmd = "powershell.exe " & psArgs

CreateObject("WScript.Shell").Run cmd, 0, False
