import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";

import { useAuth } from "../auth/useAuth";
import { getUserStats } from "../lib/progress";
import type { UserStats } from "../lib/progress";
import { Avatar, Button, Card, Skeleton } from "../components/ui";

export default function Profile() {
  const { user, logout } = useAuth();

  const [stats, setStats] = useState<UserStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    getUserStats()
      .then((value) => {
        if (active) {
          setStats(value);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Couldn't load your stats."
          );
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const displayName = user?.username || user?.email || "Learner";

  /* XP per level is fixed at 500 in the progress layer. */
  const levelFloor = ((stats?.level ?? 1) - 1) * 500;
  const intoLevel = (stats?.xp ?? 0) - levelFloor;

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">Your profile</h1>
      </header>

      <div className="stack gap-5" style={{ maxWidth: "var(--measure-wide)" }}>
        <Card>
          <div className="row gap-4">
            <Avatar name={displayName} size="lg" />

            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: "var(--text-lg)",
                  fontWeight: "var(--weight-medium)",
                  color: "var(--ink)",
                }}
              >
                {displayName}
              </div>
              <div className="meta">{user?.email}</div>
            </div>

            <Button
              variant="secondary"
              icon={<LogOut size={15} />}
              onClick={() => {
                void logout();
              }}
            >
              Sign out
            </Button>
          </div>
        </Card>

        {error ? (
          <Card>
            <p className="prose">{error}</p>
          </Card>
        ) : null}

        <div className="stat-grid">
          {isLoading ? (
            <>
              <Skeleton height="76px" />
              <Skeleton height="76px" />
              <Skeleton height="76px" />
              <Skeleton height="76px" />
            </>
          ) : (
            <>
              <div className="stat">
                <div className="stat__value">{stats?.level ?? 1}</div>
                <div className="stat__label">
                  Level · {intoLevel} / 500 xp to next
                </div>
              </div>
              <div className="stat">
                <div className="stat__value">
                  {(stats?.xp ?? 0).toLocaleString()}
                </div>
                <div className="stat__label">Total XP</div>
              </div>
              <div className="stat">
                <div className="stat__value">
                  {stats?.total_lessons_completed ?? 0}
                </div>
                <div className="stat__label">Lessons completed</div>
              </div>
              <div className="stat">
                <div className="stat__value">{stats?.longest_streak ?? 0}</div>
                <div className="stat__label">Longest streak</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
