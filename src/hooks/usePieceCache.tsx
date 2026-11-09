import { useEffect, useState, memo } from 'react';
import type { ReactNode } from 'react';
import { resolvePieceSetUrls } from '../defaultPieces';
import type { PieceSet } from '../types';

const blobCache = new Map<string, string>();
const loadPromises = new Map<string, Promise<string>>();

function isDirectSource(src: string): boolean {
  return src.startsWith('data:') || src.startsWith('blob:');
}

async function loadAndCache(src: string): Promise<string> {
  if (isDirectSource(src)) {
    blobCache.set(src, src);
    return src;
  }

  const cached = blobCache.get(src);
  if (cached) return cached;

  const pending = loadPromises.get(src);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      blobCache.set(src, url);
      return url;
    } catch {
      blobCache.set(src, src);
      return src;
    } finally {
      loadPromises.delete(src);
    }
  })();

  loadPromises.set(src, promise);
  return promise;
}

export function preloadPieceSet(source: string | PieceSet): void {
  for (const url of Object.values(resolvePieceSetUrls(source) ?? {})) {
    loadAndCache(url);
  }
}

export const CachedPieceImg = memo(function CachedPieceImg({
  src,
  alt,
}: {
  src: string;
  alt: string;
}): ReactNode {
  const [imgSrc, setImgSrc] = useState(() => blobCache.get(src) || src);

  useEffect(() => {
    if (!blobCache.has(src)) {
      loadAndCache(src).then(setImgSrc);
    } else if (imgSrc !== blobCache.get(src)) {
      setImgSrc(blobCache.get(src)!);
    }
  }, [src, imgSrc]);

  return (
    <img
      src={imgSrc}
      alt={alt}
      draggable={false}
      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
    />
  );
});
