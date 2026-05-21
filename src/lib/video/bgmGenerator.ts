/**
 * 内置背景音乐生成器
 *
 * 使用 Web Audio API 程序化生成轻量级背景音乐，
 * 无需从外部下载音频文件，彻底解决 CORS 和网络不可用问题。
 *
 * 生成的音乐风格：柔和的环境音乐（ambient pad + 简单旋律）
 * 每首曲目约 30 秒，可循环播放
 */

/** 生成 AudioBuffer 的函数类型 */
export type BgmGeneratorFn = (audioCtx: OfflineAudioContext, durationSec: number) => Promise<AudioBuffer>;

/** 内置 BGM 曲目定义 */
export interface BuiltInBgmTrack {
  id: string;
  name: string;
  category: string;
  duration: number;
  generator: BgmGeneratorFn;
  description: string;
}

// ==================== 辅助函数 ====================

/** 创建平滑的包络（ADSR） */
function applyEnvelope(
  param: AudioParam | Float32Array,
  attack: number,
  decay: number,
  sustain: number,
  release: number,
  duration: number,
  startTime: number = 0
) {
  if (param instanceof AudioParam) {
    param.setValueAtTime(0, startTime);
    param.linearRampToValueAtTime(0.5, startTime + attack);
    param.linearRampToValueAtTime(sustain, startTime + attack + decay);
    param.setValueAtTime(sustain, startTime + duration - release);
    param.linearRampToValueAtTime(0, startTime + duration);
  }
}

/** 生成柔和的 Pad 音色（多振荡器叠加 + 滤波） */
async function generatePad(
  ctx: OfflineAudioContext,
  freqs: number[],
  duration: number,
  startTime: number,
  volume: number = 0.15
): Promise<void> {
  const merger = ctx.createGain();
  merger.gain.value = volume / freqs.length;
  merger.connect(ctx.destination);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1200;
  filter.Q.value = 0.5;
  filter.connect(merger);

  for (const freq of freqs) {
    // 主振荡器
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(filter);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.1);

    // 轻微失谐副本，增加宽度
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 1.003;
    const g2 = ctx.createGain();
    g2.gain.value = 0.6;
    osc2.connect(g2);
    g2.connect(filter);
    osc2.start(startTime);
    osc2.stop(startTime + duration + 0.1);
  }

  // 包络
  applyEnvelope(merger.gain, 1.5, 0.5, volume * 0.8, 2, duration, startTime);
}

/** 生成简单旋律（正弦波 + 包络） */
async function generateMelody(
  ctx: OfflineAudioContext,
  notes: { freq: number; time: number; dur: number }[],
  startTime: number,
  volume: number = 0.08
): Promise<void> {
  for (const note of notes) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = note.freq;

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ctx.destination);
    osc.connect(gain);

    const t = startTime + note.time;
    const d = note.dur;

    // 简单的 ADSR
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.05);
    gain.gain.setValueAtTime(volume * 0.7, t + d * 0.3);
    gain.gain.linearRampToValueAtTime(0, t + d);

    osc.start(t);
    osc.stop(t + d + 0.01);
  }
}

/** 生成节拍（轻柔的打击乐） */
async function generateBeat(
  ctx: OfflineAudioContext,
  bpm: number,
  duration: number,
  startTime: number,
  volume: number = 0.06
): Promise<void> {
  const beatInterval = 60 / bpm;
  const beatCount = Math.floor(duration / beatInterval);

  for (let i = 0; i < beatCount; i++) {
    const t = startTime + i * beatInterval;

    // 轻柔的 kick（低频正弦波衰减）
    if (i % 4 === 0) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      gain.connect(ctx.destination);
      osc.connect(gain);
      osc.start(t);
      osc.stop(t + 0.25);
    }

    // 轻柔的 hi-hat（白噪声短暂爆发）
    if (i % 2 === 1) {
      const bufferSize = Math.floor(ctx.sampleRate * 0.05);
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let j = 0; j < bufferSize; j++) {
        data[j] = (Math.random() * 2 - 1) * 0.5;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 6000;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(volume * 0.4, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(t);
      noise.stop(t + 0.06);
    }
  }
}

// ==================== 曲目生成器 ====================

/** C大调和弦进行: C - Am - F - G */
const C_MAJOR_CHORDS = [
  [261.63, 329.63, 392.00], // C
  [220.00, 261.63, 329.63], // Am
  [349.23, 440.00, 523.25], // F
  [392.00, 493.88, 587.33], // G
];

