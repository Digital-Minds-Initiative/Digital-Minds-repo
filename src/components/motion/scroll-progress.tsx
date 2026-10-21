/**
 * A thin pixel-stepped bar on the bottom edge of the header that fills, right to left, as the page
 * is scrolled. It follows the scroll through a CSS scroll-driven animation, so it costs no
 * JavaScript and simply stays empty where that is unsupported (see globals.css).
 */
export function ScrollProgress() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-px h-[3px]">
      <div data-scroll-progress className="h-full w-full origin-right scale-x-0 bg-tuwaiq-lilac" />
    </div>
  );
}
