import { Hono } from "hono"
import { eq, and, desc } from "drizzle-orm"
import { db } from "../db/index"
import { milestones } from "../db/schema"

export const milestoneRoutes = new Hono()

// GET /milestones — list all milestones for this repo
milestoneRoutes.get("/", async (c) => {
  const repoId = c.req.param("repoId")!
  const state = c.req.query("state")

  let rows
  if (state && state !== "all") {
    rows = await db.select().from(milestones)
      .where(and(eq(milestones.repoId, repoId), eq(milestones.state, state)))
      .orderBy(desc(milestones.updatedAt))
  } else {
    rows = await db.select().from(milestones)
      .where(eq(milestones.repoId, repoId))
      .orderBy(desc(milestones.updatedAt))
  }
  return c.json(rows)
})
