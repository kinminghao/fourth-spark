export interface SpeakRequest {
  text: string
  lang?: string
  onEnd: () => void
  onError: (error: unknown) => void
}

export interface SpeechProvider {
  isSupported(): boolean
  speak(request: SpeakRequest): void
  stop(): void
}
