import { StatusBar } from 'expo-status-bar';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { getDocumentAsync } from 'expo-document-picker';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { convertMidiToWav, isMidiFile } from './src/midi';
import { ensureTickSoundAsync } from './src/tickSound';
import {
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { starterPlans } from './src/defaults';
import { formatClock, formatDuration, planDuration, RhythmPlan, Screen, Stage } from './src/models';

const STORAGE_KEY = '@rhythm/plans-v1';
const SETTINGS_KEY = '@rhythm/settings-v1';
const DEFAULT_MUSIC_VOLUME = 0.7;
const SPEECH_MUSIC_VOLUME_RATIO = 0.15;
const DURATION_WHEEL_ROW_HEIGHT = 54;
const DEFAULT_MAX_DURATION_MINUTES = 60;
const CIRCULAR_WHEEL_COPIES = 5;

type Settings = {
  voiceEnabled: boolean;
  vibrationEnabled: boolean;
  largeText: boolean;
};

const defaultSettings: Settings = {
  voiceEnabled: true,
  vibrationEnabled: true,
  largeText: false,
};

const colors = {
  ink: '#20322F',
  muted: '#6B7F7A',
  paper: '#F6F8F4',
  card: '#FFFFFF',
  line: '#E2EAE5',
  green: '#1D7A62',
  greenSoft: '#DCEEE7',
  orange: '#C46B32',
  orangeSoft: '#F8E9DC',
  yellow: '#B8860B',
  yellowSoft: '#F6EFCF',
  danger: '#B54A45',
};

const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const clampMusicVolume = (value: number) => Math.min(1, Math.max(0, Math.round(value * 10) / 10));

export default function App() {
  const [plans, setPlans] = useState<RhythmPlan[]>(starterPlans);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [hydrated, setHydrated] = useState(false);
  const [screen, setScreen] = useState<Screen>('home');
  const [editReturnScreen, setEditReturnScreen] = useState<Screen>('home');
  const [workoutReturnScreen, setWorkoutReturnScreen] = useState<Screen>('home');
  const [activePlanId, setActivePlanId] = useState(starterPlans[0].id);
  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === activePlanId) ?? plans[0],
    [activePlanId, plans]
  );

  useEffect(() => {
    const load = async () => {
      try {
        const [savedPlans, savedSettings] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(SETTINGS_KEY),
        ]);
        if (savedPlans) {
          const parsed = JSON.parse(savedPlans) as RhythmPlan[];
          if (Array.isArray(parsed) && parsed.length > 0) setPlans(parsed);
        }
        if (savedSettings) {
          const parsed = JSON.parse(savedSettings) as Partial<Settings>;
          setSettings({ ...defaultSettings, ...parsed });
        }
      } catch {
        // The starter plans remain available when local data cannot be read.
      } finally {
        setHydrated(true);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    if (hydrated) void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
  }, [hydrated, plans]);

  useEffect(() => {
    if (hydrated) void AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [hydrated, settings]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'workout') {
        setScreen(workoutReturnScreen);
        return true;
      }
      if (screen === 'edit') {
        setScreen(editReturnScreen);
        return true;
      }
      if (screen === 'plans' || screen === 'settings') {
        setScreen('home');
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [editReturnScreen, screen, workoutReturnScreen]);

  const updatePlan = useCallback((id: string, updater: (plan: RhythmPlan) => RhythmPlan) => {
    setPlans((current) => current.map((plan) => (plan.id === id ? updater(plan) : plan)));
  }, []);

  const selectPlan = useCallback((plan: RhythmPlan, nextScreen: Screen = 'edit') => {
    setActivePlanId(plan.id);
    if (nextScreen === 'workout') setWorkoutReturnScreen(screen);
    if (nextScreen === 'edit') setEditReturnScreen(screen);
    setScreen(nextScreen);
  }, [screen]);

  return (
    <View style={styles.app}>
      <StatusBar style="dark" />
      {screen === 'home' && (
        <HomeScreen
          plans={plans}
          activePlan={activePlan}
          onStart={(plan) => selectPlan(plan, 'workout')}
          onOpenPlan={(plan) => selectPlan(plan)}
          onSeePlans={() => setScreen('plans')}
          onSettings={() => setScreen('settings')}
        />
      )}
      {screen === 'plans' && (
        <PlansScreen
          plans={plans}
          onBack={() => setScreen('home')}
          onOpen={(plan) => selectPlan(plan)}
          onStart={(plan) => selectPlan(plan, 'workout')}
          onNew={() => {
            const newPlan: RhythmPlan = {
              id: makeId('plan'),
              title: '我的新计划',
              description: '按自己的节奏开始训练。',
              emoji: '✨',
              accent: colors.green,
              stages: [{ id: makeId('stage'), name: '准备', durationSec: 60, cue: '准备开始' }],
              updatedAt: Date.now(),
            };
            setPlans((current) => [newPlan, ...current]);
            setActivePlanId(newPlan.id);
            setEditReturnScreen('plans');
            setScreen('edit');
          }}
        />
      )}
      {screen === 'edit' && activePlan && (
        <EditorScreen
          plan={activePlan}
          onBack={() => setScreen(editReturnScreen)}
          onStart={() => { setWorkoutReturnScreen('edit'); setScreen('workout'); }}
          onUpdate={(updater) => updatePlan(activePlan.id, updater)}
          onDuplicate={() => {
            const duplicate = { ...activePlan, id: makeId('plan'), title: `${activePlan.title} 副本`, updatedAt: Date.now(), stages: activePlan.stages.map((stage) => ({ ...stage, id: makeId('stage') })) };
            setPlans((current) => [duplicate, ...current]);
            setActivePlanId(duplicate.id);
          }}
          onDelete={() => {
            if (plans.length === 1) {
              Alert.alert('至少保留一个计划', '可以先新建一个计划，再删除当前计划。');
              return;
            }
            Alert.alert('删除这个计划？', '删除后无法从应用内恢复。', [
              { text: '取消', style: 'cancel' },
              { text: '删除', style: 'destructive', onPress: () => { setPlans((current) => current.filter((item) => item.id !== activePlan.id)); setScreen('plans'); } },
            ]);
          }}
        />
      )}
      {screen === 'workout' && activePlan && (
        <WorkoutScreen
          plan={activePlan}
          settings={settings}
          onBack={() => setScreen(workoutReturnScreen)}
          onSettings={() => setScreen('settings')}
        />
      )}
      {screen === 'settings' && (
        <SettingsScreen
          settings={settings}
          onBack={() => setScreen('home')}
          onChange={(key, value) => setSettings((current) => ({ ...current, [key]: value }))}
        />
      )}
      {screen !== 'workout' && <BottomNav screen={screen} onNavigate={setScreen} />}
    </View>
  );
}

