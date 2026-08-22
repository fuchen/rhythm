import { RhythmPlan } from './models';

const now = Date.now();

export const starterPlans: RhythmPlan[] = [
  {
    id: 'easy-walk',
    title: '轻松健走 20 分钟',
    description: '适合每天出门走一走，循序渐进不累脚。',
    emoji: '🚶',
    accent: '#1D7A62',
    updatedAt: now,
    stages: [
      { id: 'easy-1', name: '热身', durationSec: 300, cue: '先慢慢走，活动开身体' },
      { id: 'easy-2', name: '舒适步行', durationSec: 600, cue: '保持舒服的步伐' },
      { id: 'easy-3', name: '放松收尾', durationSec: 300, cue: '放慢脚步，准备结束' },
    ],
  },
  {
    id: 'interval-walk',
    title: '快慢交替 18 分钟',
    description: '短时间快走和慢走交替，找到自己的节奏。',
    emoji: '🌿',
    accent: '#C46B32',
    updatedAt: now,
    stages: [
      { id: 'interval-1', name: '热身', durationSec: 180, cue: '先用慢走热身' },
      { id: 'interval-2', name: '快走', durationSec: 180, cue: '可以稍微加快步伐' },
      { id: 'interval-3', name: '慢走', durationSec: 120, cue: '放慢一点，调整呼吸' },
      { id: 'interval-4', name: '快走', durationSec: 180, cue: '继续保持节奏' },
      { id: 'interval-5', name: '慢走', durationSec: 120, cue: '放慢一点，调整呼吸' },
      { id: 'interval-6', name: '快走', durationSec: 180, cue: '最后一段快走' },
      { id: 'interval-7', name: '放松', durationSec: 120, cue: '慢慢走，训练即将结束' },
    ],
  },
  {
    id: 'stretch',
    title: '晨间拉伸 10 分钟',
    description: '起床后温和活动，唤醒肩颈和腿部。',
    emoji: '☀️',
    accent: '#B8860B',
    updatedAt: now,
    stages: [
      { id: 'stretch-1', name: '肩颈放松', durationSec: 120, cue: '肩膀放松，呼吸自然' },
      { id: 'stretch-2', name: '腿部拉伸', durationSec: 180, cue: '动作温和，不要勉强' },
      { id: 'stretch-3', name: '腰背舒展', durationSec: 180, cue: '保持平稳呼吸' },
      { id: 'stretch-4', name: '深呼吸', durationSec: 120, cue: '吸气，呼气，慢慢收尾' },
    ],
  },
];
