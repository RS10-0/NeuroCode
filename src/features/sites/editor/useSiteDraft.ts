import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError } from "../../../lib/api";
import type { ToastTone } from "../../../components/ui";
import {
  checkSlugAvailable,
  fetchSite,
  publishSite,
  removeSite,
  saveSite,
  type SiteState,
} from "../siteApi";
import {
  parseSiteConfig,
  SiteConfigError,
  type SiteConfig,
} from "../schema";
import { canonicalizeSlug, checkSlug, deriveSlug } from "../slug";
import { starterConfig } from "../templates";

/*
 * Everything the Customise screen edits, and the rules about
 * when it may be saved.
 *
 * The draft is a whole `SiteConfig`, not a set of scattered
 * fields, and every control writes into it through `patch`.
 * That is what makes the preview honest — it renders the same
 * object the server will store — and it is the seam Phase 2
 * plugs into: a natural-language edit is one more producer of
 * a `SiteConfig`, validated by the same `parseSiteConfig`
 * everything else here goes through.
 *
 * Two things are derived during render rather than written from
 * inside an effect: whether the draft is dirty, and what is
 * known about the address. Both could have been state kept in
 * step by an effect, and both would then have had a moment
 * where they disagreed with the draft they describe — which for
 * "is this saved?" is the kind of disagreement that loses
 * somebody's work.
 */

export type SavePhase = "idle" | "saving" | "error";

export interface SlugState {
  value: string;
  /* Undefined while a check is in flight or none has run. */
  available?: boolean;
  reason?: string;
  checking: boolean;
}

/*
 * What "unsaved" is measured against.
 *
 * A serialised string rather than a deep comparison, because it
 * is compared on every keystroke and the document is small —
 * the same trade `fingerprint` in features/agents/types.ts
 * makes, for the same reason.
 */
function fingerprint(config: SiteConfig, slug: string): string {
  return JSON.stringify([config, slug]);
}

export interface UseSiteDraftOptions {
  agentId: string;
  agentName: string;
  agentDescription: string;
  onNotify: (message: string, tone?: ToastTone) => void;
}

