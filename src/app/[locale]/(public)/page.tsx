import { getTranslations } from 'next-intl/server';

import { DELAYS } from '@/components/motion/delays';
import { Reveal } from '@/components/motion/reveal';
import { RevealWords } from '@/components/motion/reveal-words';
import { Button } from '@/components/ui/button';
import { FolderStack, type FolderItem } from '@/components/ui/folder-stack';
import { Fragments, type FragmentPiece } from '@/components/ui/fragments';
import { Hero } from '@/components/ui/hero';
import { IdeaNote } from '@/components/ui/idea-note';
import { MissionNote } from '@/components/ui/mission-note';
import { MomentScrap } from '@/components/ui/moment-scrap';
import { PaperCards, type PaperCardItem } from '@/components/ui/paper-cards';
import { PixelDivider } from '@/components/ui/pixel-divider';
import { PixelSticker } from '@/components/ui/pixel-sticker';
import { type PointsLedgerRow } from '@/components/ui/points-ledger';
import { PointsSystem } from '@/components/ui/points-system';
import { ScrapLabel } from '@/components/ui/scrap-label';
import { ScrapPaper, Tape } from '@/components/ui/scrapbook';
import { SpecLabel } from '@/components/ui/spec-label';
import { TicTacToeNote } from '@/components/ui/tic-tac-toe-note';
import { resolveLocale } from '@/i18n/locale';
import { Link } from '@/i18n/navigation';

/** Lilac is the platform's primary action colour on the dark surfaces. */
const PRIMARY_ACTION =
  'border-tuwaiq-lilac bg-tuwaiq-lilac text-deep hover:bg-tuwaiq-lilac/85 motion-safe:animate-[glow-pulse_3s_ease-in-out_infinite] motion-safe:transition-[translate,box-shadow] motion-safe:hover:translate-y-0.5 motion-safe:hover:animate-none motion-safe:hover:shadow-none motion-safe:active:translate-y-0.5';

/** Create an account (primary) and sign in (secondary), side by side and stacked on small screens. */
function AuthCtas({ signUp, signIn }: { signUp: string; signIn: string }) {
  return (
    <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
      <Button asChild className={PRIMARY_ACTION}>
        <Link href="/register">{signUp}</Link>
      </Button>
      <Button
        asChild
        variant="outline"
        className="relative overflow-hidden border-on-hero text-on-hero before:absolute before:inset-0 before:-z-10 before:origin-right before:scale-x-0 before:bg-on-hero/10 before:transition-[scale] before:duration-300 before:ease-out hover:bg-transparent hover:text-on-hero hover:before:scale-x-100"
      >
        <Link href="/login">{signIn}</Link>
      </Button>
    </div>
  );
}

