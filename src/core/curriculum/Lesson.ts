/*
 * ============================================================
 * LESSON MODEL
 * ============================================================
 *
 * Designed specifically for the "What is AI?" curriculum.
 *
 * The architecture intentionally separates:
 *
 *   1. Pedagogical step type
 *   2. Interactive activity type
 *   3. Activity-specific configuration
 *   4. Completion / scoring behavior
 *
 * This allows the lesson UI to render genuinely interactive
 * experiences instead of treating every lesson as a text page.
 */

/*
 * ============================================================
 * LESSON
 * ============================================================
 */

export interface Lesson {
  id: string;

  courseId: string;

  courseTitle: string;

  number: number;

  title: string;

  description: string;

  track: string;

  conceptIds: string[];

  challengeIds: string[];

  prerequisites: string[];

  totalXp: number;

  estimatedMinutes: number;

  /*
   * Every lesson is composed of ordered instructional steps.
   */
  steps: LessonStep[];

  /*
   * Optional metadata used by the course UI.
   */
  learningObjectives?: string[];

  keyTakeaways?: string[];

  /*
   * Lesson 8 can identify itself as a capstone.
   */
  isCapstone?: boolean;

  /*
   * Optional minimum score required to complete the lesson.
   */
  passingScore?: number;
}

/*
 * ============================================================
 * LESSON STEP TYPES
 * ============================================================
 */

export type LessonStepType =
  | "intro"
  | "concept"
  | "activity"
  | "challenge"
  | "quiz"
  | "completion";

/*
 * ============================================================
 * INTERACTIVE ACTIVITY TYPES
 * ============================================================
 *
 * These correspond directly to the activities defined in
 * the What is AI? course specification.
 */

export type InteractiveType =
  /*
   * ----------------------------------------------------------
   * LESSON 1 — WHAT IS AI?
   * ----------------------------------------------------------
   */
  | "decision_tree_builder"
  | "ai_sorter"

  /*
   * ----------------------------------------------------------
   * LESSON 2 — HOW DOES AI LEARN?
   * ----------------------------------------------------------
   */
  | "dataset_playground"
  | "parameter_tuning"
  | "model_testing"

  /*
   * ----------------------------------------------------------
   * LESSON 3 — HOW AI UNDERSTANDS LANGUAGE
   * ----------------------------------------------------------
   */
  | "tokenizer_playground"
  | "vector_similarity"
  | "next_token_game"

  /*
   * ----------------------------------------------------------
   * LESSON 4 — GENERATIVE AI
   * ----------------------------------------------------------
   */
  | "prompt_weaver"
  | "temperature_slider"
  | "prompt_refinement"

  /*
   * ----------------------------------------------------------
   * LESSON 5 — CAN AI BE WRONG?
   * ----------------------------------------------------------
   */
  | "fact_checker"
  | "edge_case_matrix"
  | "truth_assessment"

  /*
   * ----------------------------------------------------------
   * LESSON 6 — BIAS AND FAIRNESS
   * ----------------------------------------------------------
   */
  | "dataset_imbalance"
  | "fairness_metrics"
  | "bias_audit"

  /*
   * ----------------------------------------------------------
   * LESSON 7 — RESPONSIBLE AI
   * ----------------------------------------------------------
   */
  | "ethics_dial"
  | "data_redaction"
  | "policy_creator"

  /*
   * ----------------------------------------------------------
   * LESSON 8 — CAPSTONE
   * ----------------------------------------------------------
   */
  | "capstone_pipeline";

/*
 * ============================================================
 * BASE STEP
 * ============================================================
 */

export interface BaseLessonStep {
  id: string;

  type: LessonStepType;

  title: string;

  content?: string;

  /*
   * If true, Continue remains disabled until the step's
   * completion requirements are satisfied.
   */
  requiresCompletion?: boolean;

  /*
   * Optional XP awarded for completing this step.
   */
  xpReward?: number;

  /*
   * Optional estimated time.
   */
  estimatedMinutes?: number;
}

/*
 * ============================================================
 * INTRO STEP
 * ============================================================
 */

export interface IntroStep extends BaseLessonStep {
  type: "intro";

  subtitle?: string;

  learningObjectives?: string[];

  estimatedMinutes?: number;
}

/*
 * ============================================================
 * CONCEPT STEP
 * ============================================================
 *
 * Used for the three core concepts in each lesson.
 */

export interface ConceptStep extends BaseLessonStep {
  type: "concept";

  typeLabel?: string;

  /*
   * Optional examples shown alongside the explanation.
   */
  examples?: ConceptExample[];

