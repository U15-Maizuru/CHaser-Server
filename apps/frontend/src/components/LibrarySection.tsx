import { useEffect, useState } from 'react';
import { FileDropZone } from './FileDropZone';
import { BORDER_COLOR, TEXT_SECONDARY, STATE_READY } from '../styles/tokens';

interface Props {
  slot:     0 | 1;
  httpBase: string;
}

export function LibrarySection({ slot, httpBase }: Props) {
  const [open,  setOpen]  = useState(false);
  const [files, setFiles] = useState<string[]>([]);

  const libEndpoint = `${httpBase}/api/upload/library?slot=${slot}`;

  const fetchFiles = () => {
    fetch(`${httpBase}/api/libs?slot=${slot}`)
      .then(r => r.json())
      .then((d: { files: string[] }) => setFiles(d.files))
      .catch(() => {});
  };

  useEffect(() => {
    if (open) fetchFiles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleDelete = (filename: string) => {
    fetch(`${httpBase}/api/libs/${encodeURIComponent(filename)}?slot=${slot}`, { method: 'DELETE' })
      .then(() => fetchFiles())
      .catch(() => {});
  };

  return (
    <div style={s.root}>
      <button style={s.toggle} onClick={() => setOpen(o => !o)}>
        カスタムライブラリ {open ? '▲' : '▼'}
      </button>

      {open && (
        <div style={s.body}>
          <div style={s.preinstalled}>
            <span style={s.check}>✓</span>
            <span style={s.label}>プリインストール: pychaser</span>
          </div>

          {files.length > 0 && (
            <div style={s.fileList}>
              {files.map(f => (
                <div key={f} style={s.fileRow}>
                  <span style={s.fileName}>{f}</span>
                  <button style={s.deleteBtn} onClick={() => handleDelete(f)}>削除</button>
                </div>
              ))}
            </div>
          )}

          <FileDropZone
            endpoint={libEndpoint}
            accept={['.py']}
            label=".py ライブラリファイルをドロップ"
            onUploaded={() => fetchFiles()}
          />
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: { marginTop: 8 },
  toggle: {
    width: '100%', textAlign: 'left',
    padding: '4px 0',
    background: 'none', border: 'none', borderTop: `1px solid ${BORDER_COLOR}`,
    color: TEXT_SECONDARY, fontSize: 11, cursor: 'pointer', paddingTop: 8,
  },
  body: { display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 6 },
  preinstalled: { display: 'flex', alignItems: 'center', gap: 6 },
  check: { color: STATE_READY, fontSize: 12 },
  label: { fontSize: 11, color: TEXT_SECONDARY },
  fileList: { display: 'flex', flexDirection: 'column', gap: 4 },
  fileRow: { display: 'flex', alignItems: 'center', gap: 8 },
  fileName: { flex: 1, fontSize: 11, fontFamily: 'monospace', color: '#ccc' },
  deleteBtn: {
    padding: '1px 6px', border: '1px solid #444', borderRadius: 3,
    background: 'transparent', color: '#888', fontSize: 10, cursor: 'pointer',
  },
};
