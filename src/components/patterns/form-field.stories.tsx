import { zodResolver } from '@hookform/resolvers/zod';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useForm } from 'react-hook-form';
import { type z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { newPersonSchema, newProfileSchema } from '@/modules/members/contracts';

import { FormField } from './form-field';

// The form validates with the SAME contract the API uses.
const schema = newPersonSchema.extend(newProfileSchema.pick({ phone: true }).shape);
type FormValues = z.input<typeof schema>;

function PersonForm() {
  const form = useForm<FormValues, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: '', uniEmail: '', phone: '' },
  });
  return (
    <form className="grid max-w-md gap-4" noValidate onSubmit={form.handleSubmit(() => undefined)}>
      <FormField
        control={form.control}
        name="fullName"
        label="الاسم الكامل"
        required
        render={({ field, controlProps }) => <Input {...field} {...controlProps} />}
      />
      <FormField
        control={form.control}
        name="uniEmail"
        label="البريد الجامعي"
        description="مثال: s443001102@st.uqu.edu.sa"
        required
        render={({ field, controlProps }) => (
          <Input type="email" dir="ltr" {...field} {...controlProps} />
        )}
      />
      <FormField
        control={form.control}
        name="phone"
        label="رقم الجوال"
        render={({ field, controlProps }) => (
          <Input type="tel" dir="ltr" {...field} value={field.value ?? ''} {...controlProps} />
        )}
      />
      <Button type="submit" className="justify-self-start">
        حفظ
      </Button>
    </form>
  );
}

const meta = {
  title: 'Patterns/FormField',
  component: PersonForm,
} satisfies Meta<typeof PersonForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Submit empty to see translated validation messages. */
export const WithValidation: Story = {};
