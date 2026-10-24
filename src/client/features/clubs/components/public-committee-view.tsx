'use client';

import { ArrowLeft, Link2Off, RotateCw, Search, Timer } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/client/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DirectionalIcon } from '@/components/ui/directional-icon';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { usePathname, useRouter } from '@/i18n/navigation';
import {
  PUBLIC_MEMBER_SEARCH_MIN,
  publicIdSchema,
  viewTokenSchema,
} from '@/shared/contracts/clubs';
import { dateOnlyToDate } from '@/shared/lib/dates';

import {
  usePublicCommitteeView,
  usePublicMemberPoints,
  usePublicMemberSearch,
} from '../hooks/use-public-committee-view';
import { publicViewFailure, type PublicViewFailure } from '../lib/public-view';

const SEARCH_DEBOUNCE_MS = 300;
/** The contract's own maximum for `q`. */
const SEARCH_MAX_LENGTH = 60;
/** The member being shown, in the URL so the phone's back button returns to the search. */
const MEMBER_PARAM = 'm';

/**
 * The page a committee's view link opens (docs/adr/0023-committee-view-link.md): no sign-in, the
 * token is the permission. Members search for their own name and read the points they earned in
 * this committee. The token is never shown, never in the title, and never sent anywhere but the
 * public endpoints; the page has no outbound links and no analytics.
 */
export function PublicCommitteeView({ token }: { token: string }) {
  const validToken = viewTokenSchema.safeParse(token).success;
  const view = usePublicCommitteeView(token, validToken);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const pushedMember = useRef(false);
  // A later request can find the link dead (renewed or turned off meanwhile): same screen.
  const [dead, setDead] = useState(false);
  const memberParam = searchParams.get(MEMBER_PARAM);
  const publicId =
    memberParam && publicIdSchema.safeParse(memberParam).success ? memberParam : null;

  if (!validToken || dead) return <FailureScreen failure="invalid" />;
  if (view.isError) {
    return (
      <FailureScreen failure={publicViewFailure(view.error)} onRetry={() => void view.refetch()} />
    );
  }

  function openMember(id: string) {
    pushedMember.current = true;
    router.push({ pathname, query: { [MEMBER_PARAM]: id } }, { scroll: true });
  }

  function closeMember() {
    if (pushedMember.current) router.back();
    else router.replace(pathname, { scroll: true });
    pushedMember.current = false;
  }

  return (
    <Frame>
      <header className="grid gap-1 text-center">
        {view.data ? (
          <>
            <p className="text-sm text-fg-muted">{view.data.club.name}</p>
            <h1 className="text-2xl font-bold text-balance">{view.data.committee.name}</h1>
          </>
        ) : (
          <>
            <Skeleton className="mx-auto h-4 w-32" />
            <Skeleton className="mx-auto h-8 w-48" />
          </>
        )}
      </header>
      {/* Kept mounted while a member is open, so the search is still there on the way back. */}
      <div hidden={publicId !== null}>
        <SearchPanel token={token} onOpen={openMember} onDead={() => setDead(true)} />
      </div>
      {publicId ? (
        <MemberPanel
          token={token}
          publicId={publicId}
          onBack={closeMember}
          onDead={() => setDead(true)}
        />
      ) : null}
    </Frame>
  );
}

/** Phone first: one narrow column, centred on wider screens. */
function Frame({ children }: { children: ReactNode }) {
  return <div className="mx-auto grid w-full max-w-xl gap-6 px-4 py-8 sm:py-12">{children}</div>;
}

function FailureScreen({ failure, onRetry }: { failure: PublicViewFailure; onRetry?: () => void }) {
  const t = useTranslations('clubs.publicView');
  const Icon = failure === 'invalid' ? Link2Off : failure === 'rateLimited' ? Timer : RotateCw;
  return (
    <Frame>
      <Card
        className="items-center py-10 text-center"
        role={failure === 'invalid' ? undefined : 'alert'}
      >
        <span
          aria-hidden
          className="flex size-12 items-center justify-center rounded-full bg-surface-3 text-fg-muted"
        >
          <Icon className="size-6" />
        </span>
        <h1 className="text-lg font-semibold text-balance">
          {failure === 'invalid'
            ? t('invalid')
            : failure === 'rateLimited'
              ? t('rateLimited')
              : t('failed')}
        </h1>
        {failure === 'invalid' ? <p className="text-sm text-fg-muted">{t('invalidHint')}</p> : null}
        {failure === 'failed' && onRetry ? (
          <Button variant="outline" onClick={onRetry}>
            <RotateCw aria-hidden />
            {t('retry')}
          </Button>
        ) : null}
      </Card>
    </Frame>
  );
}

/** An inline notice for a failed search or history, where the header is already on screen. */
function InlineFailure({
  failure,
  onRetry,
  onDead,
}: {
  failure: PublicViewFailure;
  onRetry: () => void;
  onDead: () => void;
}) {
  const t = useTranslations('clubs.publicView');
  useEffect(() => {
    if (failure === 'invalid') onDead();
  }, [failure, onDead]);
  if (failure === 'invalid') return null;
  return (
    <div role="alert" className="grid justify-items-center gap-3 py-6 text-center text-sm">
      <p className="text-fg-muted">{failure === 'rateLimited' ? t('rateLimited') : t('failed')}</p>
      {failure === 'failed' ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw aria-hidden />
          {t('retry')}
        </Button>
      ) : null}
    </div>
  );
}

