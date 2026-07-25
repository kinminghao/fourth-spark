import { useState, type ComponentPropsWithoutRef } from "react"
import { Maximize2, Minimize2 } from "lucide-react"

type Mode = "fit" | "wide"

export function MarkdownTable(props: ComponentPropsWithoutRef<"table">) {
  const [mode, setMode] = useState<Mode>("fit")
  const isWide = mode === "wide"

  return (
    <div className={`md-table-wrap ${isWide ? "md-table-wide" : "md-table-fit"}`}>
      <button
        type="button"
        className="md-table-toggle"
        title={isWide ? "适应屏幕" : "超宽展开"}
        onClick={() => setMode(isWide ? "fit" : "wide")}
      >
        {isWide ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
        <span>{isWide ? "适应屏幕" : "超宽展开"}</span>
      </button>
      <div className="md-table-scroll">
        <table {...props} />
      </div>
    </div>
  )
}