  /*
   * Optional misconception callout.
   */
  misconception?: string;

  /*
   * Optional visual configuration.
   */
  visual?: ConceptVisual;
}

/*
 * ============================================================
 * ACTIVITY STEP
 * ============================================================
 *
 * This is the primary interactive step.
 *
 * The activity configuration is discriminated by
 * interactiveType.
 */

export type ActivityStep =
  | DecisionTreeActivityStep
  | AiSorterActivityStep
  | DatasetPlaygroundActivityStep
  | ParameterTuningActivityStep
  | ModelTestingActivityStep
  | TokenizerActivityStep
  | VectorSimilarityActivityStep
  | NextTokenActivityStep
  | PromptWeaverActivityStep
  | TemperatureSliderActivityStep
  | PromptRefinementActivityStep
  | FactCheckerActivityStep
  | EdgeCaseMatrixActivityStep
  | TruthAssessmentActivityStep
  | DatasetImbalanceActivityStep
  | FairnessMetricsActivityStep
  | BiasAuditActivityStep
  | EthicsDialActivityStep
  | DataRedactionActivityStep
  | PolicyCreatorActivityStep
  | CapstoneActivityStep;

/*
 * ============================================================
 * GENERIC ACTIVITY BASE
 * ============================================================
 */

export interface BaseActivityStep extends BaseLessonStep {
  type: "activity";

  interactiveType: InteractiveType;

  instructions?: string;

  completion?: ActivityCompletionConfig;

  feedback?: ActivityFeedbackConfig;
}

/*
 * ============================================================
 * LESSON 1 — DECISION TREE BUILDER
 * ============================================================
 */

export interface DecisionTreeActivityStep extends BaseActivityStep {
  interactiveType: "decision_tree_builder";

  dataset: DecisionTreeItem[];

  availableConditions: DecisionTreeCondition[];

  targetCategories: string[];

  /*
   * Correct solution represented as an ordered tree.
   */
  solution: DecisionTreeSolution;

  showLivePreview?: boolean;

  allowReordering?: boolean;
}

/*
 * ============================================================
 * LESSON 1 — AI SORTER
 * ============================================================
 */

export interface AiSorterActivityStep extends BaseActivityStep {
  interactiveType: "ai_sorter";

  cards: SorterCard[];

  buckets: SorterBucket[];

  explanationMode?: "after_each" | "after_all";

  allowRetry?: boolean;
}

/*
 * ============================================================
 * LESSON 2 — DATASET PLAYGROUND
 * ============================================================
 */

export interface DatasetPlaygroundActivityStep extends BaseActivityStep {
  interactiveType: "dataset_playground";

  dataset: DatasetItem[];

  categories: DatasetCategory[];

  requiredLabels: number;

  trainingStages?: TrainingStage[];

  accuracyFormula?: "simple" | "weighted";

  showConfidence?: boolean;

  showTrainingAnimation?: boolean;
}

/*
 * ============================================================
 * LESSON 2 — PARAMETER TUNING
 * ============================================================
 */

export interface ParameterTuningActivityStep extends BaseActivityStep {
  interactiveType: "parameter_tuning";

  parameters: TuningParameter[];

  initialValues?: Record<string, number>;

  accuracyModel: AccuracySimulation;

  targetAccuracy?: number;

  feedbackThresholds?: FeedbackThreshold[];
}

/*
 * ============================================================
 * LESSON 2 — MODEL TESTING
 * ============================================================
 */

export interface ModelTestingActivityStep extends BaseActivityStep {
  interactiveType: "model_testing";

  trainingSummary: TrainingSummary;

  testItems: ModelTestItem[];

  minimumTestsRequired?: number;

  showConfusionMatrix?: boolean;

  showPerCategoryAccuracy?: boolean;
}

/*
 * ============================================================
 * LESSON 3 — TOKENIZER PLAYGROUND
 * ============================================================
 */

export interface TokenizerActivityStep extends BaseActivityStep {
  interactiveType: "tokenizer_playground";

  starterSentences?: string[];

  tokenizationRules: TokenizationRule[];

  tokenVocabulary?: TokenVocabularyItem[];

  showTokenIds?: boolean;

  showEmbeddings?: boolean;

  allowCustomInput?: boolean;

  maxInputLength?: number;
}

/*
 * ============================================================
 * LESSON 3 — VECTOR SIMILARITY
 * ============================================================
 */

export interface VectorSimilarityActivityStep extends BaseActivityStep {
  interactiveType: "vector_similarity";

  points: VectorPoint[];

