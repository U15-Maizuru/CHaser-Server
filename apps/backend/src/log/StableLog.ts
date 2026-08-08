import fs from 'node:fs';

export class StableLog {
  private filename: string;

  constructor(filename = '') {
    this.filename = filename;
    if (filename) {
      fs.writeFileSync(filename, '--Stable Log--\r\n', { encoding: 'utf8', flag: 'w' });
    }
  }

  write(str: string): void {
    if (!this.filename) return;
    fs.appendFileSync(this.filename, str, { encoding: 'utf8' });
  }
}
