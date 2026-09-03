import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Bell, Clock, Sparkles } from "lucide-react";

import IconButton from "./ui/IconButton";
import {
  fetchFeed,
  markFeedRead,
  type Notification,
} from "../features/agents/scheduleApi";

/*
 * What the agents did while nobody was looking.
 *
 * The counterpart to the run history on the schedule page, and
 * the reason it exists in the shell rather than only on that
 * page: a scheduled run's whole point is that the learner is not
 * there for it, so the result has to find THEM. A digest that
 * only appears if you remember to go and check is a digest that
 * gets read once.
 *
 * Deliberately quiet. It polls once on mount and again when
 * opened, and never pushes — a badge that appears while somebody
 * is mid-lesson is an interruption, and nothing here is urgent
 * enough to earn one. The email in notify.ts is what carries the
 * things that cannot wait.
 */

/* How often the badge re-checks while the app is open. Two
   minutes: a schedule runs at most every six hours, so anything
   tighter is a request that will almost always find nothing. */
const POLL_MS = 120_000;

function iconFor(kind: Notification["kind"]) {
  switch (kind) {
    case "schedule_disabled":
      return <AlertTriangle size={14} aria-hidden="true" />;
    case "run_failed":
      return <AlertTriangle size={14} aria-hidden="true" />;
    case "limit_advisory":
      return <Clock size={14} aria-hidden="true" />;
    default:
      return <Sparkles size={14} aria-hidden="true" />;
  }
}

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);

  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}

export default function ScheduleFeed() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);

  /*
   * Fetches and returns; sets no state.
   *
   * Kept pure so the mount effect can apply the result in a
   * `.then` rather than synchronously — a setState in an effect
   * body cascades a render on every mount of every screen in the
   * app, which is a poor trade for a badge.
   *
   * Silent on failure. This polls in the background behind every
   * page: a learner mid-essay must not get an error toast because
   * a poll lost its connection. The next one is two minutes away.
   */
  const load = useCallback(async () => {
    try {
      return await fetchFeed();
    } catch {
      return null;
    }
  }, []);

  const apply = useCallback((feed: Awaited<ReturnType<typeof fetchFeed>> | null) => {
    if (!feed) {
      return;
    }

    setItems(feed.notifications);
    setUnread(feed.unread);
  }, []);

  useEffect(() => {
    let active = true;

    const poll = () => {
      void load().then((feed) => {
        if (active) {
          apply(feed);
        }
      });
    };

    poll();

    const timer = setInterval(poll, POLL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [load, apply]);

  /* Close on an outside click or Escape, the way a popover has
     to if it is not to trap somebody on a page they were only
     glancing at. */
  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointer = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onToggle = () => {
    const next = !open;

    setOpen(next);

    if (next) {
      setLoading(true);
      void load().then((feed) => {
        apply(feed);
        setLoading(false);
      });
    }
  };

  const onMarkAll = async () => {
    try {
      const result = await markFeedRead();

      setUnread(result.unread);
      setItems((current) =>
        current.map((item) => ({
          ...item,
          readAt: item.readAt ?? new Date().toISOString(),
        }))
      );
    } catch {
      /* Same reasoning as the load. */
    }
  };

  return (
    <div className="feed" ref={wrapRef}>
      <IconButton
        label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
        icon={<Bell size={16} />}
        size="sm"
        aria-expanded={open}
        onClick={onToggle}
      />

      {unread > 0 ? (
        <span className="feed__badge" aria-hidden="true">
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}

      {open ? (
        <div className="feed__panel" role="dialog" aria-label="Notifications">
          <div className="feed__head">
            <h2 className="feed__title">From your agents</h2>
            {unread > 0 ? (
              <button
                type="button"
                className="feed__mark"
                onClick={() => void onMarkAll()}
              >
                Mark all read
              </button>
            ) : null}
          </div>

          {items.length === 0 ? (
            <p className="feed__empty">
              {loading
                ? "Loading…"
                : "Nothing yet. When one of your agents runs on a schedule, what it found turns up here."}
            </p>
          ) : (
            <ul className="feed__list">
              {items.map((item) => {
                const body = (
                  <>
                    <span className="feed__item-head">
                      <span className={`feed__icon feed__icon--${item.kind}`}>
                        {iconFor(item.kind)}
                      </span>
                      <strong>{item.title}</strong>
                      <span className="feed__when">{ago(item.createdAt)}</span>
                    </span>
                    <span className="feed__body">{item.body}</span>
                  </>
                );

                return (
                  <li
                    key={item.id}
                    className={`feed__item${
                      item.readAt ? "" : " feed__item--unread"
                    }`}
                  >
                    {/*
                     * Clickable only when the schedule it names
                     * still exists. A dead link on the one notice
                     * that matters — "your schedule was switched
                     * off" — would be worse than plain text.
                     */}
                    {item.agentId ? (
                      <Link
                        to={`/agents/${item.agentId}/schedule`}
                        className="feed__link"
                        onClick={() => {
                          setOpen(false);
                          void markFeedRead(item.id).then((result) =>
                            setUnread(result.unread)
                          );
                        }}
                      >
                        {body}
                      </Link>
                    ) : (
                      <span className="feed__link feed__link--dead">{body}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
