'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

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
import { clubSlugSchema } from '@/shared/contracts/clubs';
import { entityNameSchema } from '@/shared/contracts/core';

interface EntityFormValues {
  name: string;
  slug: string;
  /** Empty means "no description". */
  description: string;
}

export interface EntityFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  labels: { name: string; slug?: string; slugHint?: string; description?: string };
  /** Clubs only, and only when creating: the slug is written once. */
  withSlug?: boolean;
  /** Types have a name and nothing else. */
  withDescription?: boolean;
  initial?: Partial<EntityFormValues>;
  /** Rejects with the request's error; the dialog shows it on the field or above the buttons. */
  onSubmit: (values: EntityFormValues) => Promise<unknown>;
}

const FIELDS = ['name', 'slug', 'description'] as const;

/**
 * One dialog for creating and editing a club, a committee or a membership type: a name, and
 * optionally a slug and a description. The same schemas the API uses decide what is valid; what
 * only the server can know (a name already taken) comes back onto the field it is about.
 */
export function EntityFormDialog(props: EntityFormDialogProps) {
  // Mounted only while open, so every opening starts from the entity's current values.
  return props.open ? <EntityForm {...props} /> : null;
}

function EntityForm({
  onOpenChange,
  title,
  description,
  submitLabel,
  labels,
  withSlug = false,
  withDescription = true,
  initial,
  onSubmit,
}: EntityFormDialogProps) {
  const t = useTranslations('clubs.form');
  const errorText = useErrorText();
  const [formError, setFormError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const schema = useMemo(
    () =>
      z.object({
        name: entityNameSchema,
        slug: withSlug ? clubSlugSchema : z.string(),
        description: z.string().trim().max(1000),
      }),
    [withSlug],
  );
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? '',
      slug: initial?.slug ?? '',
      description: initial?.description ?? '',
    },
  });

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit(values);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError) {
        const reason = error.details.reason;
        if (reason === 'name_taken' || reason === 'slug_taken') {
          form.setError(reason === 'name_taken' ? 'name' : 'slug', {
            type: reason,
            message: reason,
          });
          return;
        }
        const issue = error.details.issues?.find((candidate) =>
          (FIELDS as readonly string[]).includes(String(candidate.path.at(-1))),
        );
        if (issue) {
          form.setError(issue.path.at(-1) as (typeof FIELDS)[number], {
            type: issue.code,
            message: issue.code,
          });
          return;
        }
      }
      setFormError(errorText(error));
    }
  });

  function onFormSubmit(event: FormEvent<HTMLFormElement>) {
    // A double click arrives before the button shows as busy; one request is enough.
    if (busyRef.current) {
      event.preventDefault();
      return;
    }
    busyRef.current = true;
    void submit(event).finally(() => {
      busyRef.current = false;
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!form.formState.isSubmitting) onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onFormSubmit} noValidate className="grid gap-4">
          <FormField
            control={form.control}
            name="name"
            label={labels.name}
            required
            render={({ field, controlProps }) => (
              <Input {...field} {...controlProps} autoComplete="off" autoFocus />
            )}
          />
          {withSlug ? (
            <FormField
              control={form.control}
              name="slug"
              label={labels.slug}
              description={labels.slugHint}
              required
              render={({ field, controlProps }) => (
                <Input {...field} {...controlProps} dir="ltr" autoComplete="off" />
              )}
            />
          ) : null}
          {withDescription ? (
            <FormField
              control={form.control}
              name="description"
              label={labels.description}
              render={({ field, controlProps }) => (
                <textarea
                  {...field}
                  {...controlProps}
                  rows={3}
                  className="min-h-20 w-full rounded-md border border-border-strong bg-surface-1 px-3 py-2 text-sm text-fg transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid aria-invalid:border-danger"
                />
              )}
            />
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
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