  similarityMetric: "euclidean" | "cosine";

  targetPairs?: SimilarityPair[];

  draggable?: boolean;

  showDistanceLines?: boolean;

  showSimilarityScore?: boolean;
}

/*
 * ============================================================
 * LESSON 3 — NEXT TOKEN GAME
 * ============================================================
 */

export interface NextTokenActivityStep extends BaseActivityStep {
  interactiveType: "next_token_game";

  prompts: NextTokenPrompt[];

  showProbabilities?: boolean;

  allowMultipleAttempts?: boolean;

  scoringMode?: "exact" | "probability_weighted";
}

/*
 * ============================================================
 * LESSON 4 — PROMPT WEAVER
 * ============================================================
 */

export interface PromptWeaverActivityStep extends BaseActivityStep {
  interactiveType: "prompt_weaver";

  promptBlocks: PromptBlock[];

  requiredCategories: PromptBlockCategory[];

  targetPromptPattern: string[];

  exampleOutputs?: PromptVariation[];

  showOutputPreview?: boolean;
}

/*
 * ============================================================
 * LESSON 4 — TEMPERATURE SLIDER
 * ============================================================
 */

export interface TemperatureSliderActivityStep extends BaseActivityStep {
  interactiveType: "temperature_slider";

  minTemperature: number;

  maxTemperature: number;

  initialTemperature: number;

  stepSize?: number;

  prompts: TemperaturePrompt[];

  outputSets: TemperatureOutputSet[];

  showRandomnessMeter?: boolean;

  showProbabilityDistribution?: boolean;
}

/*
 * ============================================================
 * LESSON 4 — PROMPT REFINEMENT
 * ============================================================
 */

export interface PromptRefinementActivityStep extends BaseActivityStep {
  interactiveType: "prompt_refinement";

  originalPrompt: string;

  flawedOutput: string;

  refinementTargets: RefinementTarget[];

  availableConstraints: PromptConstraint[];

  minimumConstraints?: number;

  targetQualityScore: number;

  evaluationRubric: EvaluationCriterion[];

  sampleImprovedOutput?: string;
}

/*
 * ============================================================
 * LESSON 5 — FACT CHECKER
 * ============================================================
 */

export interface FactCheckerActivityStep extends BaseActivityStep {
  interactiveType: "fact_checker";

  document: FactCheckDocument;

  claims: FactCheckClaim[];

  sources?: VerificationSource[];

  minimumFlagsRequired?: number;

  showSourceHints?: boolean;
}

/*
 * ============================================================
 * LESSON 5 — EDGE CASE MATRIX
 * ============================================================
 */

export interface EdgeCaseMatrixActivityStep extends BaseActivityStep {
  interactiveType: "edge_case_matrix";

  cases: EdgeCase[];

  models: ModelConfiguration[];

  expectedObservations: EdgeCaseObservation[];

  allowModelComparison?: boolean;

  showResultsTable?: boolean;
}

/*
 * ============================================================
 * LESSON 5 — TRUTH ASSESSMENT
 * ============================================================
 */

export interface TruthAssessmentActivityStep extends BaseActivityStep {
  interactiveType: "truth_assessment";

  outputs: TruthAssessmentCase[];

  actions: TruthAssessmentAction[];

  requiredWorkflow?: TruthAssessmentAction["id"][];

  allowReordering?: boolean;
}

/*
 * ============================================================
 * LESSON 6 — DATASET IMBALANCE
 * ============================================================
 */

export interface DatasetImbalanceActivityStep extends BaseActivityStep {
  interactiveType: "dataset_imbalance";

  groups: ImbalanceGroup[];

  initialDistribution: Record<string, number>;

  targetDistribution?: Record<string, number>;

  simulationResults: ImbalanceSimulationResult[];

  showRecommendationRates?: boolean;

  allowRebalancing?: boolean;
}

/*
 * ============================================================
 * LESSON 6 — FAIRNESS METRICS
 * ============================================================
 */

export interface FairnessMetricsActivityStep extends BaseActivityStep {
  interactiveType: "fairness_metrics";

  groups: FairnessGroup[];

  metrics: FairnessMetric[];

  initialMetric: string;

  targetMetric?: string;

  configurations: FairnessConfiguration[];

  showTradeoffs?: boolean;
}

/*
 * ============================================================
 * LESSON 6 — BIAS AUDIT
 * ============================================================
 */

export interface BiasAuditActivityStep extends BaseActivityStep {
  interactiveType: "bias_audit";

  cases: BiasAuditCase[];

  mitigationOptions: MitigationOption[];

  requiredFindings: string[];

