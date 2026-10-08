import * as path from 'node:path';

const generation = require(path.join(__dirname, '..', '..', '..', 'lib', 'generation.js'));

export interface GenerationBrief {
  flowId: string;
  title: string;
  goal: string;
  audience?: string;
  steps: Array<{ title: string; description: string; action?: string }>;
}

export interface GeneratedDraft {
  engine: string;
  baseStamp: string;
  brief: GenerationBrief;
  designSystem: string | null;
  flow: { id: string; title: string; orchestrator: string; route: string; approved: false; status: 'draft' };
  frames: Array<{ id: string; file: string; label: string; summary: string; flow: string; testHooks: string[]; html: string }>;
}

export const generateDraft: (brief: unknown, context: { baseStamp: string; designSystem?: unknown }) => GeneratedDraft = generation.generateDraft;
