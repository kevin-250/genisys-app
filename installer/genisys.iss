; Genisys installer (Inno Setup 6 or 7). Build: package the app first (npm run package), then compile this file
; with Inno Setup (or run build-installer.bat). Output: installer\dist\Genisys-Setup.exe
#define AppName "Genisys"
#define AppVersion "1.1.0"
#define AppExe "genisys.exe"
#define Src "..\out\Genisys-win32-x64"

[Setup]
AppId={{6F1D2B7A-3C9E-4B52-9A41-7E5D0C8B2F13}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppName}
; Default location: per-user, no admin prompt. The wizard shows a "Select Destination Location" page so the user can change it.
DefaultDirName={autopf}\{#AppName}
DisableDirPage=no
DisableProgramGroupPage=yes
DisableReadyPage=no
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
WizardImageFile=wizard.bmp
WizardSmallImageFile=small.bmp
SetupIconFile=..\assets\icon.ico
; Installed apps list icon: the real .ico shipped in resources\assets (extraResource), so it does not depend on the exe's embedded icon.
UninstallDisplayIcon={app}\resources\assets\icon.ico
; Strongest LZMA2 settings (256 MB dictionary, needs ~3 GB RAM while compiling): ~10 MB smaller than lzma2/max.
Compression=lzma2/ultra64
LZMADictionarySize=262144
LZMANumFastBytes=273
SolidCompression=yes
OutputDir=dist
OutputBaseFilename=Genisys-Setup
; force: Genisys keeps running in the tray, so close it even if it does not answer the close request
CloseApplications=force
; Only one Setup at a time (a quick double-click must not open two wizards).
SetupMutex=GenisysSetupMutex

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"
Name: "startup"; Description: "Start Genisys when Windows starts"; GroupDescription: "Options:"

[Files]
Source: "{#Src}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\resources\assets\icon.ico"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\resources\assets\icon.ico"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#AppName}"; ValueData: """{app}\{#AppExe}"" --autostart"; Flags: uninsdeletevalue; Tasks: startup

; A new stamp on every fresh install (not on updates): the app shows its first-run setup once per stamp.
[INI]
Filename: "{app}\install.ini"; Section: "install"; Key: "stamp"; String: "{code:InstallStamp}"; Check: IsFreshInstall

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/im {#AppExe} /f"; Flags: runhidden; RunOnceId: "KillGenisys"

[Run]
Filename: "{app}\{#AppExe}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent

[Code]
const
  FeedbackMail = 'feedback@example.com'; // change this to your address; the feedback button opens an email draft to it
const
  // Same GUID as AppId above. Inno writes the uninstall entry to ...\Uninstall\<AppId>_is1 and removes it again on uninstall.
  UninstKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{6F1D2B7A-3C9E-4B52-9A41-7E5D0C8B2F13}_is1';

var
  WipeData: Boolean;
  UpdateMode: Boolean;

function InstallStamp(Param: String): String;
begin
  Result := GetDateTimeString('yyyymmddhhnnss', #0, #0);
end;

function IsFreshInstall: Boolean;
begin
  Result := not UpdateMode;
end;

// Compares dotted versions like 1.2.10 (up to 4 parts). Returns -1, 0 or 1.
function NextPart(var S: String): Integer;
var
  P: Integer;
begin
  P := Pos('.', S);
  if P = 0 then
  begin
    Result := StrToIntDef(S, 0);
    S := '';
  end else
  begin
    Result := StrToIntDef(Copy(S, 1, P - 1), 0);
    S := Copy(S, P + 1, Length(S));
  end;
end;

function CompareVer(A, B: String): Integer;
var
  I, X, Y: Integer;
begin
  Result := 0;
  for I := 1 to 4 do
  begin
    X := NextPart(A);
    Y := NextPart(B);
    if X < Y then begin Result := -1; Exit; end;
    if X > Y then begin Result := 1; Exit; end;
  end;
end;

// True only when the uninstall entry exists AND the app exe is really there, so a leftover registry key
// (or a leftover folder without the key) never makes Setup think Genisys is installed.
function ReadInstall(Root: Integer; var Ver, Dir: String): Boolean;
var
  Uninst: String;
begin
  Result := False;
  Ver := '';
  Dir := '';
  if not RegQueryStringValue(Root, UninstKey, 'UninstallString', Uninst) then Exit;
  if not RegQueryStringValue(Root, UninstKey, 'Inno Setup: App Path', Dir) then
    if not RegQueryStringValue(Root, UninstKey, 'InstallLocation', Dir) then Exit;
  Dir := RemoveBackslash(Dir);
  if not FileExists(Dir + '\{#AppExe}') then Exit;
  RegQueryStringValue(Root, UninstKey, 'DisplayVersion', Ver);
  Result := True;
end;

procedure LaunchInstalled(Dir: String);
var
  Code: Integer;
begin
  ExecAsOriginalUser(Dir + '\{#AppExe}', '', Dir, SW_SHOWNORMAL, ewNoWait, Code);
end;

function InitializeSetup(): Boolean;
var
  Ver, Dir, Msg: String;
  Mine, Other: Integer;
  Cmp, R: Integer;
begin
  Result := True;
  UpdateMode := False;

  if IsAdminInstallMode then begin Mine := HKLM; Other := HKCU; end
  else begin Mine := HKCU; Other := HKLM; end;

  // Installed for the other scope (per-user vs all users): updating from here would create a second copy.
  if (not ReadInstall(Mine, Ver, Dir)) and ReadInstall(Other, Ver, Dir) then
  begin
    if not WizardSilent then
    begin
      R := TaskDialogMsgBox('Genisys is already installed.',
        'It is installed in ' + Dir + ' for a different Windows account scope.' + #13#10 +
        'To update or repair it, run this setup the same way it was installed (as administrator for all users, or normally for just you).',
        mbInformation, MB_OKCANCEL, ['Launch Genisys', 'Close'], 0);
      if R = IDOK then LaunchInstalled(Dir);
      Result := False;
    end;
    Exit;
  end;

  if not ReadInstall(Mine, Ver, Dir) then Exit;   // not installed: normal full wizard
  if WizardSilent then Exit;                      // /SILENT and /VERYSILENT: install/update, no questions

  Cmp := CompareVer('{#AppVersion}', Ver);
  if Cmp > 0 then
  begin
    // Newer installer: small update prompt, then only the progress and finish pages (folder and options are kept).
    Msg := 'Version ' + Ver + ' is installed. This setup will update it to ' + '{#AppVersion}' + '.' + #13#10 +
      'Your install folder and settings are kept.';
    R := TaskDialogMsgBox('Update Genisys', Msg, mbInformation, MB_YESNO, ['Update', 'Close'], 0);
    if R = IDYES then UpdateMode := True else Result := False;
  end else
  begin
    if Cmp = 0 then Msg := 'Version ' + Ver + ' is installed in ' + Dir + '.'
    else Msg := 'Version ' + Ver + ' is installed in ' + Dir + ' (this setup is the older version {#AppVersion}).';
    // Keep the button list on this line: Inno reads any line that starts with "[" as a new section.
    R := TaskDialogMsgBox('Genisys is already installed.', Msg, mbInformation, MB_YESNOCANCEL, ['Launch Genisys', 'Repair / Reinstall', 'Close'], 0);
    if R = IDYES then begin LaunchInstalled(Dir); Result := False; end
    else if R <> IDNO then Result := False;       // Close (or the window X); Repair / Reinstall falls through to the wizard
  end;
end;

procedure InitializeWizard();
begin
  if UpdateMode then WizardForm.Caption := 'Update Genisys';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if UpdateMode then
    Result := (PageID = wpWelcome) or (PageID = wpSelectDir) or (PageID = wpSelectTasks) or (PageID = wpReady);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Code: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    WipeData := False;
    if not UninstallSilent then
      WipeData := MsgBox('Also delete your Genisys data?' + #13#10 + #13#10 +
        'This removes saved commands, memory, notes, settings and API keys.' + #13#10 +
        'Choose No to keep it, so a reinstall picks up where you left off.',
        mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
  end;
  if CurUninstallStep = usPostUninstall then
  begin
    if WipeData then
      DelTree(ExpandConstant('{userappdata}\Executor'), True, True, True);
    RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'Genisys');
    RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'electron.app.Genisys');
    if not UninstallSilent then
      if MsgBox('Genisys is uninstalled. Sorry to see you go.' + #13#10 + #13#10 +
        'Want to tell us what went wrong or what was missing? It takes a minute and opens an email draft.',
        mbInformation, MB_YESNO) = IDYES then
        ShellExec('open', 'mailto:' + FeedbackMail + '?subject=Genisys%20feedback&body=What%20made%20you%20uninstall%3F%0A%0A', '', '', SW_SHOW, ewNoWait, Code);
  end;
end;
