export interface CodeBuddyModelDef {
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  input: ("text" | "image")[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

export const CODEBUDDY_MODELS: CodeBuddyModelDef[] = [
  // GLM Family
  {
    id: "glm-5.2",
    name: "GLM-5.2",
    reasoning: true,
    contextWindow: 1000000,
    maxTokens: 131072,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "glm-5.1",
    name: "GLM-5.1",
    reasoning: true,
    contextWindow: 200000,
    maxTokens: 48000,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "glm-5.3",
    name: "GLM-5.3",
    reasoning: true,
    contextWindow: 1000000,
    maxTokens: 131072,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "glm-5.3-flash",
    name: "GLM-5.3 Flash",
    reasoning: false,
    contextWindow: 1000000,
    maxTokens: 131072,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "glm-5.0",
    name: "GLM-5.0",
    reasoning: true,
    contextWindow: 200000,
    maxTokens: 48000,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "glm-5.0-turbo",
    name: "GLM-5.0 Turbo",
    reasoning: false,
    contextWindow: 200000,
    maxTokens: 48000,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "glm-4.7",
    name: "GLM-4.7",
    reasoning: false,
    contextWindow: 200000,
    maxTokens: 48000,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },

  // MiniMax Family
  {
    id: "minimax-m3",
    name: "MiniMax-M3",
    reasoning: true,
    contextWindow: 1000000,
    maxTokens: 131072,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "minimax-m2.7",
    name: "MiniMax-M2.7",
    reasoning: false,
    contextWindow: 204800,
    maxTokens: 131072,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },

  // Kimi Family
  {
    id: "kimi-k3-1",
    name: "Kimi-K3",
    reasoning: true,
    contextWindow: 1000000,
    maxTokens: 1048576,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "kimi-k2.8-preview",
    name: "Kimi-K2.8 Preview",
    reasoning: true,
    contextWindow: 300000,
    maxTokens: 131072,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "kimi-k2.7",
    name: "Kimi-K2.7-Code",
    reasoning: true,
    contextWindow: 262144,
    maxTokens: 65536,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "kimi-k2.6",
    name: "Kimi-K2.6",
    reasoning: true,
    contextWindow: 262144,
    maxTokens: 65536,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "kimi-k2.5",
    name: "Kimi-K2.5",
    reasoning: true,
    contextWindow: 164000,
    maxTokens: 32000,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },

  // DeepSeek Family
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek-V4-Pro",
    reasoning: true,
    contextWindow: 1000000,
    maxTokens: 393216,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "deepseek-v4.1-flash",
    name: "DeepSeek-V4.1-Flash",
    reasoning: false,
    contextWindow: 1000000,
    maxTokens: 393216,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "deepseek-v3-2-volc",
    name: "DeepSeek-V3.2",
    reasoning: false,
    contextWindow: 96000,
    maxTokens: 32000,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },

  // Tencent Hunyuan Family
  {
    id: "hy3",
    name: "Hunyuan 3",
    reasoning: true,
    contextWindow: 192000,
    maxTokens: 64000,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "hy3-preview",
    name: "Hy3 Preview",
    reasoning: true,
    contextWindow: 192000,
    maxTokens: 64000,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
  {
    id: "hy4-preview",
    name: "Hy4 Preview",
    reasoning: true,
    contextWindow: 1000000,
    maxTokens: 64000,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
];

export function getModelCatalog(): CodeBuddyModelDef[] {
  return [...CODEBUDDY_MODELS];
}
