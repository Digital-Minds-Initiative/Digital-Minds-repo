// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@tests/utils/render';

import { OtpInput } from '../otp-input';

function Harness({ onValue }: { onValue: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <OtpInput
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
    />
  );
}

function setup() {
  let latest = '';
  const user = userEvent.setup();
  renderWithProviders(<Harness onValue={(value) => (latest = value)} />);
  const boxes = screen.getAllByRole('textbox') as HTMLInputElement[];
  return { user, boxes, value: () => latest };
}

describe('OtpInput', () => {
  it('has six single-digit boxes', () => {
    const { boxes } = setup();
    expect(boxes).toHaveLength(6);
  });

  it('moves forward as digits are typed', async () => {
    const { user, boxes, value } = setup();
    await user.click(boxes[0] as HTMLInputElement);
    await user.keyboard('1234');
    expect(boxes.map((box) => box.value).join('')).toBe('1234');
    expect(value()).toBe('1234');
    expect(document.activeElement).toBe(boxes[4]);
  });

  it('fills every box when a whole code is pasted', async () => {
    const { user, boxes, value } = setup();
    await user.click(boxes[0] as HTMLInputElement);
    await user.paste('482915');
    expect(boxes.map((box) => box.value)).toEqual(['4', '8', '2', '9', '1', '5']);
    expect(value()).toBe('482915');
  });

  it('accepts a pasted code with spaces and Arabic-Indic digits', async () => {
    const { user, boxes, value } = setup();
    await user.click(boxes[0] as HTMLInputElement);
    await user.paste('١٢٣ ٤٥٦');
    expect(value()).toBe('123456');
    expect(boxes.map((box) => box.value).join('')).toBe('123456');
  });

  it('replaces the whole code when a full code is pasted into a later box', async () => {
    const { user, boxes, value } = setup();
    await user.click(boxes[3] as HTMLInputElement);
    await user.paste('654321');
    expect(value()).toBe('654321');
  });

  it('goes back and clears on Backspace from an empty box', async () => {
    const { user, boxes, value } = setup();
    await user.click(boxes[0] as HTMLInputElement);
    await user.keyboard('12');
    // Now in box 3 (empty): Backspace clears box 2 and moves to it.
    await user.keyboard('{Backspace}');
    expect(value()).toBe('1');
    expect(document.activeElement).toBe(boxes[1]);
  });

  it('keeps a gap as a gap, so an incomplete code stays incomplete', async () => {
    const { user, boxes, value } = setup();
    await user.click(boxes[0] as HTMLInputElement);
    await user.keyboard('1234');
    await user.click(boxes[1] as HTMLInputElement);
    await user.keyboard('{Backspace}');
    expect(boxes.map((box) => box.value)).toEqual(['1', '', '3', '4', '', '']);
    expect(value()).toBe('1 34');
  });

  it('ignores letters', async () => {
    const { user, boxes, value } = setup();
    await user.click(boxes[0] as HTMLInputElement);
    await user.keyboard('a1b2');
    expect(value()).toBe('12');
    expect(boxes.map((box) => box.value).join('')).toBe('12');
  });
});
