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
Source: "{src}\TrackLine-payload.zip"; DestDir: "{tmp}"; DestName: "TrackLine-payload.zip"; Flags: external ignoreversion deleteafterinstall

[Icons]
Name: "{group}\TrackLine"; Filename: "{app}\TrackLine.exe"
Name: "{autodesktop}\TrackLine"; Filename: "{app}\TrackLine.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na area de trabalho"; GroupDescription: "Atalhos:"

[Run]
Filename: "{app}\TrackLine.exe"; Description: "Iniciar TrackLine"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
function InitializeSetup(): Boolean;
begin
  Result := True;
  if not FileExists(ExpandConstant('{src}\TrackLine-payload.zip')) then
  begin
    MsgBox(
      'Arquivo "TrackLine-payload.zip" nao encontrado ao lado do instalador.'#13#10 +
      'Coloque os dois arquivos na mesma pasta antes de instalar.',
      mbError,
      MB_OK
    );
    Result := False;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
  Params: string;
begin
  if CurStep = ssInstall then
  begin
    Params := '-NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath ''' +
      ExpandConstant('{tmp}\TrackLine-payload.zip') + ''' -DestinationPath ''' +
      ExpandConstant('{app}') + ''' -Force"';

    if not Exec(
      ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      Params,
      '',
      SW_HIDE,
      ewWaitUntilTerminated,
      ResultCode
    ) then
    begin
      RaiseException('Falha ao descompactar os arquivos do TrackLine.');
    end;

    if ResultCode <> 0 then
    begin
      RaiseException(Format('Erro ao descompactar payload (codigo %d).', [ResultCode]));
    end;
  end;
end;
