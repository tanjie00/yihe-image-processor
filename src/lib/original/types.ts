export interface LogoSettings {
  x: number; // Percentage 0-100
  y: number; // Percentage 0-100
  scale: number; // Percentage of base image width 1-100
  opacity: number; // 0-1
}

export enum ProcessStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
}

export interface ProcessedImage {
  id: string;
  originalFile: File;
  previewUrl: string; // URL for the original image
  resultUrl?: string; // URL for the processed image
  status: ProcessStatus;
  errorMessage?: string;
  progressValue?: number;
  progressMessage?: string;
  relativePath?: string; // e.g. "subfolder/nested/photo.jpg" — used to replicate directory structure
  completedAt?: number; // timestamp when processing completed, used for ETA calculation
}

export type ProcessingMode = 'add-logo' | 'both' | 'crop-only';

export type AiModel = 'gemini-2.5-flash-image' | 'gemini-3-pro-image-preview';

export interface SlicedPiece {
  id: string;
  url: string;
  width: number;
  height: number;
  index: number;
}

export interface SlicedResult {
  sourceImageId: string;
  sourceFileName: string;
  pieces: SlicedPiece[];
  isSlicing: boolean;
  cropNodes?: number[]; // percentage positions (0-100) of manual crop nodes
  sourceImageUrl?: string; // original image URL for re-editing crop nodes
}

export interface LogoItem {
  id: string;
  file: File;
  url: string;
  name: string; // filename without extension
}

export interface FolderNode {
  name: string;
  fullPath: string;
  imageCount: number;       // total images in this folder (recursive)
  directImageCount: number; // images directly in this folder (not in subfolders)
  children: FolderNode[];
  previewUrl?: string;      // first image preview for thumbnail
}

export interface BatchResult {
  id: string;
  logoId: string;
  logoName: string;
  imageId: string;
  imageName: string;
  relativePath?: string; // directory path for this image, e.g. "subfolder/nested"
  resultUrl?: string;
  status: ProcessStatus;
  errorMessage?: string;
  progressValue?: number;
  progressMessage?: string;
}