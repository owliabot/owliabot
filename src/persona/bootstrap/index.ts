import type { PersonaFrontmatter } from "../types.js";
import {
  DEFAULT_BOOTSTRAP_QUESTIONS,
  type PersonaBootstrapQuestion,
} from "./questions.js";
import {
  buildPersonaFrontmatter,
  assertValidAgentId,
  generatePersonaOverlay,
  type PersonaOverlayStatus,
} from "./generator.js";
import {
  validatePersonaFrontmatter,
  type PersonaValidationResult,
} from "./validator.js";

export interface BootstrapSessionOptions {
  agentId: string;
  rootDir?: string;
  personaDir?: string;
  questions?: PersonaBootstrapQuestion[];
  status?: PersonaOverlayStatus;
  now?: Date;
  body?: string;
}

export interface BootstrapCompletionResult {
  overlayPath: string;
  frontmatter: PersonaFrontmatter;
  validation: PersonaValidationResult;
  content: string;
}

export class BootstrapSession {
  private readonly options: BootstrapSessionOptions;
  private readonly questions: PersonaBootstrapQuestion[];
  private readonly answers: Record<string, unknown> = {};
  private readonly progress = new Set<string>();
  private started = false;
  private completed = false;

  constructor(options: BootstrapSessionOptions) {
    assertValidAgentId(options.agentId);
    this.options = options;
    this.questions = options.questions ?? DEFAULT_BOOTSTRAP_QUESTIONS;
  }

  start(): PersonaBootstrapQuestion | null {
    if (this.completed) {
      throw new Error("Bootstrap session already completed.");
    }
    this.started = true;
    return this.nextQuestion();
  }

  answer(questionId: string, value: unknown): PersonaBootstrapQuestion | null {
    this.ensureStarted();
    if (this.completed) {
      throw new Error("Bootstrap session already completed.");
    }

    const question = this.questions.find((entry) => entry.id === questionId);
    if (!question) {
      throw new Error(`Unknown bootstrap question: ${questionId}`);
    }

    this.progress.add(questionId);
    if (!isEmptyAnswer(value)) {
      this.answers[questionId] = value;
    } else {
      delete this.answers[questionId];
    }

    return this.nextQuestion();
  }

  async complete(): Promise<BootstrapCompletionResult> {
    this.ensureStarted();
    if (this.completed) {
      throw new Error("Bootstrap session already completed.");
    }
    this.completed = true;

    const generation = await generatePersonaOverlay({
      agentId: this.options.agentId,
      answers: this.answers,
      rootDir: this.options.rootDir,
      personaDir: this.options.personaDir,
      questions: this.questions,
      status: this.options.status,
      now: this.options.now,
      body: this.options.body,
    });
    const frontmatter = generation.frontmatter;
    const validation = validatePersonaFrontmatter(frontmatter);

    return {
      overlayPath: generation.path,
      frontmatter,
      validation,
      content: generation.content,
    };
  }

  private nextQuestion(): PersonaBootstrapQuestion | null {
    for (const question of this.questions) {
      if (!this.progress.has(question.id)) {
        return question;
      }
    }
    return null;
  }

  private ensureStarted() {
    if (!this.started) {
      throw new Error("Bootstrap session has not started.");
    }
  }
}

function isEmptyAnswer(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim().length === 0;
  }

  if (Array.isArray(value)) {
    const hasContent = value.some(
      (item) => typeof item === "string" && item.trim().length > 0
    );
    return !hasContent;
  }

  return false;
}

export {
  buildPersonaFrontmatter,
  generatePersonaOverlay,
  validatePersonaFrontmatter,
  DEFAULT_BOOTSTRAP_QUESTIONS,
  type PersonaBootstrapQuestion,
};
