export type ExecutionStatus =
  | "success"
  | "compile_error"
  | "runtime_error"
  | "timeout"
  | "error";

export interface JavaExecutionRequest {
  code: string;
  stdin?: string;
  timeoutMs?: number;
}

export interface JavaExecutionResult {
  status: ExecutionStatus;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  executionTimeMs: number;
}