#define MyAppName "TrackLine"
#ifndef MyAppVersion
#define MyAppVersion "0.1.0"
#endif

[Setup]
AppId={{4AF1079A-3E86-45D2-AF0A-5D3A63A7D614}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=TrackLine
DefaultDirName={autopf}\TrackLine
DefaultGroupName=TrackLine
DisableProgramGroupPage=yes
OutputDir=..\release\installer
OutputBaseFilename=TrackLine-Setup-{#MyAppVersion}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
UninstallDisplayIcon={app}\TrackLine.exe

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "..\release\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\TrackLine"; Filename: "{app}\TrackLine.exe"
Name: "{autodesktop}\TrackLine"; Filename: "{app}\TrackLine.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na area de trabalho"; GroupDescription: "Atalhos:"

[Run]
Filename: "{app}\TrackLine.exe"; Description: "Iniciar TrackLine"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