  showAuditLog?: boolean;

  allowMultipleMitigations?: boolean;
}

/*
 * ============================================================
 * LESSON 7 — ETHICS DIAL
 * ============================================================
 */

export interface EthicsDialActivityStep extends BaseActivityStep {
  interactiveType: "ethics_dial";

  scenario: EthicsScenario;

  priorities: EthicsPriority[];

  constraints: EthicsConstraint[];

  outcomes: EthicsOutcome[];

  showTradeoffGraph?: boolean;
}

/*
 * ============================================================
 * LESSON 7 — DATA REDACTION
 * ============================================================
 */

export interface DataRedactionActivityStep extends BaseActivityStep {
  interactiveType: "data_redaction";

  document: RedactionDocument;

  sensitiveFields: SensitiveDataField[];

  requiredRedactions: string[];

  showRedactionPreview?: boolean;

  allowUndo?: boolean;
}

/*
 * ============================================================
 * LESSON 7 — POLICY CREATOR
 * ============================================================
 */

export interface PolicyCreatorActivityStep extends BaseActivityStep {
  interactiveType: "policy_creator";

  policyTiles: PolicyTile[];

  requiredPolicies: string[];

  optionalPolicies?: string[];

  categories: PolicyCategory[];

  minimumPolicies?: number;

  allowCustomPolicy?: boolean;
}

/*
 * ============================================================
 * LESSON 8 — CAPSTONE
 * ============================================================
 */

export interface CapstoneActivityStep extends BaseActivityStep {
  interactiveType: "capstone_pipeline";

  scenario: CapstoneScenario;

  stages: CapstoneStageConfig[];

  datasets: CapstoneDataset[];

  promptConfig: CapstonePromptConfig;

  auditCases: CapstoneAuditCase[];

  fairnessTests: CapstoneFairnessTest[];

  deploymentPolicies: CapstoneDeploymentPolicy[];

  scoring: CapstoneScoringConfig;

  finalSignoff: CapstoneSignoffConfig;
}

/*
 * ============================================================
 * CHALLENGE STEP
 * ============================================================
 */

export interface ChallengeStep extends BaseLessonStep {
  type: "challenge";

  prompt: string;

  instructions?: string;

  evaluationCriteria?: EvaluationCriterion[];

  sampleSolution?: string;

  hints?: string[];

  activityConfig?: Record<string, unknown>;
}

/*
 * ============================================================
 * QUIZ STEP
 * ============================================================
 */

export interface QuizStep extends BaseLessonStep {
  type: "quiz";

  questionText: string;

  options: InteractiveOption[];

  explanation?: string;

  allowRetry?: boolean;

  showExplanationAfterAnswer?: boolean;
}

/*
 * ============================================================
 * COMPLETION STEP
 * ============================================================
 */

/*
 * Where a finished course sends the learner next.
 *
 * A course that ends on a summary screen ends. A course that
 * ends on a mission cashes out: the thing the learner just
 * spent six lessons understanding is one button away from
 * being a thing they made. Only the last lesson of a course
 * carries one, and not every course needs one — a course whose
 * output is judgement rather than a build ends on its own
 * capstone, and leaving the field off is how it says so.
 */
export type MissionTarget = "lab" | "agent_builder" | "agent_site";

export interface LessonMission {
  target: MissionTarget;

  /* Sits above the copy, in the meta style. */
  headline: string;

  description: string;

  /* The button. */
  label: string;
}

export interface CompletionStep extends BaseLessonStep {
  type: "completion";

  keyTakeaways: string[];

  xpReward?: number;

  completionMessage?: string;

  nextLessonId?: string;

  /*
   * The handoff into a real feature. Read by the completion
   * screen and by the course page, which shows it again once
   * every lesson is done.
   */
  mission?: LessonMission;
}

/*
 * ============================================================
 * LESSON STEP UNION
 * ============================================================
 */

export type LessonStep =
  | IntroStep
  | ConceptStep
  | ActivityStep
  | ChallengeStep
  | QuizStep
  | CompletionStep;

/*
 * ============================================================
 * CONCEPT TYPES
 * ============================================================
 */

export interface ConceptExample {
  id: string;

  title: string;

  description: string;

  input?: string;

  output?: string;
}

/*
 * ============================================================
 * CONCEPT VISUALS
 * ============================================================
 *
 * A diagram carries some ideas better than a paragraph does —
 * "the model is one stage in a pipeline" lands as a picture and
 * dissolves as prose.
 *
 * `data` used to be `unknown`, which meant the renderer had
 * nothing to narrow on and the field went unused for the whole
 * course. Each kind now declares its own shape, discriminated
 * by `type`, so a visual either typechecks or does not compile.
 *
 * Every kind is optional content. A concept step with no
 * `visual` renders exactly as it does today.
 */

