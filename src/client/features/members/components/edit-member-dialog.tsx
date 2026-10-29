'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { ApiError } from '@/client/lib/api-client';
import { useErrorText } from '@/client/lib/use-error-text';
import { FormField } from '@/components/patterns/form-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import {
  updateMemberBodySchema,
  type Member,
  type UpdateMemberBody,
} from '@/shared/contracts/members';
import { toLatinDigits } from '@/shared/lib/arabic';
import { normalizeEmail } from '@/shared/lib/email-domains';
import { normalizePersonName } from '@/shared/lib/names';

import { fromGenderValue, GenderSelect, toGenderValue, type GenderValue } from './gender-select';
import { useClubTypes, useUpdateMember } from '../hooks/use-member-actions';
import type { MemberAccess } from '../lib/access';
import { applyIssues } from '../lib/form';

interface Values {
  uniEmail: string;
  fullName: string;
  membershipTypeId: string;
  personalEmail: string;
  phone: string;
  college: string;
  major: string;
  level: string;
  gender: GenderValue;
}

const FIELDS = [
  'uniEmail',
  'fullName',
  'membershipTypeId',
  'personalEmail',
  'phone',
  'college',
  'major',
  'level',
  'gender',
] as const;

export interface EditMemberDialogProps {
  member: Member | null;
  access: MemberAccess;
  onClose: () => void;
}

/**
 * Edits a member. What can be changed depends on who is asking: officers and full admins change
 * the name and this club's details and the membership type; the university email only while the
 * person has not registered (full admins at any time, and it ends the person's sessions); a
 * committee lead changes the membership type only. Only the fields that actually changed are
 * sent, so a field the person may not touch is never part of a request that leaves it alone.
 */
export function EditMemberDialog({ member, access, onClose }: EditMemberDialogProps) {
  // Keyed and mounted per member, so each opening starts from that member's current values.
  return member ? (
    <EditMemberForm key={member.id} member={member} access={access} onClose={onClose} />
  ) : null;
}

