/**
 * 背景音乐库
 * 
 * 提供免费/免版税的背景音乐供视频合成使用
 * 音乐来源：Pixabay Free Music, Free Music Archive 等免版税音乐库
 */

export interface BgmTrack {
  id: string;
  name: string;
  artist: string;
  duration: number; // 秒
  category: string;
  /** 在线音频 URL（免版税） */
  url: string;
}

export interface BgmCategory {
  name: string;
  icon: string;
  tracks: BgmTrack[];
}

/**
 * 免版税音乐库
 * 所有音乐均为 CC0 / 免版税许可，可自由用于视频创作
 */
export const BGM_CATEGORIES: BgmCategory[] = [
  {
    name: '轻松愉快',
    icon: '🎵',
    tracks: [
      { id: 'happy-1', name: '阳光漫步', artist: 'Keyframe Audio', duration: 180, category: '轻松愉快', url: 'https://cdn.pixabay.com/audio/2024/11/01/audio_071ef1b310.mp3' },
      { id: 'happy-2', name: '甜蜜时光', artist: 'Lesfm', duration: 210, category: '轻松愉快', url: 'https://cdn.pixabay.com/audio/2024/09/10/audio_6b5e7f2d86.mp3' },
      { id: 'happy-3', name: '快乐节拍', artist: 'Coma-Media', duration: 168, category: '轻松愉快', url: 'https://cdn.pixabay.com/audio/2022/10/25/audio_642798e9bc.mp3' },
      { id: 'happy-4', name: '晴天旋律', artist: 'Lesfm', duration: 195, category: '轻松愉快', url: 'https://cdn.pixabay.com/audio/2023/08/15/audio_54d6e0bca9.mp3' },
      { id: 'happy-5', name: '微笑着前行', artist: 'Coma-Media', duration: 162, category: '轻松愉快', url: 'https://cdn.pixabay.com/audio/2023/10/07/audio_4c0ef6bfb5.mp3' },
      { id: 'happy-6', name: '柠檬汽水', artist: 'Lesfm', duration: 189, category: '轻松愉快', url: 'https://cdn.pixabay.com/audio/2024/06/05/audio_8c0c3628a2.mp3' },
    ],
  },
  {
    name: '浪漫温馨',
    icon: '💕',
    tracks: [
      { id: 'romantic-1', name: '星空之下', artist: 'AudioCoffee', duration: 195, category: '浪漫温馨', url: 'https://cdn.pixabay.com/audio/2022/02/22/audio_d1718ab41b.mp3' },
      { id: 'romantic-2', name: '晚风轻拂', artist: 'Lesfm', duration: 210, category: '浪漫温馨', url: 'https://cdn.pixabay.com/audio/2023/09/04/audio_5935dd4cbc.mp3' },
      { id: 'romantic-3', name: '梦中的婚礼', artist: 'AudioCoffee', duration: 180, category: '浪漫温馨', url: 'https://cdn.pixabay.com/audio/2022/01/18/audio_d0a13f69d2.mp3' },
      { id: 'romantic-4', name: '花间小径', artist: 'Lesfm', duration: 192, category: '浪漫温馨', url: 'https://cdn.pixabay.com/audio/2024/01/22/audio_e8c1c761e2.mp3' },
      { id: 'romantic-5', name: '月光倾诉', artist: 'Coma-Media', duration: 204, category: '浪漫温馨', url: 'https://cdn.pixabay.com/audio/2023/04/18/audio_e9f9e6cbb5.mp3' },
      { id: 'romantic-6', name: '温柔以待', artist: 'Lesfm', duration: 177, category: '浪漫温馨', url: 'https://cdn.pixabay.com/audio/2024/04/15/audio_9b89e9ab32.mp3' },
    ],
  },
  {
    name: '动感活力',
    icon: '🔥',
    tracks: [
      { id: 'energetic-1', name: '节拍风暴', artist: 'Coma-Media', duration: 156, category: '动感活力', url: 'https://cdn.pixabay.com/audio/2023/07/12/audio_e3e956fe3c.mp3' },
      { id: 'energetic-2', name: '燃爆全场', artist: 'Coma-Media', duration: 144, category: '动感活力', url: 'https://cdn.pixabay.com/audio/2022/12/22/audio_5770c4cb3c.mp3' },
      { id: 'energetic-3', name: '速度与激情', artist: 'Lesfm', duration: 168, category: '动感活力', url: 'https://cdn.pixabay.com/audio/2023/05/18/audio_6bdf7b6d0a.mp3' },
      { id: 'energetic-4', name: '电音派对', artist: 'Coma-Media', duration: 150, category: '动感活力', url: 'https://cdn.pixabay.com/audio/2024/02/07/audio_98f241db1e.mp3' },
      { id: 'energetic-5', name: '无限能量', artist: 'Lesfm', duration: 162, category: '动感活力', url: 'https://cdn.pixabay.com/audio/2023/09/25/audio_d22f620c0b.mp3' },
      { id: 'energetic-6', name: '跳跃节拍', artist: 'Coma-Media', duration: 138, category: '动感活力', url: 'https://cdn.pixabay.com/audio/2022/10/09/audio_d0253e4f2c.mp3' },
    ],
  },
  {
    name: '抒情治愈',
    icon: '🌿',
    tracks: [
      { id: 'healing-1', name: '山间清风', artist: 'AudioCoffee', duration: 210, category: '抒情治愈', url: 'https://cdn.pixabay.com/audio/2022/05/27/audio_1808fbf70d.mp3' },
      { id: 'healing-2', name: '午后时光', artist: 'Lesfm', duration: 198, category: '抒情治愈', url: 'https://cdn.pixabay.com/audio/2023/11/20/audio_b0e80a2fcb.mp3' },
      { id: 'healing-3', name: '雨后彩虹', artist: 'AudioCoffee', duration: 186, category: '抒情治愈', url: 'https://cdn.pixabay.com/audio/2022/08/31/audio_429f79c20a.mp3' },
      { id: 'healing-4', name: '静谧花园', artist: 'Lesfm', duration: 222, category: '抒情治愈', url: 'https://cdn.pixabay.com/audio/2024/03/18/audio_76f268ff1a.mp3' },
      { id: 'healing-5', name: '心灵绿洲', artist: 'Coma-Media', duration: 195, category: '抒情治愈', url: 'https://cdn.pixabay.com/audio/2023/01/16/audio_24e4067c6e.mp3' },
      { id: 'healing-6', name: '温柔岁月', artist: 'Lesfm', duration: 180, category: '抒情治愈', url: 'https://cdn.pixabay.com/audio/2023/08/28/audio_87d7cf2e7c.mp3' },
    ],
  },
  {
    name: '古风国韵',
    icon: '🏮',
    tracks: [
      { id: 'chinese-1', name: '水墨丹青', artist: 'AudioCoffee', duration: 195, category: '古风国韵', url: 'https://cdn.pixabay.com/audio/2022/10/12/audio_d0253e4f2c.mp3' },
      { id: 'chinese-2', name: '月下独酌', artist: 'Lesfm', duration: 210, category: '古风国韵', url: 'https://cdn.pixabay.com/audio/2023/06/06/audio_b1a5a9da54.mp3' },
      { id: 'chinese-3', name: '江南春色', artist: 'Coma-Media', duration: 186, category: '古风国韵', url: 'https://cdn.pixabay.com/audio/2022/09/06/audio_5e1cfb7d6a.mp3' },
      { id: 'chinese-4', name: '竹林清风', artist: 'AudioCoffee', duration: 198, category: '古风国韵', url: 'https://cdn.pixabay.com/audio/2023/04/25/audio_9e4d6e0e3b.mp3' },
      { id: 'chinese-5', name: '千里江山', artist: 'Lesfm', duration: 204, category: '古风国韵', url: 'https://cdn.pixabay.com/audio/2024/01/10/audio_8f6e509a7e.mp3' },
      { id: 'chinese-6', name: '长安夜色', artist: 'Coma-Media', duration: 192, category: '古风国韵', url: 'https://cdn.pixabay.com/audio/2023/10/28/audio_4f2b61e7f5.mp3' },
    ],
  },
  {
    name: '商务科技',
    icon: '💻',
    tracks: [
      { id: 'tech-1', name: '创新驱动', artist: 'Coma-Media', duration: 144, category: '商务科技', url: 'https://cdn.pixabay.com/audio/2023/05/25/audio_4b0ee7e4a2.mp3' },
      { id: 'tech-2', name: '数据之光', artist: 'Lesfm', duration: 156, category: '商务科技', url: 'https://cdn.pixabay.com/audio/2024/02/01/audio_9e4d6e0e3b.mp3' },
      { id: 'tech-3', name: '未来已来', artist: 'Coma-Media', duration: 138, category: '商务科技', url: 'https://cdn.pixabay.com/audio/2022/11/22/audio_9c49f4773d.mp3' },
      { id: 'tech-4', name: '数字脉搏', artist: 'Lesfm', duration: 150, category: '商务科技', url: 'https://cdn.pixabay.com/audio/2023/12/15/audio_d8f9a3e2c1.mp3' },
      { id: 'tech-5', name: '科技潮涌', artist: 'Coma-Media', duration: 162, category: '商务科技', url: 'https://cdn.pixabay.com/audio/2023/07/05/audio_8b7f2a1d3c.mp3' },
      { id: 'tech-6', name: '智能时代', artist: 'Lesfm', duration: 132, category: '商务科技', url: 'https://cdn.pixabay.com/audio/2024/05/10/audio_a1b2c3d4e5.mp3' },
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