export default async function LandingPage({ params }: PageProps<'/[locale]'>) {
  await resolveLocale(params);
  const t = await getTranslations('landing');

  const featurePieceContent = (
    key: 'members' | 'points' | 'permissions' | 'viewLink',
    spec: string,
  ) => (
    <>
      <span className="font-mono text-[11px] leading-4 font-medium tracking-[0.08em] text-on-paper-muted uppercase [direction:ltr] [unicode-bidi:isolate]">
        {spec}
      </span>
      <h4 className="m-0 font-serif text-xl font-semibold">{t(`features.${key}.title`)}</h4>
      <p className="m-0 text-sm leading-6 font-medium text-on-paper-muted">
        {t(`features.${key}.line`)}
      </p>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {(t.raw(`features.${key}.tags`) as string[]).map((tag) => (
          <li key={tag} className="flex items-start gap-2 text-sm leading-[22px]">
            <span className="mt-2 block size-1.5 shrink-0 rotate-45 bg-on-paper" aria-hidden />
            {tag}
          </li>
        ))}
      </ul>
    </>
  );

  const deskPieces: FragmentPiece[] = [
    // Scraps first: they sit behind the notes until someone picks them up.
    {
      key: 'scrap-idea',
      kind: 'custom',
      tiltDeg: -5,
      top: 70,
      start: 420,
      desktopOnly: true,
      content: <ScrapLabel text={t('features.desk.labels.idea')} tint="teal" torn tape="lilac" />,
    },
    {
      key: 'scrap-draft',
      kind: 'custom',
      tiltDeg: 4,
      top: 36,
      start: 650,
      desktopOnly: true,
      content: <ScrapLabel text={t('features.desk.labels.draft')} tint="peach" fold star />,
    },
    {
      key: 'scrap-keep',
      kind: 'custom',
      tiltDeg: -3,
      top: 640,
      start: 20,
      desktopOnly: true,
      content: <ScrapLabel text={t('features.desk.labels.keep')} tint="lilac" torn tape="teal" />,
    },
    {
      // The brand's motto, on a taped scrap that sits among the papers rather than above them.
      key: 'scrap-motto',
      kind: 'custom',
      tiltDeg: -3,
      top: 80,
      start: 220,
      className: 'lg:w-[190px]',
      content: (
        <ScrapPaper tint="cream" fold>
          <Tape tone="teal" className="start-1/2 -top-2 h-4 w-14 -translate-x-1/2 rotate-3" />
          <p className="m-0 px-4 pt-4 pb-3 text-center text-[15px] leading-7 font-bold text-tuwaiq-indigo">
            {t('features.desk.motto')}
          </p>
        </ScrapPaper>
      ),
    },
    {
      key: 'sticker-bulb',
      kind: 'custom',
      tiltDeg: 8,
      top: 560,
      start: 640,
      desktopOnly: true,
      className: 'lg:w-12',
      content: <PixelSticker name="bulb" className="w-full" />,
    },
    {
      key: 'sticker-heart',
      kind: 'custom',
      tiltDeg: -10,
      top: 120,
      start: 990,
      desktopOnly: true,
      className: 'lg:w-9',
      content: <PixelSticker name="heart" className="w-full" />,
    },
  ];

  const deskNotes: FragmentPiece[] = [
    {
      key: 'game',
      kind: 'custom',
      tiltDeg: 3,
      top: 110,
      start: 770,
      className: 'lg:w-[220px]',
      content: (
        <TicTacToeNote
          labels={{
            heading: {
              turn: t('features.desk.game.heading.turn'),
              win: t('features.desk.game.heading.win'),
              lose: t('features.desk.game.heading.lose'),
              draw: t('features.desk.game.heading.draw'),
            },
            status: {
              yourTurn: t('features.desk.game.status.yourTurn'),
              thinking: t('features.desk.game.status.thinking'),
              win: t('features.desk.game.status.win'),
              lose: t('features.desk.game.status.lose'),
              draw: t('features.desk.game.status.draw'),
            },
            play: t('features.desk.game.play'),
            restart: t('features.desk.game.restart'),
            cell: t.raw('features.desk.game.cell') as string,
            empty: t('features.desk.game.empty'),
          }}
        />
      ),
    },
    {
      key: 'idea',
      kind: 'custom',
      tiltDeg: -4,
      top: 450,
      start: 20,
      className: 'lg:w-[230px]',
      content: (
        <IdeaNote
          label={t('features.desk.idea.label')}
          action={t('features.desk.idea.action')}
          prompts={t.raw('features.desk.idea.prompts') as string[]}
        />
      ),
    },
    {
      key: 'mission',
      kind: 'custom',
      tiltDeg: 2,
      top: 545,
      start: 300,
      className: 'lg:w-[250px]',
      content: (
        <MissionNote
          title={t('features.desk.mission.title')}
          items={t.raw('features.desk.mission.items') as string[]}
          done={t('features.desk.mission.done')}
          progress={t.raw('features.desk.mission.progress') as string}
          footnote={t('features.desk.mission.footnote')}
        />
      ),
    },
    {
      key: 'moment',
      kind: 'custom',
      tiltDeg: -6,
      top: 400,
      start: 560,
      className: 'lg:w-[150px]',
      content: (
        <MomentScrap
          caption={t('features.desk.moment.caption')}
          line={t('features.desk.moment.line')}
          date={t('features.desk.moment.date')}
        />
      ),
    },
  ];

  const featurePieces: FragmentPiece[] = [
    ...deskPieces,
    {
      key: 'members',
      kind: 'lib',
      tiltDeg: -6,
      top: 180,
      start: 20,
      content: featurePieceContent('members', '→01 · MEMBERS'),
    },
    {
      key: 'points',
      kind: 'chart',
      tiltDeg: 3,
      top: 320,
      start: 220,
      content: featurePieceContent('points', 'POINTS'),
    },
    {
      key: 'permissions',
      kind: 'note',
      tiltDeg: 6,
      top: 190,
      start: 540,
      content: featurePieceContent('permissions', '→03 · ROLES'),
    },
    {
      key: 'viewLink',
      kind: 'photo',
      tiltDeg: -3,
      top: 470,
      start: 720,
      content: featurePieceContent('viewLink', '→04 · VIEW'),
    },
    ...deskNotes,
  ];

  const heroCards: PaperCardItem[] = (
    [
      { key: 'members', tint: 'lilac' },
      { key: 'points', tint: 'peach' },
      { key: 'roles', tint: 'teal' },
      { key: 'showcase', tint: 'cream' },
    ] as const
  ).map(({ key, tint }) => ({
    key,
    tint,
    headline: t(`hero.cards.${key}.headline`),
    lines: t.raw(`hero.cards.${key}.lines`) as string[],
    spec: t(`hero.cards.${key}.spec`),
  }));

  const folders: FolderItem[] = [
    { key: 'ideas', tone: 'indigo' },
    { key: 'teams', tone: 'lilac' },
    { key: 'wins', tone: 'orange' },
  ].map(({ key, tone }) => ({
    key,
    tone: tone as FolderItem['tone'],
    title: t(`folders.items.${key as 'ideas' | 'teams' | 'wins'}.title`),
    label: t(`folders.items.${key as 'ideas' | 'teams' | 'wins'}.label`),
  }));

  const ledgerRows = (
    t.raw('points.rows') as Array<{
      date: string;
      reason: string;
      points: number;
      voided?: boolean;
    }>
  ).map((row, index): PointsLedgerRow => ({ id: String(index), ...row }));
  const topRows = t.raw('filter.rows') as Array<{
    label: string;
    points?: number;
    linked?: boolean;
  }>;

  return (
    <>
      <section id="top" className="relative overflow-hidden bg-hero text-on-hero">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(var(--on-hero-muted) 1px, transparent 1px), linear-gradient(90deg, var(--on-hero-muted) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
        <div className="relative px-4 pt-12 pb-12 sm:px-6 sm:pt-16 sm:pb-16 lg:px-8 lg:pt-[104px] lg:pb-24">
          <div className="mx-auto w-full max-w-6xl">
            <Hero
              tone="on-hero"
              specLine={t('hero.specLine')}
              headline={t('hero.titleStart')}
              headlineMuted={t('hero.titleEnd')}
              body={t('hero.subtitle')}
              visual={<PaperCards cards={heroCards} />}
              secondaryLink={
                <a
                  href="#about"
                  className="inline-flex min-h-11 items-center text-[15px] font-semibold text-on-hero underline underline-offset-4"
                >
                  {t('hero.secondaryCta')}
                </a>
              }
            />
          </div>
        </div>
      </section>

      <PixelDivider from="var(--hero-surface)" to="var(--canvas)" />

      <section id="about" className="scroll-mt-24 px-4 py-12 sm:py-16 lg:py-24">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div data-drift className="order-2 mx-auto w-full max-w-xl lg:order-1">
            <Reveal variant="start" delay={4 * DELAYS.sectionStep}>
              <FolderStack items={folders} />
            </Reveal>
          </div>
          <div data-drift="slow" className="order-1 lg:order-2">
            <SpecLabel typed className="mb-4 block">
              {t('folders.sectionLabel')}
            </SpecLabel>
            <Reveal delay={DELAYS.sectionStep}>
              <h2 className="mb-5 font-serif text-[clamp(2rem,1.4rem+2.6vw,3.5rem)] leading-[1.25] font-medium text-balance">
                {t('folders.title')}
              </h2>
            </Reveal>
            <Reveal delay={2 * DELAYS.sectionStep}>
              <p className="mb-4 max-w-xl text-base leading-8 text-muted sm:text-lg">
                {t('folders.body1')}
              </p>
            </Reveal>
            <Reveal delay={3 * DELAYS.sectionStep}>
              <p className="max-w-xl text-base leading-8 text-muted sm:text-lg">
                {t('folders.body2')}
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      <PointsSystem
        ledger={{
          sectionLabel: t('points.sectionLabel'),
          title: t('points.title'),
          rows: ledgerRows,
          labels: {
            balance: t('points.labels.balance'),
            date: t('points.labels.date'),
            reason: t('points.labels.reason'),
            points: t('points.labels.points'),
            cancelled: t('points.labels.cancelled'),
          },
        }}
        board={{
          sectionLabel: t('filter.sectionLabel'),
          title: t('filter.title'),
          panelLabel: t('filter.panelLabel'),
          entries: topRows.map((row, index) => ({ id: `m${index + 1}`, ...row })),
        }}
      />

      <section id="features" className="scroll-mt-24 px-4 py-12 sm:py-16 lg:py-24">
        <div className="mx-auto w-full max-w-6xl">
          <Fragments
            pieces={featurePieces}
            className="rounded-card"
            header={
              <>
                <SpecLabel tone="on-hero" className="mb-2 block">
                  {t('features.sectionLabel')}
                </SpecLabel>
                <h2 className="font-serif text-3xl font-semibold">{t('features.title')}</h2>
              </>
            }
          />
        </div>
      </section>

      <PixelDivider from="var(--canvas)" to="var(--hero-surface)" />

      <section className="bg-hero px-4 py-12 text-on-hero sm:py-16 lg:py-24">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6">
          <RevealWords
            as="h2"
            className="font-serif text-3xl font-semibold sm:text-4xl"
            text={t('closing.title')}
          />
          <Reveal delay={4 * DELAYS.sectionStep}>
            <p className="max-w-xl text-base leading-8 text-on-hero-muted sm:text-lg">
              {t('closing.body')}
            </p>
          </Reveal>
          <Reveal delay={5 * DELAYS.sectionStep} className="w-full sm:w-auto">
            <AuthCtas signIn={t('cta.signIn')} signUp={t('cta.signUp')} />
          </Reveal>
        </div>
      </section>
    </>
  );
}
