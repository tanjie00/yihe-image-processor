/**
 * 内置背景音乐生成器 — 已弃用
 *
 * 原本使用 Web Audio API 程序化生成轻量级背景音乐（54首合成曲目），
 * 现已改为基于 manifest.json 的真实音频文件管理方式。
 *
 * 此文件保留仅为兼容性，不再主动使用。
 * 所有内置音乐通过 public/music/manifest.json 管理。
 */

/** 格式化时长 */
export function formatBgmDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
