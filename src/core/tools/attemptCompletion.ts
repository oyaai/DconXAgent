import { defineTool, optionalString } from "./types";

export const attemptCompletion = defineTool(
  "attempt_completion",
  "Call when the task is done or you need the user to decide something. Ends your turn.",
  {
    properties: {
      summary: { type: "string", description: "What you did, or what you need from the user." },
    },
    required: ["summary"],
  },
  async (args) => ({ text: optionalString(args, "summary", "Done."), done: true })
);
