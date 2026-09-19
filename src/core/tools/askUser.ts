import { defineTool, requireString } from "./types";

const MAX_OPTIONS = 5;

/**
 * Lets the model ask a real question instead of printing a numbered menu as
 * prose and hoping the user replies "2".
 *
 * Small local models reach for that pattern constantly. Giving them a tool that
 * does it properly — and telling them in the prompt to use it — turns a dead end
 * ("Please respond with a number") into clickable buttons.
 *
 * Ends the turn: the user's click arrives as the next message.
 */
export const askUser = defineTool(
  "ask_user",
  "Ask the user a question and offer them choices. Use this WHENEVER you need a decision: " +
    "where to create a project, which file to work on, which approach to take. " +
    "NEVER write a numbered menu in your reply text — call this instead. Ends your turn.",
  {
    properties: {
      question: { type: "string", description: "One clear question." },
      options: {
        type: "array",
        items: { type: "string" },
        description:
          "Up to 5 short answers the user can click. Omit for an open question they type themselves.",
      },
    },
    required: ["question"],
  },
  async (args, ctx) => {
    const question = requireString(args, "question");

    const raw = Array.isArray(args.options) ? args.options : [];
    const options = raw
      .map((o) => (typeof o === "string" ? o.trim() : ""))
      .filter((o) => o !== "")
      .slice(0, MAX_OPTIONS);

    ctx.onEvent({ type: "question", question, options });

    return {
      done: true,
      text:
        options.length > 0
          ? `Asked the user: "${question}" with options: ${options.join(" | ")}. Waiting for their answer.`
          : `Asked the user: "${question}". Waiting for their answer.`,
    };
  }
);
