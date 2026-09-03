import { registerActivity } from "../activityRegistry";
import type { ActivityComponent } from "../activityRegistry";

import AiSorterActivity from "./AiSorterActivity";
import BiasAuditActivity from "./BiasAuditActivity";
import CapstoneActivity from "./CapstoneActivity";
import DataRedactionActivity from "./DataRedactionActivity";
import DatasetImbalanceActivity from "./DatasetImbalanceActivity";
import DatasetPlaygroundActivity from "./DatasetPlaygroundActivity";
import DecisionTreeActivity from "./DecisionTreeActivity";
import EdgeCaseMatrixActivity from "./EdgeCaseMatrixActivity";
import EthicsDialActivity from "./EthicsDialActivity";
import FactCheckerActivity from "./FactCheckerActivity";
import FairnessMetricsActivity from "./FairnessMetricsActivity";
import ModelTestingActivity from "./ModelTestingActivity";
import NextTokenActivity from "./NextTokenActivity";
import ParameterTuningActivity from "./ParameterTuningActivity";
import PolicyCreatorActivity from "./PolicyCreatorActivity";
import PromptRefinementActivity from "./PromptRefinementActivity";
import PromptWeaverActivity from "./PromptWeaverActivity";
import TemperatureActivity from "./TemperatureActivity";
import TokenizerActivity from "./TokenizerActivity";
import TruthAssessmentActivity from "./TruthAssessmentActivity";
import VectorSimilarityActivity from "./VectorSimilarityActivity";

/*
 * Wires every interactive type to its component.
 *
 * Imported once for its side effect, from the lesson player.
 * Adding an activity means one file plus one line here — the
 * player, the step host and the gating logic stay untouched.
 *
 * Each component narrows the step itself, so the cast here is
 * confined to this table rather than spread through the app.
 */
const ACTIVITIES: Record<string, ActivityComponent> = {
  /* Lesson 1 — what AI is */
  decision_tree_builder: DecisionTreeActivity as ActivityComponent,
  ai_sorter: AiSorterActivity as ActivityComponent,

  /* Lesson 2 — how machines learn */
  dataset_playground: DatasetPlaygroundActivity as ActivityComponent,
  parameter_tuning: ParameterTuningActivity as ActivityComponent,
  model_testing: ModelTestingActivity as ActivityComponent,

  /* Lesson 3 — language */
  tokenizer_playground: TokenizerActivity as ActivityComponent,
  vector_similarity: VectorSimilarityActivity as ActivityComponent,
  next_token_game: NextTokenActivity as ActivityComponent,

  /* Lesson 4 — generation and prompting */
  prompt_weaver: PromptWeaverActivity as ActivityComponent,
  temperature_slider: TemperatureActivity as ActivityComponent,
  prompt_refinement: PromptRefinementActivity as ActivityComponent,

  /* Lesson 5 — limitations */
  fact_checker: FactCheckerActivity as ActivityComponent,
  edge_case_matrix: EdgeCaseMatrixActivity as ActivityComponent,
  truth_assessment: TruthAssessmentActivity as ActivityComponent,

  /* Lesson 6 — bias and fairness */
  dataset_imbalance: DatasetImbalanceActivity as ActivityComponent,
  fairness_metrics: FairnessMetricsActivity as ActivityComponent,
  bias_audit: BiasAuditActivity as ActivityComponent,

  /* Lesson 7 — responsibility */
  ethics_dial: EthicsDialActivity as ActivityComponent,
  data_redaction: DataRedactionActivity as ActivityComponent,
  policy_creator: PolicyCreatorActivity as ActivityComponent,

  /* Lesson 8 — capstone */
  capstone_pipeline: CapstoneActivity as ActivityComponent,
};

Object.entries(ACTIVITIES).forEach(([type, component]) => {
  registerActivity(type as Parameters<typeof registerActivity>[0], component);
});
