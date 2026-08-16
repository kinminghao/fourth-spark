import { useCallback, useEffect, useRef, useState } from "react"
import { Capacitor } from "@capacitor/core"
import { SpeechRecognition } from "@capacitor-community/speech-recognition"

// ── Web Speech API type declarations (not in all TS DOM lib bundles) ──────

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

// ── Engine detection ─────────────────────────────────────────────────────

const isNative = Capacitor.isNativePlatform()

const WebRecognitionAPI: SpeechRecognitionCtor | undefined =
  !isNative && typeof window !== "undefined"
    ? window.SpeechRecognition ?? window.webkitSpeechRecognition
    : undefined

// Native always supported (Capacitor plugin handles availability);
// Web only when browser exposes the API (HTTPS / localhost)
const supported = isNative || WebRecognitionAPI !== undefined

// ── Hook ─────────────────────────────────────────────────────────────────

export function useSpeechToText(lang = "zh-CN") {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [interimTranscript, setInterimTranscript] = useState("")
  const [error, setError] = useState<string | null>(null)

  const webRecognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const manualStopRef = useRef(false)
  const nativeListenersRef = useRef<Array<{ remove: () => Promise<void> }>>([])
  const gotResultRef = useRef(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isSupported = supported

  // ── stop ────────────────────────────────────────────────────────────

  const stop = useCallback(async () => {
    manualStopRef.current = true
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
    if (isNative) {
      await SpeechRecognition.stop().catch(() => {})
      for (const l of nativeListenersRef.current) await l.remove().catch(() => {})
      nativeListenersRef.current = []
      setIsListening(false)
      setInterimTranscript("")
    } else {
      webRecognitionRef.current?.stop()
    }
  }, [])

  // ── start (native) ─────────────────────────────────────────────────

  const startNative = useCallback(async () => {
    setTranscript("")
    setInterimTranscript("")
    setError(null)

    const { available } = await SpeechRecognition.available()
    if (!available) {
      setError("当前设备不支持语音识别")
      return
    }

    const perm = await SpeechRecognition.requestPermissions()
    if (perm.speechRecognition !== "granted") {
      setError("请允许语音识别权限")
      return
    }

    const listeners: Array<{ remove: () => Promise<void> }> = []

    listeners.push(
      await SpeechRecognition.addListener("partialResults", (data: { matches: string[] }) => {
        setInterimTranscript(data.matches[0] ?? "")
      }),
    )

    listeners.push(
      await SpeechRecognition.addListener("listeningState", (data: { status: string }) => {
        const on = data.status === "started"
        setIsListening(on)
        if (!on) setInterimTranscript("")
      }),
    )

    nativeListenersRef.current = listeners

    try {
      const result = await SpeechRecognition.start({
        language: lang,
        partialResults: true,
        maxResults: 1,
      })
      if (result.matches?.length) {
        setTranscript((prev) => prev + result.matches!.join(""))
      }
    } catch (err) {
      setError(`语音识别错误：${err instanceof Error ? err.message : String(err)}`)
      for (const l of listeners) await l.remove().catch(() => {})
      nativeListenersRef.current = []
    }
  }, [lang])

  // ── start (web) ────────────────────────────────────────────────────

  const startWeb = useCallback(() => {
    if (!WebRecognitionAPI) {
      setError("当前浏览器不支持语音识别，请使用 Chrome/Edge/Safari 并通过 HTTPS 访问")
      return
    }

    setTranscript("")
    setInterimTranscript("")
    setError(null)
    manualStopRef.current = false

    const recognition = new WebRecognitionAPI()
    recognition.lang = lang
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setIsListening(true)
      gotResultRef.current = false
      timeoutRef.current = setTimeout(() => {
        if (!gotResultRef.current && !manualStopRef.current) {
          setError("未检测到语音，请检查麦克风或网络连接（Chrome 需访问 Google 服务器）")
        }
      }, 5000)
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      gotResultRef.current = true
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
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
      if (!manualStopRef.current) {
        try { recognition.start(); return } catch { /* fall through */ }
      }
      setIsListening(false)
      webRecognitionRef.current = null
    }

    webRecognitionRef.current = recognition
    try {
      recognition.start()
    } catch {
      setError("无法启动语音识别")
    }
  }, [lang])

  // ── unified start ──────────────────────────────────────────────────

  const start = useCallback(() => {
    if (isNative) {
      void startNative()
    } else {
      startWeb()
    }
  }, [startNative, startWeb])

  // ── cleanup ────────────────────────────────────────────────────────

  useEffect(
    () => () => {
      manualStopRef.current = true
      webRecognitionRef.current?.stop()
      for (const l of nativeListenersRef.current) void l.remove().catch(() => {})
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
