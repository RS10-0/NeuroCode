import type { AiDoneInfo, AiError } from "../../lib/aiClient";

/*
 * The Lab's teaching copy, kept in one file.
 *
 * A playground that only runs prompts teaches nothing that a
 * chat window does not. What makes this a lab is that every
 * control says what it does to the model, and every outcome —
 * including every failure — says what actually happened and what
 * the learner can do next.
 *
 * So the explanations live here rather than inline in JSX: they
 * are content, they get edited far more often than the layout
 * does, and several of them are needed in two places at once.
 */

/* =========================================================
   TEMPERATURE
========================================================= */

/*
 * What a temperature value means, in words.
 *
 * Bands rather than a formula, because the useful thing to
 * understand first is that the number selects a behaviour, not
 * that it scales a distribution. Each band says what to expect
 * from the SAME prompt run twice, which is the observation the
 * Lab makes it possible to check.
 */
export function describeTemperature(value: number): {
  name: string;
  detail: string;
} {
  if (value <= 0.15) {
    return {
      name: "Near-deterministic",
      detail:
        "The model takes its highest-scoring next token almost every time. Run the same prompt twice and you should get near-identical answers. Best for extraction, classification and anything you need to be repeatable.",
    };
  }

  if (value <= 0.5) {
    return {
      name: "Focused",
      detail:
        "Mostly the likeliest wording, with a little room to move. Answers stay on-topic and phrasing varies only slightly between runs.",
    };
  }

  if (value <= 0.9) {
    return {
      name: "Balanced",
      detail:
        "The usual default. Enough variation to sound natural, not so much that the model wanders off the question.",
    };
  }

  if (value <= 1.3) {
    return {
      name: "Exploratory",
      detail:
        "Lower-probability tokens get a real chance. Useful for brainstorming and alternative phrasings; expect two runs to differ noticeably.",
    };
  }

  return {
    name: "Erratic",
    detail:
      "Unlikely tokens are now plausible choices. Output can drift, repeat, or stop making sense — which is worth seeing at least once, so you know what it looks like.",
  };
}

/* =========================================================
   PARAMETERS
========================================================= */

export interface ParameterNote {
  title: string;
  body: string;
}

/*
 * One note per generation parameter the runtime supports.
 *
 * Only three, and deliberately so — these are the parameters
 * the runtime validates and passes on. Showing a top-p slider
 * that nothing reads would teach the wrong thing about how a
 * request reaches a provider.
 */
export const PARAMETER_NOTES: Record<
  "temperature" | "maxOutputTokens" | "stop",
  ParameterNote
> = {
  temperature: {
    title: "Temperature",
    body: "How much randomness the model is allowed when it picks each next token. It does not make the model smarter or more accurate — only more or less predictable.",
  },
  maxOutputTokens: {
    title: "Max output tokens",
    body: "A hard ceiling on the answer's length. The model is not told to be brief; it is cut off. If a run finishes for the reason “length”, this is why — raise the cap or ask for a shorter answer.",
  },
  stop: {
    title: "Stop sequences",
    body: "Text that ends the response the moment it appears. The sequence itself is not included in the output. Useful for keeping a model inside a format; easy to over-tighten into an empty answer.",
  },
};

/* =========================================================
   FINISH REASONS
========================================================= */

export function describeFinishReason(reason: AiDoneInfo["finishReason"]): {
  label: string;
  tone: "correct" | "caution" | "error";
  detail: string;
} {
  switch (reason) {
    case "stop":
      return {
        label: "Finished",
        tone: "correct",
        detail: "The model decided it had finished answering.",
      };

    case "length":
      return {
        label: "Hit the token cap",
        tone: "caution",
        detail:
          "The answer was cut off at your max output tokens, not ended by the model. Raise the cap to see the rest.",
      };

    case "filtered":
      return {
        label: "Filtered",
        tone: "caution",
        detail:
          "The provider's safety filter stopped this response. Rewording the prompt usually resolves it.",
      };

    case "cancelled":
      return {
        label: "Stopped",
        tone: "caution",
        detail: "You stopped this run. Generation on the provider was aborted.",
      };

    default:
      return {
        label: "Ended in error",
        tone: "error",
        detail: "The provider stopped without completing the answer.",
      };
  }
}

/* =========================================================
   ERRORS
========================================================= */

/*
 * What the learner should be told, and what they can do about
 * it.
 *
 * The division of labour matters here, and getting it wrong is
 * easy. The runtime already writes a specific, safe,
 * learner-facing sentence for every failure — "Your OpenRouter
 * account is out of credit", not "HTTP 402" — and the panel
 * always shows that sentence. What this function adds is a
 * heading, a next step, and the context the server has no reason
 * to know.
 *
 * It must never REPLACE the server's message with a generic one.
 * An earlier version did, and turned "your account is out of
 * credit, add some" into "the provider is having trouble, try
 * again in a moment" — which is both less useful and, in that
 * case, simply false.
 *
 * So `body` is additional context and may be empty when the
 * server's own message already says everything worth saying.
 *
 * `action` is a request to the page, not a handler: the Lab owns
 * the retry, and this file should not need to know it exists.
 */
