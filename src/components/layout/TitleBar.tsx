import { Minus, Square, X, RefreshCw } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useUpdate } from '../../contexts/UpdateContext';
import { isDesktopChromeAvailable } from '../../lib/runtime';

export function TitleBar() {
  const { checkForUpdates, isChecking } = useUpdate();

  if (!isDesktopChromeAvailable()) {
    return null;
  }

  const handleMinimize = async () => {
    try { await getCurrentWindow().minimize(); } catch (e) { console.error("minimize failed", e); }
  };
  const handleMaximize = async () => {
    try {
      const win = getCurrentWindow();
      if (await win.isMaximized()) { await win.unmaximize(); } else { await win.maximize(); }
    } catch (e) { console.error("maximize failed", e); }
  };
  const handleClose = async () => {
    try { await getCurrentWindow().close(); } catch (e) { console.error("close failed", e); }
  };

  return (
    <div 
      data-tauri-drag-region="true"
      className="h-10 bg-background/80 backdrop-blur-xl flex items-center justify-between px-2 select-none border-b border-border/30 sticky top-0 z-50 window-drag-region"
    >
      <div data-tauri-drag-region="true" className="flex items-center gap-2 pl-2">
         <span data-tauri-drag-region="true" className="font-bold text-sm tracking-tight pointer-events-none text-foreground">DogitoChat</span>
      </div>

      <div className="flex items-center gap-2">
        <button 
          onClick={() => checkForUpdates()}
          disabled={isChecking}
          className="mr-3 flex items-center gap-1.5 px-3 py-1 text-[11px] font-bold text-primary bg-primary/10 hover:bg-primary/20 transition-all rounded-full shadow-sm titlebar-button"
        >
          <RefreshCw size={12} className={isChecking ? "animate-spin" : ""} />
          {isChecking ? "Checking..." : "Check for Updates"}
        </button>

        <div className="flex h-10 items-center" data-tauri-drag-region="false">
          <button type="button" aria-label="Minimize" onClick={handleMinimize} data-tauri-drag-region="false"
            className="inline-flex justify-center items-center w-11 h-full hover:bg-secondary/80 transition-colors cursor-pointer text-muted-foreground hover:text-foreground border-0 bg-transparent p-0">
            <Minus size={16} />
          </button>
          <button type="button" aria-label="Maximize" onClick={handleMaximize} data-tauri-drag-region="false"
            className="inline-flex justify-center items-center w-11 h-full hover:bg-secondary/80 transition-colors cursor-pointer text-muted-foreground hover:text-foreground border-0 bg-transparent p-0">
            <Square size={14} />
          </button>
          <button type="button" aria-label="Close" onClick={handleClose} data-tauri-drag-region="false"
            className="inline-flex justify-center items-center w-11 h-full hover:bg-red-500 hover:text-white transition-colors cursor-pointer text-muted-foreground border-0 bg-transparent p-0">
            <X size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
