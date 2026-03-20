import { useState } from 'react';
import { Modal } from './modal';
import { Button } from './button';
import { Loader2, DownloadCloud, CheckCircle } from 'lucide-react';
import { relaunch } from '@tauri-apps/plugin-process';

export function UpdateModal({ update, onClose }: any) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [installed, setInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startUpdate = async () => {
    setDownloading(true);
    let downloaded = 0;
    let contentLength = 0;

    try {
      await update.downloadAndInstall((event: any) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength;
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            if (contentLength) {
              setProgress(Math.round((downloaded / contentLength) * 100));
            }
            break;
          case 'Finished':
            break;
        }
      });
      setInstalled(true);
    } catch(err: any) {
      console.error(err);
      setError(err.toString());
    } finally {
      setDownloading(false);
    }
  }

  const handleRestart = async () => {
    await relaunch();
  };

  return (
    <Modal isOpen={true} onClose={downloading ? () => {} : onClose} title="Software Update Available!">
      <div className="space-y-6 pt-4">
        <div className="p-4 bg-secondary/30 rounded-xl border border-border/50 text-center space-y-2">
          <div className="inline-flex p-3 bg-primary/10 rounded-full text-primary mb-2">
            <DownloadCloud size={32} />
          </div>
          <h3 className="font-bold text-xl text-foreground">Version {update.version} is now available!</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap text-left bg-background p-3 rounded-lg border border-border/30 mt-4 max-h-40 overflow-y-auto custom-scrollbar">
            {update.body || "No release notes provided."}
          </p>
        </div>

        {error && <div className="p-3 text-sm text-red-500 bg-red-500/10 rounded-md border border-red-500/20">{error}</div>}

        {installed ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-500 justify-center">
              <CheckCircle size={20} />
              <span className="font-semibold">Update installed successfully!</span>
            </div>
            <Button onClick={handleRestart} className="w-full h-11 text-base bg-primary shadow-lg shadow-primary/20">
              Restart App Now
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {downloading && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium text-foreground">
                  <span>Downloading update...</span>
                  <span>{progress}%</span>
                </div>
                <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-primary transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}
            
            <div className="flex gap-3">
              <Button variant="outline" onClick={onClose} disabled={downloading} className="flex-1">
                Remind Me Later
              </Button>
              <Button onClick={startUpdate} disabled={downloading} className="flex-1 shadow-lg shadow-primary/20">
                {downloading ? <Loader2 className="animate-spin" size={18} /> : 'Download & Install'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
