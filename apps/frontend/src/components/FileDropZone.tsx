import { useRef, useState } from 'react';
import { useFileUpload } from '../hooks/useFileUpload';
import {
  BG_CARD, BORDER_COLOR, TEXT_SECONDARY, TEXT_MUTED, TEXT_PRIMARY,
  COOL_COLOR, WIN_BASE, WIN_PALE,
  RADIUS_SM, FONT_NUM,
} from '../styles/tokens';

interface Props {
  endpoint:   string;
  accept:     string[];
  label:      string;
  onUploaded: (serverPath: string, filename: string) => void;
}

export function FileDropZone({ endpoint, accept, label, onUploaded }: Props) {
  const { state, progress, error, upload, reset } = useFileUpload();
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const [dragging,     setDragging]     = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!accept.includes(ext)) {
      alert(`許可されていないファイルです。${accept.join(', ')} のみ対応しています。`);
      return;
    }
    try {
      const { serverPath } = await upload(file, endpoint);
      setUploadedName(file.name);
      onUploaded(serverPath, file.name);
    } catch {
      /* error is shown via hook state */
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = '';
  };

  const handleDelete = () => {
    setUploadedName(null);
    reset();
  };

  if (uploadedName && state === 'done') {
    return (
      <div style={s.done}>
        <span style={s.check}>✓</span>
        <span style={s.filename}>{uploadedName}</span>
        <button style={s.deleteBtn} onClick={handleDelete}>削除</button>
      </div>
    );
  }

  return (
    <div style={{ ...s.zone, borderColor: dragging ? COOL_COLOR : (error ? '#c43a3a' : BORDER_COLOR) }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => state !== 'uploading' && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept.join(',')}
        style={{ display: 'none' }}
        onChange={handleInputChange}
      />

      {state === 'uploading' ? (
        <div style={s.inner}>
          <div style={s.progressBar}>
            <div style={{ ...s.progressFill, width: `${progress}%` }} />
          </div>
          <span style={s.hint}>{progress}%</span>
        </div>
      ) : (
        <div style={s.inner}>
          <span style={s.icon}>⬆</span>
          <span style={s.mainText}>{label}</span>
          <span style={s.hint}>または クリックして選択 ({accept.join(', ')})</span>
          {error && <span style={s.errorText}>{error}</span>}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  zone: {
    border: '2px dashed',
    borderRadius: RADIUS_SM,
    padding: '16px 12px',
    cursor: 'pointer',
    transition: 'border-color 0.15s',
    textAlign: 'center',
    background: BG_CARD,
  },
  inner: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  icon:     { fontSize: 22 },
  mainText: { fontSize: 12, color: TEXT_SECONDARY },
  hint:     { fontSize: 10, color: TEXT_MUTED },
  errorText:{ fontSize: 11, color: '#c43a3a', marginTop: 4 },
  progressBar: {
    width: '100%',
    height: 4,
    background: BORDER_COLOR,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: COOL_COLOR,
    transition: 'width 0.1s',
  },
  done: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px',
    background: WIN_PALE,
    borderRadius: RADIUS_SM,
    border: `1px solid ${WIN_BASE}`,
  },
  check:    { color: WIN_BASE, fontSize: 14 },
  filename: { flex: 1, fontSize: 12, fontFamily: FONT_NUM, color: TEXT_PRIMARY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  deleteBtn: {
    padding: '2px 8px',
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: 99,
    background: BG_CARD,
    color: TEXT_MUTED,
    fontSize: 11,
    cursor: 'pointer',
  },
};
