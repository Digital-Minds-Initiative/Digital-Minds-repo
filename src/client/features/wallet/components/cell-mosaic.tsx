import { useId } from 'react';

/**
 * A staircase of square cells in the colours of the badge: the corner cluster of a conference
 * badge, built from the system's cells. A capital letter in `rows` is a solid cell, a small one an
 * outline cell, `.` nothing. One colour code can be perforated (a round hole punched through it).
 */
export function CellMosaic({
  rows,
  palette,
  perforated,
  size = 15,
  className,
}: {
  rows: readonly string[];
  palette: Record<string, string>;
  perforated: string;
  size?: number;
  className?: string;
}) {
  const maskId = useId();
  const width = Math.max(...rows.map((row) => row.length)) * size;
  const height = rows.length * size;
  const cells: Array<{ x: number; y: number; color: string; solid: boolean; punched: boolean }> =
    [];
  rows.forEach((row, y) =>
    [...row].forEach((code, x) => {
      const key = code.toLowerCase();
      const color = palette[key];
      if (code === '.' || color === undefined) return;
      cells.push({ x, y, color, solid: code !== key, punched: code !== key && key === perforated });
    }),
  );

  return (
    <svg
      aria-hidden
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <mask id={maskId}>
        <rect width={width} height={height} fill="#fff" />
        {cells
          .filter((cell) => cell.punched)
          .map((cell) => (
            <circle
              key={`h${cell.x}-${cell.y}`}
              cx={cell.x * size + size / 2}
              cy={cell.y * size + size / 2}
              r={size * 0.17}
              fill="#000"
            />
          ))}
      </mask>
      {cells.map((cell) =>
        cell.solid ? (
          <rect
            key={`${cell.x}-${cell.y}`}
            x={cell.x * size}
            y={cell.y * size}
            width={size}
            height={size}
            rx={size * 0.12}
            fill={cell.color}
            mask={cell.punched ? `url(#${maskId})` : undefined}
          />
        ) : (
          <rect
            key={`${cell.x}-${cell.y}`}
            x={cell.x * size + 1}
            y={cell.y * size + 1}
            width={size - 2}
            height={size - 2}
            rx={size * 0.12}
            fill="none"
            stroke={cell.color}
            strokeWidth={1.4}
          />
        ),
      )}
    </svg>
  );
}
