import { notFound } from 'next/navigation';

/** Unknown paths render the localised not-found page. */
export default function CatchAllPage() {
  notFound();
}
