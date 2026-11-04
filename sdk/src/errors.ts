export type JointSaveErrorCode =
  | "MISSING_CONTRACT"
  | "INVALID_ARGUMENT"
  | "UNSUPPORTED"
  | "ACCOUNT_ERROR"
  | "SIMULATION_FAILED"
  | "SIGN_FAILED"
  | "SUBMIT_FAILED"
  | "TIMEOUT"
  | "DECODE_FAILED"
  | "RPC_ERROR";

export interface JointSaveErrorContext {
  method?: string | undefined;
  contract?: string | undefined;
  cause?: unknown;
}

export class JointSaveError extends Error {
  readonly code: JointSaveErrorCode;
  readonly method: string | undefined;
  readonly contract: string | undefined;
  readonly cause: unknown;

  constructor(code: JointSaveErrorCode, message: string, context: JointSaveErrorContext = {}) {
    super(message);
    this.name = "JointSaveError";
    this.code = code;
    this.method = context.method;
    this.contract = context.contract;
    this.cause = context.cause;
    Object.setPrototypeOf(this, JointSaveError.prototype);
  }
}

export interface FallbackErrorContext {
  code: JointSaveErrorCode;
  message?: string;
  method?: string | undefined;
  contract?: string | undefined;
}

export function toJointSaveError(error: unknown, fallback: FallbackErrorContext): JointSaveError {
  if (error instanceof JointSaveError) return error;
  const message = fallback.message ?? (error instanceof Error ? error.message : String(error));
  return new JointSaveError(fallback.code, message, {
    method: fallback.method,
    contract: fallback.contract,
    cause: error,
  });
}