function EditMemberForm({
  member,
  access,
  onClose,
}: {
  member: Member;
  access: MemberAccess;
  onClose: () => void;
}) {
  const t = useTranslations('members.form');
  const tSheet = useTranslations('members.sheet');
  const errorText = useErrorText();
  const [formError, setFormError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const update = useUpdateMember(member.id);
  const types = useClubTypes(member.club.id);
  const form = useForm<Values>({
    defaultValues: {
      uniEmail: member.user.uniEmail,
      fullName: member.user.fullName,
      membershipTypeId: member.membershipType.id,
      personalEmail: member.profile.personalEmail ?? '',
      phone: member.profile.phone ?? '',
      college: member.profile.college ?? '',
      major: member.profile.major ?? '',
      level: member.profile.level === null ? '' : String(member.profile.level),
      gender: toGenderValue(member.profile.gender),
    },
  });
  const emailChanged =
    normalizeEmail(useWatch({ control: form.control, name: 'uniEmail' })) !==
      member.user.uniEmail && access.canEditEmail;

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    const changes: Record<string, unknown> = {};
    if (access.canEditEmail && normalizeEmail(values.uniEmail) !== member.user.uniEmail) {
      changes.uniEmail = values.uniEmail;
    }
    if (access.canManage && normalizePersonName(values.fullName) !== member.user.fullName) {
      changes.fullName = values.fullName;
    }
    if (access.canChangeType && values.membershipTypeId !== member.membershipType.id) {
      changes.membershipTypeId = values.membershipTypeId;
    }
    if (access.canManage) {
      // An emptied box clears the field; an unchanged one is not sent at all.
      const text = (value: string) => (value.trim() === '' ? null : value.trim());
      const next = {
        personalEmail: text(values.personalEmail),
        phone: text(values.phone),
        college: text(values.college),
        major: text(values.major),
        level:
          text(toLatinDigits(values.level)) === null
            ? null
            : Number(toLatinDigits(values.level).trim()),
        gender: fromGenderValue(values.gender),
      };
      const keys = ['personalEmail', 'phone', 'college', 'major', 'level', 'gender'] as const;
      for (const key of keys) {
        if (next[key] !== member.profile[key]) changes[key] = next[key];
      }
    }
    if (Object.keys(changes).length === 0) {
      setFormError(t('edit.noChanges'));
      return;
    }
    const parsed = updateMemberBodySchema.safeParse(changes);
    if (!parsed.success) {
      if (!applyIssues(form, parsed.error.issues, FIELDS)) setFormError(errorText(null));
      return;
    }
    try {
      await update.mutateAsync(parsed.data as UpdateMemberBody);
      toast.success(t('edit.saved'));
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.details.reason === 'already_exists') {
          form.setError('uniEmail', { type: 'already_exists', message: 'already_exists' });
          return;
        }
        if (error.details.issues && applyIssues(form, error.details.issues, FIELDS)) return;
      }
      setFormError(errorText(error));
    }
  });

  function onFormSubmit(event: FormEvent<HTMLFormElement>) {
    if (busyRef.current) {
      event.preventDefault();
      return;
    }
    busyRef.current = true;
    void submit(event).finally(() => {
      busyRef.current = false;
    });
  }

  const clubFields = [
    {
      name: 'personalEmail',
      label: t('fieldsPlain.personalEmail'),
      dir: 'ltr',
      inputMode: 'email',
    },
    {
      name: 'phone',
      label: t('fieldsPlain.phone'),
      hint: t('fields.phoneHint'),
      dir: 'ltr',
      inputMode: 'tel',
    },
    { name: 'college', label: t('fieldsPlain.college') },
    { name: 'major', label: t('fieldsPlain.major') },
    {
      name: 'level',
      label: t('fieldsPlain.level'),
      hint: t('fields.levelHint'),
      inputMode: 'numeric',
      dir: 'ltr',
    },
  ] as const;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!form.formState.isSubmitting && !next) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('edit.title', { name: member.user.fullName })}</DialogTitle>
          <DialogDescription>
            {access.canManage ? t('edit.description') : tSheet('typeChange.leadHint')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onFormSubmit} noValidate className="grid gap-4">
          {access.canManage ? (
            <>
              <FormField
                control={form.control}
                name="fullName"
                label={t('fields.fullName')}
                description={t('edit.sharedHint')}
                required
                render={({ field, controlProps }) => (
                  <Input {...field} {...controlProps} autoComplete="off" />
                )}
              />
              <FormField
                control={form.control}
                name="uniEmail"
                label={t('fields.email')}
                description={access.canEditEmail ? t('edit.sharedHint') : t('edit.emailLocked')}
                required
                render={({ field, controlProps }) => (
                  <Input
                    {...field}
                    {...controlProps}
                    type="email"
                    dir="ltr"
                    inputMode="email"
                    autoComplete="off"
                    disabled={!access.canEditEmail}
                  />
                )}
              />
              {emailChanged ? (
                <p
                  role="note"
                  className="rounded-md bg-warning-subtle px-3 py-2 text-sm text-warning-subtle-fg"
                >
                  {t('edit.emailWarning')}
                </p>
              ) : null}
            </>
          ) : null}

          {access.canChangeType ? (
            <FormField
              control={form.control}
              name="membershipTypeId"
              label={t('fields.membershipType')}
              render={({ field, controlProps }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id={controlProps.id}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      types.data?.items ?? [
                        { id: member.membershipType.id, name: member.membershipType.name },
                      ]
                    ).map((type) => (
                      <SelectItem key={type.id} value={type.id}>
                        {type.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          ) : null}

          {access.canManage ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {clubFields.map((spec) => (
                <FormField
                  key={spec.name}
                  control={form.control}
                  name={spec.name}
                  label={spec.label}
                  description={'hint' in spec ? spec.hint : undefined}
                  render={({ field, controlProps }) => (
                    <Input
                      {...field}
                      {...controlProps}
                      autoComplete="off"
                      dir={'dir' in spec ? spec.dir : undefined}
                      inputMode={'inputMode' in spec ? spec.inputMode : undefined}
                    />
                  )}
                />
              ))}
              <FormField
                control={form.control}
                name="gender"
                label={t('fieldsPlain.gender')}
                render={({ field, controlProps }) => (
                  <GenderSelect
                    id={controlProps.id}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>
          ) : null}

          {formError ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {formError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {t('edit.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
