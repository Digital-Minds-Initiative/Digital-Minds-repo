'use client';

import { useTranslations } from 'next-intl';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { genderSchema, type Gender } from '@/shared/contracts/core';

/** A Radix select item cannot have an empty value, so "none recorded" has a name of its own. */
export const NO_GENDER = 'none';
export type GenderValue = Gender | typeof NO_GENDER;

export function toGenderValue(gender: Gender | null): GenderValue {
  return gender ?? NO_GENDER;
}

export function fromGenderValue(value: GenderValue): Gender | null {
  return value === NO_GENDER ? null : genderSchema.parse(value);
}

interface GenderSelectProps {
  id?: string;
  value: GenderValue;
  onChange: (value: GenderValue) => void;
  disabled?: boolean;
}

/** The optional «الجنس» field of the add and edit forms: ذكر, أنثى, or غير محدد. */
export function GenderSelect({ id, value, onChange, disabled }: GenderSelectProps) {
  const t = useTranslations('members.gender');
  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next === NO_GENDER ? NO_GENDER : genderSchema.parse(next))}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="h-11">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_GENDER}>{t('unspecified')}</SelectItem>
        <SelectItem value="MALE">{t('MALE')}</SelectItem>
        <SelectItem value="FEMALE">{t('FEMALE')}</SelectItem>
      </SelectContent>
    </Select>
  );
}
