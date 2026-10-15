'use client';

import { useTranslations } from 'next-intl';
import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

import { cn } from '@/client/lib/utils';
import { Input } from '@/components/ui/input';
import { toLatinDigits } from '@/shared/lib/arabic';

import { paperInputClass } from './paper-classes';

const OTP_LENGTH = 6;

/** Only the digits of a string; Arabic-Indic and Persian digits become Latin ones. */
const digitsOf = (value: string) => toLatinDigits(value).replace(/\D/g, '');

export interface OtpInputProps {
  /**
   * The digits typed so far by position; an empty box is a space (`"12 4"`). It is what the form
   * stores, and the contract's schema drops the spaces, so a code with a gap is simply too short.
   */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Forwarded to the first box (react-hook-form focuses it on error). */
  inputRef?: (element: HTMLInputElement | null) => void;
  /** Goes on the first box so the visible label points at the group. */
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'aria-required'?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * The sign-in code as six single-digit boxes. Typing moves forward, Backspace and the arrows move
 * back and forth, and pasting (or an SMS autofill) fills every box at once, whatever digits and
 * spaces the text has. Boxes read left to right, like the number itself.
 */
export function OtpInput({
  value,
  onChange,
  onBlur,
  inputRef,
  id,
  disabled,
  className,
  ...aria
}: OtpInputProps) {
  const t = useTranslations('auth.code');
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const chars = Array.from({ length: OTP_LENGTH }, (_, index) =>
    /\d/.test(value[index] ?? '') ? (value[index] as string) : '',
  );

  const emit = (next: string[]) =>
    onChange(
      next
        .map((char) => char || ' ')
        .join('')
        .trimEnd(),
    );
  const focusBox = (index: number) => {
    const box = boxes.current[Math.max(0, Math.min(OTP_LENGTH - 1, index))];
    box?.focus();
    box?.select();
  };
  /** Writes `digits` into the boxes from `from` on and moves to the box after the last one. */
  const fill = (digits: string, from: number) => {
    const next = [...chars];
    let index = from;
    for (const digit of digits) {
      if (index >= OTP_LENGTH) break;
      next[index] = digit;
      index += 1;
    }
    emit(next);
    focusBox(index);
  };

  function handleChange(index: number, raw: string) {
    const digits = digitsOf(raw);
    if (digits === '') {
      const next = [...chars];
      next[index] = '';
      emit(next);
      return;
    }
    // One digit types into this box; more than one (autofill, a paste into a box) spreads out.
    fill(digits, index);
  }

  function handlePaste(index: number, event: ClipboardEvent<HTMLInputElement>) {
    const digits = digitsOf(event.clipboardData.getData('text'));
    if (digits === '') return;
    event.preventDefault();
    // A whole code replaces everything; a few digits go in from the box they were pasted into.
    fill(digits.slice(0, OTP_LENGTH), digits.length >= OTP_LENGTH ? 0 : index);
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'Backspace':
        if (chars[index] === '' && index > 0) {
          event.preventDefault();
          const next = [...chars];
          next[index - 1] = '';
          emit(next);
          focusBox(index - 1);
        }
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusBox(index - 1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        focusBox(index + 1);
        break;
      case 'Home':
        event.preventDefault();
        focusBox(0);
        break;
      case 'End':
        event.preventDefault();
        focusBox(OTP_LENGTH - 1);
        break;
    }
  }

  return (
    <div role="group" dir="ltr" className={cn('grid grid-cols-6 gap-1.5 sm:gap-3', className)}>
      {chars.map((char, index) => (
        <Input
          key={index}
          ref={(element) => {
            boxes.current[index] = element;
            if (index === 0) inputRef?.(element);
          }}
          id={index === 0 ? id : undefined}
          value={char}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          autoFocus={index === 0}
          disabled={disabled}
          aria-label={index === 0 ? undefined : t('digit', { n: index + 1, total: OTP_LENGTH })}
          aria-invalid={aria['aria-invalid']}
          aria-describedby={aria['aria-describedby']}
          aria-required={aria['aria-required']}
          onChange={(event) => handleChange(index, event.target.value)}
          onPaste={(event) => handlePaste(index, event)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onFocus={(event) => event.target.select()}
          onBlur={index === OTP_LENGTH - 1 ? onBlur : undefined}
          className={cn(
            paperInputClass,
            'min-w-0 px-0 text-center font-mono text-2xl font-semibold',
          )}
        />
      ))}
    </div>
  );
}
