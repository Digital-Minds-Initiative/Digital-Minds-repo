// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MissionNote } from '../mission-note';

describe('MissionNote', () => {
  it('counts ticked items and shows the stamp when all are done', () => {
    render(
      <MissionNote
        title="T"
        items={['a', 'b']}
        done="DONE!"
        progress="{done}/{total}"
        footnote="f"
      />,
    );
    expect(screen.getByText('0/2')).toBeTruthy();
    expect(screen.queryByText('DONE!')).toBeNull();
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    expect(screen.getByText('2/2')).toBeTruthy();
    expect(screen.getByText('DONE!')).toBeTruthy();
  });
});
