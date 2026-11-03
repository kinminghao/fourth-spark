import { useEffect, useState } from "react"

function readVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return []
  }
  return window.speechSynthesis.getVoices()
}

export function useSpeechVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(readVoices)

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return
    }
    const synthesis = window.speechSynthesis
    const update = (): void => {
      setVoices(synthesis.getVoices())
    }
    update()

    if (typeof synthesis.addEventListener !== "function") {
      return
    }
    synthesis.addEventListener("voiceschanged", update)
    return () => {
      synthesis.removeEventListener("voiceschanged", update)
    }
  }, [])

  return voices
}
