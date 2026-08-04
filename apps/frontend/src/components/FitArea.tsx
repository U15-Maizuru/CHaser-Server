import type { ReactNode } from 'react';
import { useFitScale } from '../hooks/useFitScale';

// 与えられた箱いっぱいまで中身を拡大 / 縮小して中央に置くだけの入れ物。
// 観戦画面 (プロジェクタ) とトーナメント表・リーグ表で使う。
//
// **親は高さの決まった箱にすること。** 中身は絶対配置で流れから外すので、
// 親の高さが中身に依存していると (height:auto) 高さ 0 になって何も見えなくなる。

export interface FitAreaProps {
  children:   ReactNode;
  /** 拡大の上限。操作する画面では小さめにする */
  maxScale?:  number;
  /** 縮小の下限 */
  minScale?:  number;
  style?:     React.CSSProperties;
}

export function FitArea({ children, maxScale = 3, minScale = 0.3, style }: FitAreaProps) {
  const { containerRef, contentRef, scale } = useFitScale(maxScale, minScale);
  return (
    <div ref={containerRef} style={{ ...box, ...style }}>
      <div
        ref={contentRef}
        style={{
          position: 'absolute', left: '50%', top: '50%', width: 'max-content',
          transform: `translate(-50%, -50%) scale(${scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

const box: React.CSSProperties = {
  position: 'relative', width: '100%', height: '100%', minHeight: 0, overflow: 'hidden',
};
