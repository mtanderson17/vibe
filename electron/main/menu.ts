import { Menu, shell, type MenuItemConstructorOptions, type BrowserWindow } from 'electron'

// Vibe application menu — replaces the default Electron menu with items that
// actually do something in the app. Every menu item that maps to an in-app
// action fires an IPC message that the renderer handles.

export function buildAppMenu(win: BrowserWindow): void {
  const isMac = process.platform === 'darwin'

  function send(channel: string, ...args: unknown[]): void {
    win.webContents.send(channel, ...args)
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: 'Vibe',
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => send('menu:settings') },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const }
      ]
    } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Agent',
          accelerator: 'CommandOrControl+T',
          click: () => send('menu:new-agent')
        },
        {
          label: 'Close Agent',
          accelerator: 'CommandOrControl+W',
          click: () => send('menu:close-agent')
        },
        { type: 'separator' },
        ...(isMac ? [] : [
          { label: 'Settings…', accelerator: 'Ctrl+,', click: () => send('menu:settings') } as MenuItemConstructorOptions,
          { type: 'separator' as const },
          { role: 'quit' as const }
        ])
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Control Center', accelerator: 'CommandOrControl+1', click: () => send('menu:view', 'control') },
        { label: 'Tasks',          accelerator: 'CommandOrControl+2', click: () => send('menu:view', 'tasks') },
        { label: 'Cost',           accelerator: 'CommandOrControl+3', click: () => send('menu:view', 'cost') },
        { label: 'Context',        accelerator: 'CommandOrControl+4', click: () => send('menu:view', 'context') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Agent',
      submenu: [
        { label: 'New Agent', accelerator: 'CommandOrControl+T', click: () => send('menu:new-agent') },
        { label: 'Focus Next Agent', accelerator: 'CommandOrControl+]', click: () => send('menu:focus-next') },
        { label: 'Focus Previous Agent', accelerator: 'CommandOrControl+[', click: () => send('menu:focus-prev') },
        { type: 'separator' },
        { label: 'Stop Current Agent', accelerator: 'CommandOrControl+.', click: () => send('menu:stop-current') },
        { type: 'separator' },
        { label: 'Regenerate Project Summary', accelerator: 'CommandOrControl+Shift+R', click: () => send('menu:pm-regenerate') }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CommandOrControl+/',
          click: () => send('menu:shortcuts')
        },
        {
          label: 'Command Palette',
          accelerator: 'CommandOrControl+K',
          click: () => send('menu:palette')
        },
        { type: 'separator' },
        {
          label: 'Vibe on GitHub',
          click: () => { shell.openExternal('https://github.com/mtanderson17/vibe') }
        },
        {
          label: 'Report an Issue',
          click: () => { shell.openExternal('https://github.com/mtanderson17/vibe/issues') }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
