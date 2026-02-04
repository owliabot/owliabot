import type { PersonaFrontmatter } from "../types.js";

export type PersonaAnswerType = "string" | "string[]";

export interface PersonaBootstrapQuestion {
  id: string;
  prompt: string;
  field: keyof PersonaFrontmatter;
  answerType: PersonaAnswerType;
  required: boolean;
}

export const DEFAULT_BOOTSTRAP_QUESTIONS: PersonaBootstrapQuestion[] = [
  {
    id: "name",
    prompt: "你希望我如何称呼你或这个角色？",
    field: "name",
    answerType: "string",
    required: true,
  },
  {
    id: "role",
    prompt: "这个角色的目标/职责是什么？",
    field: "role",
    answerType: "string",
    required: true,
  },
  {
    id: "mission",
    prompt: "是否有一句话使命或主要目标？（可选）",
    field: "mission",
    answerType: "string",
    required: false,
  },
  {
    id: "tone",
    prompt: "偏好的风格/语气有哪些？可用逗号或换行分隔。（可选）",
    field: "tone",
    answerType: "string[]",
    required: false,
  },
  {
    id: "boundaries",
    prompt: "有哪些明确的禁区/边界？可用逗号或换行分隔。",
    field: "boundaries",
    answerType: "string[]",
    required: true,
  },
  {
    id: "tools",
    prompt: "有哪些工具偏好或禁用？可用逗号或换行分隔。（可选）",
    field: "tools",
    answerType: "string[]",
    required: false,
  },
];
