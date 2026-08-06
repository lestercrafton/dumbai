import { createEventType } from "../actions";

export const metadata = { title: "New Event Type" };

export default function NewEventTypePage() {
  return (
    <div>
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">New Event Type</h1>
      <form action={createEventType} className="card max-w-2xl space-y-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-ink-muted">Title</label>
            <input name="title" required placeholder="e.g., 30-min Discovery Call" className="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:shadow-ring" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-muted">URL slug</label>
            <input name="slug" required placeholder="e.g., discovery-call" pattern="[a-z0-9-]+" className="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:shadow-ring" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-muted">Description</label>
          <textarea name="description" rows={3} placeholder="What this meeting is about…" className="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:shadow-ring" />
        </div>
        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-ink-muted">Duration (min)</label>
            <input name="durationMinutes" type="number" defaultValue={30} min={5} max={480} className="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:shadow-ring" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-muted">Category</label>
            <select name="category" className="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:shadow-ring">
              <option value="sales">Sales</option>
              <option value="engineering">Engineering</option>
              <option value="operations">Operations</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-muted">Location</label>
            <select name="locationType" className="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:shadow-ring">
              <option value="GOOGLE_MEET">Google Meet</option>
              <option value="ZOOM">Zoom</option>
              <option value="PHONE">Phone</option>
              <option value="IN_PERSON">In Person</option>
              <option value="CUSTOM">Custom / TBD</option>
            </select>
          </div>
        </div>
        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            <label className="block text-sm font-medium text-ink-muted">Buffer before (min)</label>
            <input name="bufferBefore" type="number" defaultValue={0} min={0} className="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:shadow-ring" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-muted">Buffer after (min)</label>
            <input name="bufferAfter" type="number" defaultValue={0} min={0} className="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:shadow-ring" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink-muted">Min notice (min)</label>
            <input name="minNoticeMinutes" type="number" defaultValue={60} min={0} className="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:shadow-ring" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-muted">Max days ahead</label>
          <input name="maxDaysAhead" type="number" defaultValue={60} min={1} max={365} className="mt-1 w-full max-w-[200px] rounded-xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-brand focus:shadow-ring" />
        </div>
        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-sm"><input name="active" type="checkbox" defaultChecked className="h-4 w-4 rounded border-border text-brand accent-brand" /> Active (visible on booking page)</label>
          <label className="flex items-center gap-2 text-sm"><input name="requiresApproval" type="checkbox" className="h-4 w-4 rounded border-border text-brand accent-brand" /> Requires approval</label>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <a href="/admin/event-types" className="btn-secondary">Cancel</a>
          <button type="submit" className="btn-primary">Create event type</button>
        </div>
      </form>
    </div>
  );
}
