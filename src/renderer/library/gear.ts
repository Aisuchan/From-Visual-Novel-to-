/* Font Awesome Free 7's solid gear, inlined as geometry (its own
   svgs/solid/gear.svg, CC BY 4.0 — the package this app already bundles).
   Drawn rather than set: a glyph's baseline is snapped to whole device pixels,
   and the shell's zoom is fractional, so the same mark landed up to 1.3 design
   px off the middle of the button's disc and the direction changed with the
   window size (measured, by capturing the button and weighing the ink against
   the ring: -1.32px at 0.75, +1.06 at 0.8333, -0.57 at 1). As a path it is
   placed by geometry and lands within a fifth of a pixel at every size.

   The box is the ink's own: the artwork runs from -16 to 528 in both axes of
   its 512 viewBox — a tooth points straight up and down, so it overhangs top
   and bottom — and `-16 -16 544 544` is that square, centred on 256, 256.

   Shared by the gear on the Main Image and the one the Setting board is
   headed with. */
export const GEAR_VIEW_BOX = '-16 -16 544 544'

export const GEAR_PATH =
  'M195.1 9.5C198.1-5.3 211.2-16 226.4-16l59.8 0c15.2 0 28.3 10.7 31.3 25.5L332 79.5c14.1 6 27.3 13.7 39.3 22.8l67.8-22.5c14.4-4.8 30.2 1.2 37.8 14.4l29.9 51.8c7.6 13.2 4.9 29.8-6.5 39.9L447 233.3c.9 7.4 1.3 15 1.3 22.7s-.5 15.3-1.3 22.7l53.4 47.5c11.4 10.1 14 26.8 6.5 39.9l-29.9 51.8c-7.6 13.1-23.4 19.2-37.8 14.4l-67.8-22.5c-12.1 9.1-25.3 16.7-39.3 22.8l-14.4 69.9c-3.1 14.9-16.2 25.5-31.3 25.5l-59.8 0c-15.2 0-28.3-10.7-31.3-25.5l-14.4-69.9c-14.1-6-27.2-13.7-39.3-22.8L73.5 432.3c-14.4 4.8-30.2-1.2-37.8-14.4L5.8 366.1c-7.6-13.2-4.9-29.8 6.5-39.9l53.4-47.5c-.9-7.4-1.3-15-1.3-22.7s.5-15.3 1.3-22.7L12.3 185.8c-11.4-10.1-14-26.8-6.5-39.9L35.7 94.1c7.6-13.2 23.4-19.2 37.8-14.4l67.8 22.5c12.1-9.1 25.3-16.7 39.3-22.8L195.1 9.5zM256.3 336a80 80 0 1 0 -.6-160 80 80 0 1 0 .6 160z'
