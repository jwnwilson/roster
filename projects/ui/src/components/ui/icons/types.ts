import type { SVGProps } from "react";

/** Icons forward any SVG attribute, so a caller can mark one up (`data-glyph`,
 *  `aria-hidden`, `role`) without the icon needing to know why. */
export type IconProps = { size?: number } & Omit<SVGProps<SVGSVGElement>, "width" | "height">;
