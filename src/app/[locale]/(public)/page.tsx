import { getTranslations } from 'next-intl/server';

import type { SamplePage } from '@/client/lib/dm-engine';
import { LandingDock } from '@/components/shell/landing-dock';
import { Button } from '@/components/ui/button';
import { DitherSeam } from '@/components/ui/dither-seam';
import { Fragments, type FragmentPiece } from '@/components/ui/fragments';
import { Hero } from '@/components/ui/hero';
import { Marquee } from '@/components/ui/marquee';
import { SpecLabel } from '@/components/ui/spec-label';
import { Stat } from '@/components/ui/stat';
import { resolveLocale } from '@/i18n/locale';
import { Link } from '@/i18n/navigation';
import { demoClubs, demoPeople } from '@/shared/demo/demo';

const TOWER_PAGES: SamplePage[] = [
  { bg: 'var(--brand)', fg: 'var(--on-brand)', code: 'M1', title: 'الأعضاء' },
  { bg: 'var(--paper-teal)', fg: 'var(--on-paper)', code: 'C1', title: 'اللجان' },
  { bg: 'var(--slab)', fg: 'var(--on-slab)', code: 'P1', title: 'سجل النقاط' },
  { bg: 'var(--paper-peach)', fg: 'var(--on-paper)', code: 'R1', title: 'الصلاحيات' },
  { bg: 'var(--uqu-deep-teal)', fg: '#FFFFFF', code: 'K1', title: 'الأندية' },
];

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

  const featurePieces: FragmentPiece[] = [
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
      top: 210,
      start: 480,
      content: featurePieceContent('permissions', '→03 · ROLES'),
    },
    {
      key: 'viewLink',
      kind: 'photo',
      tiltDeg: -3,
      top: 360,
      start: 560,
      content: featurePieceContent('viewLink', '→04 · VIEW'),
    },
  ];

  const committeesCount = demoClubs.reduce((sum, club) => sum + club.committees.length, 0);
  const registeredCount = demoPeople.filter((p) => p.registered).length;
  const statItems = [
    { value: demoClubs.length, label: t('stats.clubs') },
    { value: committeesCount, label: t('stats.committees') },
    { value: demoPeople.length, label: t('stats.members') },
    { value: registeredCount, label: t('stats.registered') },
  ];

  const marqueeChips = demoClubs.flatMap((club) => [
    { name: club.name },
    ...club.committees.map((c) => ({ name: c.name })),
  ]);

  const dockItems = [
    { key: 'home', label: t('dock.home'), icon: 'home' as const, href: '#top' },
    { key: 'features', label: t('dock.features'), icon: 'grid' as const, href: '#features' },
  ];

  return (
    <>
      <section id="top" className="relative overflow-hidden bg-deep text-on-deep">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(var(--on-deep-muted) 1px, transparent 1px), linear-gradient(90deg, var(--on-deep-muted) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />
        <div className="relative px-4 py-16 sm:py-24">
          <div className="mx-auto w-full max-w-6xl">
            <Hero
              tone="on-deep"
              specLine={t('hero.specLine')}
              headline={t('hero.titleStart')}
              headlineMuted={t('hero.titleEnd')}
              body={t('hero.subtitle')}
              pages={TOWER_PAGES}
              primaryAction={
                <Button asChild className="border-on-deep bg-on-deep text-deep hover:bg-on-deep/90">
                  <Link href="/dashboard">{t('hero.primaryCta')}</Link>
                </Button>
              }
              secondaryLink={
                <a
                  href="#features"
                  className="text-[15px] font-semibold text-on-deep underline underline-offset-4"
                >
                  {t('hero.secondaryCta')}
                </a>
              }
            />
          </div>
        </div>
      </section>

      <DitherSeam from="var(--deep)" to="var(--canvas)" cell={8} cols={150} rows={2} />

      <section className="px-4 py-16 sm:py-24">
        <div className="mx-auto w-full max-w-6xl">
          <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <SpecLabel className="mb-2 block">{t('stats.sectionLabel')}</SpecLabel>
              <h2 className="font-serif text-3xl font-semibold">{t('stats.title')}</h2>
            </div>
            <p className="text-sm text-muted">{t('stats.caption')}</p>
          </div>
          <Stat items={statItems} />
        </div>
      </section>

      <section id="features" className="px-4 py-16 sm:py-24">
        <div className="mx-auto w-full max-w-6xl">
          <Fragments
            pieces={featurePieces}
            className="rounded-card"
            header={
              <>
                <SpecLabel tone="on-deep" className="mb-2 block">
                  {t('features.sectionLabel')}
                </SpecLabel>
                <h2 className="font-serif text-3xl font-semibold">{t('features.title')}</h2>
              </>
            }
          />
        </div>
      </section>

      <section className="px-4 py-10">
        <div className="mx-auto w-full max-w-6xl">
          <SpecLabel className="mb-4 block">{t('marquee.sectionLabel')}</SpecLabel>
          <Marquee chips={marqueeChips} />
        </div>
      </section>

      <section className="bg-deep px-4 py-16 text-on-deep sm:py-24">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6">
          <h2 className="font-serif text-3xl font-semibold">{t('closing.title')}</h2>
          <p className="max-w-xl text-lg leading-8 text-on-deep-muted">{t('closing.body')}</p>
          <Button asChild className="border-on-deep bg-on-deep text-deep hover:bg-on-deep/90">
            <Link href="/dashboard">{t('closing.cta')}</Link>
          </Button>
        </div>
      </section>

      <LandingDock items={dockItems} />
    </>
  );
}