/* Two things held side by side. */
export interface ComparisonVisual {
  type: "comparison";

  data: {
    left: { label: string; points: string[] };
    right: { label: string; points: string[] };
  };
}

/* An ordered pipeline, each stage feeding the next. */
export interface FlowVisual {
  type: "flow";

  data: {
    stages: { id: string; label: string; caption?: string }[];
  };
}

/* Labelled nodes and the relationships between them. */
export interface DiagramVisual {
  type: "diagram";

  data: {
    nodes: { id: string; label: string; caption?: string }[];
    /* Optional edge labels, drawn between consecutive nodes. */
    links?: { from: string; to: string; label?: string }[];
  };
}

/* Ordered milestones with a marker each. */
export interface TimelineVisual {
  type: "timeline";

  data: {
    milestones: { id: string; when: string; label: string; caption?: string }[];
  };
}

/* One state, a transform, and the state it becomes. */
export interface BeforeAfterVisual {
  type: "before_after";

  data: {
    before: { label: string; body: string };
    after: { label: string; body: string };
    transform?: string;
  };
}

/* A small labelled bar readout. Values are 0-100. */
export interface DataVisual {
  type: "data";

  data: {
    caption?: string;
    bars: { id: string; label: string; value: number; note?: string }[];
  };
}

/* An explicit opt-out, so a step can say "no picture here". */
export interface NoVisual {
  type: "none";
  data?: undefined;
}

export type ConceptVisual =
  | ComparisonVisual
  | FlowVisual
  | DiagramVisual
  | TimelineVisual
  | BeforeAfterVisual
  | DataVisual
  | NoVisual;

/*
 * ============================================================
 * ACTIVITY COMPLETION
 * ============================================================
 */

export interface ActivityCompletionConfig {
  type:
    | "all_correct"
    | "minimum_correct"
    | "target_score"
    | "required_actions"
    | "manual_signoff";

  minimumCorrect?: number;

  targetScore?: number;

  requiredActions?: string[];

  allowPartialCredit?: boolean;

  maxAttempts?: number;
}

/*
 * ============================================================
 * ACTIVITY FEEDBACK
 * ============================================================
 */

export interface ActivityFeedbackConfig {
  correct?: string;

  incorrect?: string;

  partial?: string;

  completion?: string;

  showAfterEachAction?: boolean;
}

/*
 * ============================================================
 * GENERIC OPTIONS
 * ============================================================
 */

export interface InteractiveOption {
  id: string;

  label: string;

  isCorrect: boolean;

  feedback?: string;

  explanation?: string;

  value?: string | number;
}

/*
 * ============================================================
 * LESSON 1 — DECISION TREE
 * ============================================================
 */

export interface DecisionTreeItem {
  id: string;

  name: string;

  attributes: Record<string, string | number | boolean>;

  correctCategory: string;
}

export interface DecisionTreeCondition {
  id: string;

  label: string;

  attribute: string;

  operator:
    | "equals"
    | "not_equals"
    | "greater_than"
    | "less_than"
    | "contains";

  value: string | number | boolean;
}

export interface DecisionTreeSolution {
  rootConditionId: string;

  nodes: DecisionTreeNode[];

  classifications: Record<string, string>;
}

export interface DecisionTreeNode {
  id: string;

  label: string;

  conditionId?: string;

  yesChildId?: string;

  noChildId?: string;

  result?: string;
}

/*
 * ============================================================
 * LESSON 1 — AI SORTER
 * ============================================================
 */

export interface SorterCard {
  id: string;

  title: string;

  description: string;

  correctBucketId: string;

  explanation: string;
}

export interface SorterBucket {
  id: string;

  label: string;

  description?: string;
}

/*
 * ============================================================
 * LESSON 2 — DATASETS
 * ============================================================
 */

export interface DatasetItem {
  id: string;

  label?: string;

  image?: string;

  category?: string;

  features?: Record<string, number>;

  metadata?: Record<string, string | number | boolean>;

  correctLabel?: string;
}

export interface DatasetCategory {
  id: string;

  label: string;

  description?: string;
}

export interface TrainingStage {
  id: string;

  label: string;

  minimumItems: number;

  accuracy: number;

  confidence: number;
}

/*
 * ============================================================
 * LESSON 2 — PARAMETER TUNING
 * ============================================================
 */

