import type { Meta, StoryObj } from '@storybook/nextjs-vite';

/*
 * Semantic tokens as they resolve in the current theme. Switch light/dark in the toolbar to review
 * a theme; components only ever use these (never the --palette-* primitives).
 */

const GROUPS: Record<string, string[]> = {
  Surfaces: [
    'bg',
    'surface-1',
    'surface-2',
    'surface-3',
    'overlay',
    'border',
    'border-strong',
    'input',
  ],
  Text: ['fg', 'fg-muted', 'fg-subtle', 'fg-inverse'],
  Brand: ['primary', 'primary-hover', 'primary-fg', 'primary-subtle', 'primary-subtle-fg', 'ring'],
  Status: [
    'danger',
    'danger-subtle',
    'success',
    'success-subtle',
    'warning',
    'warning-subtle',
    'info',
    'info-subtle',
  ],
};

function Tokens() {
  return (
    <div className="grid gap-8">
      {Object.entries(GROUPS).map(([group, names]) => (
        <section key={group} className="grid gap-3">
          <h2 className="text-lg font-semibold">{group}</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {names.map((name) => (
              <div key={name} className="overflow-hidden rounded-lg border border-border">
                <div className="h-14" style={{ background: `var(--color-${name})` }} />
                <code dir="ltr" className="block bg-surface-1 px-2 py-1 text-xs">
                  --color-{name}
                </code>
              </div>
            ))}
          </div>
        </section>
      ))}
      <section className="grid gap-2">
        <h2 className="text-lg font-semibold">Type scale</h2>
        {(
          ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl', 'text-3xl'] as const
        ).map((size) => (
          <p key={size} className={size}>
            <code dir="ltr" className="me-3 text-xs text-fg-muted">
              {size}
            </code>
            العقول الرقمية — منصة الأندية التقنية
          </p>
        ))}
      </section>
    </div>
  );
}

const meta = {
  title: 'Foundations/Tokens',
  component: Tokens,
} satisfies Meta<typeof Tokens>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SemanticTokens: Story = {};