/** 轻松愉快 - 明亮的C大调Pad + 轻快旋律 */
async function generateHappy(ctx: OfflineAudioContext, durationSec: number): Promise<AudioBuffer> {
  const chordDuration = durationSec / 4;

  for (let i = 0; i < 4; i++) {
    await generatePad(ctx, C_MAJOR_CHORDS[i], chordDuration + 0.5, i * chordDuration, 0.12);
  }

  // 轻快旋律 C5 E5 G5 A5 G5 E5 C5 D5
  const melodyNotes = [
    { freq: 523.25, time: 0, dur: 0.5 },
    { freq: 659.25, time: 0.6, dur: 0.5 },
    { freq: 783.99, time: 1.2, dur: 0.5 },
    { freq: 880.00, time: 1.8, dur: 0.8 },
    { freq: 783.99, time: 2.8, dur: 0.5 },
    { freq: 659.25, time: 3.4, dur: 0.5 },
    { freq: 523.25, time: 4.0, dur: 0.5 },
    { freq: 587.33, time: 4.6, dur: 0.8 },
    // 重复
    { freq: 523.25, time: 6.0, dur: 0.5 },
    { freq: 659.25, time: 6.6, dur: 0.5 },
    { freq: 783.99, time: 7.2, dur: 0.8 },
    { freq: 880.00, time: 8.2, dur: 0.5 },
    { freq: 783.99, time: 8.8, dur: 0.5 },
    { freq: 659.25, time: 9.4, dur: 0.5 },
    { freq: 587.33, time: 10.0, dur: 0.5 },
    { freq: 523.25, time: 10.6, dur: 1.0 },
  ];
  await generateMelody(ctx, melodyNotes, 0, 0.07);

  await generateBeat(ctx, 100, durationSec, 0, 0.04);

  return ctx.startRendering();
}

/** 浪漫温馨 - 柔和的Am-Dm-G-C + 温暖旋律 */
async function generateRomantic(ctx: OfflineAudioContext, durationSec: number): Promise<AudioBuffer> {
  const chords = [
    [220.00, 261.63, 329.63], // Am
    [293.66, 349.23, 440.00], // Dm
    [392.00, 493.88, 587.33], // G
    [261.63, 329.63, 392.00], // C
  ];
  const chordDuration = durationSec / 4;

  for (let i = 0; i < 4; i++) {
    await generatePad(ctx, chords[i], chordDuration + 0.5, i * chordDuration, 0.10);
  }

  // 温暖旋律 - 慢速
  const melodyNotes = [
    { freq: 329.63, time: 0, dur: 1.0 },
    { freq: 349.23, time: 1.2, dur: 0.8 },
    { freq: 392.00, time: 2.2, dur: 1.2 },
    { freq: 440.00, time: 3.6, dur: 0.8 },
    { freq: 392.00, time: 4.6, dur: 1.0 },
    { freq: 349.23, time: 5.8, dur: 0.8 },
    { freq: 329.63, time: 6.8, dur: 1.2 },
    { freq: 293.66, time: 8.2, dur: 1.0 },
  ];
  await generateMelody(ctx, melodyNotes, 0, 0.06);

  return ctx.startRendering();
}

/** 动感活力 - 快节奏Em-C-G-D + 节拍 */
async function generateEnergetic(ctx: OfflineAudioContext, durationSec: number): Promise<AudioBuffer> {
  const chords = [
    [164.81, 196.00, 246.94], // Em
    [261.63, 329.63, 392.00], // C
    [392.00, 493.88, 587.33], // G
    [293.66, 369.99, 440.00], // D
  ];
  const chordDuration = durationSec / 4;

  for (let i = 0; i < 4; i++) {
    await generatePad(ctx, chords[i], chordDuration + 0.3, i * chordDuration, 0.10);
  }

  // 快速旋律
  const melodyNotes = [
    { freq: 329.63, time: 0, dur: 0.3 },
    { freq: 392.00, time: 0.35, dur: 0.3 },
    { freq: 440.00, time: 0.7, dur: 0.3 },
    { freq: 493.88, time: 1.05, dur: 0.4 },
    { freq: 440.00, time: 1.5, dur: 0.3 },
    { freq: 392.00, time: 1.85, dur: 0.3 },
    { freq: 329.63, time: 2.2, dur: 0.3 },
    { freq: 349.23, time: 2.55, dur: 0.5 },
    // 重复提升
    { freq: 493.88, time: 3.5, dur: 0.3 },
    { freq: 523.25, time: 3.85, dur: 0.3 },
    { freq: 587.33, time: 4.2, dur: 0.3 },
    { freq: 659.25, time: 4.55, dur: 0.5 },
    { freq: 587.33, time: 5.1, dur: 0.3 },
    { freq: 523.25, time: 5.45, dur: 0.3 },
    { freq: 493.88, time: 5.8, dur: 0.5 },
    { freq: 440.00, time: 6.4, dur: 0.6 },
  ];
  await generateMelody(ctx, melodyNotes, 0, 0.06);

  await generateBeat(ctx, 130, durationSec, 0, 0.05);

  return ctx.startRendering();
}

