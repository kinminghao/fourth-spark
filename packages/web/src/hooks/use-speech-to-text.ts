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

// ── WAV encoder (PCM16, mono) ────────────────────────────────────────────

function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const len = samples.length
  const buffer = new ArrayBuffer(44 + len * 2)
  const v = new DataView(buffer)

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i))
  }

  writeStr(0, "RIFF")
  v.setUint32(4, 36 + len * 2, true)
  writeStr(8, "WAVE")
  writeStr(12, "fmt ")
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  writeStr(36, "data")
  v.setUint32(40, len * 2, true)

  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return new Blob([buffer], { type: "audio/wav" })
}

// ── Engine detection ─────────────────────────────────────────────────────

const isNative = Capacitor.isNativePlatform()

const WebRecognitionAPI: SpeechRecognitionCtor | undefined =
  !isNative && typeof window !== "undefined"
    ? window.SpeechRecognition ?? window.webkitSpeechRecognition
    : undefined

// ── Hook ─────────────────────────────────────────────────────────────────

const SAMPLE_RATE = 16000

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

  // Server-engine recording refs
  const audioCtxRef = useRef<AudioContext | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const chunksRef = useRef<Float32Array[]>([])

  const isSupported = true

  // ── stop ────────────────────────────────────────────────────────────

  const stopServerRecording = useCallback(async () => {
    processorRef.current?.disconnect()
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop())
    await audioCtxRef.current?.close().catch(() => {})

    const chunks = chunksRef.current
    chunksRef.current = []
    processorRef.current = null
    mediaStreamRef.current = null
    audioCtxRef.current = null

    if (chunks.length === 0) {
      setIsListening(false)
      return
    }

    setInterimTranscript("识别中…")

    const totalLen = chunks.reduce((sum, c) => sum + c.length, 0)
    const merged = new Float32Array(totalLen)
    let offset = 0
    for (const c of chunks) {
      merged.set(c, offset)
      offset += c.length
    }

    const wav = encodeWAV(merged, SAMPLE_RATE)
    const form = new FormData()
    form.append("audio", wav, "recording.wav")

    try {
      const res = await fetch("/api/transcribe", { method: "POST", body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        setError((body as { error?: string }).error ?? `HTTP ${res.status}`)
      } else {
        const { text } = (await res.json()) as { text: string }
        if (text) setTranscript(text)
      }
    } catch (err) {
      setError(`语音识别失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setInterimTranscript("")
      setIsListening(false)
    }
  }, [])

  const stop = useCallback(async () => {
    manualStopRef.current = true
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
    if (isNative) {
      await SpeechRecognition.stop().catch(() => {})
      for (const l of nativeListenersRef.current) await l.remove().catch(() => {})
      nativeListenersRef.current = []
      setIsListening(false)
      setInterimTranscript("")
    } else if (webRecognitionRef.current) {
      webRecognitionRef.current.stop()
    } else if (audioCtxRef.current) {
      await stopServerRecording()
    } else {
      setIsListening(false)
    }
  }, [stopServerRecording])

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

  // ── start (web speech API) ─────────────────────────────────────────

  const startWeb = useCallback(() => {
    if (!WebRecognitionAPI) return false

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
      return true
    } catch {
      return false
    }
  }, [lang])

  // ── start (server — raw PCM → WAV → POST /api/transcribe) ─────────

  const startServer = useCallback(async () => {
    setTranscript("")
    setInterimTranscript("")
    setError(null)

    // Check server availability first
    try {
      const res = await fetch("/api/transcribe/status")
      const { available } = (await res.json()) as { available: boolean }
      if (!available) {
        setError("语音识别服务未就绪，请稍后重试")
        return
      }
    } catch {
      setError("无法连接语音识别服务")
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: SAMPLE_RATE, channelCount: 1 } })
    } catch {
      setError("请允许麦克风权限")
      return
    }

    const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE })
    const source = audioCtx.createMediaStreamSource(stream)
    const processor = audioCtx.createScriptProcessor(4096, 1, 1)

    chunksRef.current = []

    processor.onaudioprocess = (e) => {
      chunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)))
    }

    source.connect(processor)
    processor.connect(audioCtx.destination)

    audioCtxRef.current = audioCtx
    mediaStreamRef.current = stream
    processorRef.current = processor
    setIsListening(true)
  }, [])

  // ── unified start ──────────────────────────────────────────────────

  const start = useCallback(() => {
    if (isNative) {
      void startNative()
    } else if (WebRecognitionAPI) {
      const ok = startWeb()
      if (!ok) void startServer()
    } else {
      void startServer()
    }
  }, [startNative, startWeb, startServer])

  // ── cleanup ────────────────────────────────────────────────────────

  useEffect(
    () => () => {
      manualStopRef.current = true
      webRecognitionRef.current?.stop()
      processorRef.current?.disconnect()
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop())
      void audioCtxRef.current?.close().catch(() => {})
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
