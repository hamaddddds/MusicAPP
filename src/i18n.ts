export type Language = 'en';

export const translations = {
  en: {
    home: 'Home',
    search: 'Search',
    library: 'Library',
    radio: 'Radio',
    history: 'History',
    settings: 'Settings',
    update: 'Updates',
    checkUpdate: 'Check for Updates',
    checkingUpdate: 'Checking...',
    upToDate: 'You are using the latest version.',
    updateHint: 'The app checks for updates automatically on startup. Use this button to check manually if auto-update fails.',
    accounts: 'Accounts',
    connectedAccounts: 'Connected Accounts',
    connectAccount: 'Connect Account',
    disconnectAccount: 'Disconnect Account',
    themes: 'Appearance',
    language: 'Language',
    discordRpc: 'Discord RPC',
    about: 'About',
    rpcTitle: 'Discord Rich Presence',
    rpcDesc: 'Show the currently playing song on your Discord status.',
    rpcDesktopOnly: '(only on desktop app)',
    connectRpc: 'Connect RPC',
    connecting: 'Connecting...',
    disconnectRpc: 'Disconnect RPC',
    rpcStatusConnected: 'Connected to Desktop Client',
    rpcStatusConnecting: 'Connecting',
    rpcStatusError: 'Failed',
    rpcStatusOff: 'Inactive',
    loginDiscord: 'Login Discord',
    export: 'Export',
    import: 'Import',
    nowPlaying: 'Playing on Music Venue',
    preview: 'Preview',
    themeDark: 'Dark',
    themeLight: 'Light',
    themeAmoled: 'AMOLED',
  }
};

export function getTranslation(lang: Language, key: keyof typeof translations['en']): string {
  return translations['en'][key] || key;
}