/** 抒情治愈 - 缓慢的F-Bb-C-F + 长音旋律 */
async function generateHealing(ctx: OfflineAudioContext, durationSec: number): Promise<AudioBuffer> {
  const chords = [
    [349.23, 440.00, 523.25], // F
    [466.16, 587.33, 698.46], // Bb
    [523.25, 659.25, 783.99], // C
    [349.23, 440.00, 523.25], // F
  ];
  const chordDuration = durationSec / 4;

  for (let i = 0; i < 4; i++) {
    await generatePad(ctx, chords[i], chordDuration + 1, i * chordDuration, 0.08);
  }

  // 长音旋律
  const melodyNotes = [
    { freq: 523.25, time: 0, dur: 2.0 },
    { freq: 587.33, time: 2.2, dur: 1.5 },
    { freq: 659.25, time: 3.9, dur: 2.0 },
    { freq: 523.25, time: 6.1, dur: 1.5 },
    { freq: 440.00, time: 7.8, dur: 2.0 },
  ];
  await generateMelody(ctx, melodyNotes, 0, 0.05);

  return ctx.startRendering();
}

/** 古风国韵 - 五声音阶 C-D-E-G-A */
async function generateChinese(ctx: OfflineAudioContext, durationSec: number): Promise<AudioBuffer> {
  const chords = [
    [261.63, 329.63, 392.00], // C (宫)
    [293.66, 392.00, 440.00], // D商
    [329.63, 440.00, 523.25], // E角
    [392.00, 523.25, 587.33], // G徵
  ];
  const chordDuration = durationSec / 4;

  for (let i = 0; i < 4; i++) {
    await generatePad(ctx, chords[i], chordDuration + 0.5, i * chordDuration, 0.09);
  }

  // 五声音阶旋律 (宫商角徵羽)
  const pentatonic = [523.25, 587.33, 659.25, 783.99, 880.00]; // C5 D5 E5 G5 A5
  const melodyNotes = [
    { freq: pentatonic[0], time: 0, dur: 0.8 },
    { freq: pentatonic[2], time: 1.0, dur: 0.6 },
    { freq: pentatonic[3], time: 1.8, dur: 1.0 },
    { freq: pentatonic[4], time: 3.0, dur: 0.8 },
    { freq: pentatonic[3], time: 4.0, dur: 0.6 },
    { freq: pentatonic[2], time: 4.8, dur: 0.8 },
    { freq: pentatonic[1], time: 5.8, dur: 1.0 },
    { freq: pentatonic[0], time: 7.0, dur: 1.5 },
  ];
  await generateMelody(ctx, melodyNotes, 0, 0.06);

  return ctx.startRendering();
}

/** 商务科技 - 现代感Em-Am-B7-Em + 电子音色 */
async function generateTech(ctx: OfflineAudioContext, durationSec: number): Promise<AudioBuffer> {
  const chords = [
    [164.81, 196.00, 246.94], // Em
    [220.00, 261.63, 329.63], // Am
    [246.94, 311.13, 369.99], // B
    [164.81, 196.00, 246.94], // Em
  ];
  const chordDuration = durationSec / 4;

  for (let i = 0; i < 4; i++) {
    await generatePad(ctx, chords[i], chordDuration + 0.3, i * chordDuration, 0.10);
  }

  // 电子音色旋律 - 锯齿波效果通过多个正弦叠加模拟
  const melodyNotes = [
    { freq: 329.63, time: 0, dur: 0.4 },
    { freq: 392.00, time: 0.5, dur: 0.4 },
    { freq: 440.00, time: 1.0, dur: 0.6 },
    { freq: 392.00, time: 1.7, dur: 0.4 },
    { freq: 329.63, time: 2.2, dur: 0.4 },
    { freq: 293.66, time: 2.7, dur: 0.6 },
    { freq: 329.63, time: 3.5, dur: 0.8 },
    // 重复
    { freq: 493.88, time: 5.0, dur: 0.4 },
    { freq: 440.00, time: 5.5, dur: 0.4 },
    { freq: 392.00, time: 6.0, dur: 0.6 },
    { freq: 329.63, time: 6.7, dur: 0.4 },
    { freq: 392.00, time: 7.2, dur: 0.8 },
  ];
  await generateMelody(ctx, melodyNotes, 0, 0.06);

  await generateBeat(ctx, 110, durationSec, 0, 0.04);

  return ctx.startRendering();
}

