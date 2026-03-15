export const agentResponseSchema = {
  name: "agent_copilot_response",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string" },
      thesis: { type: "string" },
      nextAction: { type: "string" },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
    },
    required: ["answer", "thesis", "nextAction", "confidence"],
  },
} as const;
