import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { RhythmPlan } from './models';

export type NativeWorkoutStatus = 'idle' | 'running' | 'paused' | 'complete';

export type NativeWorkoutSnapshot = {
  active: boolean;
  status: NativeWorkoutStatus;
  stageIndex: number;
  remaining: number;
  planId: string;
};

type NativeWorkoutTimerModule = {
  start(config: {
    planId: string;
    planTitle: string;
    stages: Array<{ name: string; cue: string; durationSec: number; musicName?: string; musicUri?: string }>;
    stageIndex: number;
    remainingSec: number;
    voiceEnabled: boolean;
    vibrationEnabled: boolean;
    voiceVolume: number;
    musicVolume: number;
    tickUri?: string;
  }): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  skip(): Promise<void>;
  reset(): Promise<void>;
  getSnapshot(): Promise<NativeWorkoutSnapshot>;
};

const nativeModule = Platform.OS === 'android'
  ? requireOptionalNativeModule<NativeWorkoutTimerModule>('RhythmWorkoutTimer')
  : null;

export const hasNativeWorkoutTimer = nativeModule !== null;

export function startNativeWorkoutTimer(
  plan: RhythmPlan,
  stageIndex: number,
  remainingSec: number,
  settings: { voiceEnabled: boolean; vibrationEnabled: boolean; voiceVolume: number; musicVolume: number },
  tickUri: string | null
) {
  return nativeModule?.start({
    planId: plan.id,
    planTitle: plan.title,
    stages: plan.stages.map((stage) => ({
      name: stage.name,
      cue: stage.cue ?? '',
      durationSec: stage.durationSec,
      musicName: stage.music?.name,
      musicUri: stage.music?.uri,
    })),
    stageIndex,
    remainingSec,
    voiceEnabled: settings.voiceEnabled,
    vibrationEnabled: settings.vibrationEnabled,
    voiceVolume: settings.voiceVolume,
    musicVolume: settings.musicVolume,
    tickUri: tickUri ?? undefined,
  }) ?? Promise.resolve();
}

export const pauseNativeWorkoutTimer = () => nativeModule?.pause() ?? Promise.resolve();
export const resumeNativeWorkoutTimer = () => nativeModule?.resume() ?? Promise.resolve();
export const skipNativeWorkoutStage = () => nativeModule?.skip() ?? Promise.resolve();
export const resetNativeWorkoutTimer = () => nativeModule?.reset() ?? Promise.resolve();
export const getNativeWorkoutSnapshot = () => nativeModule?.getSnapshot() ?? Promise.resolve(null);