function HomeScreen({
  plans,
  activePlan,
  onStart,
  onOpenPlan,
  onSeePlans,
  onSettings,
}: {
  plans: RhythmPlan[];
  activePlan: RhythmPlan;
  onStart: (plan: RhythmPlan) => void;
  onOpenPlan: (plan: RhythmPlan) => void;
  onSeePlans: () => void;
  onSettings: () => void;
}) {
  return (
    <ScreenContainer>
      <ScrollView style={styles.flex} contentContainerStyle={styles.homeContent} showsVerticalScrollIndicator={false}>
        <View style={styles.homeHeader}>
          <View>
            <Text style={styles.eyebrow}>早上好，准备动一动吗</Text>
            <Text style={styles.brand}>节奏伴侣</Text>
          </View>
          <Pressable style={styles.iconButton} onPress={onSettings} accessibilityLabel="打开设置">
            <Text style={styles.iconButtonText}>⚙</Text>
          </Pressable>
        </View>

        <View style={styles.welcomeCard}>
          <View style={styles.welcomeCopy}>
            <Text style={styles.welcomeTitle}>今天也按自己的节奏</Text>
            <Text style={styles.welcomeText}>不用盯着手机，听到提示就知道下一步。</Text>
            <Pressable style={styles.primaryButton} onPress={() => onStart(activePlan)} accessibilityRole="button">
              <Text style={styles.primaryButtonText}>开始上次训练</Text>
              <Text style={styles.primaryButtonArrow}>→</Text>
            </Pressable>
          </View>
          <Text style={styles.welcomeEmoji}>🌱</Text>
        </View>

        <SectionHeading title="我的常用计划" action="查看全部" onAction={onSeePlans} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
          {plans.slice(0, 3).map((plan) => (
            <PlanMiniCard key={plan.id} plan={plan} onPress={() => onOpenPlan(plan)} />
          ))}
        </ScrollView>
      </ScrollView>
    </ScreenContainer>
  );
}

function PlansScreen({
  plans,
  onBack,
  onOpen,
  onStart,
  onNew,
}: {
  plans: RhythmPlan[];
  onBack: () => void;
  onOpen: (plan: RhythmPlan) => void;
  onStart: (plan: RhythmPlan) => void;
  onNew: () => void;
}) {
  return (
    <ScreenContainer>
      <Header title="我的计划" onBack={onBack} />
      <View style={styles.libraryIntro}>
        <Text style={styles.pageTitle}>按计划运动</Text>
        <Text style={styles.pageSubtitle}>创建适合自己的节奏，随时开始。</Text>
        <Pressable style={styles.outlineButton} onPress={onNew}>
          <Text style={styles.outlineButtonPlus}>＋</Text>
          <Text style={styles.outlineButtonText}>新建计划</Text>
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.planList}>
        {plans.map((plan) => <PlanCard key={plan.id} plan={plan} onOpen={() => onOpen(plan)} onStart={() => onStart(plan)} />)}
      </ScrollView>
    </ScreenContainer>
  );
}

