export type LanguageCode = 'EN' | 'UK' | 'PL' | 'DE' | 'FR' | 'ES';

export interface TranslateRequest {
  text: string;
  sourceLanguage: LanguageCode | 'AUTO';
  targetLanguage: LanguageCode;
}

export interface TranslateResponse {
  translation: string;
}

export interface DebounceOptions {
  delayMs: number;
  leading?: boolean;
  trailing?: boolean;
  onSuppressed?: () => void;
}

export interface EventLogEntry {
  id: number;
  type: 'CALL' | 'EXECUTION' | 'HTTP_REQUEST' | 'RESPONSE' | 'ERROR';
  label: string;
  value?: string;
  timestamp: number;
}
