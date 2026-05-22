/**
 * 视频生成服务 - 共享类型定义
 * 提取到独立文件以避免循环依赖
 */

/** 视频宽高比类型 */
export type VideoAspectRatio = '16:9' | '9:16' | '4:3' | '1:1' | '3:4' | 'custom';

/** 转场效果名称类型 */
export type TransitionTypeName = 'fade' | 'slideLeft' | 'slideRight' | 'slideUp' | 'slideDown' | 'circleZoom' | 'dissolve' | 'granular' | 'blindsH' | 'blindsV' | 'coverLeft' | 'coverRight';

/** 视频生成设置 */
export interface VideoSettings {
  /** 宽高比 */
  aspectRatio: VideoAspectRatio;
  /** 自定义宽度（仅 aspectRatio 为 'custom' 时生效） */
  customWidth?: number;
  /** 自定义高度（仅 aspectRatio 为 'custom' 时生效） */
  customHeight?: number;
  /** 帧率，默认 30 */
  fps: number;
  /** 每张图像展示时长（秒），默认 3 */
  imageDuration: number;
  /** 转场时长（秒），默认 1 */
  transitionDuration: number;
  /** 转场效果类型，默认 'fade' */
  transition: TransitionTypeName;
  /** 视频质量 0~1，默认 0.8 */
  quality: number;
  /** 背景音乐文件 */
  audioFile?: File;
  /** 背景音乐音量 0~1 */
  audioVolume?: number;
}

/** 视频生成进度信息 */
export interface VideoProgress {
  /** 当前阶段 */
  phase: 'preparing' | 'rendering' | 'encoding';
  /** 当前帧 */
  current: number;
  /** 总帧数 */
  total: number;
  /** 完成百分比 0~100 */
  percent: number;
}