export interface ErrorGuidance {
  title: string;
  /* Context ADDED to the runtime's message, never a replacement
     for it. Empty when there is nothing useful to add. */
  body: string;
  tone: "caution" | "error";
  action?: "retry" | "sign-in";
  /* True when the run is worth attempting again unchanged. */
  retryable: boolean;
}

export function explainError(error: AiError): ErrorGuidance {
  switch (error.code) {
    /* ----- limits the learner hit ----- */

    case "rate_limited":
      return {
        title: "Slow down for a moment",
        body: error.retryAfterSeconds
          ? `You have sent a lot of requests in a short time. Try again in about ${error.retryAfterSeconds} seconds.`
          : "You have sent a lot of requests in a short time. Wait a few seconds and try again.",
        tone: "caution",
        action: "retry",
        retryable: true,
      };

    case "quota_exceeded":
      return {
        title: "Today's request allowance is spent",
        body: "You have used every AI request BuildGentic allows you today. It refills over the next 24 hours — and finishing a lesson earns you more.",
        tone: "caution",
        retryable: false,
      };

    case "out_of_xp":
      return {
        /*
         * Deliberately not phrased as a telling-off, and
         * deliberately not a dead end. This is the one allowance
         * refusal a learner can do something about today, so the
         * body has to lead with that rather than with "come back
         * tomorrow".
         */
        title: "You are out of XP for today",
        body: "Your XP refills every day — and finishing a lesson earns more straight away, so you do not have to wait.",
        tone: "caution",
        retryable: false,
      };

    case "token_quota_exceeded":
      return {
        title: "Today's token allowance is spent",
        body: "Tokens, not requests, are what BuildGentic budgets — a few very long runs can spend the day's allowance faster than many short ones. It refills over the next 24 hours.",
        tone: "caution",
        retryable: false,
      };

    case "too_many_concurrent":
      return {
        title: "Too many runs at once",
        body: "Another run of yours is still going. Wait for it to finish, or stop it, then try again.",
        tone: "caution",
        action: "retry",
        retryable: true,
      };

    /* ----- BuildGentic's own budget, not the learner's ----- */

    case "platform_budget_exceeded":
      return {
        title: "BuildGentic's shared AI budget is spent",
        body: "This is BuildGentic's own ceiling across every learner, not your personal allowance — so waiting for your own limit to reset will not help. It resets tomorrow.",
        tone: "caution",
        retryable: false,
      };

    /* ----- configuration ----- */

    case "provider_not_configured":
      return {
        title: "AI is not configured on this server",
        body: "BuildGentic's own AI credentials are missing or were rejected. This is a problem with the server, not with anything you did.",
        tone: "error",
        retryable: false,
      };

    /* ----- the request itself ----- */

    case "invalid_request":
      return {
        title: "The runtime refused this request",
        body: "",
        tone: "error",
        retryable: false,
      };

    case "model_not_allowed":
      return {
        title: "That model is not available to you",
        body: "",
        tone: "error",
        retryable: false,
      };

    /* ----- the provider ----- */

    case "provider_rejected":
      return {
        title: "The provider refused the prompt",
        body: "The model understood the request and chose not to answer it. Rewording usually resolves this.",
        tone: "caution",
        retryable: false,
      };

    case "empty_response":
      return {
        title: "The model returned nothing",
        body: "A run can come back empty when a stop sequence matches immediately, when the whole output budget is spent before any text is produced, or when the prompt is filtered. Loosen the stop sequences or raise the token cap.",
        tone: "caution",
        action: "retry",
        retryable: true,
      };

    case "provider_unavailable":
    case "provider_malformed_response":
      return {
        title: "The provider could not answer",
        /*
         * No "try again in a moment" here. This code covers both
         * a transient 503 and an account that has run out of
         * credit, and the runtime's own message is the only one
         * that knows which — so the advice has to come from
         * there, and this line only says where the fault lies.
         */
        body: "This came back from the model's own service rather than from anything in your prompt.",
        tone: "error",
        action: "retry",
        retryable: true,
      };

    case "timeout":
      return {
        title: "The provider ran out of time",
        body: "BuildGentic stopped waiting and cancelled the request, so nothing further is being billed. Try again, or lower the token cap for a faster answer.",
        tone: "error",
        action: "retry",
        retryable: true,
      };

    case "connection_lost":
      return {
        title: "The connection dropped mid-answer",
        body: "The text above is real but incomplete — the stream ended before the model finished. Run it again to get a whole answer.",
        tone: "error",
        action: "retry",
        retryable: true,
      };

    /* ----- session ----- */

    case "unauthenticated":
      return {
        title: "You are signed out",
        body: "Your session expired. Sign in again to keep using the Lab.",
        tone: "error",
        action: "sign-in",
        retryable: false,
      };

    /* `cancelled` never reaches here — the Lab treats a stop as
       an outcome, not a failure. */
    default:
      return {
        title: "Something went wrong",
        body: error.message,
        tone: "error",
        action: "retry",
        retryable: true,
      };
  }
}
