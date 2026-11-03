export interface SpeakRequest {
  text: string
  lang?: string
  voiceURI?: string | null
  rate?: number
  onEnd: () => void
  onError: (error: unknown) => void
}

export interface SpeechProvider {
  isSupported(): boolean
  speak(request: SpeakRequest): void
  pause(): void
  resume(): void
  stop(): void
}
