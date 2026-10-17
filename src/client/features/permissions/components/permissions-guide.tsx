'use client';

import { Check, Info, Minus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import type { RoleAccess } from '../lib/access';

/**
 * Who may do what with roles, in one small table, with the signed-in person's own column marked.
 * It sits behind a button in the page header rather than taking room on the page. It repeats the rule the server enforces (docs/adr/0018-granting-roles.md) so nobody has to guess
 * why a button is missing.
 */
export function PermissionsGuide({ access }: { access: RoleAccess }) {
  const t = useTranslations('permissions.guide');
  const rows = [
    { key: 'officers', fullAdmin: true, officer: false },
    { key: 'leads', fullAdmin: true, officer: true },
    { key: 'read', fullAdmin: true, officer: true },
  ] as const;
  const columns = [
    { key: 'fullAdmin', label: t('roles.fullAdmin'), mine: access.role === 'fullAdmin' },
    { key: 'officer', label: t('roles.officer'), mine: access.role === 'officer' },
  ] as const;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Info aria-hidden />
          {t('open')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto">
          <table className="w-full min-w-96 border-collapse text-sm">
            <thead>
              <tr className="text-fg-muted">
                <th className="py-2 pe-3 text-start font-medium" />
                {columns.map((column) => (
                  <th key={column.key} className="px-3 py-2 text-center font-medium">
                    <span className="grid justify-items-center gap-1">
                      {column.label}
                      {column.mine ? <Badge variant="primary">{t('yourRole')}</Badge> : null}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-border">
                  <th scope="row" className="py-2.5 pe-3 text-start font-normal">
                    {t(`rows.${row.key}`)}
                  </th>
                  {columns.map((column) => {
                    const allowed = row[column.key];
                    return (
                      <td key={column.key} className="px-3 py-2.5 text-center">
                        {allowed ? (
                          <Check className="mx-auto size-4 text-success" aria-label="✓" />
                        ) : (
                          <Minus className="mx-auto size-4 text-fg-subtle" aria-label="—" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="m-0 grid list-disc gap-1 ps-5 text-sm text-fg-muted">
          {(t.raw('notes') as string[]).map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
