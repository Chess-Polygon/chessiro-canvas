import * as react from 'react';
import { C as ChessiroCanvasProps, a as ChessiroCanvasRef, P as PieceSet, R as RasterOptions } from './premove-CBJREY53.js';
export { A as AnimateMoveOptions, b as AnimationEvent, c as AppearAnimation, d as Arrow, e as ArrowBrush, f as ArrowBrushes, g as ArrowHeadShape, h as ArrowVisuals, B as BoardSvgOptions, i as BoardTheme, j as CameraController, k as CameraDriftOptions, l as CameraShakeOptions, m as CameraTiltOptions, n as CameraZoomOptions, o as CaptureAnimation, p as CastleSwapOptions, q as CelebrateOptions, r as CinematicMoveOptions, s as CinematicPlayback, t as CinematicStep, u as CinematicStyle, D as DEFAULT_ARROW_BRUSHES, v as DEFAULT_BOARD_THEME, w as Dests, x as DrawArrowOptions, E as EASINGS, y as EasingFunction, z as EasingName, F as ExpectedMove, G as FlipAnimation, H as GhostPiece, I as INITIAL_FEN, J as INITIAL_GAME_FEN, K as ImplodeOptions, L as LandingAnimation, M as LaserOptions, N as MOVE_ANIMATION_PRESETS, O as MoveAnimationOptions, Q as MoveAnimationPreset, S as MoveQualityBadge, T as NotationVisuals, U as Orientation, V as OverlayVisuals, W as Piece, X as PieceCode, Y as PieceColor, Z as PieceRenderer, _ as PieceRole, $ as PieceTiltOptions, a0 as PlayCinematicOptions, a1 as PopBadgeOptions, a2 as PopBannerOptions, a3 as PremoveConfig, a4 as PromotionBeamOptions, a5 as PromotionContext, a6 as PromotionPiece, a7 as PromotionVisuals, a8 as PulseSquareOptions, a9 as ResolvedMoveAnimation, aa as SpotlightHandle, ab as SpotlightOptions, ac as Square, ad as SquareBurstOptions, ae as SquareLabel, af as SquareVisuals, ag as TextOverlay, ah as cubicBezier, ai as premoveDests, aj as readFen, ak as renderBoardSvg, al as resolveMoveAnimation, am as writeFen } from './premove-CBJREY53.js';

declare const ChessiroCanvas: react.ForwardRefExoticComponent<ChessiroCanvasProps & react.RefAttributes<ChessiroCanvasRef>>;

declare function preloadPieceSet(source: string | PieceSet): void;

declare function resolvePieceImageSrc(pieceKey: string, source?: string | PieceSet): string;

/** Rasterise an SVG string to an image Blob (PNG by default) in the browser. */
declare function svgToImageBlob(svg: string, options?: RasterOptions): Promise<Blob>;

export { ChessiroCanvas, ChessiroCanvasProps, ChessiroCanvasRef, PieceSet, RasterOptions, preloadPieceSet, resolvePieceImageSrc, svgToImageBlob };
