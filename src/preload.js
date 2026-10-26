const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = ch => cb => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(ch, fn);
  return () => ipcRenderer.removeListener(ch, fn);
};

contextBridge.exposeInMainWorld('podium', {
  info: () => ipcRenderer.invoke('app:info'),
  adapterSource: () => ipcRenderer.invoke('adapter:source'),
  pickDeck: () => ipcRenderer.invoke('deck:pick'),
  loadDeck: p => ipcRenderer.invoke('deck:load', p),
  pickNotes: () => ipcRenderer.invoke('notes:pick'),
  clearNotes: () => ipcRenderer.invoke('notes:clear'),
  resetNotes: () => ipcRenderer.invoke('notes:reset'),
  start: opts => ipcRenderer.invoke('show:start', opts),
  stop: () => ipcRenderer.invoke('show:stop'),
  nav: cmd => ipcRenderer.invoke('show:nav', cmd),
  goTo: i => ipcRenderer.invoke('show:goto', i),
  blank: mode => ipcRenderer.invoke('show:blank', mode),
  swap: () => ipcRenderer.invoke('show:swap'),
  notes: () => ipcRenderer.invoke('show:notes'),
  setSetting: (k, v) => ipcRenderer.invoke('settings:set', k, v),
  pathForFile: file => webUtils.getPathForFile(file),

  onDeckLoaded: on('deck:loaded'),
  onDeckChanged: on('deck:changed'),
  onDisplays: on('displays:changed'),
  onShowInfo: on('show:info'),
  onState: on('audience:state'),
  onOutline: on('show:outline'),
  onNotes: on('notes:mapped'),
  onBlank: on('show:blank'),
  onEnded: on('show:ended'),
});