function EditorScreen({
  plan,
  onBack,
  onStart,
  onUpdate,
  onDuplicate,
  onDelete,
}: {
  plan: RhythmPlan;
  onBack: () => void;
  onStart: () => void;
  onUpdate: (updater: (plan: RhythmPlan) => RhythmPlan) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [newStageName, setNewStageName] = useState('');
  const [newStageDurationSec, setNewStageDurationSec] = useState(120);
  const [durationPicker, setDurationPicker] = useState<{ stageId: string | null; seconds: number } | null>(null);
  const [musicImporting, setMusicImporting] = useState(false);
  const total = planDuration(plan);

  const addStage = () => {
    if (newStageDurationSec < 1) {
      Alert.alert('请输入时长', '阶段时长至少需要 1 秒。');
      return;
    }
    onUpdate((current) => ({
      ...current,
      updatedAt: Date.now(),
      stages: [...current.stages, { id: makeId('stage'), name: newStageName.trim() || '新阶段', durationSec: newStageDurationSec, cue: '准备进入下一阶段' }],
    }));
    setNewStageName('');
    setNewStageDurationSec(120);
  };

  const confirmDuration = (seconds: number) => {
    if (seconds < 1) {
      Alert.alert('请输入时长', '阶段时长至少需要 1 秒。');
      return;
    }
    if (durationPicker?.stageId) {
      onUpdate((current) => ({
        ...current,
        updatedAt: Date.now(),
        stages: current.stages.map((stage) => stage.id === durationPicker.stageId ? { ...stage, durationSec: seconds } : stage),
      }));
    } else {
      setNewStageDurationSec(seconds);
    }
    setDurationPicker(null);
  };

  return (
    <ScreenContainer>
      <Header title="编辑计划" onBack={onBack} right={<Pressable onPress={onDuplicate}><Text style={styles.headerAction}>复制</Text></Pressable>} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.editorContent} keyboardShouldPersistTaps="handled">
          <View style={styles.editorHero}>
            <Text style={styles.editorEmoji}>{plan.emoji}</Text>
            <View style={styles.editorHeroCopy}>
              <TextInput
                value={plan.title}
                onChangeText={(title) => onUpdate((current) => ({ ...current, title, updatedAt: Date.now() }))}
                style={styles.editorTitleInput}
                placeholder="计划名称"
                accessibilityLabel="计划名称"
              />
              <TextInput
                value={plan.description}
                onChangeText={(description) => onUpdate((current) => ({ ...current, description, updatedAt: Date.now() }))}
                style={styles.editorDescriptionInput}
                placeholder="写一句说明"
                multiline
                accessibilityLabel="计划说明"
              />
            </View>
          </View>

          <View style={styles.summaryRow}>
            <SummaryItem label="总时长" value={formatDuration(total)} />
            <SummaryItem label="阶段数" value={`${plan.stages.length} 段`} />
            <SummaryItem label="提示方式" value="语音＋震动" />
          </View>

          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>训练步骤</Text>
          </View>
          <View style={styles.stageList}>
            {plan.stages.map((stage, index) => (
              <StageEditorRow
                key={stage.id}
                stage={stage}
                index={index}
                isLast={index === plan.stages.length - 1}
                onEditDuration={() => setDurationPicker({ stageId: stage.id, seconds: stage.durationSec })}
                onDelete={() => {
                  if (plan.stages.length === 1) return Alert.alert('至少保留一个阶段');
                  onUpdate((current) => ({ ...current, updatedAt: Date.now(), stages: current.stages.filter((item) => item.id !== stage.id) }));
                }}
                onChangeName={(name) => onUpdate((current) => ({ ...current, updatedAt: Date.now(), stages: current.stages.map((item) => item.id === stage.id ? { ...item, name } : item) }))}
              />
            ))}
          </View>

          <View style={styles.addStageCard}>
            <Text style={styles.addStageTitle}>添加一个阶段</Text>
            <View style={styles.addStageInputs}>
              <TextInput value={newStageName} onChangeText={setNewStageName} placeholder="例如：快走" style={[styles.textInput, styles.stageNameInput]} />
              <Pressable style={styles.durationPickerTrigger} onPress={() => setDurationPicker({ stageId: null, seconds: newStageDurationSec })} accessibilityLabel="设置新阶段时长">
                <Text style={styles.durationPickerValue}>{formatClock(newStageDurationSec)}</Text>
                <Text style={styles.durationPickerSuffix}>分:秒</Text>
              </Pressable>
              <Pressable style={styles.addStageButton} onPress={addStage} accessibilityLabel="添加阶段"><Text style={styles.addStageButtonText}>＋</Text></Pressable>
            </View>
          </View>

          <View style={styles.musicCard}>
            <View style={styles.musicIcon}><Text>🎵</Text></View>
            <View style={styles.musicCopy}>
              <Text style={styles.musicTitle}>背景音乐</Text>
            <Text style={styles.musicSubtitle}>{plan.music?.name ?? '支持 MP3、WAV 和 MIDI 文件'}</Text>
            </View>
            <View style={styles.musicActions}>
              <Pressable style={styles.musicButton} disabled={musicImporting} onPress={async () => {
                const result = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
                const asset = !result.canceled ? result.assets?.[0] : undefined;
                if (!asset) return;
                if (isMidiFile(asset.name, asset.mimeType)) {
                  try {
                    setMusicImporting(true);
                    const converted = await convertMidiToWav(asset.uri, asset.name);
                    onUpdate((current) => ({ ...current, updatedAt: Date.now(), music: { name: converted.name, uri: converted.uri, volume: current.music?.volume ?? DEFAULT_MUSIC_VOLUME } }));
                  } catch (error) {
                    const message = error instanceof Error ? error.message : '无法读取这个 MIDI 文件。';
                    Alert.alert('MIDI 导入失败', message);
                  } finally {
                    setMusicImporting(false);
                  }
                  return;
                }
                onUpdate((current) => ({ ...current, updatedAt: Date.now(), music: { name: asset.name, uri: asset.uri, volume: current.music?.volume ?? DEFAULT_MUSIC_VOLUME } }));
              }}>
                <Text style={styles.musicButtonText}>{musicImporting ? '转换中' : plan.music ? '更换' : '选择'}</Text>
              </Pressable>
              {plan.music && (
                <Pressable
                  style={[styles.musicButton, styles.musicRemoveButton]}
                  disabled={musicImporting}
                  onPress={() => onUpdate((current) => ({ ...current, updatedAt: Date.now(), music: undefined }))}
                  accessibilityLabel="移除背景音乐"
                >
                  <Text style={styles.musicRemoveButtonText}>移除</Text>
                </Pressable>
              )}
            </View>
          </View>
          {plan.music && (
            <View style={styles.musicVolumeRow}>
              <Text style={styles.musicVolumeLabel}>音乐音量</Text>
              <Pressable
                style={styles.musicVolumeButton}
                onPress={() => onUpdate((current) => current.music ? ({ ...current, updatedAt: Date.now(), music: { ...current.music, volume: clampMusicVolume((current.music.volume ?? DEFAULT_MUSIC_VOLUME) - 0.1) } }) : current)}
                accessibilityLabel="降低音乐音量"
              >
                <Text style={styles.musicVolumeButtonText}>−</Text>
              </Pressable>
              <Text style={styles.musicVolumeValue}>{Math.round((plan.music.volume ?? DEFAULT_MUSIC_VOLUME) * 100)}%</Text>
              <Pressable
                style={styles.musicVolumeButton}
                onPress={() => onUpdate((current) => current.music ? ({ ...current, updatedAt: Date.now(), music: { ...current.music, volume: clampMusicVolume((current.music.volume ?? DEFAULT_MUSIC_VOLUME) + 0.1) } }) : current)}
                accessibilityLabel="提高音乐音量"
              >
                <Text style={styles.musicVolumeButtonText}>＋</Text>
              </Pressable>
            </View>
          )}

          <Pressable style={styles.primaryButtonLarge} onPress={onStart}>
            <Text style={styles.primaryButtonLargeText}>开始这个计划</Text>
            <Text style={styles.primaryButtonLargeArrow}>→</Text>
          </Pressable>
          <Pressable style={styles.deletePlanButton} onPress={onDelete}><Text style={styles.deletePlanText}>删除计划</Text></Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
      <DurationPickerModal
        visible={durationPicker !== null}
        initialSeconds={durationPicker?.seconds ?? newStageDurationSec}
        onCancel={() => setDurationPicker(null)}
        onConfirm={confirmDuration}
      />
    </ScreenContainer>
  );
}

