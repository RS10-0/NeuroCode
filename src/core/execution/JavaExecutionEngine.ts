import type {
  JavaExecutionRequest,
  JavaExecutionResult,
} from "./JavaExecution";

export class JavaExecutionEngine {
  private readonly backendUrl =
    "http://localhost:3001";

  async execute(
    request: JavaExecutionRequest
  ): Promise<JavaExecutionResult> {
    if (!request.code.trim()) {
      return {
        status: "error",
        stdout: "",
        stderr: "No code was provided.",
        exitCode: null,
        executionTimeMs: 0,
      };
    }

    const startTime = performance.now();

    try {
      const response = await fetch(
        `${this.backendUrl}/api/execute`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            code: request.code,
            stdin: request.stdin ?? "",
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        return {
          status: "error",
          stdout: "",
          stderr:
            data.error ?? "Execution request failed.",
          exitCode: null,
          executionTimeMs:
            performance.now() - startTime,
        };
      }

      return {
        status: data.status ?? "error",
        stdout: data.stdout ?? "",
        stderr: data.stderr ?? "",
        exitCode: data.exitCode ?? null,
        executionTimeMs:
          data.executionTimeMs ??
          performance.now() - startTime,
      };
    } catch (error) {
      return {
        status: "error",
        stdout: "",
        stderr:
          error instanceof Error
            ? error.message
            : "Could not connect to the backend.",
        exitCode: null,
        executionTimeMs:
          performance.now() - startTime,
      };
    }
  }
}
