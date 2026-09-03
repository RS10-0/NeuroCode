import { Check, Copy, ExternalLink, Loader, Sparkles, X } from "lucide-react";
import { useState } from "react";

import {
  Badge,
  Button,
  Callout,
  Field,
  Input,
} from "../../../components/ui";
import type { SiteLimits, SiteRecord, SiteUsage } from "../siteApi";
import type { SlugState } from "./useSiteDraft";
import { canonicalizeSlug, SLUG_MAX_LENGTH, type SlugCheck } from "../slug";

/*
 * The address, and what having one costs.
 *
 * Two things share this panel because a student should be
 * deciding both at once: this is the URL you are about to hand
 * out, and this is what happens to your allowance when people
 * follow it. Splitting them would put the second across a tab
 * boundary from the moment it is relevant.
 */

export interface AddressControlsProps {
  siteBase: string;
  slug: string;
  onSlug: (slug: string) => void;
  onSuggest: () => void;
  check: SlugState;
  problem: SlugCheck;
  site: SiteRecord | null;
  usage: SiteUsage | null;
  limits: SiteLimits;
  onPublishedChange: (published: boolean) => void;
  onTakeDown: () => void;
}

export default function AddressControls({
  siteBase,
  slug,
  onSlug,
  onSuggest,
  check,
  problem,
  site,
  usage,
  limits,
  onPublishedChange,
  onTakeDown,
}: AddressControlsProps) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const clean = canonicalizeSlug(slug);
  const preview = `${siteBase.replace(/^https?:\/\//, "")}/${clean || "…"}`;

  const copy = async () => {
    if (!site) {
      return;
    }

    try {
      await navigator.clipboard.writeText(site.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Clipboard refused — an insecure context, or a browser
         that asks. The URL is on screen and selectable, so
         there is nothing to recover from. */
    }
  };

  /*
   * One line, in this order: the shape of the address is wrong,
   * or somebody holds it, or it is free. Showing more than one
   * at a time would be showing a student a problem they have
   * already fixed.
   */
  const status = !clean
    ? null
    : !problem.ok
      ? { tone: "error" as const, text: problem.message ?? "" }
      : check.checking
        ? { tone: "muted" as const, text: "Checking…" }
        : check.available === false
          ? { tone: "error" as const, text: check.reason ?? "That address is taken." }
          : check.available
            ? { tone: "ok" as const, text: "Available" }
            : null;

  return (
    <div className="siteedit__stack">
      <section className="siteedit__group">
        <h3 className="siteedit__grouptitle">Address</h3>

        <Field
          label="Your page lives at"
          hint={
            <>
              Lowercase letters, numbers and hyphens. Up to {SLUG_MAX_LENGTH}{" "}
              characters.
            </>
          }
          error={status?.tone === "error" ? status.text : undefined}
        >
          {({ id, describedBy }) => (
            <div className="siteedit__slugrow">
              <span className="siteedit__slugbase">
                {siteBase.replace(/^https?:\/\//, "")}/
              </span>

              <Input
                id={id}
                aria-describedby={describedBy}
                className="siteedit__sluginput"
                value={slug}
                maxLength={SLUG_MAX_LENGTH}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                invalid={status?.tone === "error"}
                placeholder="studybuddy"
                /*
                 * Lowercased as it is typed rather than on blur.
                 * A student who types "StudyBuddy" and watches it
                 * become "studybuddy" has learned the rule; one
                 * who is told about it in an error message after
                 * pressing Save has been told off.
                 */
                onChange={(event) => onSlug(canonicalizeSlug(event.target.value))}
              />
            </div>
          )}
        </Field>

        <div className="siteedit__slugstatus">
          {status?.tone === "ok" ? (
            <span className="siteedit__slugok">
              <Check size={14} strokeWidth={2.5} aria-hidden="true" />
              {status.text}
            </span>
          ) : null}

          {status?.tone === "muted" ? (
            <span className="siteedit__slugmuted">
              <Loader size={14} strokeWidth={2} aria-hidden="true" />
              {status.text}
            </span>
          ) : null}

          <Button
            size="sm"
            variant="ghost"
            icon={<Sparkles size={14} strokeWidth={2} />}
            onClick={onSuggest}
          >
            Use the agent's name
          </Button>
        </div>

        {site && clean !== site.slug ? (
          <Callout tone="caution" title="This changes your link">
            Your page is at <code>{site.slug}</code> now. Saving moves it to{" "}
            <code>{clean}</code>, and anybody holding the old link will get a
            404. The old address goes back in the pool for someone else.
          </Callout>
        ) : null}

        {!site ? (
          <p className="siteedit__grouphint">
            Nothing is published yet — <code>{preview}</code> is what you will
            get when you publish.
          </p>
        ) : null}
      </section>

      {site ? (
        <section className="siteedit__group">
          <h3 className="siteedit__grouptitle">
            Live page{" "}
            <Badge tone={site.published ? "correct" : "neutral"}>
              {site.published ? "Public" : "Hidden"}
            </Badge>
          </h3>

          <div className="siteedit__urlrow">
            <a
              className="siteedit__url"
              href={site.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              {site.url}
              <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
            </a>

            <Button
              size="sm"
              icon={
                copied ? (
                  <Check size={14} strokeWidth={2.5} />
                ) : (
                  <Copy size={14} strokeWidth={2} />
                )
              }
              onClick={copy}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>

          <div className="siteedit__switchrow">
            <Button
              size="sm"
              variant={site.published ? "secondary" : "primary"}
              onClick={() => onPublishedChange(!site.published)}
            >
              {site.published ? "Hide this page" : "Make it public again"}
            </Button>

            <span className="siteedit__grouphint">
              Hiding keeps your address and everything on the page. Only
              visitors are turned away.
            </span>
          </div>
        </section>
      ) : null}

      {usage ? (
        <section className="siteedit__group">
          <h3 className="siteedit__grouptitle">Activity</h3>

          <dl className="siteedit__stats">
            <div>
              <dt>Conversations today</dt>
              <dd>{usage.visitsDay}</dd>
            </div>
            <div>
              <dt>Messages today</dt>
              <dd>
                {usage.requestsDay}
                <span className="siteedit__statcap">
                  {" "}
                  / {limits.requestsPerDay}
                </span>
              </dd>
            </div>
            <div>
              <dt>Messages all time</dt>
              <dd>{usage.requestsTotal}</dd>
            </div>
            <div>
              <dt>Tokens today</dt>
              <dd>{usage.tokensDay.toLocaleString()}</dd>
            </div>
          </dl>

          <Callout tone="info" title="Visitors spend your allowance">
            Every answer on your public page is a call you pay for, exactly
            like testing the agent yourself. This page is capped at{" "}
            {limits.requestsPerDay} messages a day and{" "}
            {limits.visitorRequestsPerMinute} a minute per visitor, so a link
            that travels further than you expected slows down rather than
            emptying your account.
          </Callout>
        </section>
      ) : null}

      {site ? (
        <section className="siteedit__group siteedit__group--danger">
          <h3 className="siteedit__grouptitle">Take it down</h3>

          {confirming ? (
            <Callout tone="error" title="Give up this address?">
              <p>
                <code>{site.slug}</code> goes back in the pool and somebody
                else can claim it. Everything on the page is deleted. If you
                only want it out of sight, hide it instead.
              </p>

              <div className="siteedit__confirm">
                <Button size="sm" variant="danger" onClick={onTakeDown}>
                  Delete this page
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  icon={<X size={14} strokeWidth={2} />}
                  onClick={() => setConfirming(false)}
                >
                  Keep it
                </Button>
              </div>
            </Callout>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              Delete this page
            </Button>
          )}
        </section>
      ) : null}
    </div>
  );
}
