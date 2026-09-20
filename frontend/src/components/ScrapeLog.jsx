import { Fragment, useState } from "react";
import Badge from "./Badge";
import { dateTime, inr, seconds } from "../format";

const TRIGGERS = { scheduled: "Scheduled", manual: "Manual", auto: "Auto-refresh", first: "First scrape" };

export default function ScrapeLog({ logs }) {
  const [open, setOpen] = useState(null);

  if (!logs.length) return <p className="muted">No scrapes yet.</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Trigger</th>
            <th>Outcome</th>
            <th>Attempts</th>
            <th>Duration</th>
            <th>Price</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <Fragment key={l.id}>
              <tr className="clickable" onClick={() => setOpen(open === l.id ? null : l.id)}>
                <td>{dateTime(l.started_at)}</td>
                <td>{TRIGGERS[l.trigger] || "—"}</td>
                <td>
                  <Badge outcome={l.outcome} />
                </td>
                <td>{l.attempts}</td>
                <td>{seconds(l.duration_ms)}</td>
                <td>{l.price != null ? inr(l.price) : "—"}</td>
                <td className="detail-cell">{l.error_message || (l.outcome === "retried" ? "Succeeded after a retry" : "OK")}</td>
              </tr>
              {open === l.id && (
                <tr className="attempts-row">
                  <td colSpan={7}>
                    <strong>Every attempt in this run</strong>
                    <ol>
                      {(l.attempt_log || []).map((a) => (
                        <li key={a.attempt}>
                          Attempt {a.attempt}: <span className={`txt-${a.outcome}`}>{a.outcome}</span> in {seconds(a.ms)}
                          {a.error ? ` — ${a.error}` : ""}
                        </li>
                      ))}
                    </ol>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}