export function useSiteDraft({
  agentId,
  agentName,
  agentDescription,
  onNotify,
}: UseSiteDraftOptions) {
  const [state, setState] = useState<SiteState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [slug, setSlug] = useState("");

  const [phase, setPhase] = useState<SavePhase>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  /*
   * The last saved shape, in state rather than a ref.
   *
   * `dirty` is computed during render, and reading a ref during
   * render is exactly the thing that makes a component's output
   * depend on something React does not track. It changes twice
   * in a session — on load and on save — so state costs nothing.
   */
  const [savedPrint, setSavedPrint] = useState("");

  /* Bumped by the retry button to re-run the load effect. */
  const [reloadToken, setReloadToken] = useState(0);

  /* ---------------------------------------------------------
     LOAD

     No synchronous writes in the effect body: `loading` already
     starts true, and every other write happens in a callback
     once the request has answered.
     --------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;

    fetchSite(agentId)
      .then((next) => {
        if (cancelled) {
          return;
        }

        /*
         * An agent with no page yet still gets a full draft —
         * the starter for the default template, at the address
         * it would be given. The screen is therefore editable
         * before anything has been published, which is the
         * order a student works in: look at it, change it, then
         * decide to put it up.
         */
        const draft =
          next.site?.config ??
          starterConfig({
            agentName,
            description: agentDescription,
            template: "assistant",
          });

        const address = next.site?.slug ?? next.suggestedSlug;

        setState(next);
        setConfig(draft);
        setSlug(address);
        setSavedPrint(fingerprint(draft, address));
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof ApiError
              ? error.message
              : "Could not load this agent's page."
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [agentId, agentName, agentDescription, reloadToken]);

  /* An event handler, so writing state synchronously here is
     the ordinary case rather than a cascading render. */
  const reload = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    setReloadToken((token) => token + 1);
  }, []);

  /* ---------------------------------------------------------
     EDIT
     --------------------------------------------------------- */

  /*
   * The single write path.
   *
   * Every control funnels through here rather than calling
   * `setConfig` itself, so there is one place that knows how a
   * change is applied — and one place for Phase 2 to reuse when
   * it turns a sentence into a field change.
   */
  const patch = useCallback(
    (
      change:
        | Partial<SiteConfig>
        | ((current: SiteConfig) => Partial<SiteConfig>)
    ) => {
      setConfig((current) => {
        if (!current) {
          return current;
        }

        const delta = typeof change === "function" ? change(current) : change;

        return { ...current, ...delta };
      });
    },
    []
  );

  /*
   * The whole document at once.
   *
   * `patch` is a shallow merge and cannot express "this is the
   * new page", which is exactly what a natural-language edit
   * and its undo both are. Separate from `patch` rather than
   * folded into it, so the two intents stay distinguishable at
   * every call site.
   */
  const replace = useCallback((next: SiteConfig) => {
    setConfig(next);
  }, []);

  /*
   * What the server would say about this draft, computed on
   * every change.
   *
   * The form's own `maxLength` attributes come from the same
   * LIMITS object, so in practice this stays null — it is the
   * backstop for the paths that do not go through an input at
   * all, which today means switching templates and tomorrow
   * means a Phase 2 patch.
   */
  const configError = useMemo(() => {
    if (!config) {
      return null;
    }

    try {
      parseSiteConfig(config);
      return null;
    } catch (error) {
      return error instanceof SiteConfigError
        ? { path: error.path, message: error.message }
        : { path: "config", message: "This page cannot be saved as it is." };
    }
  }, [config]);

  const slugProblem = useMemo(() => checkSlug(slug), [slug]);

  const dirty = config ? fingerprint(config, slug) !== savedPrint : false;

  /* ---------------------------------------------------------
     ADDRESS AVAILABILITY

     The server is only asked about addresses that could
     actually be free: the shape rules run here first, and an
     address unchanged from the published one is not a question
     at all.

     The answer carries the address it answers, so a reply that
     arrives after the student has typed on is identifiable as
     stale during render rather than needing to be cleared from
     inside the effect.
     --------------------------------------------------------- */

  const [slugAnswer, setSlugAnswer] = useState<{
    slug: string;
    available: boolean;
    reason?: string;
  } | null>(null);

  const clean = canonicalizeSlug(slug);
  const unchanged = Boolean(state?.site && clean === state.site.slug);
  const askable = slugProblem.ok && !unchanged && clean.length > 0;

  useEffect(() => {
    if (!askable) {
      return;
    }

    const controller = new AbortController();

    /* Debounced, so typing an address is one request when the
       typing stops rather than one per character. */
    const timer = window.setTimeout(() => {
      checkSlugAvailable(agentId, clean, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setSlugAnswer({
              slug: clean,
              available: result.available,
              reason: result.reason,
            });
          }
        })
        .catch(() => {
          /* A failed check must not read as "taken" — that would
             block a student on a network blip. Leaving the
             answer absent keeps the field in its "checking"
             state, and the Save attempt is the authority
             anyway. */
        });
    }, 350);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [agentId, clean, askable]);

  const slugCheck: SlugState = !clean
    ? { value: clean, checking: false }
    : !slugProblem.ok
      ? { value: clean, available: false, checking: false }
      : unchanged
        ? { value: clean, available: true, checking: false }
        : slugAnswer?.slug === clean
          ? {
              value: clean,
              available: slugAnswer.available,
              reason: slugAnswer.reason,
              checking: false,
            }
          : { value: clean, checking: true };

  /* ---------------------------------------------------------
     SAVE
     --------------------------------------------------------- */

  const canSave =
    Boolean(config) &&
    !configError &&
    slugProblem.ok &&
    slugCheck.available !== false &&
    phase !== "saving";

  const save = useCallback(async () => {
    if (!config || !canSave) {
      return;
    }

    setPhase("saving");
    setSaveError(null);

    const address = canonicalizeSlug(slug);
    const first = !state?.site;

    try {
      const result = first
        ? await publishSite(agentId, { config, slug: address })
        : await saveSite(agentId, { config, slug: address });

      /*
       * The server's version wins.
       *
       * It may have resolved a collision and given a different
       * address than the one asked for, and showing the student
       * the address they typed rather than the one they got
       * would be showing them a URL that does not work.
       */
      setState((current) =>
        current ? { ...current, site: result.site } : current
      );
      setConfig(result.site.config);
      setSlug(result.site.slug);
      setSavedPrint(fingerprint(result.site.config, result.site.slug));

      setPhase("idle");
      onNotify(first ? "Page published." : "Page updated.", "correct");
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not save this page. Try again.";

      setPhase("error");
      setSaveError(message);
      onNotify(message, "error");
    }
  }, [agentId, canSave, config, onNotify, slug, state?.site]);

  const setPublished = useCallback(
    async (published: boolean) => {
      if (!state?.site) {
        return;
      }

      try {
        const result = await saveSite(agentId, { published });

        setState((current) =>
          current ? { ...current, site: result.site } : current
        );

        onNotify(
          published
            ? "Page is live again."
            : "Page hidden. Your address is still yours.",
          published ? "correct" : "info"
        );
      } catch (error) {
        onNotify(
          error instanceof ApiError ? error.message : "Could not change this.",
          "error"
        );
      }
    },
    [agentId, onNotify, state?.site]
  );

  const takeDown = useCallback(async () => {
    if (!state?.site) {
      return;
    }

    try {
      await removeSite(agentId);
      onNotify("Page taken down.", "info");
      reload();
    } catch (error) {
      onNotify(
        error instanceof ApiError
          ? error.message
          : "Could not take the page down.",
        "error"
      );
    }
  }, [agentId, onNotify, reload, state?.site]);

  /*
   * Switching template is a content operation, not a theme one.
   *
   * It swaps the layout AND the palette that layout was
   * designed against — otherwise every template would open
   * looking like the last one, which is the exact impression
   * these are meant not to give. What it never touches is the
   * student's own writing: the hero, the sections and the chat
   * settings come across untouched, so trying a template and
   * going back costs nothing.
   */
  const useTemplate = useCallback(
    (template: SiteConfig["template"]) => {
      setConfig((current) => {
        if (!current) {
          return current;
        }

        const starter = starterConfig({
          agentName,
          description: agentDescription,
          template,
        });

        return { ...current, template, theme: starter.theme };
      });
    },
    [agentName, agentDescription]
  );

  const suggestFromName = useCallback(() => {
    setSlug(deriveSlug(agentName));
  }, [agentName]);

  return {
    loading,
    loadError,
    state,
    config,
    slug,
    setSlug,
    suggestFromName,
    slugCheck,
    slugProblem,
    patch,
    replace,
    useTemplate,
    configError,
    dirty,
    canSave,
    phase,
    saveError,
    save,
    setPublished,
    takeDown,
    reload,
  };
}
