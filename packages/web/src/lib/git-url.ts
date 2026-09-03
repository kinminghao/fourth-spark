// Client-side git URL parser — mirrors packages/server/src/lib/git-url.ts regex
// Only extracts the host; full owner/repo parsing not needed on the frontend.

const SSH_RE = /^[\w.-]+@([\w.-]+):([\w.-]+)\/([\w.-]+?)(?:\.git)?$/
const HTTPS_RE = /^https?:\/\/([\w.-]+)\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/)?$/
const SSH_PROTO_RE = /^ssh:\/\/[\w.-]+@([\w.-]+)\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/

export function extractHostFromGitUrl(url: string): string | null {
  for (const re of [SSH_RE, HTTPS_RE, SSH_PROTO_RE]) {
    const m = url.match(re)
    if (m) return m[1]
  }
  return null
}
