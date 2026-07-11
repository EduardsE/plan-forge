import { cn } from "#/lib/utils";

/**
 * The objects panel's card illustrations: little front-view furniture
 * glyphs built from absolutely-positioned layers, the same technique (and,
 * for the seating items, the exact geometry and colors) as the mockup's
 * cards on screen 1d. Everything else is drawn in the same warm palette.
 *
 * Presentation-only by design — the catalog itself (`src/lib/model/catalog.ts`)
 * stays plain data.
 */

interface GlyphLayer {
  /** translateX from the tile's horizontal center ("-50%" = centered). */
  tx: string;
  bottom: number;
  w: number;
  h: number;
  /** Any CSS background. */
  bg: string;
  /** Border radius shorthand. */
  r?: string;
  /** Rotation in degrees, applied after the translate (mockup order). */
  rot?: number;
  border?: string;
}

const layer = (
  tx: string,
  bottom: number,
  w: number,
  h: number,
  bg: string,
  r?: string,
  rot?: number,
): GlyphLayer => ({ tx, bottom, w, h, bg, r, rot });

const WOOD = "#b98a5f";
const WOOD_DARK = "#7a5230";
const GLYPHS: Record<string, GlyphLayer[]> = {
  // Seating — copied 1:1 from the mockup's panel cards / drag card.
  "lounge-chair": [
    layer("-50%", 36, 44, 36, "#ce7b52", "9px 9px 0 0"),
    layer("-50%", 26, 56, 13, "#b96741", "5px"),
    layer("-16px", 12, 3, 14, WOOD_DARK),
    layer("13px", 12, 3, 14, WOOD_DARK),
  ],
  "sofa-2": [
    layer("-50%", 36, 84, 26, "#ce7b52", "8px 8px 0 0"),
    layer("-50%", 24, 96, 16, "#b96741", "6px"),
    layer("-48px", 24, 13, 34, "#a55836", "6px"),
    layer("35px", 24, 13, 34, "#a55836", "6px"),
    layer("0", 38, 1.5, 22, "rgba(255,255,255,.5)"),
  ],
  armchair: [
    layer("-50%", 34, 46, 34, WOOD, "9px 9px 0 0"),
    layer("-50%", 24, 66, 22, "#a87848", "7px"),
    layer("-33px", 24, 11, 30, "#96683c", "5px"),
    layer("22px", 24, 11, 30, "#96683c", "5px"),
  ],
  stool: [
    layer("-50%", 44, 42, 11, WOOD, "5px"),
    layer("-17px", 16, 3, 30, WOOD_DARK, undefined, 9),
    layer("14px", 16, 3, 30, WOOD_DARK, undefined, -9),
  ],
  bench: [
    layer("-50%", 40, 66, 10, WOOD, "4px"),
    layer("-27px", 20, 4, 21, WOOD_DARK),
    layer("23px", 20, 4, 21, WOOD_DARK),
  ],
  pouf: [layer("-50%", 26, 52, 30, "#c9805f", "14px 14px 10px 10px")],
  "desk-chair": [
    layer("-50%", 42, 34, 28, "#ce7b52", "8px 8px 3px 3px"),
    layer("-50%", 34, 44, 9, "#b96741", "4px"),
    layer("-50%", 20, 4, 15, WOOD_DARK),
    layer("-50%", 16, 32, 4, WOOD_DARK, "2px"),
  ],
  // Tables.
  desk: [
    layer("-50%", 46, 24, 15, "#2a3244", "2px"),
    layer("-50%", 38, 72, 8, "#c8996b", "3px"),
    layer("-32px", 16, 4, 22, WOOD_DARK),
    layer("28px", 16, 4, 22, WOOD_DARK),
  ],
  "coffee-table": [
    layer("-50%", 34, 60, 8, WOOD, "4px"),
    layer("-26px", 16, 4, 18, WOOD_DARK),
    layer("22px", 16, 4, 18, WOOD_DARK),
  ],
  "side-table": [
    layer("-50%", 40, 34, 7, WOOD, "3px"),
    layer("-50%", 18, 4, 22, WOOD_DARK),
    layer("-50%", 16, 22, 3, WOOD_DARK, "2px"),
  ],
  "dining-table": [
    layer("-50%", 38, 76, 9, "#c8996b", "4px"),
    layer("-34px", 16, 5, 22, WOOD_DARK),
    layer("29px", 16, 5, 22, WOOD_DARK),
  ],
  // Storage.
  credenza: [
    layer("-50%", 24, 70, 34, "#b4824e", "6px"),
    layer("-1px", 28, 2, 26, "#96683c"),
    layer("-28px", 16, 4, 8, WOOD_DARK),
    layer("24px", 16, 4, 8, WOOD_DARK),
  ],
  shelf: [
    layer("-50%", 16, 56, 60, WOOD, "4px"),
    layer("-50%", 52, 46, 4, "#8a6238"),
    layer("-50%", 32, 46, 4, "#8a6238"),
  ],
  wardrobe: [
    layer("-50%", 14, 52, 66, "#b4824e", "5px"),
    layer("-1px", 18, 2, 58, "#96683c"),
    layer("-8px", 42, 3, 9, WOOD_DARK, "2px"),
    layer("5px", 42, 3, 9, WOOD_DARK, "2px"),
  ],
  // Beds.
  "bed-double": [
    layer("-50%", 44, 78, 12, "#a87848", "6px 6px 0 0"),
    layer("-50%", 20, 78, 24, "#c9805f", "4px 4px 6px 6px"),
    layer("-34px", 40, 26, 10, "#f1e9d9", "3px"),
  ],
  "bed-single": [
    layer("-50%", 44, 54, 12, "#a87848", "6px 6px 0 0"),
    layer("-50%", 20, 54, 24, "#c9805f", "4px 4px 6px 6px"),
    layer("-22px", 40, 22, 10, "#f1e9d9", "3px"),
  ],
  // Lighting.
  "floor-lamp": [
    layer("-50%", 58, 30, 18, "#d8a46b", "5px 5px 2px 2px"),
    layer("-50%", 16, 3, 44, WOOD_DARK),
    layer("-50%", 14, 24, 3, WOOD_DARK, "2px"),
  ],
  "table-lamp": [
    layer("-50%", 42, 28, 16, "#d8a46b", "5px 5px 2px 2px"),
    layer("-50%", 28, 3, 15, WOOD_DARK),
    layer("-50%", 24, 18, 4, WOOD_DARK, "2px"),
  ],
  // Decor.
  rug: [
    layer("-50%", 26, 72, 40, "#c9805f", "6px"),
    layer("-50%", 32, 56, 28, "#d89b7e", "4px"),
  ],
  "floor-mirror": [
    layer("-50%", 14, 34, 62, "#8c6b48", "14px 14px 4px 4px"),
    layer("-50%", 18, 26, 50, "#ddeaf2", "11px 11px 2px 2px"),
  ],
  // Wall items (drawn from the mockup's wall art and clock).
  "picture-frame": [
    layer("-50%", 24, 56, 42, "#7a5c3e", "3px"),
    layer(
      "-50%",
      29,
      46,
      32,
      "linear-gradient(180deg,#d8845c 55%,#b4633e 55%)",
      "2px",
    ),
  ],
  "wall-clock": [
    {
      tx: "-50%",
      bottom: 24,
      w: 44,
      h: 44,
      bg: "#f7f0e2",
      r: "50%",
      border: "4px solid #8c6b48",
    },
    layer("-1px", 46, 2, 12, "#4a3a28"),
    layer("0", 45, 9, 2, "#4a3a28"),
  ],
  // Plants.
  plant: [
    layer("-50%", 44, 42, 38, "#4f7d46", "50% 50% 46% 54%"),
    layer("-50%", 18, 26, 20, "#b4633e", "3px 3px 8px 8px"),
  ],
  "plant-large": [
    layer("-20px", 46, 30, 28, "#4f7d46", "50%"),
    layer("2px", 52, 32, 30, "#5c8a50", "50%"),
    layer("-9px", 40, 34, 30, "#4f7d46", "50%"),
    layer("-50%", 16, 28, 22, "#b4633e", "3px 3px 9px 9px"),
  ],
};
const FALLBACK_GLYPH: GlyphLayer[] = [layer("-50%", 24, 52, 34, WOOD, "6px")];

/** Card image area: mockup's 92px light tile with the glyph layers inside. */
export function CatalogThumbnail({
  catalogId,
  className,
}: {
  catalogId: string;
  className?: string;
}) {
  const layers = GLYPHS[catalogId] ?? FALLBACK_GLYPH;
  return (
    <div
      aria-hidden
      className={cn(
        "relative h-[92px] overflow-hidden rounded-[8px] bg-[var(--well)]",
        className,
      )}
    >
      {layers.map((glyph, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: layers are a static ordered stack
          key={index}
          className="absolute left-1/2"
          style={{
            bottom: glyph.bottom,
            width: glyph.w,
            height: glyph.h,
            background: glyph.bg,
            borderRadius: glyph.r,
            border: glyph.border,
            transform: `translateX(${glyph.tx})${
              glyph.rot ? ` rotate(${glyph.rot}deg)` : ""
            }`,
          }}
        />
      ))}
    </div>
  );
}
