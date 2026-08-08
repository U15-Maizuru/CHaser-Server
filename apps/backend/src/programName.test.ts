import { describe, expect, it } from 'vitest';
import { extractDeclaredName } from './programName.js';

/** 同梱サンプルと同じ形の雛形。名前は argparse の default から届く */
function templateSource(defaultName: string): string {
  return [
    '# player',
    'import argparse',
    'from lib.pyCHaser import * # lib/pyCHaser.py',
    '',
    'def main(port, name, host):',
    '    player = Client(port=port, name=name, host=host)',
    '    while True:',
    '        player.get_ready()',
    '',
    'if __name__ == "__main__":',
    '    parser = argparse.ArgumentParser()',
    "    parser.add_argument('-p', '--port', default=2009)",
    `    parser.add_argument('-n', '--name', default='${defaultName}')`,
    "    parser.add_argument('-i', '--host', default='localhost')",
    '    args = parser.parse_args()',
    '    main(port=args.port, name=args.name, host=args.host)',
  ].join('\n');
}

describe('extractDeclaredName', () => {
  it('Client(name=...) の文字列リテラルを拾う', () => {
    const src = "player = Client(port=2009, name='舞鶴A', host='localhost')";
    expect(extractDeclaredName(src)).toBe('舞鶴A');
  });

  it('ダブルクォートでも拾う', () => {
    const src = 'player = Client(port=2009, name="舞鶴A", host="localhost")';
    expect(extractDeclaredName(src)).toBe('舞鶴A');
  });

  it('複数行に分けた Client(...) でも拾う', () => {
    const src = [
      'player = Client(',
      '    port=2009,',
      "    name='舞鶴A',",
      "    host='localhost',",
      ')',
    ].join('\n');
    expect(extractDeclaredName(src)).toBe('舞鶴A');
  });

  it('name が最後の引数でも拾う', () => {
    expect(extractDeclaredName("Client(port=2009, name='舞鶴A')")).toBe('舞鶴A');
  });

  it('雛形どおり name=name のときは argparse の default を拾う', () => {
    expect(extractDeclaredName(templateSource('舞鶴A'))).toBe('舞鶴A');
  });

  it("雛形のままの default='player' もそのまま採用する", () => {
    // スコアバーに実際に出るのがこの値なので、除外せず初期値として見せる
    expect(extractDeclaredName(templateSource('player'))).toBe('player');
  });

  it('Client(name=...) のリテラルは argparse の default より優先される', () => {
    const src = templateSource('player')
      .replace('Client(port=port, name=name, host=host)', "Client(port=port, name='舞鶴A', host=host)");
    expect(extractDeclaredName(src)).toBe('舞鶴A');
  });

  it("短いオプション '-n' だけの宣言でも拾う", () => {
    const src = [
      'from lib.pyCHaser import *',
      'def main(port, name, host):',
      '    player = Client(port=port, name=name, host=host)',
      "parser.add_argument('-n', default='舞鶴A')",
    ].join('\n');
    expect(extractDeclaredName(src)).toBe('舞鶴A');
  });

  it('--name の default が無ければ undefined', () => {
    const src = [
      'from lib.pyCHaser import *',
      'def main(port, name, host):',
      '    player = Client(port=port, name=name, host=host)',
      "parser.add_argument('-n', '--name')",
    ].join('\n');
    expect(extractDeclaredName(src)).toBeUndefined();
  });

  it('--name 以外の default を誤って拾わない', () => {
    const src = [
      'from lib.pyCHaser import *',
      '    player = Client(port=port, name=name, host=host)',
      "parser.add_argument('-i', '--host', default='localhost')",
    ].join('\n');
    expect(extractDeclaredName(src)).toBeUndefined();
  });

  it('Client の呼び出しが無ければ undefined', () => {
    expect(extractDeclaredName('print("hi")')).toBeUndefined();
  });

  it('f-string や連結は解釈せず undefined', () => {
    expect(extractDeclaredName("Client(port=2009, name=f'舞鶴{i}', host='x')")).toBeUndefined();
    expect(extractDeclaredName("Client(port=2009, name=PREFIX + 'A', host='x')")).toBeUndefined();
  });

  it('空文字や空白だけの名前は undefined', () => {
    expect(extractDeclaredName("Client(port=2009, name='', host='x')")).toBeUndefined();
    expect(extractDeclaredName(templateSource('   '))).toBeUndefined();
  });

  it('コメントアウトされた Client(...) は見ない', () => {
    const src = [
      "# player = Client(port=2009, name='コメント', host='x')",
      "player = Client(port=2009, name='舞鶴A', host='x')",
    ].join('\n');
    expect(extractDeclaredName(src)).toBe('舞鶴A');
  });

  it('TCP 経路と同じ整形がかかる (制御文字の除去と100文字上限)', () => {
    expect(extractDeclaredName(templateSource('あ'.repeat(150)))).toHaveLength(100);
    expect(extractDeclaredName(templateSource('舞​鶴'))).toBe('舞鶴');
  });
});
