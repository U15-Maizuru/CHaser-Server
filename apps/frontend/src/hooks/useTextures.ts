import { useEffect, useState } from 'react';

export type TextureKey = 'Floor' | 'Block' | 'Item' | 'Cool' | 'Hot';
const TEXTURE_KEYS: TextureKey[] = ['Floor', 'Block', 'Item', 'Cool', 'Hot'];

/** テーマ別のテクスチャ画像を読み込む (盤面の描画とマップエディタで共有) */
export function useTextures(theme: string): Partial<Record<TextureKey, HTMLImageElement>> {
  const [textures, setTextures] = useState<Partial<Record<TextureKey, HTMLImageElement>>>({});
  useEffect(() => {
    const loaded: Partial<Record<TextureKey, HTMLImageElement>> = {};
    let remaining = TEXTURE_KEYS.length;
    for (const key of TEXTURE_KEYS) {
      const img = new Image();
      img.src = new URL(`../assets/Image/${theme}/${key}.png`, import.meta.url).href;
      img.onload  = () => { loaded[key] = img; if (--remaining === 0) setTextures({ ...loaded }); };
      img.onerror = () => { if (--remaining === 0) setTextures({ ...loaded }); };
    }
    setTextures({});
  }, [theme]);
  return textures;
}
