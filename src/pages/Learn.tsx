import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";

import { useAuth } from "../auth/AuthContext";

import { learningEngine } from "../core/learning";
import { evaluationEngine } from "../core/evaluation";
import { javaExecutionEngine } from "../core/execution";

import type { Evaluation } from "../core/evaluation/Evaluation";
import type { JavaExecutionResult } from "../core/execution/JavaExecution";
import type { Progress } from "../core/progress/Progress";

function Learn() {
  const { user } = useAuth();

  const lessons = learningEngine.getLessons();

  const [currentLesson, setCurrentLesson] = useState(0);

  const [code, setCode] = useState(() => {
    const firstLesson = lessons[0];

    if (!firstLesson) {
      return "";
    }

    const firstChallenge =
      learningEngine.getLessonChallenges(
        firstLesson.id
      )[0];

    return firstChallenge?.starterCode ?? "";
  });

  const [input, setInput] = useState("");

  const [submitted, setSubmitted] =
    useState(false);

  const [evaluation, setEvaluation] =
    useState<Evaluation | null>(null);

  const [executionResult, setExecutionResult] =
    useState<JavaExecutionResult | null>(null);

  const [isRunning, setIsRunning] =
    useState(false);

  const [consoleTab, setConsoleTab] =
    useState<"output" | "input">("output");

  const [progress, setProgress] =
    useState<Progress | null>(null);

  const [isLoadingProgress, setIsLoadingProgress] =
    useState(true);

  const lesson = lessons[currentLesson];

  const challenge = lesson
    ? learningEngine.getLessonChallenges(
        lesson.id
      )[0]
    : undefined;

  // -----------------------------------------
  // LOAD PROGRESS FROM BACKEND
  // -----------------------------------------

  useEffect(() => {
    if (!user) {
      setProgress(null);
      setIsLoadingProgress(false);
      return;
    }

    const loadProgress = async () => {
      setIsLoadingProgress(true);

      try {
        const response = await fetch(
          `http://localhost:3001/api/progress/${user.id}`
        );

        if (!response.ok) {
          throw new Error(
            "Unable to load progress."
          );
        }

        const data: Progress =
          await response.json();

        setProgress(data);

        /*
         * If the backend remembers the student's
         * current lesson, open that lesson.
         */
        if (data.currentLessonId) {
          const savedLessonIndex =
            lessons.findIndex(
              (item) =>
                item.id ===
                data.currentLessonId
            );

          if (savedLessonIndex >= 0) {
            setCurrentLesson(
              savedLessonIndex
            );

            const savedLesson =
              lessons[savedLessonIndex];

            const savedChallenge =
              learningEngine.getLessonChallenges(
                savedLesson.id
              )[0];

            setCode(
              savedChallenge?.starterCode ??
                ""
            );
          }
        }
      } catch (error) {
        console.error(
          "Failed to load progress:",
          error
        );
      } finally {
        setIsLoadingProgress(false);
      }
    };

    loadProgress();
  }, [user, lessons]);

  // -----------------------------------------
  // CHANGE LESSON
  // -----------------------------------------

  const handleLessonChange = async (
    index: number
  ) => {
    const nextLesson = lessons[index];

    const nextChallenge = nextLesson
      ? learningEngine.getLessonChallenges(
          nextLesson.id
        )[0]
      : undefined;

    setCurrentLesson(index);

    setCode(
      nextChallenge?.starterCode ?? ""
    );

    setInput("");
    setSubmitted(false);
    setEvaluation(null);
    setExecutionResult(null);
    setConsoleTab("output");

    if (!nextLesson || !user) {
      return;
    }

    try {
      const response = await fetch(
        "http://localhost:3001/api/progress/current-lesson",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            studentId: user.id,
            lessonId: nextLesson.id,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          "Unable to save current lesson."
        );
      }

      const updatedProgress: Progress =
        await response.json();

      setProgress(updatedProgress);
    } catch (error) {
      console.error(
        "Failed to save current lesson:",
        error
      );
    }
  };

  // -----------------------------------------
  // RUN JAVA CODE
  // -----------------------------------------

  const handleRun = async () => {
    if (!code.trim() || isRunning) {
      return;
    }

    setIsRunning(true);
    setExecutionResult(null);
    setConsoleTab("output");

    try {
      const result =
        await javaExecutionEngine.execute({
          code,
          stdin: input,
        });

      setExecutionResult(result);
    } catch (error) {
      setExecutionResult({
        status: "error",
        stdout: "",
        stderr:
          error instanceof Error
            ? error.message
            : "Unable to execute Java code.",
        exitCode: null,
        executionTimeMs: 0,
      });
    } finally {
      setIsRunning(false);
    }
  };

  // -----------------------------------------
  // SUBMIT ANSWER
  // -----------------------------------------

  const handleSubmit = async () => {
    if (!challenge || !lesson || !user) {
      return;
    }

    const result =
      evaluationEngine.evaluate(
        code,
        challenge.solution,
        lesson.conceptIds
      );

    setEvaluation(result);
    setSubmitted(true);

    /*
     * Save the attempt to the backend.
     */
    try {
      const response = await fetch(
        "http://localhost:3001/api/progress/evaluation",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            studentId: user.id,
            lessonId: lesson.id,
            conceptIds:
              lesson.conceptIds,
            correct:
              result.status === "correct",
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          "Unable to save evaluation."
        );
      }

      const updatedProgress: Progress =
        await response.json();

      setProgress(updatedProgress);
    } catch (error) {
      console.error(
        "Failed to save evaluation:",
        error
      );
    }
  };

  // -----------------------------------------
  // AUTHENTICATION CHECK
  // -----------------------------------------

  if (!user) {
    return (
      <div className="app">
        <header className="app-header">
          <div className="brand">
            NeuroCode
          </div>
        </header>

        <main className="lesson-content">
          <h1>Sign in to continue</h1>

          <p>
            You need to be logged in to access
            your lessons and save your progress.
          </p>
        </main>
      </div>
    );
  }

  // -----------------------------------------
  // PROGRESS LOADING
  // -----------------------------------------

  if (isLoadingProgress) {
    return (
      <div className="app">
        <header className="app-header">
          <div className="brand">
            NeuroCode
          </div>
        </header>

        <main className="lesson-content">
          <h1>Loading your progress...</h1>

          <p>
            We're getting your lessons ready.
          </p>
        </main>
      </div>
    );
  }

  // -----------------------------------------
  // LESSON NOT FOUND
  // -----------------------------------------

  if (!lesson) {
    return (
      <div className="app">
        <header className="app-header">
          <div className="brand">
            NeuroCode
          </div>
        </header>

        <main className="lesson-content">
          <h1>Lesson not found</h1>

          <p>
            This lesson could not be found in
            the current curriculum.
          </p>
        </main>
      </div>
    );
  }

  // -----------------------------------------
  // CHALLENGE NOT FOUND
  // -----------------------------------------

  if (!challenge) {
    return (
      <div className="app">
        <header className="app-header">
          <div className="brand">
            NeuroCode
          </div>
        </header>

        <main className="lesson-content">
          <h1>Challenge not found</h1>

          <p>
            This lesson does not currently
            have a valid challenge attached to
            it.
          </p>
        </main>
      </div>
    );
  }

  // -----------------------------------------
  // DERIVED DATA
  // -----------------------------------------

  const progressPercentage =
    lessons.length > 0
      ? ((currentLesson + 1) /
          lessons.length) *
        100
      : 0;

  const concepts =
    learningEngine.getLessonConcepts(
      lesson.id
    );

  const completedLessonIds =
    progress?.completedLessonIds ?? [];

  // -----------------------------------------
  // RENDER
  // -----------------------------------------

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          NeuroCode
        </div>

        <div className="progress">
          <span>
            Java Fundamentals
          </span>

          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{
                width: `${progressPercentage}%`,
              }}
            />
          </div>

          <span>
            {Math.round(
              progressPercentage
            )}
            %
          </span>
        </div>
      </header>

      <main className="learning-layout">
        <aside className="lesson-sidebar">
          <p className="sidebar-label">
            JAVA FUNDAMENTALS
          </p>

          {lessons.map(
            (item, index) => {
              const isCompleted =
                completedLessonIds.includes(
                  item.id
                );

              return (
                <button
                  key={item.id}
                  className={`lesson ${
                    index ===
                    currentLesson
                      ? "active"
                      : ""
                  }`}
                  onClick={() =>
                    handleLessonChange(
                      index
                    )
                  }
                >
                  <span>
                    {String(
                      item.number
                    ).padStart(
                      2,
                      "0"
                    )}
                  </span>

                  <div>
                    <strong>
                      {item.title}
                    </strong>

                    <small>
                      {isCompleted
                        ? "Completed"
                        : index ===
                          currentLesson
                        ? "Currently learning"
                        : index <
                          currentLesson
                        ? "In progress"
                        : "Up next"}
                    </small>
                  </div>
                </button>
              );
            }
          )}
        </aside>

        <section className="lesson-content">
          <p className="eyebrow">
            LESSON{" "}
            {String(
              lesson.number
            ).padStart(2, "0")}
          </p>

          <h1>
            {lesson.title}
          </h1>

          <p className="lesson-intro">
            {lesson.description}
          </p>

          <div className="concept-card">
            <h2>
              What you'll learn
            </h2>

            <p>
              {lesson.description}
            </p>

            <h3>
              Concepts
            </h3>

            <ul>
              {concepts.map(
                (concept) => (
                  <li
                    key={
                      concept.id
                    }
                  >
                    <strong>
                      {concept.name}
                    </strong>

                    <span>
                      {" "}
                      —{" "}
                      {
                        concept.description
                      }
                    </span>
                  </li>
                )
              )}
            </ul>
          </div>

          <div className="challenge-card">
            <div className="challenge-header">
              <span>
                TRY IT
              </span>

              <span>
                {challenge.difficulty.toUpperCase()}
              </span>
            </div>

            <h2>
              {challenge.title}
            </h2>

            <p>
              {challenge.prompt}
            </p>

            <div className="coding-workspace">
              {/* EDITOR TOOLBAR */}

              <div className="editor-toolbar">
                <div className="editor-language">
                  <span className="language-dot" />

                  <span>
                    Java
                  </span>
                </div>

                <button
                  className="run-button"
                  onClick={
                    handleRun
                  }
                  disabled={
                    isRunning
                  }
                >
                  {isRunning
                    ? "Running..."
                    : "▶ Run"}
                </button>
              </div>

              {/* MONACO EDITOR */}

              <div className="editor-container">
                <Editor
                  height="420px"
                  defaultLanguage="java"
                  theme="vs-dark"
                  value={code}
                  onChange={(
                    value
                  ) => {
                    setCode(
                      value ?? ""
                    );

                    setSubmitted(
                      false
                    );

                    setEvaluation(
                      null
                    );

                    setExecutionResult(
                      null
                    );
                  }}
                  options={{
                    minimap: {
                      enabled:
                        false,
                    },

                    fontSize: 14,

                    lineNumbers:
                      "on",

                    automaticLayout:
                      true,

                    scrollBeyondLastLine:
                      false,

                    padding: {
                      top: 16,
                      bottom: 16,
                    },

                    tabSize: 4,

                    wordWrap: "on",

                    formatOnPaste:
                      true,

                    formatOnType:
                      true,
                  }}
                />
              </div>

              {/* CONSOLE */}

              <div className="workspace-console">
                <div className="console-header">
                  <div className="console-tabs">
                    <button
                      className={`console-tab ${
                        consoleTab ===
                        "output"
                          ? "active"
                          : ""
                      }`}
                      onClick={() =>
                        setConsoleTab(
                          "output"
                        )
                      }
                    >
                      OUTPUT
                    </button>

                    <button
                      className={`console-tab ${
                        consoleTab ===
                        "input"
                          ? "active"
                          : ""
                      }`}
                      onClick={() =>
                        setConsoleTab(
                          "input"
                        )
                      }
                    >
                      INPUT
                    </button>
                  </div>

                  <span
                    className={`console-status ${
                      executionResult?.status ??
                      ""
                    }`}
                  >
                    {executionResult
                      ? executionResult.status.toUpperCase()
                      : "READY"}
                  </span>
                </div>

                {/* INPUT TAB */}

                {consoleTab ===
                  "input" && (
                  <div className="console-panel">
                    <div className="console-section-title">
                      PROGRAM INPUT
                    </div>

                    <textarea
                      value={
                        input
                      }
                      onChange={(
                        event
                      ) =>
                        setInput(
                          event.target
                            .value
                        )
                      }
                      placeholder="Enter input your program should read..."
                      spellCheck={
                        false
                      }
                    />
                  </div>
                )}

                {/* OUTPUT TAB */}

                {consoleTab ===
                  "output" && (
                  <div className="console-panel">
                    <div className="console-section-title">
                      PROGRAM OUTPUT
                    </div>

                    {executionResult?.stdout && (
                      <pre>
                        {
                          executionResult.stdout
                        }
                      </pre>
                    )}

                    {executionResult?.stderr && (
                      <pre className="error-output">
                        {
                          executionResult.stderr
                        }
                      </pre>
                    )}

                    {!executionResult?.stdout &&
                      !executionResult?.stderr && (
                        <div className="console-empty">
                          Run your program
                          to see output.
                        </div>
                      )}

                    {executionResult && (
                      <div className="execution-meta">
                        Execution time:{" "}
                        {
                          executionResult.executionTimeMs
                        }
                        ms
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* SUBMIT */}

            <button
              className="submit-button"
              onClick={
                handleSubmit
              }
            >
              Submit Answer
            </button>

            {/* EVALUATION */}

            {submitted &&
              evaluation && (
                <div
                  className={`feedback ${
                    evaluation.status ===
                    "correct"
                      ? "correct"
                      : "incorrect"
                  }`}
                >
                  {evaluation.status ===
                  "correct" ? (
                    <>
                      <strong>
                        Nice work! 🎉
                      </strong>

                      <p>
                        {
                          evaluation.message
                        }
                      </p>
                    </>
                  ) : (
                    <>
                      <strong>
                        {evaluation.status ===
                        "error"
                          ? "Something went wrong."
                          : "Not quite yet."}
                      </strong>

                      <p>
                        {
                          evaluation.message
                        }
                      </p>

                      {evaluation.hints
                        .length >
                        0 && (
                        <ul>
                          {evaluation.hints.map(
                            (
                              hint
                            ) => (
                              <li
                                key={
                                  hint
                                }
                              >
                                {
                                  hint
                                }
                              </li>
                            )
                          )}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default Learn;