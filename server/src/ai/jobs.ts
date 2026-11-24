// The jobs Leeway pays an AI model for, each with its own model. Usage is
// recorded by job, so the owner sees what each one costs.

import type { ModelId } from './models.js'

export const AI_JOBS = ['summary', 'paystub', 'chat'] as const

export type AiJob = (typeof AI_JOBS)[number]

export interface JobInfo {
  /** Shown in Settings. */
  title: string
  description: string
  /** The small model: each job is short and routine. */
  defaultModel: ModelId
  /** The server variable that fixes the model, overriding the owner's pick. */
  envVar: string
}

export const JOB_INFO: Record<AiJob, JobInfo> = {
  summary: {
    title: 'Dashboard summary',
    description: 'A few sentences on how the period is going, a few times a day at most.',
    defaultModel: 'claude-haiku-5-5',
    envVar: 'SUMMARY_MODEL',
  },
  paystub: {
    title: 'Paystub reader',
    description: 'Reads the figures off a paystub you upload, once per file.',
    defaultModel: 'claude-haiku-5-5',
    envVar: 'PAYSTUB_MODEL',
  },
  chat: {
    title: 'Chat',
    description: 'Answers what you ask in Chat, a few calls for each question.',
    defaultModel: 'claude-haiku-5-5',
    envVar: 'CHAT_MODEL',
  },
}