function WorkoutScreen({ plan, settings, onBack, onSettings }: { plan: RhythmPlan; settings: Settings; onBack: () => void; onSettings: () => void }) {
  const [status, setStatus] = useState<'idle' | 'running' | 'paused' | 'complete'>('idle');
  const [stageIndex, setStageIndex] = useState(0);
  const [remaining, setRemaining] = useState(plan.stages[0]?.durationSec ?? 0);
  const [speechActive, setSpeechActive] = useState(false);
  const [tickUri, setTickUri] = useState<string | null>(null);
  const endAtRef = useRef(0);
  const speechTokenRef = useRef(0);
  const speechActiveRef = useRef(false);
  const musicUri = plan.music?.uri ?? null;
  const musicVolume = clampMusicVolume(plan.music?.volume ?? DEFAULT_MUSIC_VOLUME);
  const player = useAudioPlayer(musicUri, { updateInterval: 500, keepAudioSessionActive: true });
  const tickPlayer = useAudioPlayer(tickUri, { keepAudioSessionActive: true });
  const currentStage = plan.stages[stageIndex];
  const total = planDuration(plan);
  const completedBefore = plan.stages.slice(0, stageIndex).reduce((sum, stage) => sum + stage.durationSec, 0);
  const progress = Math.min(1, total === 0 ? 0 : (completedBefore + currentStage.durationSec - remaining) / total);

  const setSpeechActiveState = useCallback((active: boolean) => {
    speechActiveRef.current = active;
    setSpeechActive(active);
  }, []);

  const stopSpeech = useCallback(() => {
    speechTokenRef.current += 1;
    setSpeechActiveState(false);
    void Speech.stop();
  }, [setSpeechActiveState]);

  const announce = useCallback((text: string) => {
    stopSpeech();
    if (settings.voiceEnabled) {
      const speechToken = speechTokenRef.current + 1;
      speechTokenRef.current = speechToken;
      setSpeechActiveState(true);
      const finishSpeech = () => {
        if (speechTokenRef.current !== speechToken) return;
        setSpeechActiveState(false);
      };
      try {
        Speech.speak(text, {
          language: 'zh-CN',
          rate: 0.88,
          volume: 1,
          onDone: finishSpeech,
          onError: finishSpeech,
          onStopped: finishSpeech,
        });
      } catch {
        finishSpeech();
      }
    }
    if (settings.vibrationEnabled) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [setSpeechActiveState, settings.vibrationEnabled, settings.voiceEnabled, stopSpeech]);

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'doNotMix', shouldPlayInBackground: true });
    void ensureTickSoundAsync().then(setTickUri).catch(() => setTickUri(null));
    return stopSpeech;
  }, [stopSpeech]);

  useEffect(() => {
    if (!musicUri) return;
    if (status === 'running') {
      player.setActiveForLockScreen(true, { title: plan.title, artist: '节奏伴侣' }, { showSeekForward: false, showSeekBackward: false });
      player.play();
    } else {
      player.pause();
    }
  }, [musicUri, plan.title, player, status]);

  useEffect(() => {
    if (!musicUri) return;
    player.volume = musicVolume * (speechActive ? SPEECH_MUSIC_VOLUME_RATIO : 1);
  }, [musicUri, musicVolume, player, speechActive]);

  useEffect(() => {
    tickPlayer.volume = 1;
    tickPlayer.loop = true;
    const shouldRunTick = status === 'running' && !musicUri && Boolean(tickUri) && !speechActive;
    if (!shouldRunTick) {
      tickPlayer.pause();
      if (tickUri) tickPlayer.setActiveForLockScreen(false);
      return undefined;
    }
    tickPlayer.setActiveForLockScreen(true, { title: plan.title, artist: '节奏伴侣' }, { showSeekForward: false, showSeekBackward: false });
    const tickStartTimer = setTimeout(() => {
      if (speechActiveRef.current || status !== 'running') return;
      void tickPlayer.seekTo(0).then(() => {
        if (!speechActiveRef.current && status === 'running') tickPlayer.play();
      }).catch(() => undefined);
    }, 1000);
    return () => clearTimeout(tickStartTimer);
  }, [musicUri, plan.title, speechActive, status, tickPlayer, tickUri]);

  useEffect(() => {
    if (status !== 'running') return undefined;
    const timer = setInterval(() => {
      const nextRemaining = Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000));
      setRemaining(nextRemaining);
      if (nextRemaining > 0) return;
      if (stageIndex < plan.stages.length - 1) {
        const nextStage = plan.stages[stageIndex + 1];
        setStageIndex((current) => current + 1);
        setRemaining(nextStage.durationSec);
        endAtRef.current = Date.now() + nextStage.durationSec * 1000;
        announce(`接下来，${nextStage.name}。${nextStage.cue ?? ''}`);
      } else {
        setStatus('complete');
        announce('训练完成，做得很好！');
      }
    }, 250);
    return () => clearInterval(timer);
  }, [announce, plan.stages, stageIndex, status]);

  const start = () => {
    endAtRef.current = Date.now() + remaining * 1000;
    setStatus('running');
    announce(`开始${currentStage.name}，${currentStage.cue ?? ''}`);
  };

  const pause = () => {
    setRemaining(Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000)));
    setStatus('paused');
    stopSpeech();
  };

  const resume = () => {
    endAtRef.current = Date.now() + remaining * 1000;
    setStatus('running');
  };

  const skip = () => {
    if (stageIndex < plan.stages.length - 1) {
      const nextStage = plan.stages[stageIndex + 1];
      setStageIndex((current) => current + 1);
      setRemaining(nextStage.durationSec);
      endAtRef.current = Date.now() + nextStage.durationSec * 1000;
      announce(`跳到${nextStage.name}。${nextStage.cue ?? ''}`);
      return;
    }
    setStatus('complete');
    setRemaining(0);
    announce('训练完成，做得很好！');
  };

  const reset = () => {
    setStatus('idle');
    setStageIndex(0);
    setRemaining(plan.stages[0]?.durationSec ?? 0);
    stopSpeech();
  };

  if (status === 'complete') {
    return (
      <View style={styles.workoutPage}>
        <View style={styles.completeWrap}>
          <Text style={styles.completeEmoji}>🎉</Text>
          <Text style={styles.completeTitle}>训练完成</Text>
          <Text style={styles.completeSubtitle}>今天的节奏掌握得很棒，休息一下吧。</Text>
          <View style={styles.completeStats}><Text style={styles.completeStatsValue}>{formatDuration(total)}</Text><Text style={styles.completeStatsLabel}>本次训练</Text></View>
          <Pressable style={styles.primaryButtonLarge} onPress={onBack}><Text style={styles.primaryButtonLargeText}>回到首页</Text><Text style={styles.primaryButtonLargeArrow}>→</Text></Pressable>
          <Pressable style={styles.secondaryButton} onPress={reset}><Text style={styles.secondaryButtonText}>再来一次</Text></Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.workoutPage}>
      <View style={styles.workoutTopBar}>
        <Pressable style={styles.workoutBack} onPress={onBack}><Text style={styles.workoutBackText}>‹</Text><Text style={styles.workoutBackLabel}>退出训练</Text></Pressable>
        <Text style={styles.workoutPlanTitle}>{plan.title}</Text>
        <Pressable style={styles.workoutSettings} onPress={onSettings}><Text>⚙</Text></Pressable>
      </View>
      <View style={styles.workoutBody}>
        <Text style={styles.workoutLabel}>{status === 'idle' ? '准备开始' : status === 'paused' ? '已暂停' : `第 ${stageIndex + 1} / ${plan.stages.length} 段`}</Text>
        <View style={[styles.timerRing, { borderColor: plan.accent }]}>
          <View style={styles.timerInner}>
            <Text style={[styles.timerValue, settings.largeText && styles.timerValueLarge]}>{formatClock(remaining)}</Text>
            <Text style={styles.timerStage}>{currentStage.name}</Text>
          </View>
        </View>
        <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: plan.accent }]} /></View>
        <Text style={styles.cueText}>{currentStage.cue ?? '按自己的节奏来'}</Text>
        {plan.stages[stageIndex + 1] && <Text style={styles.nextStage}>下一段：{plan.stages[stageIndex + 1].name} · {formatDuration(plan.stages[stageIndex + 1].durationSec)}</Text>}
        <View style={styles.workoutControls}>
          {status === 'idle' && <Pressable style={[styles.controlButton, { backgroundColor: plan.accent }]} onPress={start}><Text style={styles.controlButtonText}>开始</Text></Pressable>}
          {status === 'running' && <Pressable style={[styles.controlButton, { backgroundColor: plan.accent }]} onPress={pause}><Text style={styles.controlButtonText}>暂停</Text></Pressable>}
          {status === 'paused' && <Pressable style={[styles.controlButton, { backgroundColor: plan.accent }]} onPress={resume}><Text style={styles.controlButtonText}>继续</Text></Pressable>}
          {status !== 'idle' && <Pressable style={styles.skipButton} onPress={skip}><Text style={styles.skipButtonText}>跳过这一段</Text></Pressable>}
        </View>
        {status !== 'idle' && <Pressable onPress={reset} style={styles.resetButton}><Text style={styles.resetText}>重新开始</Text></Pressable>}
      </View>
    </View>
  );
}

