export interface AudioClip {
  id: string;
  sessionId: string;
  blob: Blob;
  startedAt: string;
  duration: number;
  createdAt: number;
  status: "queued" | "processing" | "failed";
  durable: boolean;
  error?: string;
  segments?: {
    id: string;
    text: string;
    startedAt: string;
    duration: number;
  }[];
}
export type PendingClip = Omit<AudioClip, "blob"> & { bytes: number };
export interface AudioStorage {
  put(clip: AudioClip): Promise<unknown>;
  list(): Promise<AudioClip[]>;
  remove(id: string): Promise<unknown>;
}
export interface AudioQueue {
  pause(): void;
  initialize(): Promise<void>;
  enqueue(clip: {
    blob: Blob;
    sessionId: string;
    startedAt?: string;
    duration?: number;
    finalCapture?: boolean;
  }): Promise<string>;
  retry(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  get(id: string): AudioClip | undefined;
  capacity(): boolean;
  drain(): Promise<void>;
}
export function createAudioQueue(options: {
  storage: AudioStorage;
  transcribe(
    clip: AudioClip,
  ): Promise<{ text: string; durationSeconds?: number }>;
  append(
    sessionId: string,
    segment: NonNullable<AudioClip["segments"]>[number],
  ): Promise<unknown>;
  onChange?(clips: PendingClip[]): void;
  maxClips?: number;
  maxBytes?: number;
  now?: () => number;
}): AudioQueue;
export function audioNamespace(input: {
  desktop: boolean;
  state?: { storage?: string; accountId?: string } | null;
}): string | null;
export function encryptedAudioStorage(namespace: string): AudioStorage;
