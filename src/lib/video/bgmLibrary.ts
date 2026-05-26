/**
 * 背景音乐库 — 基于manifest的动态音乐管理
 *
 * 从 public/music/manifest.json 动态加载音乐列表，
 * 音乐文件存放在 public/music/ 目录下。
 * 支持自定义上传音乐功能。
 */

export interface BgmTrack {
  id: string;
  name: string;
  artist: string;
  duration: number; // 秒
  category: string;
  /** 内置音乐标记 */
  isBuiltIn?: boolean;
  /** 在线音频 URL（仅自定义上传使用） */
  url?: string;
  /** 文件型音乐的相对路径（相对于 public/music/ 目录） */
  filePath?: string;
}

export interface BgmCategory {
  name: string;
  icon: string;
  tracks: BgmTrack[];
}

// 缓存已加载的音乐数据
let cachedCategories: BgmCategory[] = [];
let loadingPromise: Promise<BgmCategory[]> | null = null;

/**
 * 加载音乐 manifest
 * 从 /music/manifest.json 读取音乐列表
 */
export async function loadBgmManifest(): Promise<BgmCategory[]> {
  // 如果已经有缓存数据且非空，直接返回
  if (cachedCategories && cachedCategories.length > 0 && cachedCategories.some(c => c.tracks.length > 0)) {
    return cachedCategories;
  }
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const response = await fetch('/music/manifest.json');
      if (!response.ok) {
        console.warn('音乐 manifest 加载失败:', response.status);
        return cachedCategories;
      }
      const manifest = await response.json();

      if (manifest.categories && Array.isArray(manifest.categories)) {
        cachedCategories = manifest.categories.map((cat: any) => ({
          name: cat.name || '未分类',
          icon: cat.icon || '🎵',
          tracks: (cat.tracks || []).map((track: any) => ({
            id: track.id || `builtin-${track.filePath || Math.random().toString(36).slice(2)}`,
            name: track.name || track.filePath || '未知',
            artist: track.artist || '内置',
            duration: track.duration || 30,
            category: cat.name || '未分类',
            isBuiltIn: true,
            filePath: track.filePath,
          })),
        }));
      } else {
        cachedCategories = [];
      }

      console.log(`音乐 manifest 加载完成: ${cachedCategories.reduce((sum, c) => sum + c.tracks.length, 0)} 首曲目`);
      return cachedCategories;
    } catch (err) {
      console.warn('音乐 manifest 加载异常:', err);
      return cachedCategories;
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

/**
 * 获取音乐分类（同步，需先调用 loadBgmManifest）
 */
export function getBgmCategories(): BgmCategory[] {
  return cachedCategories;
}

/**
 * 清除缓存（用于强制重新加载）
 */
export function invalidateBgmCache(): void {
  cachedCategories = [];
  loadingPromise = null;
}

/** 获取所有音乐列表（扁平化） */
export function getAllTracks(): BgmTrack[] {
  return getBgmCategories().flatMap(c => c.tracks);
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

/** 获取文件型音乐的完整 URL 路径 */
export function getMusicFileUrl(filePath: string): string {
  return `/music/${filePath}`;
}
