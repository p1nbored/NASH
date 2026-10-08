export const MACOS_TCC_KEY_OVERRIDES = {
  'auto.hooks.useMacosTccPromptNotice.title': {
    es: '¿Ves avisos de “NASH quiere acceder…”?',
    ja: '「NASH がアクセスしようとしています…」という確認が表示されますか？',
    ko: '“NASH에서 접근하려고 합니다…” 권한 요청이 표시되나요?',
    zh: '看到“NASH 想要访问…”提示？'
  },
  'auto.hooks.useMacosTccPromptNotice.description': {
    es: 'Los mensajes de permisos de macOS pueden aparecer cuando un agente o una herramienta de terminal que se ejecuta en NASH intenta acceder a archivos protegidos. Concede acceso total al disco en Ajustes para reducir estos avisos.',
    ja: 'NASH で実行中のエージェントやターミナルツールが保護されたファイルにアクセスしようとすると、macOS の権限メッセージが表示されることがあります。これらの確認を減らすには、設定でフルディスクアクセスを許可してください。',
    ko: 'NASH에서 실행 중인 에이전트나 터미널 도구가 보호된 파일에 접근하려고 하면 macOS 권한 메시지가 표시될 수 있습니다. 이러한 요청을 줄이려면 설정에서 전체 디스크 접근 권한을 허용하세요.',
    zh: '当 NASH 中运行的智能体或终端工具尝试访问受保护的文件时，macOS 可能会显示权限信息。请在“设置”中授予“完全磁盘访问权限”，以减少此类提示。'
  },
  'auto.components.settings.DeveloperPermissionsPane.7ca17b62c8': {
    es: 'Cuando los agentes que ejecuta NASH leen datos de otras apps, macOS muestra el nombre de NASH porque es el proceso responsable de los comandos de terminal. Concede este permiso a NASH para reducir esos avisos. Después, cierra y vuelve a abrir NASH.',
    ja: 'NASH が実行するエージェントがほかのアプリのデータを読み取ると、ターミナルコマンドの実行元プロセスである NASH の名前が macOS に表示されます。これらの確認を減らすには、NASH にこの権限を許可してください。その後、NASH を終了して再度開いてください。',
    ko: 'NASH가 실행하는 에이전트가 다른 앱의 데이터를 읽으면, macOS는 터미널 명령을 실행하는 프로세스인 NASH를 표시합니다. 이러한 요청을 줄이려면 NASH에 이 권한을 허용하세요. 그런 다음 NASH를 종료했다가 다시 여세요.',
    zh: '当 NASH 运行的智能体读取其他应用的数据时，macOS 会显示 NASH，因为 NASH 是执行终端命令的进程。请为 NASH 授予此权限，以减少此类提示。然后退出并重新打开 NASH。'
  },
  'auto.components.settings.DeveloperPermissionsPane.c566bca278': {
    ko: '전체 디스크 접근 권한',
    zh: '完全磁盘访问权限'
  }
}
