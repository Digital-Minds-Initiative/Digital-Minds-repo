'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { ApiError } from '@/client/lib/api-client';
import { useErrorText } from '@/client/lib/use-error-text';
import { FormField } from '@/components/patterns/form-field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { createMemberBodySchema } from '@/shared/contracts/members';
import { toLatinDigits } from '@/shared/lib/arabic';

import { useClubCommittees, useClubTypes, useCreateMember } from '../hooks/use-member-actions';
import { applyIssues, blankToUndefined } from '../lib/form';

interface Values {
  clubId: string;
  uniEmail: string;
  fullName: string;
  /** Empty means the club's first membership type. */
  membershipTypeId: string;
  committeeIds: string[];
  personalEmail: string;
  phone: string;
  college: string;
  major: string;
  level: string;
}

const FIELDS = [
  'uniEmail',
  'fullName',
  'personalEmail',
  'phone',
  'college',
  'major',
  'level',
] as const;

const DEFAULT_TYPE = 'default';

export interface AddMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The clubs the person may add members to. */
  clubs: ReadonlyArray<{ id: string; name: string }>;
  /** Called with the member's id when the person asks to open an existing member's file. */
  onOpenMember: (memberId: string) => void;
}

/**
 * Adds a person to a club by university email, with their name, this club's contact and study
 * details, a membership type and any committees. The email is the identity: a new address makes
 * an account the person claims when they sign up, an existing account is linked and keeps its
 * name, a removed membership is restored with its history — and someone already in the club is
 * refused with a way to open their file (docs/adr/0017-member-permissions.md).
 */
export function AddMemberDialog(props: AddMemberDialogProps) {
  // Mounted only while open, so every opening starts with an empty form.
  return props.open ? <AddMemberForm {...props} /> : null;
}

function AddMemberForm({ onOpenChange, clubs, onOpenMember }: AddMemberDialogProps) {
  const t = useTranslations('members.form');
  const errorText = useErrorText();
  const [formError, setFormError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const busyRef = useRef(false);
  const form = useForm<Values>({
    defaultValues: {
      clubId: clubs[0]?.id ?? '',
      uniEmail: '',
      fullName: '',
      membershipTypeId: DEFAULT_TYPE,
      committeeIds: [],
      personalEmail: '',
      phone: '',
      college: '',
      major: '',
      level: '',
    },
  });
  const clubId = useWatch({ control: form.control, name: 'clubId' });
  const committeeIds = useWatch({ control: form.control, name: 'committeeIds' });
  const types = useClubTypes(clubId || undefined);
  const committees = useClubCommittees(clubId || undefined);
  const create = useCreateMember(clubId);

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    setExistingId(null);
    const level = blankToUndefined(toLatinDigits(values.level));
    const body = {
      person: { uniEmail: values.uniEmail, fullName: values.fullName },
      profile: {
        personalEmail: blankToUndefined(values.personalEmail),
        phone: blankToUndefined(values.phone),
        college: blankToUndefined(values.college),
        major: blankToUndefined(values.major),
        level: level === undefined ? undefined : Number(level),
      },
      membershipTypeId:
        values.membershipTypeId === DEFAULT_TYPE ? undefined : values.membershipTypeId,
      committeeIds: values.committeeIds,
    };
    // The same schema the API uses decides what is valid, so the person is told before a request.
    const parsed = createMemberBodySchema.safeParse(body);
    if (!parsed.success) {
      if (!applyIssues(form, parsed.error.issues, FIELDS)) setFormError(t('add.genericError'));
      return;
    }
    try {
      await create.mutateAsync(parsed.data);
      toast.success(t('add.added'));
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.details.reason === 'already_in_club' && error.details.ids?.memberId) {
          setExistingId(error.details.ids.memberId);
          return;
        }
        if (error.details.issues && applyIssues(form, error.details.issues, FIELDS)) return;
      }
      setFormError(errorText(error));
    }
  });

  function onFormSubmit(event: FormEvent<HTMLFormElement>) {
    // A double click arrives before the button shows as busy: one request is enough.
    if (busyRef.current) {
      event.preventDefault();
      return;
    }
    busyRef.current = true;
    void submit(event).finally(() => {
      busyRef.current = false;
    });
  }

  const textFields = [
    { name: 'personalEmail', label: t('fields.personalEmail'), dir: 'ltr', inputMode: 'email' },
    {
      name: 'phone',
      label: t('fields.phone'),
      hint: t('fields.phoneHint'),
      dir: 'ltr',
      inputMode: 'tel',
    },
    { name: 'college', label: t('fields.college') },
    { name: 'major', label: t('fields.major') },
    {
      name: 'level',
      label: t('fields.level'),
      hint: t('fields.levelHint'),
      inputMode: 'numeric',
      dir: 'ltr',
    },
  ] as const;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!form.formState.isSubmitting) onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('add.title')}</DialogTitle>
          <DialogDescription>{t('add.description')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onFormSubmit} noValidate className="grid gap-4">
          {clubs.length > 1 ? (
            <FormField
              control={form.control}
              name="clubId"
              label={t('fields.club')}
              render={({ field, controlProps }) => (
                <Select
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                    form.setValue('membershipTypeId', DEFAULT_TYPE);
                    form.setValue('committeeIds', []);
                  }}
                >
                  <SelectTrigger id={controlProps.id}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {clubs.map((club) => (
                      <SelectItem key={club.id} value={club.id}>
                        {club.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          ) : (
            <p className="text-sm font-medium">{clubs[0]?.name}</p>
          )}

          <FormField
            control={form.control}
            name="uniEmail"
            label={t('fields.email')}
            required
            render={({ field, controlProps }) => (
              <Input
                {...field}
                {...controlProps}
                type="email"
                dir="ltr"
                inputMode="email"
                autoComplete="off"
                placeholder={t('fields.emailPlaceholder')}
                autoFocus
              />
            )}
          />
          <FormField
            control={form.control}
            name="fullName"
            label={t('fields.fullName')}
            required
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} autoComplete="off" />
            )}
          />

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
                  <SelectItem value={DEFAULT_TYPE}>{t('defaultType')}</SelectItem>
                  {(types.data?.items ?? []).map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />

          {(committees.data?.items.length ?? 0) > 0 ? (
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-1 text-sm font-medium">{t('fields.committees')}</legend>
              {committees.data?.items.map((committee) => {
                const id = `add-member-committee-${committee.id}`;
                return (
                  <div key={committee.id} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={committeeIds.includes(committee.id)}
                      onCheckedChange={(checked) =>
                        form.setValue(
                          'committeeIds',
                          checked === true
                            ? [...committeeIds, committee.id]
                            : committeeIds.filter((existing) => existing !== committee.id),
                        )
                      }
                    />
                    <Label htmlFor={id}>{committee.name}</Label>
                  </div>
                );
              })}
            </fieldset>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            {textFields.map((spec) => (
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
          </div>

          {existingId ? (
            <div role="alert" className="grid gap-2 rounded-md bg-warning-subtle p-3 text-sm">
              <p className="font-medium text-warning-subtle-fg">{t('add.alreadyIn')}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => {
                  onOpenChange(false);
                  onOpenMember(existingId);
                }}
              >
                {t('add.openExisting')}
              </Button>
            </div>
          ) : null}
          {formError ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {formError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {t('add.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
