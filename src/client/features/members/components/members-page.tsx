'use client';

import { Plus, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Suspense, useState } from 'react';

import { useMe } from '@/client/features/auth';
import { PageHeader } from '@/components/patterns/page-header';
import { Button } from '@/components/ui/button';

import { AddMemberDialog } from './add-member-dialog';
import { ImportMembersDialog } from './import-members-dialog';
import { MembersTable } from './members-table';
import { clubsToAddTo } from '../lib/access';

interface MembersPageProps {
  title: string;
  description: string;
}

/**
 * The members page: the title with the main action beside it — adding a member, for those who may
 * add to a club — and the table below. The dialog lives here so a member it points to ("already in
 * the club") can open their file in the table's panel.
 */
export function MembersPage({ title, description }: MembersPageProps) {
  const t = useTranslations('members.toolbar');
  const me = useMe();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const addableClubs = me.data ? clubsToAddTo(me.data) : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={title}
        description={description}
        actions={
          addableClubs.length > 0 ? (
            <>
              <Button variant="outline" onClick={() => setImporting(true)}>
                <Upload aria-hidden />
                {t('importMembers')}
              </Button>
              <Button onClick={() => setAdding(true)}>
                <Plus aria-hidden />
                {t('addMember')}
              </Button>
            </>
          ) : undefined
        }
      />
      {/* The table reads the URL query (useSearchParams), which needs a Suspense boundary. */}
      <Suspense>
        <MembersTable openId={openId} onOpenIdChange={setOpenId} />
      </Suspense>
      <ImportMembersDialog open={importing} onOpenChange={setImporting} clubs={addableClubs} />
      <AddMemberDialog
        open={adding}
        onOpenChange={setAdding}
        clubs={addableClubs}
        onOpenMember={setOpenId}
      />
    </div>
  );
}
