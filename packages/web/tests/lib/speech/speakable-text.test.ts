import { describe, expect, test } from "bun:test"
import type { MessagePart } from "../../../src/lib/api-client"
import { extractSpeakableMessageText, splitSpeechChunks, toSpeakableText } from "../../../src/lib/speech/speakable-text"

describe("toSpeakableText", () => {
  test("removes fenced code blocks with their content", () => {
    const input = "前面\n```ts\nconst x = 1\n```\n后面"
    expect(toSpeakableText(input)).toBe("前面\n后面")
  })

  test("removes tilde-fenced code blocks with their content", () => {
    const input = "开始\n~~~python\nprint('x')\n~~~\n结束"
    expect(toSpeakableText(input)).toBe("开始\n结束")
  })

  test("removes inline code", () => {
    expect(toSpeakableText("调用 `run()` 完成")).toBe("调用 完成")
  })

  test("keeps link label and drops the URL", () => {
    const result = toSpeakableText("请看 [说明文档](https://example.com/docs)")
    expect(result).toBe("请看 说明文档")
    expect(result).not.toContain("https")
  })

  test("removes images entirely", () => {
    expect(toSpeakableText("前 ![alt](image.png) 后")).toBe("前 后")
  })

  test("removes HTML tags", () => {
    expect(toSpeakableText("<div>你好</div><br/>世界")).toBe("你好 世界")
  })

  test("removes table rows and separators", () => {
    const input = "| 名称 | 年龄 |\n| --- | --- |\n| 张三 | 30 |"
    expect(toSpeakableText(input)).toBe("")
  })

  test("removes tables without leading pipes", () => {
    const input = "前文\n\n名称 | 年龄\n--- | ---\n张三 | 30\n\n后文"
    expect(toSpeakableText(input)).toBe("前文\n\n后文")
  })

  test("strips heading, quote, list and emphasis markers", () => {
    const input = "# 标题\n> 引用\n- 项目 **粗体**\n* 项目 _斜体_\n1. 第一\n~~删除~~"
    expect(toSpeakableText(input)).toBe("标题\n引用\n项目 粗体\n项目 斜体\n第一\n删除")
  })

  test("drops horizontal rules", () => {
    expect(toSpeakableText("上\n---\n中\n***\n下")).toBe("上\n中\n下")
  })

  test("returns empty string for code-only input", () => {
    expect(toSpeakableText("```\nconst x = 1\n```")).toBe("")
  })

  test("returns empty string for image-only input", () => {
    expect(toSpeakableText("![alt](image.png)")).toBe("")
  })

  test("collapses repeated blank lines and trims", () => {
    expect(toSpeakableText("\n\n第一段\n\n\n\n第二段\n\n")).toBe("第一段\n\n第二段")
  })
})

describe("extractSpeakableMessageText", () => {
  test("only text parts contribute", () => {
    const parts: MessagePart[] = [
      { type: "text", content: "你好" },
      { type: "thinking", text: "思考内容" },
      { type: "tool", toolName: "bash", output: "工具输出" },
      { type: "file", url: "data:application/pdf;base64,AAA" },
      { type: "text", text: "世界" },
    ]

    const result = extractSpeakableMessageText(parts)
    expect(result).toBe("你好\n\n世界")
    expect(result).not.toContain("思考内容")
    expect(result).not.toContain("工具输出")
    expect(result).not.toContain("data:")
  })
})

describe("splitSpeechChunks", () => {
  test("splits on Chinese and English punctuation keeping terminators", () => {
    expect(splitSpeechChunks("你好。世界！Hello! World?；")).toEqual(["你好。", "世界！", "Hello!", "World?", "；"])
  })

  test("splits on newlines", () => {
    expect(splitSpeechChunks("第一行\n第二行")).toEqual(["第一行", "第二行"])
  })

  test("trims and drops empty segments", () => {
    expect(splitSpeechChunks("  \n  \n你好。\n\n")).toEqual(["你好。"])
  })

  test("returns one chunk for already short input", () => {
    expect(splitSpeechChunks("简短的一句话")).toEqual(["简短的一句话"])
  })

  test("hard splits segments longer than maxChars", () => {
    expect(splitSpeechChunks("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"])
  })

  test("prefers the last space when splitting long segments", () => {
    expect(splitSpeechChunks("hello world again", 12)).toEqual(["hello world", "again"])
  })

  test("returns no chunks for empty input", () => {
    expect(splitSpeechChunks("")).toEqual([])
    expect(splitSpeechChunks("   ")).toEqual([])
  })
})