function SettingsScreen({ settings, onBack, onChange }: { settings: Settings; onBack: () => void; onChange: (key: keyof Settings, value: boolean) => void }) {
  return (
    <ScreenContainer>
      <Header title="设置" onBack={onBack} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.settingsContent}>
        <Text style={styles.pageTitle}>运动时的提醒</Text>
        <Text style={styles.pageSubtitle}>根据需要调整，运动中也会保持这些设置。</Text>
        <View style={styles.settingsCard}>
          <SettingRow icon="🔊" title="语音提示" description="播报当前和下一阶段" value={settings.voiceEnabled} onValueChange={(value) => onChange('voiceEnabled', value)} />
          <SettingRow icon="📳" title="震动提醒" description="阶段切换时轻轻震动" value={settings.vibrationEnabled} onValueChange={(value) => onChange('vibrationEnabled', value)} />
          <SettingRow icon="Aa" title="大字体模式" description="让运动界面的数字更醒目" value={settings.largeText} onValueChange={(value) => onChange('largeText', value)} last />
        </View>
        <View style={styles.aboutCard}><Text style={styles.aboutEmoji}>🌿</Text><View style={styles.aboutCopy}><Text style={styles.aboutTitle}>节奏伴侣 1.0.1</Text><Text style={styles.aboutText}>为家人设计的简单运动计时器。数据只保存在这台手机上。</Text></View></View>
      </ScrollView>
    </ScreenContainer>
  );
}

function SettingRow({ icon, title, description, value, onValueChange, last }: { icon: string; title: string; description: string; value: boolean; onValueChange: (value: boolean) => void; last?: boolean }) {
  return (
    <View style={[styles.settingRow, !last && styles.settingRowBorder]}>
      <View style={styles.settingIcon}><Text style={styles.settingIconText}>{icon}</Text></View>
      <View style={styles.settingCopy}><Text style={styles.settingTitle}>{title}</Text><Text style={styles.settingDescription}>{description}</Text></View>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ false: '#D7E1DC', true: colors.greenSoft }} thumbColor={value ? colors.green : '#FFFFFF'} accessibilityLabel={title} />
    </View>
  );
}

function DurationPickerModal({ visible, initialSeconds, onCancel, onConfirm }: { visible: boolean; initialSeconds: number; onCancel: () => void; onConfirm: (seconds: number) => void }) {
  const initialMinutes = Math.min(DEFAULT_MAX_DURATION_MINUTES, Math.max(0, Math.floor(initialSeconds / 60)));
  const maximumMinutes = DEFAULT_MAX_DURATION_MINUTES;
  const minuteValues = useMemo(() => Array.from({ length: maximumMinutes + 1 }, (_, index) => index), [maximumMinutes]);
  const secondValues = useMemo(() => Array.from({ length: 60 }, (_, index) => index), []);
  const [minutes, setMinutes] = useState(initialMinutes);
  const [seconds, setSeconds] = useState(Math.max(0, initialSeconds % 60));

  useEffect(() => {
    if (!visible) return undefined;
    setMinutes(initialMinutes);
    setSeconds(Math.max(0, initialSeconds % 60));
    return undefined;
  }, [initialMinutes, initialSeconds, visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.durationModalBackdrop}>
        <View style={styles.durationModal}>
          <View style={styles.durationModalHeader}>
            <Pressable onPress={onCancel} style={styles.durationModalAction}><Text style={styles.durationCancelText}>取消</Text></Pressable>
            <Text style={styles.durationModalTitle}>设置时长</Text>
            <Pressable onPress={() => onConfirm(minutes * 60 + seconds)} style={styles.durationModalAction}><Text style={styles.durationConfirmText}>完成</Text></Pressable>
          </View>
          <Text style={styles.durationModalHint}>上下滑动选择分钟和秒</Text>
          <View style={styles.durationWheelRow}>
            <DurationWheelColumn visible={visible} values={minuteValues} selectedValue={minutes} resetValue={initialMinutes} suffix="分" onSelect={setMinutes} />
            <DurationWheelColumn visible={visible} values={secondValues} selectedValue={seconds} resetValue={Math.max(0, initialSeconds % 60)} suffix="秒" onSelect={setSeconds} />
          </View>
          <View style={styles.durationSelectedLine}><Text style={styles.durationSelectedText}>{minutes} 分 {seconds.toString().padStart(2, '0')} 秒</Text></View>
        </View>
      </View>
    </Modal>
  );
}

