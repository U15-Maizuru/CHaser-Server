import { useEffect, useState } from 'react';
import { FileDropZone } from './FileDropZone';
import { BORDER_COLOR, TEXT_SECONDARY, TEXT_PRIMARY, TEXT_MUTED, WIN_BASE, BG_CARD, FONT_NUM } from '../styles/tokens';

interface Props {
  slot:     0 | 1;
  httpBase: string;
  roomId:   string;
}

const DEFAULT_LIBRARY = 'pyCHaser.py';

export function LibrarySection({ slot, httpBase, roomId }: Props) {
  const [open,  setOpen]  = useState(false);
  const [files, setFiles] = useState<string[]>([]);

  const libEndpoint  = `${httpBase}/api/upload/library?slot=${slot}&room=${roomId}`;
  const customFiles  = files.filter(f => f !== DEFAULT_LIBRARY);

  const fetchFiles = () => {
    fetch(`${httpBase}/api/libs?slot=${slot}&room=${roomId}`)
      .then(r => r.json())
      .then((d: { files: string[] }) => setFiles(d.files))
      .catch(() => {});
  };

  useEffect(() => {
    if (open) fetchFiles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleDelete = (filename: string) => {
    fetch(`${httpBase}/api/libs/${encodeURIComponent(filename)}?slot=${slot}&room=${roomId}`, { method: 'DELETE' })
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
            <span style={s.label}>標準ライブラリ: lib.pyCHaser（常に利用可能）</span>
          </div>

          {customFiles.length > 0 && (
            <div style={s.fileList}>
              {customFiles.map(f => (
                <div key={f} style={s.fileRow}>
                  <span style={s.fileName}>lib.{f.replace(/\.py$/, '')}</span>
                  <button style={s.deleteBtn} onClick={() => handleDelete(f)}>削除</button>
                </div>
              ))}
            </div>
          )}

          <span style={s.hint}>
            追加した .py ファイルは、プログラムから lib.ファイル名 として import できます
          </span>
          <FileDropZone
            endpoint={libEndpoint}
            accept={['.py']}
            label="カスタムライブラリ (.py) をドロップ"
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
  check: { color: WIN_BASE, fontSize: 12 },
  label: { fontSize: 11, color: TEXT_SECONDARY },
  fileList: { display: 'flex', flexDirection: 'column', gap: 4 },
  hint: { fontSize: 10, color: TEXT_MUTED },
  fileRow: { display: 'flex', alignItems: 'center', gap: 8 },
  fileName: { flex: 1, fontSize: 11, fontFamily: FONT_NUM, color: TEXT_PRIMARY },
  deleteBtn: {
    padding: '1px 6px', border: `1px solid ${BORDER_COLOR}`, borderRadius: 99,
    background: BG_CARD, color: TEXT_SECONDARY, fontSize: 10, cursor: 'pointer',
  },
};