// ==================== 曲目注册表 ====================

const BGM_DURATION = 30; // 每首 30 秒

export const BUILT_IN_BGM_TRACKS: BuiltInBgmTrack[] = [
  {
    id: 'builtin-happy-1',
    name: '阳光漫步',
    category: '轻松愉快',
    duration: BGM_DURATION,
    generator: generateHappy,
    description: '明亮的C大调和弦，轻快旋律',
  },
  {
    id: 'builtin-happy-2',
    name: '甜蜜时光',
    category: '轻松愉快',
    duration: BGM_DURATION,
    generator: generateHappy,
    description: '温暖的大调进行',
  },
  {
    id: 'builtin-romantic-1',
    name: '星空之下',
    category: '浪漫温馨',
    duration: BGM_DURATION,
    generator: generateRomantic,
    description: '柔和的小调色彩',
  },
  {
    id: 'builtin-romantic-2',
    name: '晚风轻拂',
    category: '浪漫温馨',
    duration: BGM_DURATION,
    generator: generateRomantic,
    description: '温暖浪漫的旋律',
  },
  {
    id: 'builtin-energetic-1',
    name: '节拍风暴',
    category: '动感活力',
    duration: BGM_DURATION,
    generator: generateEnergetic,
    description: '快节奏电子风格',
  },
  {
    id: 'builtin-energetic-2',
    name: '燃爆全场',
    category: '动感活力',
    duration: BGM_DURATION,
    generator: generateEnergetic,
    description: '强烈的节奏驱动',
  },
  {
    id: 'builtin-healing-1',
    name: '山间清风',
    category: '抒情治愈',
    duration: BGM_DURATION,
    generator: generateHealing,
    description: '缓慢舒展的旋律',
  },
  {
    id: 'builtin-healing-2',
    name: '静谧花园',
    category: '抒情治愈',
    duration: BGM_DURATION,
    generator: generateHealing,
    description: '安静祥和的氛围',
  },
  {
    id: 'builtin-chinese-1',
    name: '水墨丹青',
    category: '古风国韵',
    duration: BGM_DURATION,
    generator: generateChinese,
    description: '五声音阶古风旋律',
  },
  {
    id: 'builtin-chinese-2',
    name: '月下独酌',
    category: '古风国韵',
    duration: BGM_DURATION,
    generator: generateChinese,
    description: '悠扬的中国风',
  },
  {
    id: 'builtin-tech-1',
    name: '创新驱动',
    category: '商务科技',
    duration: BGM_DURATION,
    generator: generateTech,
    description: '现代感的电子音色',
  },
  {
    id: 'builtin-tech-2',
    name: '数据之光',
    category: '商务科技',
    duration: BGM_DURATION,
    generator: generateTech,
    description: '科技感的节拍',
  },
];

/** BGM 分类（与原接口兼容） */
export const BUILT_IN_BGM_CATEGORIES = [
  {
    name: '轻松愉快',
    icon: '🎵',
    tracks: BUILT_IN_BGM_TRACKS.filter(t => t.category === '轻松愉快'),
  },
  {
    name: '浪漫温馨',
    icon: '💕',
    tracks: BUILT_IN_BGM_TRACKS.filter(t => t.category === '浪漫温馨'),
  },
  {
    name: '动感活力',
    icon: '🔥',
    tracks: BUILT_IN_BGM_TRACKS.filter(t => t.category === '动感活力'),
  },
  {
    name: '抒情治愈',
    icon: '🌿',
    tracks: BUILT_IN_BGM_TRACKS.filter(t => t.category === '抒情治愈'),
  },
  {
    name: '古风国韵',
    icon: '🏮',
    tracks: BUILT_IN_BGM_TRACKS.filter(t => t.category === '古风国韵'),
  },
  {
    name: '商务科技',
    icon: '💻',
    tracks: BUILT_IN_BGM_TRACKS.filter(t => t.category === '商务科技'),
  },
];

/**
 * 生成内置 BGM 的 AudioBuffer
 * @param trackId - 内置曲目 ID
 * @param durationSec - 目标时长（秒），默认使用曲目自带时长
 * @returns AudioBuffer
 */
export async function generateBgmAudioBuffer(
  trackId: string,
  durationSec?: number
): Promise<AudioBuffer> {
  const track = BUILT_IN_BGM_TRACKS.find(t => t.id === trackId);
  if (!track) throw new Error(`未找到内置音乐: ${trackId}`);

  const duration = durationSec || track.duration;
  const sampleRate = 44100;
  const ctx = new OfflineAudioContext(2, sampleRate * duration, sampleRate);

  return track.generator(ctx, duration);
}

/** 格式化时长 */
export function formatBgmDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
