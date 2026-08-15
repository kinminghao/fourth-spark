import { useCallback, useEffect, useRef, useState } from "react"

// Web Speech API type declarations (not in all TS lib bundles)
interface SpeechRecognitionAlternative {
  readonly transcript: string
  readonly confidence: number
}

interface SpeechRecognitionResult {
  readonly length: number
  readonly isFinal: boolean
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionResultList {
  readonly length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string
  readonly message: string
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: ((ev: Event) => void) | null
  onresult: ((ev: SpeechRecognitionEvent) => void) | null
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null
  onend: ((ev: Event) => void) | null
  start(): void
  stop(): void
  abort(): void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
}

const RecognitionAPI: SpeechRecognitionCtor | undefined =
  typeof window !== "undefined"
    ? window.SpeechRecognition ?? window.webkitSpeechRecognition
    : undefined

export function useSpeechToText(lang = "zh-CN") {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [interimTranscript, setInterimTranscript] = useState("")
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const manualStopRef = useRef(false)

  const isSupported = RecognitionAPI !== undefined

  const stop = useCallback(() => {
    manualStopRef.current = true
    recognitionRef.current?.stop()
  }, [])

  const start = useCallback(() => {
    if (!RecognitionAPI) return

    setTranscript("")
    setInterimTranscript("")
    setError(null)
    manualStopRef.current = false

    const recognition = new RecognitionAPI()
    recognition.lang = lang
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => setIsListening(true)

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalChunk = ""
      let interim = ""
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalChunk += text
        } else {
          interim += text
        }
      }
      if (finalChunk) setTranscript((prev) => prev + finalChunk)
      setInterimTranscript(interim)
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error !== "no-speech" && event.error !== "aborted") {
        manualStopRef.current = true
      }
      switch (event.error) {
        case "not-allowed":
          setError("请允许麦克风权限")
          break
        case "network":
          setError("网络错误，请检查连接")
          break
        case "no-speech":
        case "aborted":
          return
        default:
          setError(`语音识别错误：${event.error}`)
      }
    }

    recognition.onend = () => {
      setInterimTranscript("")
      // Chrome auto-stops after silence; restart unless manually stopped
      if (!manualStopRef.current) {
        try {
          recognition.start()
          return
        } catch {
          // Failed to restart
        }
      }
      setIsListening(false)
      recognitionRef.current = null
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
    } catch {
      setError("无法启动语音识别")
    }
  }, [lang])

  useEffect(
    () => () => {
      manualStopRef.current = true
      recognitionRef.current?.stop()
    },
    [],
  )

  const resetTranscript = useCallback(() => {
    setTranscript("")
    setInterimTranscript("")
  }, [])

  return {
    isSupported,
    isListening,
    transcript,
    interimTranscript,
    error,
    start,
    stop,
    resetTranscript,
  }
}
