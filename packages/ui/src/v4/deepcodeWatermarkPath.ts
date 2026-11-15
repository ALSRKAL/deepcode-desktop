/**
 * DeepCode Studio empty-state watermark: the split-D mark (docs/brand/identity.md
 * in the server repository), drawn as strokes in a 512×512 view box so it keeps
 * the size and placement of the upstream watermark it replaces. The bowl follows
 * the theme foreground; the stem carries the accent line of the mark.
 *
 * Inline vector on purpose (no bitmap mask): a mask-image pointing at a PNG can
 * rasterise before the image decodes and leave half a watermark on screen.
 */
export const DEEPCODE_WATERMARK = {
  viewBox: "0 0 512 512",
  bowl: "M176 136H280a120 120 0 0 1 0 240H176",
  stem: "M176 136v240",
  strokeWidth: 52,
} as const;
