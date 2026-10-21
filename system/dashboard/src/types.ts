export type SetupStatus = 'not_started' | 'in_progress' | 'complete'
export type Stage = 'orient' | 'opportunity_map' | 'blueprint' | 'build' | 'complete'
export type AssistantState = 'verified' | 'unverified' | 'blocked'

export interface Setup {
  status: SetupStatus | null
  stage: Stage | null
  discoveryPath: string | null
  orientationCompleted: number | null
  nextQuestion: string | null
}

export interface Assistant {
  name: string
  reach: 'opens' | 'reaches'
  state: AssistantState
  checked: string | null
}

export interface HomeBaseStatus {
  schemaVersion: number
  version: string | null
  setup: Setup
  projects: { active: string[] }
  systems: { active: string[]; building: string[]; designing: string[] }
  assistants: Assistant[]
  skills: { repository: number; user: number }
  adapters: { agentsMd: boolean; claudeMd: boolean; agentsSkills: boolean; claudeSkills: boolean }
  // Index entries written without a local link: counts only.
  unlinked: { projects: number; systems: number; skills: number; assistants: number }
}

// The user's look, from instance/dashboard/theme.json and theme.css.
export interface ThemeStatus {
  schemaVersion: number
  state: 'none' | 'applied' | 'not-applied'
  name: string | null
  notes: string[]
  customCss: boolean
}

export interface InstanceModule { id: string; title: string; url: string }
export interface ModuleApi { getStatus(): Promise<HomeBaseStatus>; dbName: string }