function SearchPanel({
  token,
  onOpen,
  onDead,
}: {
  token: string;
  onOpen: (publicId: string) => void;
  onDead: () => void;
}) {
  const t = useTranslations('clubs.publicView');
  const format = useFormatter();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const search = usePublicMemberSearch(token, q);
  const ready = q.length >= PUBLIC_MEMBER_SEARCH_MIN;

  return (
    <section className="grid gap-4" aria-label={t('searchLabel')}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-fg-subtle"
          aria-hidden
        />
        <Input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchLabel')}
          maxLength={SEARCH_MAX_LENGTH}
          autoComplete="off"
          enterKeyHint="search"
          className="h-12 ps-11 text-base"
        />
      </div>

      {!ready ? (
        <p className="text-center text-sm text-fg-muted">{t('searchHint')}</p>
      ) : search.isError ? (
        <InlineFailure
          failure={publicViewFailure(search.error)}
          onRetry={() => void search.refetch()}
          onDead={onDead}
        />
      ) : search.isPending ? (
        <div className="grid gap-2" aria-label={t('searching')} aria-busy>
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : search.data.items.length === 0 ? (
        <p role="status" className="py-6 text-center text-sm text-fg-muted">
          {t('noResults')}
        </p>
      ) : (
        <ul aria-label={t('resultsLabel')} className="m-0 grid list-none gap-2 p-0">
          {search.data.items.map((member) => (
            <li key={member.publicId}>
              <button
                type="button"
                onClick={() => onOpen(member.publicId)}
                className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-surface-1 px-4 py-3 text-start transition-colors outline-none hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="grid min-w-0 justify-items-start gap-1">
                  <span className="max-w-full truncate font-medium">{member.fullName}</span>
                  <MembershipTypeBadge name={member.membershipType.name} />
                </span>
                <Badge variant={member.balance < 0 ? 'danger' : 'outline'} className="shrink-0">
                  <span className="[direction:ltr]">
                    {format.number(member.balance, 'integer')}
                  </span>
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The title the club gives the member, in the members table's badge. The table colours a type by
 * its place in the club's order, which the public page is not sent, so this is the plain rung.
 */
function MembershipTypeBadge({ name }: { name: string }) {
  return (
    <Badge variant="neutral" className="max-w-full">
      <span className="truncate">{name}</span>
    </Badge>
  );
}

function MemberPanel({
  token,
  publicId,
  onBack,
  onDead,
}: {
  token: string;
  publicId: string;
  onBack: () => void;
  onDead: () => void;
}) {
  const t = useTranslations('clubs.publicView');
  const format = useFormatter();
  const points = usePublicMemberPoints(token, publicId);
  const first = points.data?.pages[0];
  const transactions = points.data?.pages.flatMap((page) => page.transactions.items) ?? [];

  return (
    <section className="grid gap-5" aria-label={first?.member.fullName}>
      <Button variant="ghost" size="sm" className="justify-self-start" onClick={onBack}>
        <DirectionalIcon icon={ArrowLeft} />
        {t('back')}
      </Button>

      {points.isError ? (
        <InlineFailure
          failure={publicViewFailure(points.error)}
          onRetry={() => void points.refetch()}
          onDead={onDead}
        />
      ) : !first ? (
        <div className="grid gap-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <>
          <Card className="items-center gap-2 text-center" padding="lg">
            <h2 className="text-lg font-semibold text-balance">{first.member.fullName}</h2>
            <MembershipTypeBadge name={first.member.membershipType.name} />
            <p className="text-sm text-fg-muted">{t('balanceLabel')}</p>
            <p
              className={cn(
                'font-mono text-5xl font-bold [direction:ltr]',
                first.balance < 0 && 'text-danger',
              )}
            >
              {format.number(first.balance, 'integer')}
            </p>
          </Card>

          <div className="grid gap-3">
            <h3 className="text-base font-semibold">{t('history')}</h3>
            {transactions.length === 0 ? (
              <p className="py-4 text-center text-sm text-fg-muted">{t('historyEmpty')}</p>
            ) : (
              <ol className="m-0 grid list-none gap-2 p-0">
                {transactions.map((transaction, index) => (
                  <li
                    key={`${transaction.workDate}-${String(index)}`}
                    className="flex items-start gap-3 rounded-lg border border-border bg-surface-1 px-4 py-3"
                  >
                    <span
                      className={cn(
                        'min-w-14 shrink-0 font-mono text-lg font-bold [direction:ltr]',
                        transaction.amount > 0 ? 'text-success' : 'text-danger',
                      )}
                    >
                      {format.number(transaction.amount, 'points')}
                    </span>
                    <span className="grid min-w-0 gap-0.5">
                      <span className="text-sm break-words">{transaction.reason}</span>
                      <span className="text-xs text-fg-muted">
                        {format.dateTime(dateOnlyToDate(transaction.workDate), 'dateShort')}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {points.hasNextPage ? (
              <Button
                variant="outline"
                className="justify-self-center"
                loading={points.isFetchingNextPage}
                onClick={() => void points.fetchNextPage()}
              >
                {t('loadMore')}
              </Button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
