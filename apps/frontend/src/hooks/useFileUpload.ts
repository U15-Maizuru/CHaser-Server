import { useCallback, useState } from 'react';

type UploadState = 'idle' | 'uploading' | 'done' | 'error';

interface UploadResult {
  serverPath: string;
}

export interface FileUploadHook {
  state:    UploadState;
  progress: number;
  error:    string | null;
  upload:   (file: File, endpoint: string) => Promise<UploadResult>;
  reset:    () => void;
}

export function useFileUpload(): FileUploadHook {
  const [state,    setState]    = useState<UploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [error,    setError]    = useState<string | null>(null);

  const reset = useCallback(() => {
    setState('idle');
    setProgress(0);
    setError(null);
  }, []);

  const upload = useCallback((file: File, endpoint: string): Promise<UploadResult> => {
    return new Promise((resolve, reject) => {
      setState('uploading');
      setProgress(0);
      setError(null);

      const fd = new FormData();
      fd.append('file', file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', endpoint);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setProgress(100);
          setState('done');
          resolve(JSON.parse(xhr.responseText) as UploadResult);
        } else {
          let msg = 'アップロードに失敗しました';
          try { msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg; } catch { /* */ }
          setError(msg);
          setState('error');
          reject(new Error(msg));
        }
      };

      xhr.onerror = () => {
        const msg = 'ネットワークエラーが発生しました';
        setError(msg);
        setState('error');
        reject(new Error(msg));
      };

      xhr.send(fd);
    });
  }, []);

  return { state, progress, error, upload, reset };
}
