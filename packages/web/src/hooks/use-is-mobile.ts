import { useEffect, useState } from "react"

const MOBILE_BREAKPOINT = 768

function checkIsMobile(): boolean {
  if (typeof window === "undefined") return false
  return window.innerWidth < MOBILE_BREAKPOINT && ("ontouchstart" in window || navigator.maxTouchPoints > 0)
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(checkIsMobile)

  useEffect(() => {
    const onResize = () => setIsMobile(checkIsMobile())
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  return isMobile
}
