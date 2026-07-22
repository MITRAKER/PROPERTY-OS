import { createTask, listTasks } from "../../../db/repo";
import { withAuth } from "../../../lib/auth/server.ts";

export async function GET(request: Request) {
  return withAuth(request, async () => {
    try {
      return Response.json({ tasks: await listTasks() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load tasks.";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  return withAuth(request, async () => {
    try {
      const body = (await request.json()) as {
        title?: unknown; address?: unknown; propertyId?: unknown; due?: unknown; time?: unknown; priority?: unknown;
      };
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) return Response.json({ error: "A task title is required." }, { status: 400 });

      const priority = body.priority === "high" || body.priority === "low" ? body.priority : "medium";
      const task = await createTask({
        title,
        address: typeof body.address === "string" ? body.address : "",
        propertyId: typeof body.propertyId === "string" ? body.propertyId : null,
        due: typeof body.due === "string" && body.due ? body.due : "Today",
        time: typeof body.time === "string" ? body.time : "",
        priority,
      });
      return Response.json({ task }, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create the task.";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
