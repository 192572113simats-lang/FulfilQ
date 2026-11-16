import { useEffect, useState } from 'react';
import { DeliveryColumn, DeliveryStoryDTO } from '@fulfilliq/shared';
import { ApiError, apiFetch } from '../lib/api.ts';

const COLUMNS: DeliveryColumn[] = ['Ready', 'In Progress', 'Review', 'Test', 'Blocked', 'Done'];
const WIP_LABELS: Partial<Record<DeliveryColumn, number>> = {
  'In Progress': 4,
  Review: 2,
  Test: 2,
};

export function DeliveryBoardPage() {
  const [stories, setStories] = useState<DeliveryStoryDTO[]>([]);
  const [banner, setBanner] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadBoard = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ banner: string; stories: DeliveryStoryDTO[] }>('/api/delivery-board');
      setBanner(res.banner);
      setStories(res.stories);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load delivery board');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBoard();
  }, []);

  const moveStory = async (storyId: string, nextCol: DeliveryColumn) => {
    setError(null);
    try {
      await apiFetch(`/api/delivery-board/${storyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ columnStatus: nextCol }),
      });
      await loadBoard();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to move story');
    }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-slate-900">Agile Delivery Board (S01–S13)</h1>
        <p className="mt-1 text-sm text-slate-600">
          Scrum + Lean workflow with enforced WIP limits (In Progress: 4, Review: 2, Test: 2). Separate from the operational order lifecycle.
        </p>
      </div>

      <div role="note" className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm font-medium text-amber-900">
        {banner || 'SIMULATED PLANNING DATA, not actual team delivery.'}
      </div>

      {error && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="h-64 bg-white border border-slate-200 rounded-lg animate-pulse" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 items-start">
          {COLUMNS.map((col) => {
            const colStories = stories.filter((s) => s.columnStatus === col);
            const wipLimit = WIP_LABELS[col];

            return (
              <section key={col} className="bg-slate-100 border border-slate-200 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-800 px-1">
                  <span>{col}</span>
                  <span className="font-mono tabular-nums text-slate-600">
                    {colStories.length}
                    {wipLimit ? ` / ${wipLimit}` : ''}
                  </span>
                </div>

                <div className="space-y-2.5">
                  {colStories.map((st) => (
                    <article key={st.id} className="bg-white border border-slate-200 rounded-md p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs font-mono text-slate-500">
                        <span>{st.id}</span>
                        <span>
                          {st.priority} · {st.points}pt · Sp{st.sprint}
                        </span>
                      </div>
                      <h2 className="text-xs font-semibold text-slate-900 leading-snug">{st.title}</h2>
                      <p className="text-[11px] text-slate-500">{st.ownerRole}</p>
                      {st.isDeferred && (
                        <p className="text-[11px] font-medium text-amber-800">
                          Roadmap Only (Deferred)
                        </p>
                      )}
                      <div>
                        <label htmlFor={`move-${st.id}`} className="sr-only">
                          Move {st.id} column
                        </label>
                        <select
                          id={`move-${st.id}`}
                          value={st.columnStatus}
                          onChange={(e) => moveStory(st.id, e.target.value as DeliveryColumn)}
                          className="w-full px-2 py-1 text-xs border border-slate-200 rounded bg-slate-50"
                        >
                          {COLUMNS.map((opt) => (
                            <option key={opt} value={opt}>
                              Move to {opt}
                            </option>
                          ))}
                        </select>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Roadmap Note for Deferred S13 */}
      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-base font-semibold text-slate-900">
          Product Roadmap (Deferred Out of First Release)
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          The following items remain on the future roadmap and are intentionally not implemented in this first release: S13 Sales Analytics dashboard, ML demand forecasting, product recommendations, loyalty rewards, multi-currency pricing, and real live payment card processing.
        </p>
      </section>
    </div>
  );
}
