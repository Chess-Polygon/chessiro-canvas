import { DEFAULT_PIECE_DATA_URIS } from './defaultPieceDataUris';
import type { PieceCode } from './core/boardSvg';
import type { PieceSet } from './types';

const PIECE_CODES: readonly PieceCode[] = ['wp', 'wn', 'wb', 'wr', 'wq', 'wk', 'bp', 'bn', 'bb', 'br', 'bq', 'bk'];
const DEFAULT_PIECE_SOURCES: Record<PieceCode, string> = DEFAULT_PIECE_DATA_URIS;
const DEFAULT_EXTENSION = 'svg';

type PieceArtLocation = Partial<Pick<PieceSet, 'path' | 'extension' | 'resolveSrc'>>;

function toArtLocation(source?: string | PieceSet): PieceArtLocation {
  return typeof source === 'string' ? { path: source } : source ?? {};
}

function hasExternalArt(location: PieceArtLocation): boolean {
  return Boolean(location.resolveSrc || location.path);
}

function externalArtUrl(code: PieceCode, location: PieceArtLocation): string {
  if (location.resolveSrc) return location.resolveSrc(code);
  const extension = location.extension?.replace(/^\./, '') || DEFAULT_EXTENSION;
  return `${location.path}/${code}.${extension}`;
}

export function resolvePieceImageSrc(pieceKey: string, source?: string | PieceSet): string {
  const code = pieceKey.toLowerCase() as PieceCode;
  const location = toArtLocation(source);
  if (hasExternalArt(location)) return externalArtUrl(code, location);
  return DEFAULT_PIECE_SOURCES[code] ?? DEFAULT_PIECE_SOURCES.wq;
}

/** The URL of every piece in a set, or undefined when the set uses the bundled art. */
export function resolvePieceSetUrls(source?: string | PieceSet): Record<PieceCode, string> | undefined {
  const location = toArtLocation(source);
  if (!hasExternalArt(location)) return undefined;
  return Object.fromEntries(
    PIECE_CODES.map((code) => [code, externalArtUrl(code, location)]),
  ) as Record<PieceCode, string>;
}
