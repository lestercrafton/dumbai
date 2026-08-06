import { db } from "@/lib/db";

export const metadata = { title: "Teams" };

export default async function TeamsPage() {
  const teams = await db.team.findMany({
    orderBy: { createdAt: "asc" },
    include: { members: { include: { user: true } }, _count: { select: { eventTypes: true } } },
  });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
        <p className="mt-1 text-sm text-ink-muted">Organize your team members for round-robin scheduling.</p>
      </div>
      {teams.length === 0 ? (
        <div className="card text-center text-ink-muted">
          <p>No teams yet. Run <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs">npm run db:seed</code> to create the defaults (Sales, Engineering, Operations).</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <div key={team.id} className="card">
              <h3 className="text-lg font-semibold">{team.name}</h3>
              {team.description && <p className="mt-1 text-sm text-ink-muted">{team.description}</p>}
              <div className="mt-4 flex items-center justify-between text-sm text-ink-muted">
                <span>{team.members.length} members</span>
                <span>{team._count.eventTypes} event types</span>
              </div>
              {team.members.length > 0 && (
                <div className="mt-3 space-y-1">
                  {team.members.map((m) => (
                    <div key={m.id} className="flex items-center justify-between text-sm">
                      <span>{m.user.name ?? m.user.email}</span>
                      <span className="text-xs text-ink-muted">{m.role}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
