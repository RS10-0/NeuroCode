import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Clock } from "lucide-react";

import Card from "./ui/Card";
import { fetchFeed, type Notification } from "../features/agents/scheduleApi";

/*
 * The last few things a learner's agents did on their own.
 *
 * The dashboard half of the same feed the bell reads, and it
 * exists for the case the bell does not cover: somebody who has
 * been away for a week and opens the app to see where they were.
 * A badge tells you there is something; this tells you what,
 * without a click.
 *
 * Renders NOTHING when there is nothing. A dashboard card that
 * says "no scheduled runs yet" on every screen for every learner
 * who has never made a schedule is a permanent advertisement,
 * and the empty state that belongs to this feature already lives
 * on the schedule page where somebody can act on it.
 */

const SHOWN = 3;

export default function ScheduleDigest() {
  const [items, setItems] = useState<Notification[]>([]);

  const load = useCallback(async () => {
    try {
      return await fetchFeed();
    } catch {
      /* Silent: the dashboard is not the place to report that a
         background feed could not be reached. */
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;

    void load().then((feed) => {
      if (active && feed) {
        setItems(feed.notifications.slice(0, SHOWN));
      }
    });

    return () => {
      active = false;
    };
  }, [load]);

  if (items.length === 0) {
    return null;
  }

  return (
    <Card>
      <div
        className="row gap-3"
        style={{
          justifyContent: "space-between",
          marginBottom: "var(--space-3)",
        }}
      >
        <span className="meta">from your agents</span>
        <Clock size={13} aria-hidden="true" style={{ color: "var(--ink-muted)" }} />
      </div>

      <ul className="digest">
        {items.map((item) => (
          <li key={item.id} className="digest__item">
            {item.agentId ? (
              <Link to={`/agents/${item.agentId}/schedule`} className="digest__link">
                <strong>{item.title}</strong>
                <span>{item.body}</span>
              </Link>
            ) : (
              <span className="digest__link digest__link--dead">
                <strong>{item.title}</strong>
                <span>{item.body}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
