export interface Cue {
  start: number;
  end: number;
  text: string;
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: string;
  isTranslatable?: boolean;
}

export class CaptionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptionUnavailableError";
  }
}
