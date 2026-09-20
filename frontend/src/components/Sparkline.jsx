// Small inline trend line (no chart library needed). Green = price fell, red = price rose.
export default function Sparkline({ values, tone, width = 132, height = 40 }) {
  if (!values || values.length < 2) return <div className="spark spark-empty">Trend appears after 2 scrapes</div>;

  const pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((v, i) => [
    pad + (i * (width - 2 * pad)) / (values.length - 1),
    pad + (height - 2 * pad) * (1 - (v - min) / span)
  ]);
  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const area = `${line} L${last[0].toFixed(1)},${height} L${points[0][0].toFixed(1)},${height} Z`;
  // colour follows the latest movement (same as the label next to it); default: overall direction
  const dir = tone || (values[values.length - 1] <= values[0] ? "down" : "up");

  return (
    <svg className={`spark spark-${dir}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Recent price trend">
      <path d={area} className="spark-area" />
      <path d={line} className="spark-line" fill="none" />
      <circle cx={last[0]} cy={last[1]} r="2.8" className="spark-dot" />
    </svg>
  );
}
