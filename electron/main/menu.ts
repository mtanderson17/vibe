import { Menu, shell, type MenuItemConstructorOptions, type BrowserWindow } from 'electron'
import { getConfig } from './config'
import { resolveAccelerator } from './keybindings'

// Vibe application menu — replaces the default Electron menu with items that
// actually do something in the app. Every menu item that maps to an in-app
// action fires an IPC message that the renderer handles.

export function buildAppMenu(win: BrowserWindow): void {
  const isMac = process.platform === 'darwin'
  const overrides = getConfig().keybindings

  function send(channel: string, ...args: unknown[]): void {
    win.webContents.send(channel, ...args)
  }
  // Sugar: pull the current accelerator for a keybinding id (respects overrides).
  const accel = (id: string) => resolveAccelerator(id, overrides)

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: 'Vibe',
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { label: 'Settings…', accelerator: accel('settings'), click: () => send('menu:settings') },
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
          label: 'Open Project…',
          accelerator: accel('open-project'),
          click: () => send('menu:open-project')
        },
        {
          label: 'Open Recent',
          submenu: recentWorkspacesSubmenu(send)
        },
        { type: 'separator' },
        {
          label: 'New Agent',
          accelerator: accel('new-agent'),
          click: () => send('menu:new-agent')
        },
        {
          label: 'Close Agent',
          accelerator: accel('close-agent'),
          click: () => send('menu:close-agent')
        },
        { type: 'separator' },
        ...(isMac ? [] : [
          { label: 'Settings…', accelerator: accel('settings'), click: () => send('menu:settings') } as MenuItemConstructorOptions,
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
        { label: 'Control Center', accelerator: accel('view-control'), click: () => send('menu:view', 'control') },
        { label: 'Tasks',          accelerator: accel('view-tasks'),   click: () => send('menu:view', 'tasks') },
        { label: 'Files',          accelerator: accel('view-files'),   click: () => send('menu:view', 'files') },
        { label: 'Cost',           accelerator: accel('view-cost'),    click: () => send('menu:view', 'cost') },
        { label: 'Context',        accelerator: accel('view-context'), click: () => send('menu:view', 'context') },
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
        { label: 'New Agent', accelerator: accel('new-agent'), click: () => send('menu:new-agent') },
        { label: 'Focus Next Agent', accelerator: accel('focus-next'), click: () => send('menu:focus-next') },
        { label: 'Focus Previous Agent', accelerator: accel('focus-prev'), click: () => send('menu:focus-prev') },
        { type: 'separator' },
        { label: 'Stop Current Agent', accelerator: accel('stop-current'), click: () => send('menu:stop-current') },
        { type: 'separator' },
        { label: 'Regenerate Project Summary', accelerator: accel('pm-regenerate'), click: () => send('menu:pm-regenerate') }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: accel('shortcuts'),
          click: () => send('menu:shortcuts')
        },
        {
          label: 'Command Palette',
          accelerator: accel('palette'),
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

function recentWorkspacesSubmenu(send: (channel: string, ...args: unknown[]) => void): MenuItemConstructorOptions[] {
  const recent = getConfig().recentWorkspaces
  if (!recent.length) {
    return [{ label: '(no recent projects)', enabled: false }]
  }
  return recent.map(path => ({
    label: path,
    click: () => send('menu:open-project', path)
  }))
}