export interface TuningParameter {
  id: string;

  label: string;

  description: string;

  min: number;

  max: number;

  step: number;

  unit?: string;
}

export interface AccuracySimulation {
  baselineAccuracy: number;

  effects: ParameterEffect[];

  minAccuracy?: number;

  maxAccuracy?: number;
}

export interface ParameterEffect {
  parameterId: string;

  optimalRange: [number, number];

  effectStrength: number;

  description: string;
}

export interface FeedbackThreshold {
  minAccuracy: number;

  maxAccuracy: number;

  message: string;
}

/*
 * ============================================================
 * LESSON 2 — MODEL TESTING
 * ============================================================
 */

export interface TrainingSummary {
  trainingItemCount: number;

  categories: string[];

  trainingAccuracy: number;

  knownLimitations?: string[];
}

export interface ModelTestItem {
  id: string;

  input: string;

  image?: string;

  expectedCategory: string;

  modelPrediction: string;

  confidence: number;

  explanation?: string;
}

/*
 * ============================================================
 * LESSON 3 — TOKENIZATION
 * ============================================================
 */

export interface TokenizationRule {
  id: string;

  description: string;

  example: string;

  resultingTokens: string[];
}

export interface TokenVocabularyItem {
  token: string;

  tokenId: number;

  embeddingPreview?: number[];
}

/*
 * ============================================================
 * LESSON 3 — VECTORS
 * ============================================================
 */

export interface VectorPoint {
  id: string;

  label: string;

  x: number;

  y: number;

  category?: string;

  explanation?: string;
}

export interface SimilarityPair {
  firstId: string;

  secondId: string;

  expectedRelationship: "similar" | "different";
}

/*
 * ============================================================
 * LESSON 3 — NEXT TOKEN
 * ============================================================
 */

export interface NextTokenPrompt {
  id: string;

  prompt: string;

  predictions: TokenPrediction[];

  correctTokenId: string;

  explanation: string;
}

export interface TokenPrediction {
  id: string;

  token: string;

  probability: number;

  isCorrect?: boolean;

  feedback?: string;
}

/*
 * ============================================================
 * LESSON 4 — PROMPT WEAVER
 * ============================================================
 */

export type PromptBlockCategory =
  | "subject"
  | "style"
  | "lighting"
  | "mood"
  | "context"
  | "format"
  | "constraints";

export interface PromptBlock {
  id: string;

  category: PromptBlockCategory;

  label: string;

  text: string;

  qualityValue?: number;
}

/*
 * ============================================================
 * LESSON 4 — TEMPERATURE
 * ============================================================
 */

export interface TemperaturePrompt {
  id: string;

  prompt: string;

  description?: string;
}

export interface TemperatureOutputSet {
  promptId: string;

  outputs: TemperatureOutput[];
}

export interface TemperatureOutput {
  temperature: number;

  output: string;

  creativityScore: number;

  predictabilityScore: number;
}

/*
 * ============================================================
 * LESSON 4 — PROMPT REFINEMENT
 * ============================================================
 */

export interface RefinementTarget {
  id: string;

  label: string;

  description: string;
}

export interface PromptConstraint {
  id: string;

  category:
    | "tone"
    | "format"
    | "length"
    | "audience"
    | "role"
    | "context"
    | "restriction";

  label: string;

  text: string;

  scoreValue: number;
}

export interface EvaluationCriterion {
  id: string;

  label: string;

  description: string;

  weight: number;
}

/*
 * ============================================================
 * LESSON 5 — FACT CHECKER
 * ============================================================
 */

export interface FactCheckDocument {
  id: string;

  title: string;

  text: string;
}

export interface FactCheckClaim {
  id: string;

  text: string;

  /* "fabricated" covers a claim the model invented outright —
     the hallucination case the lesson is teaching. */
  status: "true" | "false" | "unsupported" | "misleading" | "fabricated";

  explanation: string;

  sourceIds?: string[];
}

export interface VerificationSource {
  id: string;

  title: string;

  sourceType: "primary" | "secondary" | "reference";

  reliability: "high" | "medium" | "low";

  summary: string;
}

/*
 * ============================================================
 * LESSON 5 — EDGE CASES
 * ============================================================
 */

export interface EdgeCase {
  id: string;

  title: string;

  description: string;

  category:
    | "visual"
    | "language"
    | "reasoning"
    | "data"
    | "context";

  expectedDifficulty: "low" | "medium" | "high";
}

export interface ModelConfiguration {
  id: string;

  label: string;

  description: string;

  trainingCoverage: number;

  contextWindow?: number;

