/** Thrown when a guardrail refuses an operation. Surfaced to the model as `GUARD: …`. */
export class GuardError extends Error {
  override readonly name = "GuardError";
}

/** Thrown when the Ollama server is unreachable or returns an error. */
export class OllamaError extends Error {
  override readonly name = "OllamaError";
}
