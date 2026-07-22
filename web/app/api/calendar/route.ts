import { buildIcs, isIsoDate, type CalendarEvent } from "../../../lib/calendar/ics.ts";
import { listProperties, listTasks } from "../../../db/repo";
import { withAuth } from "../../../lib/auth/server.ts";

// GET /api/calendar[?taskId=...]
// Returns follow-ups as an .ics file so the agent's own calendar handles the
// reminders — no paid notification service.
export async function GET(request: Request) {
  return withAuth(request, async () => {
    try {
      const taskId = new URL(request.url).searchParams.get("taskId");
      const today = new Date().toISOString().slice(0, 10);
      const [tasks, properties] = await Promise.all([listTasks(), listProperties()]);
      const addressById = new Map(properties.map((property) => [property.id, property.address]));

      const source = taskId ? tasks.filter((task) => task.id === taskId) : tasks.filter((task) => !task.completed);

      const events: CalendarEvent[] = [];
      for (const task of source) {
        const date = isIsoDate(task.due) ? task.due : task.due === "Today" ? today : null;
        if (!date) continue;
        const location = task.address || (task.propertyId ? addressById.get(task.propertyId) ?? "" : "");
        events.push({
          uid: `${task.id}@property-os`,
          title: task.title,
          date,
          description: location ? `Property OS follow-up · ${location}` : "Property OS follow-up",
          location,
          alarmMinutesBefore: 30,
        });
      }

      const ics = buildIcs(events);
      const filename = taskId ? "property-os-follow-up.ics" : "property-os-follow-ups.ics";
      return new Response(ics, {
        status: 200,
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not build the calendar file.";
      return Response.json({ error: message }, { status: 500 });
    }
  });
}
