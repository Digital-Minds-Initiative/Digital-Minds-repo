'use client';

import { useTranslations } from 'next-intl';
import { Direction } from 'radix-ui';
import { useSyncExternalStore } from 'react';

import { Button } from './button';
import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from './toast';

/*
 * Imperative toasts:
 *   toast.success(t('saved'));
 *   toast.error(t('common.errors.INTERNAL'), { description: error.message });
 * Pass already-translated text. Render <Toaster /> once (AppProviders does).
 */

type ToastVariant = 'default' | 'success' | 'danger';

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
  open: boolean;
  duration?: number;
  action?: ToastActionOptions;
}

interface ToastActionOptions {
  /** The button's text, also read to screen readers as the alternative. */
  label: string;
  onClick: () => void;
}

interface ToastOptions {
  description?: string;
  /** Milliseconds before auto-dismiss (Radix default: 5000). */
  duration?: number;
  /** One button that does something about the toast, such as «إعادة الإرسال». Closes it. */
  action?: ToastActionOptions;
}

const MAX_VISIBLE = 3;
const REMOVE_DELAY_MS = 300;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const EMPTY: ToastItem[] = [];

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function show(title: string, variant: ToastVariant, options: ToastOptions = {}): number {
  const id = nextId++;
  items = [...items, { id, title, variant, open: true, ...options }].slice(-MAX_VISIBLE);
  emit();
  return id;
}

function dismiss(id: number): void {
  items = items.map((item) => (item.id === id ? { ...item, open: false } : item));
  emit();
  setTimeout(() => {
    items = items.filter((item) => item.id !== id);
    emit();
  }, REMOVE_DELAY_MS);
}

export const toast = Object.assign(
  (title: string, options?: ToastOptions) => show(title, 'default', options),
  {
    success: (title: string, options?: ToastOptions) => show(title, 'success', options),
    error: (title: string, options?: ToastOptions) => show(title, 'danger', options),
    dismiss,
  },
);

export function Toaster() {
  const t = useTranslations('ui.toast');
  const direction = Direction.useDirection();
  const toasts = useSyncExternalStore(
    subscribe,
    () => items,
    () => EMPTY,
  );

  return (
    <ToastProvider swipeDirection={direction === 'rtl' ? 'left' : 'right'} label={t('region')}>
      {toasts.map((item) => (
        <Toast
          key={item.id}
          variant={item.variant}
          open={item.open}
          duration={item.duration}
          onOpenChange={(open) => {
            if (!open) dismiss(item.id);
          }}
        >
          <div className="grid gap-1">
            <ToastTitle>{item.title}</ToastTitle>
            {item.description ? <ToastDescription>{item.description}</ToastDescription> : null}
            {item.action ? (
              <ToastAction altText={item.action.label} asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1 justify-self-start"
                  onClick={item.action.onClick}
                >
                  {item.action.label}
                </Button>
              </ToastAction>
            ) : null}
          </div>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </ToastProvider>
  );
}