  specialization?: string;
}

export interface EdgeCaseObservation {
  caseId: string;

  modelId: string;

  expectedBehavior: string;

  expectedRisk: "low" | "medium" | "high";
}

/*
 * ============================================================
 * LESSON 5 — TRUTH ASSESSMENT
 * ============================================================
 */

export interface TruthAssessmentCase {
  id: string;

  output: string;

  category:
    | "accurate"
    | "needs_fact_checking"
    | "unsafe"
    | "fabricated";

  correctActionId: string;

  explanation: string;
}

export interface TruthAssessmentAction {
  id: "publish" | "fact_check" | "discard";

  label: string;

  description: string;
}

/*
 * ============================================================
 * LESSON 6 — DATASET IMBALANCE
 * ============================================================
 */

export interface ImbalanceGroup {
  id: string;

  label: string;

  initialPercentage: number;

  recommendationRate: number;

  explanation: string;
}

export interface ImbalanceSimulationResult {
  distribution: Record<string, number>;

  recommendationRates: Record<string, number>;

  disparityScore: number;

  explanation: string;
}

/*
 * ============================================================
 * LESSON 6 — FAIRNESS
 * ============================================================
 */

export interface FairnessGroup {
  id: string;

  label: string;

  sampleCount: number;

  approvalRate: number;

  representationRate: number;

  truePositiveRate?: number;
}

export interface FairnessMetric {
  id: string;

  label: string;

  description: string;

  formula?: string;
}

export interface FairnessConfiguration {
  id: string;

  metricId: string;

  settings: Record<string, number>;

  groupResults: Record<string, number>;

  tradeoffs: string[];

  explanation: string;
}

/*
 * ============================================================
 * LESSON 6 — BIAS AUDIT
 * ============================================================
 */

export interface BiasAuditCase {
  id: string;

  title: string;

  log: string;

  issueType:
    | "representation"
    | "algorithmic"
    | "measurement"
    | "historical"
    | "unknown";

  severity: "low" | "medium" | "high";

  correctMitigationIds: string[];

  explanation: string;
}

export interface MitigationOption {
  id: string;

  label: string;

  description: string;

  applicableIssueTypes: BiasAuditCase["issueType"][];

  effectiveness: number;
}

/*
 * ============================================================
 * LESSON 7 — ETHICS DIAL
 * ============================================================
 */

export interface EthicsScenario {
  id: string;

  title: string;

  description: string;

  context: string;
}

export interface EthicsPriority {
  id: string;

  label: string;

  description: string;

  weight: number;
}

export interface EthicsConstraint {
  id: string;

  label: string;

  description: string;

  required: boolean;
}

export interface EthicsOutcome {
  id: string;

  settings: Record<string, number>;

  description: string;

  safetyScore: number;

  fairnessScore: number;

  legalComplianceScore: number;
}

/*
 * ============================================================
 * LESSON 7 — DATA REDACTION
 * ============================================================
 */

export interface RedactionDocument {
  id: string;

  title: string;

  content: string;

  fields: RedactableField[];
}

export interface RedactableField {
  id: string;

  text: string;

  startIndex: number;

  endIndex: number;

  dataType: SensitiveDataField["type"];

  shouldRedact: boolean;
}

export interface SensitiveDataField {
  id: string;

  type:
    | "name"
    | "email"
    | "phone"
    | "address"
    | "ssn"
    | "medical_record"
    | "financial"
    | "account_id";

  label: string;

  riskLevel: "low" | "medium" | "high";

  explanation: string;
}

/*
 * ============================================================
 * LESSON 7 — POLICY CREATOR
 * ============================================================
 */

export interface PolicyTile {
  id: string;

  label: string;

  description: string;

  category: "privacy" | "transparency" | "oversight" | "safety" | "ip";

  required?: boolean;
}

export interface PolicyCategory {
  id: string;

  label: string;

  description: string;
}

/*
 * ============================================================
 * LESSON 8 — CAPSTONE
 * ============================================================
 */

export type CapstoneStage =
  | "data_selection"
  | "model_training"
  | "prompt_engineering"
  | "error_audit"
  | "bias_audit"
  | "responsible_deployment"
  | "final_signoff";

/*
 * One stage of the capstone pipeline.
 *
 * Referenced by CapstoneActivityStep.stages but never declared,
 * which broke the typecheck for the whole project.
 */
export interface CapstoneStageConfig {
  id: string;

  stage: CapstoneStage;

  title: string;

  description: string;

  required: boolean;

  xpReward?: number;
}

export interface CapstoneScenario {
  id: string;

