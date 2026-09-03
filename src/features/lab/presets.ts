import type { LabSettings } from "./types";

/*
 * Experiments worth running before you have thought of your own.
 *
 * An empty playground is a hard place to learn anything: a
 * learner who does not yet know what temperature does also does
 * not know what prompt would reveal it. Each preset below is
 * built around one observation, stated in `question`, that the
 * run actually makes visible — so the first thing a learner does
 * here produces evidence rather than just an answer.
 *
 * Deliberately not "prompt templates". Nothing here is a recipe
 * to reuse; each one is a demonstration to run twice.
 */

export interface LabPreset {
  id: string;
  title: string;
  /* What to watch for. Shown next to the run, not buried. */
  question: string;
  /* The four settings a preset actually varies. */
  settings: Pick<
    LabSettings,
    "system" | "prompt" | "temperature" | "maxOutputTokens" | "stop"
  >;
}

export const LAB_PRESETS: LabPreset[] = [
  {
    id: "temperature",
    title: "What temperature really does",
    question:
      "Run this twice at temperature 0, then twice at 1.6. At zero the two answers should be near-identical; at 1.6 they will not be. Same model, same prompt — only the sampling changed.",
    settings: {
      system: "",
      prompt: "Invent a name for a coffee shop run entirely by cats. Give one name and nothing else.",
      temperature: 0,
      maxOutputTokens: 128,
      stop: [],
    },
  },
  {
    id: "system",
    title: "System instructions change everything",
    question:
      "Run it once as it is. Then clear the system instructions and run the same prompt again. The question never changed — the answer will have.",
    settings: {
      system:
        "You are a blunt physics professor with no patience for hand-waving. Never use an analogy. Answer in at most three sentences.",
      prompt: "Why is the sky blue?",
      temperature: 0.7,
      maxOutputTokens: 256,
      stop: [],
    },
  },
  {
    id: "token-cap",
    title: "Watch an answer get cut off",
    question:
      "The cap is 64 tokens and the prompt asks for far more than that. The run will stop mid-sentence and the report will say “Hit the token cap” — the model did not choose to stop, it was cut off.",
    settings: {
      system: "",
      prompt: "Explain how a neural network learns, in detail, with examples.",
      temperature: 0.7,
      maxOutputTokens: 64,
      stop: [],
    },
  },
  {
    id: "stop-sequence",
    title: "A stop sequence that bites too early",
    question:
      "The stop sequence is a full stop, so generation ends at the first sentence — and the sequence itself is not included, so the answer has no final punctuation. Over-tight stop sequences are a common way to get a truncated or empty answer.",
    settings: {
      system: "",
      prompt: "List three reasons fact-checking a language model matters.",
      temperature: 0.5,
      maxOutputTokens: 512,
      stop: ["."],
    },
  },
];
