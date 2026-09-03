import { useMemo, useState } from "react";

import type { TokenizerActivityStep } from "../../../core/curriculum/Lesson";
import { Callout, Input } from "../../../components/ui";
import type { StepProps } from "../types";
import ActivityActions from "./kit/ActivityActions";
import { useActivityRun } from "./kit/useActivityRun";

/*
 * A small subword tokenizer.
 *
 * Long or unusual words are split into fragments; short common
 * ones stay whole. That is the behaviour the lesson is about —
 * it does not need to match any real vocabulary to make the
 * point, but it does need to be consistent, so the same input
 * always produces the same tokens.
 */
function tokenize(text: string, vocabulary: Set<string>): string[] {
  const tokens: string[] = [];

  const words = text.match(/\s+|[^\s]+/g) ?? [];

  words.forEach((chunk) => {
    if (/^\s+$/.test(chunk)) {
      tokens.push(chunk);
      return;
    }

    const punctuation = chunk.match(/^([\w'-]*)([^\w'-]*)$/);
    const word = punctuation?.[1] ?? chunk;
    const trailing = punctuation?.[2] ?? "";

    if (word) {
      const lower = word.toLowerCase();

      if (vocabulary.has(lower) || word.length <= 4) {
        tokens.push(word);
      } else {
        /* Split into leading chunk plus 3-character pieces. */
        let rest = word;
        let first = true;

        while (rest.length > 0) {
          const size = first ? Math.min(4, rest.length) : Math.min(3, rest.length);
          tokens.push(rest.slice(0, size));
          rest = rest.slice(size);
          first = false;
        }
      }
    }

    if (trailing) {
      trailing.split("").forEach((mark) => tokens.push(mark));
    }
  });

  return tokens;
}

/* Stable pseudo-id so the same token always shows the same number. */
function tokenId(token: string): number {
  let hash = 0;

  for (let index = 0; index < token.length; index += 1) {
    hash = (hash * 31 + token.charCodeAt(index)) % 50000;
  }

  return hash + 1000;
}

export default function TokenizerActivity({
  step,
  state,
  onProgress,
}: StepProps<TokenizerActivityStep>) {
  const activity = step as TokenizerActivityStep;
  const run = useActivityRun(activity, { state, onProgress });

  const [text, setText] = useState(activity.starterSentences?.[0] ?? "");
  const [tokenizedCustom, setTokenizedCustom] = useState(false);

  const vocabulary = useMemo(
    () =>
      new Set(
        (activity.tokenVocabulary ?? []).map((item) => item.token.toLowerCase())
      ),
    [activity.tokenVocabulary]
  );

  const tokens = useMemo(
    () => tokenize(text, vocabulary),
    [text, vocabulary]
  );

  const visibleTokens = tokens.filter((token) => !/^\s+$/.test(token));

  const isStarter = (activity.starterSentences ?? []).includes(text);

  function check() {
    run.check({
      completed: tokenizedCustom,
      actions: tokenizedCustom ? ["tokenize-custom-sentence"] : [],
    });
  }

  return (
    <>
      <p className="activity-note">
        A model never sees your words. It sees these pieces, then their id
        numbers. Type something of your own and watch where it splits.
      </p>

      {activity.starterSentences?.length ? (
        <div className="sorter__choices" style={{ marginBottom: "var(--space-4)" }}>
          {activity.starterSentences.map((sentence) => (
            <label
              key={sentence}
              className={`chip${text === sentence ? " chip--selected" : ""}`}
            >
              <input
                type="radio"
                className="chip__input"
                name="starter-sentence"
                checked={text === sentence}
                disabled={run.checked}
                onChange={() => setText(sentence)}
              />
              {sentence.length > 40 ? `${sentence.slice(0, 40)}…` : sentence}
            </label>
          ))}
        </div>
      ) : null}

      {activity.allowCustomInput !== false ? (
        <Input
          value={text}
          maxLength={activity.maxInputLength ?? 120}
          disabled={run.checked}
          aria-label="Text to tokenize"
          placeholder="Type a sentence of your own"
          onChange={(event) => {
            setText(event.target.value);

            if (event.target.value.trim().length > 8) {
              setTokenizedCustom(true);
            }
          }}
        />
      ) : null}

      <div className="activity-group">
        <div className="activity-group__title">
          {visibleTokens.length} tokens
        </div>

        <div className="tokens">
          {tokens.map((token, index) =>
            /^\s+$/.test(token) ? (
              <span key={index} className="token token--space">
                ␣
              </span>
            ) : (
              <span key={index} className="token">
                {token}
                {activity.showTokenIds !== false ? (
                  <span className="token__id">{tokenId(token)}</span>
                ) : null}
              </span>
            )
          )}
        </div>

        <p className="slider__hint">
          {visibleTokens.length} tokens for {text.trim().length} characters.
          Common words survive whole; rarer ones get chopped up.
        </p>
      </div>

      {activity.tokenizationRules.length ? (
        <div className="activity-group">
          <div className="activity-group__title">Why it splits that way</div>

          <ul className="prose" style={{ fontSize: "var(--text-sm)" }}>
            {activity.tokenizationRules.map((rule) => (
              <li key={rule.id}>
                {rule.description}{" "}
                <code>{rule.example}</code> →{" "}
                <code>{rule.resultingTokens.join(" · ")}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ActivityActions
        checked={run.checked}
        canCheck={tokenizedCustom || !isStarter}
        attemptsLeft={run.attemptsLeft}
        outOfAttempts={run.outOfAttempts}
        checkLabel="Done exploring"
        onCheck={check}
        onReset={run.reset}
      />

      {!run.checked && !tokenizedCustom ? (
        <p className="slider__hint">
          Type your own sentence to finish this step.
        </p>
      ) : null}

      {run.checked ? (
        <div style={{ marginTop: "var(--space-4)" }}>
          <Callout tone="correct" title="Words in, numbers out">
            {activity.feedback?.completion ??
              activity.feedback?.correct ??
              "Everything downstream — attention, prediction, generation — operates on these ids. The model has no access to the letters you typed."}
          </Callout>
        </div>
      ) : null}
    </>
  );
}
