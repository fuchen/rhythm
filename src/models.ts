export type Stage = {
  id: string;
  name: string;
  durationSec: number;
  cue?: string;
  music?: MusicSelection;
};

export type MusicSelection = {
  name: string;
  uri: string;
};

export type RhythmPlan = {
  id: string;
  title: string;
  description: string;
  emoji: string;
  accent: string;
  stages: Stage[];
  updatedAt: number;
};

export type Screen = 'home' | 'plans' | 'edit' | 'workout' | 'settings';

export const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes === 0) return `${remainingSeconds}秒`;
  if (remainingSeconds === 0) return `${minutes}分钟`;
  return `${minutes}分${remainingSeconds}秒`;
};

export const formatClock = (seconds: number) => {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainingSeconds = Math.max(0, seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
};

export const planDuration = (plan: RhythmPlan) =>
  plan.stages.reduce((total, stage) => total + stage.durationSec, 0);
