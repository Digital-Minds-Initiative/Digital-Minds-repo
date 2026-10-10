import { ArrowRight, ShieldCheck, Trophy, Users } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DirectionalIcon } from '@/components/ui/directional-icon';
import { resolveLocale } from '@/i18n/locale';
import { Link } from '@/i18n/navigation';

const FEATURES = [
  { key: 'members', icon: Users },
  { key: 'points', icon: Trophy },
  { key: 'permissions', icon: ShieldCheck },
] as const;

export default async function LandingPage({ params }: PageProps<'/[locale]'>) {
  await resolveLocale(params);
  const t = await getTranslations('landing');

  return (
    <>
      <section className="border-b border-border bg-surface-1">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-4 py-20 sm:py-28">
          <Badge variant="primary">{t('hero.badge')}</Badge>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
            {t('hero.title')}
          </h1>
          <p className="max-w-2xl text-lg text-fg-muted">{t('hero.subtitle')}</p>
          <Button asChild size="lg">
            <Link href="/dashboard">
              {t('hero.primaryCta')}
              <DirectionalIcon icon={ArrowRight} />
            </Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-16">
        <h2 className="mb-8 text-2xl font-bold">{t('features.title')}</h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {FEATURES.map(({ key, icon: Icon }) => (
            <li key={key}>
              <Card className="h-full">
                <CardHeader className="gap-3">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-primary-subtle text-primary-subtle-fg">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <CardTitle>{t(`features.${key}.title`)}</CardTitle>
                  <CardDescription>{t(`features.${key}.body`)}</CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
