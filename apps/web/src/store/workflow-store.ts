import { create } from "zustand";
import type { StepKey } from "@kys/shared";

interface WorkflowState {
  currentStep: StepKey;
  activeSourceId: number | null;
  activeExperienceId: number | null;
  setCurrentStep: (step: StepKey) => void;
  setActiveSourceId: (sourceId: number | null) => void;
  setActiveExperienceId: (experienceId: number | null) => void;
}

export const useWorkflowStore = create<WorkflowState>((set) => ({
  currentStep: "resume_import",
  activeSourceId: null,
  activeExperienceId: null,
  setCurrentStep: (currentStep) => set({ currentStep }),
  setActiveSourceId: (activeSourceId) => set({ activeSourceId }),
  setActiveExperienceId: (activeExperienceId) => set({ activeExperienceId }),
}));