function DurationWheelColumn({ visible, values, selectedValue, resetValue, suffix, onSelect }: { visible: boolean; values: number[]; selectedValue: number; resetValue: number; suffix: string; onSelect: (value: number) => void }) {
  const scrollRef = useRef<ScrollView>(null);
  const momentumRef = useRef(false);
  const middleCycle = Math.floor(CIRCULAR_WHEEL_COPIES / 2);
  const resetIndex = Math.max(0, values.indexOf(resetValue));
  const circularValues = useMemo(
    () => Array.from({ length: values.length * CIRCULAR_WHEEL_COPIES }, (_, index) => values[index % values.length]),
    [values]
  );

  useEffect(() => {
    if (!visible) return undefined;
    const initialIndex = middleCycle * values.length + resetIndex;
    const timer = setTimeout(() => scrollRef.current?.scrollTo({ y: initialIndex * DURATION_WHEEL_ROW_HEIGHT, animated: false }), 0);
    return () => clearTimeout(timer);
  }, [middleCycle, resetIndex, values.length, visible]);

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    momentumRef.current = false;
    const rawIndex = Math.max(0, Math.round(event.nativeEvent.contentOffset.y / DURATION_WHEEL_ROW_HEIGHT));
    const normalizedIndex = ((rawIndex % values.length) + values.length) % values.length;
    onSelect(values[normalizedIndex]);
    if (rawIndex < values.length || rawIndex >= values.length * (CIRCULAR_WHEEL_COPIES - 1)) {
      const recenteredIndex = middleCycle * values.length + normalizedIndex;
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: recenteredIndex * DURATION_WHEEL_ROW_HEIGHT, animated: false }));
    }
  };

  const handleScrollEndDrag = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!momentumRef.current) handleScrollEnd(event);
  };

  return (
    <View style={styles.durationWheelColumn}>
      <View pointerEvents="none" style={styles.durationWheelSelection} />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={DURATION_WHEEL_ROW_HEIGHT}
        decelerationRate={0.93}
        bounces={false}
        overScrollMode="never"
        contentContainerStyle={styles.durationWheelContent}
        onMomentumScrollBegin={() => { momentumRef.current = true; }}
        onMomentumScrollEnd={handleScrollEnd}
        onScrollEndDrag={handleScrollEndDrag}
      >
        {circularValues.map((value, index) => (
          <View key={`${value}-${index}`} style={styles.durationWheelItem}>
            <Text style={[styles.durationWheelText, value === selectedValue && styles.durationWheelTextActive]}>{value.toString().padStart(2, '0')}</Text>
            <Text style={[styles.durationWheelSuffix, value === selectedValue && styles.durationWheelTextActive]}>{suffix}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function StageEditorRow({ stage, index, isLast, onEditDuration, onDelete, onChangeName }: { stage: Stage; index: number; isLast: boolean; onEditDuration: () => void; onDelete: () => void; onChangeName: (name: string) => void }) {
  return (
    <View style={styles.stageEditorRow}>
      <View style={styles.stageNumber}><Text style={styles.stageNumberText}>{index + 1}</Text></View>
      <View style={styles.stageEditorCopy}>
        <TextInput value={stage.name} onChangeText={onChangeName} style={styles.stageNameTextInput} />
        <Text style={styles.stageCueText}>{stage.cue}</Text>
      </View>
      <Pressable onPress={onEditDuration} style={styles.stageDurationButton} accessibilityLabel={`设置${stage.name}时长`}>
        <Text style={styles.stageDuration}>{formatClock(stage.durationSec)}</Text>
        <Text style={styles.stageDurationHint}>调整</Text>
      </Pressable>
      {!isLast && <Pressable onPress={onDelete} style={styles.stageDelete}><Text style={styles.stageDeleteText}>×</Text></Pressable>}
    </View>
  );
}

function PlanCard({ plan, onOpen, onStart }: { plan: RhythmPlan; onOpen: () => void; onStart: () => void }) {
  return (
    <View style={styles.planCard}>
      <Pressable style={styles.planCardMain} onPress={onOpen}>
        <View style={[styles.planEmoji, { backgroundColor: `${plan.accent}18` }]}><Text style={styles.planEmojiText}>{plan.emoji}</Text></View>
        <View style={styles.planCardCopy}><Text style={styles.planCardTitle}>{plan.title}</Text><Text style={styles.planCardDescription} numberOfLines={2}>{plan.description}</Text><Text style={[styles.planCardMeta, { color: plan.accent }]}>{formatDuration(planDuration(plan))} · {plan.stages.length} 个阶段</Text></View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
      <Pressable style={[styles.planStartButton, { borderColor: plan.accent }]} onPress={onStart}><Text style={[styles.planStartText, { color: plan.accent }]}>开始</Text></Pressable>
    </View>
  );
}

function PlanMiniCard({ plan, onPress }: { plan: RhythmPlan; onPress: () => void }) {
  return <Pressable style={styles.planMiniCard} onPress={onPress}><View style={[styles.miniEmoji, { backgroundColor: `${plan.accent}18` }]}><Text>{plan.emoji}</Text></View><Text style={styles.miniTitle} numberOfLines={1}>{plan.title}</Text><Text style={styles.miniMeta}>{formatDuration(planDuration(plan))}</Text></Pressable>;
}

function ScreenContainer({ children }: { children: React.ReactNode }) {
  return <View style={styles.screen}><View style={styles.content}>{children}</View></View>;
}

function Header({ title, onBack, right }: { title: string; onBack: () => void; right?: React.ReactNode }) {
  return <View style={styles.header}><Pressable style={styles.backButton} onPress={onBack} accessibilityLabel="返回"><Text style={styles.backText}>‹</Text></Pressable><Text style={styles.headerTitle}>{title}</Text><View style={styles.headerRight}>{right}</View></View>;
}

function SectionHeading({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{title}</Text>{action && <Pressable onPress={onAction}><Text style={styles.sectionAction}>{action} ›</Text></Pressable>}</View>;
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return <View style={styles.summaryItem}><Text style={styles.summaryValue}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></View>;
}

function BottomNav({ screen, onNavigate }: { screen: Screen; onNavigate: (screen: Screen) => void }) {
  return <View style={styles.bottomNav}><NavItem icon="⌂" label="首页" active={screen === 'home'} onPress={() => onNavigate('home')} /><NavItem icon="◷" label="我的计划" active={screen === 'plans' || screen === 'edit'} onPress={() => onNavigate('plans')} /><NavItem icon="⚙" label="设置" active={screen === 'settings'} onPress={() => onNavigate('settings')} /></View>;
}

function NavItem({ icon, label, active, onPress }: { icon: string; label: string; active: boolean; onPress: () => void }) {
  return <Pressable style={styles.navItem} onPress={onPress}><Text style={[styles.navIcon, active && styles.navIconActive]}>{icon}</Text><Text style={[styles.navLabel, active && styles.navLabelActive]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.paper },
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? 34 : 14 },
  flex: { flex: 1 },
  homeContent: { paddingBottom: 100 },
  homeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  eyebrow: { color: colors.muted, fontSize: 13, marginBottom: 5, letterSpacing: 0.3 },
  brand: { color: colors.ink, fontSize: 30, fontWeight: '800', letterSpacing: -0.8 },
  iconButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  iconButtonText: { fontSize: 20, color: colors.ink },
  welcomeCard: { backgroundColor: colors.green, borderRadius: 26, padding: 22, minHeight: 212, flexDirection: 'row', overflow: 'hidden', marginBottom: 27 },
  welcomeCopy: { flex: 1, zIndex: 1 },
  welcomeTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '800', lineHeight: 31, maxWidth: 230 },
  welcomeText: { color: '#DDF3EA', fontSize: 14, lineHeight: 21, marginTop: 9, maxWidth: 230 },
  welcomeEmoji: { position: 'absolute', right: -5, bottom: -8, fontSize: 112, opacity: 0.28 },
  primaryButton: { backgroundColor: '#FFFFFF', borderRadius: 12, minHeight: 46, paddingHorizontal: 14, marginTop: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', maxWidth: 174 },
  primaryButtonLarge: { backgroundColor: colors.green, borderRadius: 14, minHeight: 54, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22 },
  primaryButtonText: { color: colors.green, fontWeight: '800', fontSize: 15 },
  primaryButtonArrow: { color: colors.green, fontSize: 22, marginLeft: 11 },
  primaryButtonLargeText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  primaryButtonLargeArrow: { color: '#FFFFFF', fontSize: 22, marginLeft: 11 },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 13 },
  sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  sectionAction: { color: colors.green, fontWeight: '700', fontSize: 13 },
  horizontalList: { gap: 12, paddingBottom: 28 },
  planMiniCard: { backgroundColor: colors.card, width: 150, borderRadius: 18, padding: 14, borderWidth: 1, borderColor: colors.line },
  miniEmoji: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  miniTitle: { color: colors.ink, fontWeight: '800', fontSize: 14 },
  miniMeta: { color: colors.muted, fontSize: 12, marginTop: 5 },
  header: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  backButton: { width: 40, height: 40, justifyContent: 'center' },
  backText: { fontSize: 36, color: colors.ink, lineHeight: 38, fontWeight: '300' },
  headerTitle: { color: colors.ink, fontWeight: '800', fontSize: 18 },
  headerRight: { minWidth: 40, alignItems: 'flex-end' },
  headerAction: { color: colors.green, fontWeight: '800', fontSize: 14 },
  libraryIntro: { marginBottom: 18 },
  pageTitle: { color: colors.ink, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  pageSubtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 5 },
  outlineButton: { height: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 17 },
  outlineButtonPlus: { color: colors.green, fontSize: 21, marginRight: 5 },
  outlineButtonText: { color: colors.green, fontSize: 14, fontWeight: '800' },
  planList: { gap: 12, paddingBottom: 100 },
  planCard: { backgroundColor: colors.card, borderRadius: 19, borderWidth: 1, borderColor: colors.line, padding: 15 },
  planCardMain: { flexDirection: 'row', alignItems: 'center' },
  planEmoji: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  planEmojiText: { fontSize: 26 },
  planCardCopy: { flex: 1 },
  planCardTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  planCardDescription: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  planCardMeta: { fontSize: 12, fontWeight: '700', marginTop: 5 },
  chevron: { color: colors.muted, fontSize: 26, marginLeft: 8 },
  planStartButton: { borderWidth: 1, borderRadius: 10, minHeight: 36, justifyContent: 'center', alignItems: 'center', marginTop: 13 },
  planStartText: { fontSize: 13, fontWeight: '800' },
  editorContent: { paddingBottom: 100 },
  editorHero: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  editorEmoji: { fontSize: 42, marginRight: 14, marginTop: 3 },
  editorHeroCopy: { flex: 1 },
  editorTitleInput: { color: colors.ink, fontSize: 23, fontWeight: '800', paddingVertical: 0 },
  editorDescriptionInput: { color: colors.muted, fontSize: 13, lineHeight: 19, paddingVertical: 5 },
  summaryRow: { backgroundColor: colors.greenSoft, borderRadius: 16, flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 14, marginBottom: 24 },
  summaryItem: { alignItems: 'center', minWidth: 80 },
  summaryValue: { color: colors.green, fontSize: 14, fontWeight: '800' },
  summaryLabel: { color: colors.muted, fontSize: 11, marginTop: 4 },
  sectionTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionHint: { color: colors.muted, fontSize: 11 },
  stageList: { backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  stageEditorRow: { minHeight: 75, borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center' },
  stageNumber: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  stageNumberText: { color: colors.green, fontSize: 12, fontWeight: '800' },
  stageEditorCopy: { flex: 1, minWidth: 80 },
  stageNameTextInput: { color: colors.ink, fontSize: 14, fontWeight: '800', paddingVertical: 0 },
  stageCueText: { color: colors.muted, fontSize: 11, marginTop: 4 },
  stageDurationButton: { minWidth: 70, minHeight: 44, borderRadius: 10, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: 4 },
  stageDuration: { color: colors.ink, fontSize: 12, fontWeight: '800', textAlign: 'center' },
  stageDurationHint: { color: colors.green, fontSize: 9, marginTop: 2 },
  stageDelete: { width: 24, alignItems: 'flex-end', marginLeft: 2 },
  stageDeleteText: { color: '#A9B9B3', fontSize: 22, fontWeight: '300' },
  addStageCard: { backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 14, marginTop: 12 },
  addStageTitle: { color: colors.ink, fontWeight: '800', fontSize: 14, marginBottom: 10 },
  addStageInputs: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  textInput: { backgroundColor: colors.paper, borderRadius: 10, minHeight: 42, paddingHorizontal: 11, color: colors.ink, fontSize: 13 },
  stageNameInput: { flex: 1 },
  minutesInputWrap: { backgroundColor: colors.paper, borderRadius: 10, minHeight: 42, flexDirection: 'row', alignItems: 'center', paddingLeft: 10, paddingRight: 8 },
  minutesInput: { color: colors.ink, fontSize: 13, minWidth: 30, paddingVertical: 0 },
  inputSuffix: { color: colors.muted, fontSize: 12 },
  durationPickerTrigger: { backgroundColor: colors.paper, borderRadius: 10, minHeight: 42, minWidth: 82, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' },
  durationPickerValue: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  durationPickerSuffix: { color: colors.muted, fontSize: 10, marginTop: 1 },
  addStageButton: { width: 42, height: 42, backgroundColor: colors.green, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  addStageButtonText: { color: '#FFFFFF', fontSize: 23, lineHeight: 25 },
  musicCard: { backgroundColor: colors.orangeSoft, borderRadius: 17, padding: 13, flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  musicIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#FFFFFFA8', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  musicCopy: { flex: 1 },
  musicTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  musicSubtitle: { color: colors.muted, fontSize: 11, marginTop: 3 },
  musicActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  musicButton: { backgroundColor: '#FFFFFF', borderRadius: 9, minWidth: 50, minHeight: 33, justifyContent: 'center', alignItems: 'center' },
  musicButtonText: { color: colors.orange, fontSize: 12, fontWeight: '800' },
  musicRemoveButton: { borderWidth: 1, borderColor: '#E6B9A7' },
  musicRemoveButtonText: { color: colors.danger, fontSize: 12, fontWeight: '800' },
  musicVolumeRow: { backgroundColor: colors.card, borderRadius: 10, minHeight: 38, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', marginTop: 9 },
  musicVolumeLabel: { color: colors.muted, fontSize: 11, flex: 1 },
  musicVolumeButton: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center' },
  musicVolumeButtonText: { color: colors.green, fontSize: 17, lineHeight: 19 },
  musicVolumeValue: { color: colors.ink, fontSize: 12, fontWeight: '800', minWidth: 38, textAlign: 'center' },
  durationModalBackdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  durationModal: { backgroundColor: colors.paper, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingTop: 15, paddingBottom: Platform.OS === 'android' ? 28 : 18 },
  durationModalHeader: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  durationModalAction: { minWidth: 58, minHeight: 42, justifyContent: 'center' },
  durationCancelText: { color: colors.danger, fontSize: 16, fontWeight: '800' },
  durationConfirmText: { color: colors.green, fontSize: 16, fontWeight: '800', textAlign: 'right' },
  durationModalTitle: { color: colors.ink, fontSize: 20, fontWeight: '800' },
  durationModalHint: { color: colors.muted, fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 10 },
  durationWheelRow: { flexDirection: 'row', justifyContent: 'center', gap: 18 },
  durationWheelColumn: { width: 126, height: DURATION_WHEEL_ROW_HEIGHT * 3, overflow: 'hidden', position: 'relative' },
  durationWheelContent: { paddingVertical: DURATION_WHEEL_ROW_HEIGHT },
  durationWheelItem: { height: DURATION_WHEEL_ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  durationWheelText: { color: '#B7C0BD', fontSize: 27, fontWeight: '500', minWidth: 42, textAlign: 'right' },
  durationWheelSuffix: { color: '#B7C0BD', fontSize: 17, marginLeft: 4 },
  durationWheelTextActive: { color: colors.ink, fontSize: 34, fontWeight: '800' },
  durationWheelSelection: { position: 'absolute', zIndex: 1, left: 0, right: 0, top: DURATION_WHEEL_ROW_HEIGHT, height: DURATION_WHEEL_ROW_HEIGHT, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.greenSoft, backgroundColor: '#FFFFFF44', borderRadius: 12 },
  durationSelectedLine: { alignItems: 'center', marginTop: 12 },
  durationSelectedText: { color: colors.green, fontSize: 16, fontWeight: '800' },
  deletePlanButton: { alignItems: 'center', padding: 16 },
  deletePlanText: { color: colors.danger, fontSize: 13, fontWeight: '700' },
  workoutPage: { flex: 1, backgroundColor: colors.paper },
  workoutTopBar: { paddingTop: Platform.OS === 'android' ? 33 : 15, paddingHorizontal: 18, height: 87, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  workoutBack: { flexDirection: 'row', alignItems: 'center', minWidth: 88 },
  workoutBackText: { fontSize: 34, color: colors.ink, lineHeight: 35, marginRight: 3 },
  workoutBackLabel: { color: colors.muted, fontSize: 12 },
  workoutPlanTitle: { color: colors.ink, fontSize: 14, fontWeight: '800', maxWidth: 160, textAlign: 'center' },
  workoutSettings: { width: 42, alignItems: 'flex-end' },
  workoutBody: { flex: 1, alignItems: 'center', paddingHorizontal: 28, paddingTop: 42 },
  workoutLabel: { color: colors.muted, fontSize: 14, fontWeight: '700', letterSpacing: 0.4 },
  timerRing: { width: 260, height: 260, borderRadius: 130, borderWidth: 13, marginTop: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  timerInner: { width: 224, height: 224, borderRadius: 112, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line },
  timerValue: { color: colors.ink, fontSize: 54, lineHeight: 62, fontWeight: '300', letterSpacing: -1.5 },
  timerValueLarge: { fontSize: 65, lineHeight: 73 },
  timerStage: { color: colors.green, fontSize: 18, fontWeight: '800', marginTop: 3 },
  progressTrack: { width: '100%', height: 7, borderRadius: 4, backgroundColor: colors.line, overflow: 'hidden', marginTop: 34 },
  progressFill: { height: '100%', borderRadius: 4 },
  cueText: { color: colors.ink, fontSize: 17, fontWeight: '800', marginTop: 27, textAlign: 'center' },
  nextStage: { color: colors.muted, fontSize: 13, marginTop: 7 },
  workoutControls: { width: '100%', alignItems: 'center', marginTop: 30 },
  controlButton: { minWidth: 190, minHeight: 58, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  controlButtonText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  skipButton: { padding: 13, marginTop: 4 },
  skipButtonText: { color: colors.green, fontWeight: '800', fontSize: 13 },
  resetButton: { padding: 14, marginTop: 5 },
  resetText: { color: colors.muted, fontSize: 12 },
  completeWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingBottom: 44 },
  completeEmoji: { fontSize: 70, marginBottom: 14 },
  completeTitle: { color: colors.ink, fontSize: 34, fontWeight: '800' },
  completeSubtitle: { color: colors.muted, fontSize: 15, marginTop: 8, textAlign: 'center' },
  completeStats: { backgroundColor: colors.greenSoft, borderRadius: 16, paddingHorizontal: 34, paddingVertical: 15, alignItems: 'center', marginTop: 26 },
  completeStatsValue: { color: colors.green, fontSize: 22, fontWeight: '800' },
  completeStatsLabel: { color: colors.muted, fontSize: 12, marginTop: 3 },
  secondaryButton: { padding: 15, marginTop: 3 },
  secondaryButtonText: { color: colors.green, fontWeight: '800' },
  settingsContent: { paddingBottom: 100 },
  settingsCard: { backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', marginTop: 22 },
  settingRow: { minHeight: 78, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' },
  settingRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.line },
  settingIcon: { width: 39, height: 39, borderRadius: 13, backgroundColor: colors.greenSoft, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  settingIconText: { color: colors.green, fontSize: 16, fontWeight: '800' },
  settingCopy: { flex: 1 },
  settingTitle: { color: colors.ink, fontWeight: '800', fontSize: 14 },
  settingDescription: { color: colors.muted, fontSize: 12, marginTop: 3 },
  aboutCard: { backgroundColor: colors.yellowSoft, borderRadius: 18, padding: 16, flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  aboutEmoji: { fontSize: 28, marginRight: 12 },
  aboutCopy: { flex: 1 },
  aboutTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  aboutText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 78, paddingBottom: Platform.OS === 'ios' ? 17 : 7, backgroundColor: '#FFFFFFF5', borderTopWidth: 1, borderTopColor: colors.line, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  navItem: { alignItems: 'center', justifyContent: 'center', minWidth: 80 },
  navIcon: { color: '#9AA9A4', fontSize: 22, lineHeight: 25 },
  navIconActive: { color: colors.green },
  navLabel: { color: '#9AA9A4', fontSize: 11, marginTop: 3 },
  navLabelActive: { color: colors.green, fontWeight: '800' },
});
