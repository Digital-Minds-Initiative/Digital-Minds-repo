'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { admitMemberBodySchema, createMemberBodySchema } from '@/shared/contracts/members';
import { toLatinDigits } from '@/shared/lib/arabic';

import { fromGenderValue, GenderSelect, NO_GENDER, type GenderValue } from './gender-select';
import {
  useAdmitMember,
  useClubCommittees,
  useClubTypes,
  useCreateMember,
} from '../hooks/use-member-actions';
import type { AdmittingCommittee } from '../lib/access';
import { useCommitteeLabel } from '../lib/committee-label';
import { applyIssues, blankToUndefined, type FormIssue } from '../lib/form';

interface Values {
  clubId: string;
  /** Committee mode only: the committee the person is brought into. */
  committeeId: string;
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
  gender: GenderValue;
}

const FIELDS = [
  'uniEmail',
  'fullName',
  'personalEmail',
  'phone',
  'college',
  'major',
  'level',
  'gender',
] as const;

const DEFAULT_TYPE = 'default';

export interface AddMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The clubs the person may add members to. */
  clubs: ReadonlyArray<{ id: string; name: string }>;
  /**
   * Without a club to add to: the committees the person leads. The dialog then brings a person
   * into one of them, always with «عضو» (docs/adr/0029-leads-add-members.md).
   */
  committees?: readonly AdmittingCommittee[];
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

/** A parsed body ready to send, or the issues that kept it from being sent. */
function withParsed<T>(
  parsed: { success: true; data: T } | { success: false; error: { issues: FormIssue[] } },
  send: (body: T) => Promise<unknown>,
): { send: () => Promise<unknown> } | { issues: FormIssue[] } {
  return parsed.success ? { send: () => send(parsed.data) } : { issues: parsed.error.issues };
}

