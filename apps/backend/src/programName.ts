import { sanitizeName } from './network/TcpClient.js';

/**
 * 対戦用プログラム (.py) のソースから、そのプログラムが名乗るプレイヤー名を推定する。
 *
 * 対戦画面のスコアバーに出る名前は、プログラムが `Client(name=...)` に渡した値が
 * TCP の最初の1行として届いたものなので、ここではその値を静的に読み取る。
 * Python を本当にパースはせず、雛形 (assets/lib-templates/pyCHaser.py) の使われ方に
 * 合わせた軽量な正規表現で拾う:
 *
 *   1. `Client(...)` の `name=` が文字列リテラル      → その値
 *        例: Client(port=2009, name='舞鶴A', host='localhost')
 *   2. `name=` が変数 (雛形どおりの `name=name` / `name=args.name`) のときは
 *      argparse の `--name` の default を採用
 *        例: parser.add_argument('-n', '--name', default='舞鶴A')
 *   3. どちらも取れなければ undefined (呼び出し側は「未指定」として扱う)
 *
 * 雛形のままの `default='player'` も 2. で拾って 'player' を返す。実際にスコアバーへ
 * 出るのがその値である以上、除外せずそのまま見せるほうが表示と実態が食い違わない。
 *
 * f-string・文字列連結・他の変数を経由した名前は解釈せず undefined にする
 * (推測で埋めるより空欄のまま手入力してもらうほうが安全)。
 */
export function extractDeclaredName(source: string): string | undefined {
  const code = stripComments(source);

  const fromCall = nameFromClientCall(code);
  if (fromCall !== undefined) return normalize(fromCall);

  const fromArgparse = nameFromArgparse(code);
  if (fromArgparse !== undefined) return normalize(fromArgparse);

  return undefined;
}

/** クォート内の `#` を消さないよう、文字列リテラルを飛ばしながら行コメントだけ落とす */
function stripComments(source: string): string {
  return source
    .split('\n')
    .map(line => {
      let quote: string | null = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]!;
        if (quote) {
          if (ch === '\\') i++;
          else if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
          quote = ch;
        } else if (ch === '#') {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join('\n');
}

/** `Client(` の対応する `)` までを取り出す。ネストした括弧も数える */
function clientCallArgs(code: string): string | undefined {
  const open = /(?:^|[^\w.])Client\s*\(/.exec(code);
  if (!open) return undefined;

  const start = open.index + open[0].length;
  let depth = 1;
  let quote: string | null = null;
  for (let i = start; i < code.length; i++) {
    const ch = code[i]!;
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return code.slice(start, i);
    }
  }
  return undefined;
}

function nameFromClientCall(code: string): string | undefined {
  const args = clientCallArgs(code);
  if (args === undefined) return undefined;
  // name= の右辺が素の文字列リテラルのときだけ採用する
  // (f'...' や '...' + x は先頭の f / 後続の演算子で外れる)
  const m = /(?:^|[^\w.])name\s*=\s*(['"])((?:\\.|(?!\1)[^\r\n])*)\1\s*(?:,|$)/.exec(args);
  return m?.[2];
}

function nameFromArgparse(code: string): string | undefined {
  // add_argument(...) を1つずつ見て、'--name' / '-n' を宣言しているものの default を取る
  const calls = code.matchAll(/add_argument\s*\(([^)]*)\)/gs);
  for (const call of calls) {
    const args = call[1] ?? '';
    if (!/(['"])(?:--name|-n)\1/.test(args)) continue;
    const m = /(?:^|[^\w.])default\s*=\s*(['"])((?:\\.|(?!\1)[^\r\n])*)\1/.exec(args);
    if (m?.[2] !== undefined) return m[2];
  }
  return undefined;
}

function normalize(raw: string): string | undefined {
  const name = sanitizeName(raw).trim();
  return name === '' ? undefined : name;
}
