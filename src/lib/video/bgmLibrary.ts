/**
 * 背景音乐库 v2
 *
 * 使用 Web Audio API 内置生成音乐，无需网络下载。
 * 彻底解决外部 URL 失效、CORS 阻止、离线不可用等问题。
 *
 * 同时保留自定义上传音乐功能。
 */

export interface BgmTrack {
  id: string;
  name: string;
  artist: string;
  duration: number; // 秒
  category: string;
  /** 内置生成标记（无需 URL） */
  isBuiltIn?: boolean;
  /** 在线音频 URL（仅自定义上传使用） */
  url?: string;
}

export interface BgmCategory {
  name: string;
  icon: string;
  tracks: BgmTrack[];
}

/**
 * 内置音乐库
 * 所有音乐由 Web Audio API 实时生成，无需下载
 */
export const BGM_CATEGORIES: BgmCategory[] = [
  {
    name: '轻松愉快',
    icon: '🎵',
    tracks: [
      { id: 'builtin-happy-1', name: '阳光漫步', artist: '内置', duration: 30, category: '轻松愉快', isBuiltIn: true },
      { id: 'builtin-happy-2', name: '甜蜜时光', artist: '内置', duration: 30, category: '轻松愉快', isBuiltIn: true },
      { id: 'builtin-happy-3', name: '快乐节拍', artist: '内置', duration: 30, category: '轻松愉快', isBuiltIn: true },
      { id: 'builtin-happy-4', name: '晴天旋律', artist: '内置', duration: 30, category: '轻松愉快', isBuiltIn: true },
      { id: 'builtin-happy-5', name: '微笑着前行', artist: '内置', duration: 30, category: '轻松愉快', isBuiltIn: true },
      { id: 'builtin-happy-6', name: '柠檬汽水', artist: '内置', duration: 30, category: '轻松愉快', isBuiltIn: true },
    ],
  },
  {
    name: '浪漫温馨',
    icon: '💕',
    tracks: [
      { id: 'builtin-romantic-1', name: '星空之下', artist: '内置', duration: 30, category: '浪漫温馨', isBuiltIn: true },
      { id: 'builtin-romantic-2', name: '晚风轻拂', artist: '内置', duration: 30, category: '浪漫温馨', isBuiltIn: true },
      { id: 'builtin-romantic-3', name: '梦中的婚礼', artist: '内置', duration: 30, category: '浪漫温馨', isBuiltIn: true },
      { id: 'builtin-romantic-4', name: '花间小径', artist: '内置', duration: 30, category: '浪漫温馨', isBuiltIn: true },
      { id: 'builtin-romantic-5', name: '月光倾诉', artist: '内置', duration: 30, category: '浪漫温馨', isBuiltIn: true },
      { id: 'builtin-romantic-6', name: '温柔以待', artist: '内置', duration: 30, category: '浪漫温馨', isBuiltIn: true },
    ],
  },
  {
    name: '动感活力',
    icon: '🔥',
    tracks: [
      { id: 'builtin-energetic-1', name: '节拍风暴', artist: '内置', duration: 30, category: '动感活力', isBuiltIn: true },
      { id: 'builtin-energetic-2', name: '燃爆全场', artist: '内置', duration: 30, category: '动感活力', isBuiltIn: true },
      { id: 'builtin-energetic-3', name: '速度与激情', artist: '内置', duration: 30, category: '动感活力', isBuiltIn: true },
      { id: 'builtin-energetic-4', name: '电音派对', artist: '内置', duration: 30, category: '动感活力', isBuiltIn: true },
      { id: 'builtin-energetic-5', name: '无限能量', artist: '内置', duration: 30, category: '动感活力', isBuiltIn: true },
      { id: 'builtin-energetic-6', name: '跳跃节拍', artist: '内置', duration: 30, category: '动感活力', isBuiltIn: true },
    ],
  },
  {
    name: '抒情治愈',
    icon: '🌿',
    tracks: [
      { id: 'builtin-healing-1', name: '山间清风', artist: '内置', duration: 30, category: '抒情治愈', isBuiltIn: true },
      { id: 'builtin-healing-2', name: '午后时光', artist: '内置', duration: 30, category: '抒情治愈', isBuiltIn: true },
      { id: 'builtin-healing-3', name: '雨后彩虹', artist: '内置', duration: 30, category: '抒情治愈', isBuiltIn: true },
      { id: 'builtin-healing-4', name: '静谧花园', artist: '内置', duration: 30, category: '抒情治愈', isBuiltIn: true },
      { id: 'builtin-healing-5', name: '心灵绿洲', artist: '内置', duration: 30, category: '抒情治愈', isBuiltIn: true },
      { id: 'builtin-healing-6', name: '温柔岁月', artist: '内置', duration: 30, category: '抒情治愈', isBuiltIn: true },
    ],
  },
  {
    name: '古风国韵',
    icon: '🏮',
    tracks: [
      { id: 'builtin-chinese-1', name: '水墨丹青', artist: '内置', duration: 30, category: '古风国韵', isBuiltIn: true },
      { id: 'builtin-chinese-2', name: '月下独酌', artist: '内置', duration: 30, category: '古风国韵', isBuiltIn: true },
      { id: 'builtin-chinese-3', name: '江南春色', artist: '内置', duration: 30, category: '古风国韵', isBuiltIn: true },
      { id: 'builtin-chinese-4', name: '竹林清风', artist: '内置', duration: 30, category: '古风国韵', isBuiltIn: true },
      { id: 'builtin-chinese-5', name: '千里江山', artist: '内置', duration: 30, category: '古风国韵', isBuiltIn: true },
      { id: 'builtin-chinese-6', name: '长安夜色', artist: '内置', duration: 30, category: '古风国韵', isBuiltIn: true },
    ],
  },
  {
    name: '商务科技',
    icon: '💻',
    tracks: [
      { id: 'builtin-tech-1', name: '创新驱动', artist: '内置', duration: 30, category: '商务科技', isBuiltIn: true },
      { id: 'builtin-tech-2', name: '数据之光', artist: '内置', duration: 30, category: '商务科技', isBuiltIn: true },
      { id: 'builtin-tech-3', name: '未来已来', artist: '内置', duration: 30, category: '商务科技', isBuiltIn: true },
      { id: 'builtin-tech-4', name: '数字脉搏', artist: '内置', duration: 30, category: '商务科技', isBuiltIn: true },
      { id: 'builtin-tech-5', name: '科技潮涌', artist: '内置', duration: 30, category: '商务科技', isBuiltIn: true },
      { id: 'builtin-tech-6', name: '智能时代', artist: '内置', duration: 30, category: '商务科技', isBuiltIn: true },
    ],
  },
];

/** 获取所有音乐列表（扁平化） */
export function getAllTracks(): BgmTrack[] {
  return BGM_CATEGORIES.flatMap(c => c.tracks);
}

/** 通过 ID 查找音乐 */
export function getTrackById(id: string): BgmTrack | undefined {
  return getAllTracks().find(t => t.id === id);
}

/** 格式化时长 */
export function formatTrackDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