/** A titled group of fields: a light heading and one gap, no box around it. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4">
      <h3 className="border-b border-border/60 pb-2 text-xs font-semibold text-fg-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}

function AddMemberForm({
  onOpenChange,
  clubs,
  committees = [],
  onOpenMember,
}: AddMemberDialogProps) {
  const t = useTranslations('members.form');
  const committeeLabel = useCommitteeLabel(committees);
  // A club to add to wins; a lead without one adds to a committee they lead.
  const intoCommittee = clubs.length === 0;
  const errorText = useErrorText();
  const [formError, setFormError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const busyRef = useRef(false);
  const form = useForm<Values>({
    defaultValues: {
      clubId: clubs[0]?.id ?? '',
      committeeId: committees[0]?.id ?? '',
      uniEmail: '',
      fullName: '',
      membershipTypeId: DEFAULT_TYPE,
      committeeIds: [],
      personalEmail: '',
      phone: '',
      college: '',
      major: '',
      level: '',
      gender: NO_GENDER,
    },
  });
  const clubId = useWatch({ control: form.control, name: 'clubId' });
  const committeeId = useWatch({ control: form.control, name: 'committeeId' });
  const committeeIds = useWatch({ control: form.control, name: 'committeeIds' });
  const types = useClubTypes(clubId || undefined);
  const clubCommittees = useClubCommittees(clubId || undefined);
  const create = useCreateMember(clubId);
  const admit = useAdmitMember(committeeId);

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    setExistingId(null);
    const level = blankToUndefined(toLatinDigits(values.level));
    const person = { uniEmail: values.uniEmail, fullName: values.fullName };
    const profile = {
      personalEmail: blankToUndefined(values.personalEmail),
      phone: blankToUndefined(values.phone),
      college: blankToUndefined(values.college),
      major: blankToUndefined(values.major),
      level: level === undefined ? undefined : Number(level),
      gender: fromGenderValue(values.gender) ?? undefined,
    };
    // The same schema the API uses decides what is valid, so the person is told before a request.
    // A committee's add takes no type and no committees: the server gives «عضو» and the URL's.
    const request = intoCommittee
      ? withParsed(admitMemberBodySchema.safeParse({ person, profile }), admit.mutateAsync)
      : withParsed(
          createMemberBodySchema.safeParse({
            person,
            profile,
            membershipTypeId:
              values.membershipTypeId === DEFAULT_TYPE ? undefined : values.membershipTypeId,
            committeeIds: values.committeeIds,
          }),
          create.mutateAsync,
        );
    if ('issues' in request) {
      if (!applyIssues(form, request.issues, FIELDS)) setFormError(t('add.genericError'));
      return;
    }
    try {
      await request.send();
      toast.success(t('add.added'));
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError) {
        const existing =
          error.details.reason === (intoCommittee ? 'already_in_committee' : 'already_in_club');
        if (existing && error.details.ids?.memberId) {
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
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="px-6 pe-12 pt-6 pb-4">
          <DialogTitle>{intoCommittee ? t('add.committeeTitle') : t('add.title')}</DialogTitle>
          <DialogDescription>
            {intoCommittee ? t('add.committeeDescription') : t('add.description')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onFormSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="grid gap-6 overflow-y-auto px-6 py-5">
            <Section title={t('add.sections.basic')}>
              {intoCommittee && committees.length > 1 ? (
                <FormField
                  control={form.control}
                  name="committeeId"
                  label={t('fields.committee')}
                  render={({ field, controlProps }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id={controlProps.id} className="h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {committees.map((committee) => (
                          <SelectItem key={committee.id} value={committee.id}>
                            {committeeLabel(committee)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              ) : intoCommittee ? (
                <p className="text-sm font-medium">
                  {committees[0] ? committeeLabel(committees[0]) : null}
                </p>
              ) : clubs.length > 1 ? (
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
                      <SelectTrigger id={controlProps.id} className="h-11">
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
            </Section>

            {intoCommittee ? (
              <Section title={t('add.sections.membership')}>
                <p className="m-0 rounded-md bg-surface-3 p-3 text-sm text-fg-muted">
                  {t('add.committeeTypeNote')}
                </p>
              </Section>
            ) : (
              <Section title={t('add.sections.membership')}>
                <FormField
                  control={form.control}
                  name="membershipTypeId"
                  label={t('fields.membershipType')}
                  render={({ field, controlProps }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id={controlProps.id} className="h-11">
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
                {(clubCommittees.data?.items.length ?? 0) > 0 ? (
                  <fieldset className="m-0 grid gap-2 border-0 p-0">
                    <legend className="mb-2 text-sm font-medium">{t('fields.committees')}</legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {clubCommittees.data?.items.map((committee) => {
                        const id = `add-member-committee-${committee.id}`;
                        return (
                          <label
                            key={committee.id}
                            htmlFor={id}
                            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border bg-surface-1 px-3 text-sm transition-colors hover:bg-surface-2 has-data-[state=checked]:border-primary/50 has-data-[state=checked]:bg-primary-subtle has-data-[state=checked]:font-medium has-data-[state=checked]:text-primary-subtle-fg"
                          >
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
                            <span className="truncate">{committee.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                ) : null}
              </Section>
            )}

            <Section title={t('add.sections.extra')}>
              {intoCommittee ? (
                <p className="m-0 text-xs text-fg-muted">{t('add.committeeProfileNote')}</p>
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
                <FormField
                  control={form.control}
                  name="gender"
                  label={t('fields.gender')}
                  render={({ field, controlProps }) => (
                    <GenderSelect
                      id={controlProps.id}
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
              </div>
            </Section>

            {existingId ? (
              <div role="alert" className="grid gap-2 rounded-md bg-warning-subtle p-3 text-sm">
                <p className="font-medium text-warning-subtle-fg">
                  {intoCommittee ? t('add.alreadyInCommittee') : t('add.alreadyIn')}
                </p>
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
          </div>
          <DialogFooter className="border-t border-border/60 bg-surface-1/40 px-6 py-4">
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
