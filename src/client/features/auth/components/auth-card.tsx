import type { ReactNode } from 'react';

import { PaperFrame } from '@/components/ui/paper-frame';

import { BackLink } from './back-link';

/**
 * The notebook page every sign-in screen sits on: back control, serif title, an optional short
 * lead, then the form. Everything starts on the same edge; height follows the content.
 */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PaperFrame>
      <BackLink />
      <h1 className="mt-7 font-serif text-[clamp(2rem,1.5rem+2.4vw,2.75rem)] leading-tight font-semibold text-balance">
        {title}
      </h1>
      {description ? (
        <p className="mt-2 text-sm leading-6 text-on-paper-muted">{description}</p>
      ) : null}
      <div className="mt-11 grid gap-8 [&_[data-slot=form-description]]:text-on-paper-muted [&_[data-slot=label]]:text-on-paper [&_[data-slot=label]>span]:text-2xl [&_[data-slot=label]>span]:leading-none [&_[data-slot=label]>span]:font-bold">
        {children}
      </div>
    </PaperFrame>
  );
}