  organization: string;

  title: string;

  description: string;

  systemName: string;

  systemPurpose: string;

  risks: string[];

  stakeholders: string[];
}

/*
 * ============================================================
 * CAPSTONE DATA SELECTION
 * ============================================================
 */

export interface CapstoneDataset {
  id: string;

  name: string;

  description: string;

  sourceType:
    | "verified"
    | "primary"
    | "secondary"
    | "forum"
    | "synthetic"
    | "unknown";

  quality: "high" | "medium" | "low";

  balanced: boolean;

  containsSensitiveData: boolean;

  recommended: boolean;

  explanation: string;
}

/*
 * ============================================================
 * CAPSTONE PROMPT ENGINEERING
 * ============================================================
 */

export interface CapstonePromptConfig {
  systemPromptRequirements: PromptRequirement[];

  temperatureOptions: number[];

  recommendedTemperature: number;

  requiredPromptElements: string[];

  forbiddenBehaviors: string[];

  outputFormatOptions: string[];
}

export interface PromptRequirement {
  id: string;

  label: string;

  description: string;

  required: boolean;
}

/*
 * ============================================================
 * CAPSTONE ERROR AUDIT
 * ============================================================
 */

export interface CapstoneAuditCase {
  id: string;

  userMessage: string;

  aiResponse: string;

  issue:
    | "safe"
    | "hallucination"
    | "unsafe_advice"
    | "missing_context"
    | "privacy_violation"
    | "bias";

  severity: "low" | "medium" | "high";

  correctAction:
    | "approve"
    | "regenerate"
    | "escalate"
    | "block";

  explanation: string;
}

/*
 * ============================================================
 * CAPSTONE FAIRNESS
 * ============================================================
 */

export interface CapstoneFairnessTest {
  id: string;

  group: string;

  language?: string;

  ageRange?: string;

  culturalContext?: string;

  query: string;

  expectedOutcome: string;

  observedOutcome: string;

  disparityDetected: boolean;

  recommendedAdjustment?: string;
}

/*
 * ============================================================
 * CAPSTONE DEPLOYMENT
 * ============================================================
 */

export interface CapstoneDeploymentPolicy {
  id: string;

  label: string;

  description: string;

  category:
    | "privacy"
    | "human_oversight"
    | "disclosure"
    | "safety"
    | "data_governance";

  required: boolean;

  consequenceIfMissing: string;
}

/*
 * ============================================================
 * CAPSTONE SCORING
 * ============================================================
 */

export interface CapstoneScoringConfig {
  categories: CapstoneScoreCategory[];

  minimumOverallScore: number;

  minimumCategoryScores?: Partial<CapstoneScore>;

  weighting: {
    accuracy: number;

    fairness: number;

    safety: number;

    userExperience: number;
  };
}

export interface CapstoneScoreCategory {
  id: "accuracy" | "fairness" | "safety" | "userExperience";

  label: string;

  description: string;

  weight: number;

  maxScore: number;
}

export interface CapstoneScore {
  accuracy: number;

  fairness: number;

  safety: number;

  userExperience: number;

  overall: number;
}

/*
 * ============================================================
 * CAPSTONE FINAL SIGN-OFF
 * ============================================================
 */

export interface CapstoneSignoffConfig {
  required: boolean;

  confirmationText: string;

  checklist: SignoffRequirement[];

  successMessage: string;

  failureMessage: string;
}

export interface SignoffRequirement {
  id: string;

  label: string;

  description: string;

  required: boolean;
}

/*
 * ============================================================
 * PROMPT VARIATION
 * ============================================================
 */

export interface PromptVariation {
  label: string;

  output: string;

  qualityScore?: number;
}

/*
 * ============================================================
 * GENERIC CODING TYPES
 * ============================================================
 *
 * Kept for Coding Foundations and future courses.
 */

export interface CodingStep extends BaseLessonStep {
  type: never;

  language?: "java" | "javascript" | "html" | "python";

  starterCode?: string;

  solution?: string;

  hint?: string;

  testCases?: CodingTestCase[];
}

export interface CodingTestCase {
  id: string;

  input: string;

  expectedOutput: string;
}

/*
 * ============================================================
 * LEGACY / EXTENSIBILITY SUPPORT
 * ============================================================
 *
 * These allow future activities to carry additional metadata
 * without forcing the core What is AI? activities to fall back
 * to untyped objects.
 */

export interface ActivityState {
  completed: boolean;

  score?: number;

  attempts: number;

  correctActions?: number;

  totalActions?: number;

  startedAt?: number;

  completedAt?: number;
}