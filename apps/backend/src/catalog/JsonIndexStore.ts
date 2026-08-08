import fs from 'node:fs';
import path from 'node:path';

/**
 * 「ディレクトリ + index.json」で永続化するカタログの土台。
 *
 * プログラムライブラリ (programCatalog) とマップライブラリ (mapCatalog) は、
 * 保存するエントリの中身が違うだけで、ディレクトリの用意・index.json の読み書き・
 * id での削除は同じことをしていた。同じ規則が2箇所にあると、片方だけ壊れた JSON への
 * 対処を変えるといった食い違いが起きるのでここに集約する。
 *
 * エントリ固有の処理 (ファイルのリネーム・パース・削除するファイルの決め方) は
 * 呼び出し側に残す。
 */
export class JsonIndexStore<T extends { id: string }> {
  readonly dir: string;
  private readonly indexPath: string;

  constructor(dir: string) {
    this.dir       = path.resolve(dir);
    this.indexPath = path.join(this.dir, 'index.json');
  }

  /** ディレクトリと空の index.json を用意する (既にあれば何もしない) */
  ensureDir(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.indexPath)) this.write([]);
  }

  /** index.json の中身。読めない・壊れている場合は空として扱い、カタログ自体は壊さない */
  read(): T[] {
    try {
      return JSON.parse(fs.readFileSync(this.indexPath, 'utf-8')) as T[];
    } catch {
      return [];
    }
  }

  write(entries: T[]): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.indexPath, JSON.stringify(entries, null, 2));
  }

  find(id: string): T | undefined {
    return this.read().find(e => e.id === id);
  }

  add(entry: T): void {
    const entries = this.read();
    entries.push(entry);
    this.write(entries);
  }

  /**
   * id のエントリを index から外す。
   * 実体ファイルの削除は呼び出し側の責任なので、外したエントリを返す。
   */
  remove(id: string): T | undefined {
    const entries = this.read();
    const entry   = entries.find(e => e.id === id);
    if (!entry) return undefined;
    this.write(entries.filter(e => e.id !== id));
    return entry;
  }
}
