import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { inr } from "../format";

const shortTime = (t) =>
  new Date(t).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const toPoints = (history) =>
  history.map((h) => ({
    t: new Date(h.scraped_at).getTime(),
    price: h.price,
    mrp: h.mrp,
    stock: h.stock_qty
  }));

const axis = { fontSize: 12, stroke: "#94a3b8" };

export function PriceChart({ history }) {
  const data = toPoints(history);
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0f766e" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#0f766e" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#ece9e1" />
        <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={shortTime} {...axis} />
        <YAxis domain={["auto", "auto"]} tickFormatter={(v) => `₹${v.toLocaleString("en-IN")}`} width={78} {...axis} />
        <Tooltip labelFormatter={shortTime} formatter={(v, name) => [inr(v), name]} />
        <Legend />
        <Area type="monotone" dataKey="price" name="Price" stroke="#0f766e" strokeWidth={2.5} fill="url(#priceFill)" dot={{ r: 3 }} isAnimationActive={false} />
        <Line type="monotone" dataKey="mrp" name="MRP" stroke="#94a3b8" strokeDasharray="5 4" dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function StockChart({ history }) {
  const data = toPoints(history).filter((p) => p.stock != null);
  if (!data.length) return <p className="muted">No stock quantity recorded yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="stockFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d97706" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#d97706" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#ece9e1" />
        <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={shortTime} {...axis} />
        <YAxis allowDecimals={false} width={78} {...axis} />
        <Tooltip labelFormatter={shortTime} formatter={(v) => [v, "Units in stock"]} />
        <Area type="stepAfter" dataKey="stock" name="Units in stock" stroke="#d97706" strokeWidth={2} fill="url(#stockFill)" dot={{ r: 3 }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
