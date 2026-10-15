/*
 * Tailwind 4's `outline-none` leaves `outline-style: none`, which `focus-visible:outline-2` does not
 * undo, so these classes set the style explicitly and keep the browser's own outline until then.
 *
 * They put the shared form controls on the notebook page. The page recolours itself per theme
 * (see PaperFrame), so text and fields use the `on-paper` colours instead of the page foreground;
 * the accents (focus ring, link pill, button) switch between indigo/teal and lilac in the dark.
 */
export const paperFocusClass =
  'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-tuwaiq-indigo dark:focus-visible:outline-tuwaiq-lilac';
export const paperInputClass =
  'h-14 border-paper-rule bg-on-paper/5 text-base text-on-paper placeholder:text-on-paper-muted focus-visible:outline-solid focus-visible:outline-tuwaiq-indigo dark:focus-visible:outline-tuwaiq-lilac';
export const paperButtonClass =
  'h-14 w-full bg-teal text-base text-on-teal hover:bg-teal/90 focus-visible:outline-solid focus-visible:outline-tuwaiq-indigo dark:bg-brand dark:text-on-brand dark:hover:bg-brand/90 dark:focus-visible:outline-tuwaiq-lilac';
/** A link that reads as pressable: tinted pill, bold accent text. */
export const paperPillLinkClass = `inline-flex min-h-9 items-center rounded-md border border-tuwaiq-indigo/40 bg-tuwaiq-indigo/10 px-3 font-bold text-tuwaiq-indigo transition-colors hover:bg-tuwaiq-indigo/20 dark:border-tuwaiq-lilac/50 dark:bg-tuwaiq-lilac/15 dark:text-on-deep dark:hover:bg-tuwaiq-lilac/25 ${paperFocusClass}`;
export const paperLinkClass = `font-semibold text-on-paper underline underline-offset-4 ${paperFocusClass}`;
