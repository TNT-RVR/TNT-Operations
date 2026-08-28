import { LAYER_DEFS, GROUPS, GROUP_LABEL, activeLayers, type LayerGroup, type LayerId, type LayerVisibility, type LayerDef } from './layers'

/**
 * The map's LAYERS / TOOL / ACTIONS control surface (spec Part 6).
 *
 * - LAYERS: visibility chips, grouped like the desktop app's six layers.
 * - TOOL: which layer is "active" — its actions appear in the strip below.
 * - LEGEND: lists ONLY the overlays currently on, each with a swatch drawn in
 *   the real stroke/fill colour (§6.8).
 *
 * ── On a phone ───────────────────────────────────────────────────────────────
 *
 * All of this is FOUR wrapping rows plus a legend, which on a 375 px screen ate
 * the entire viewport and left the map as a strip at the bottom — the one thing
 * the screen exists to show. Two changes fix that without taking anything away:
 * the legend folds (it is reference, not control, and it grows with every layer
 * turned on), and the parent hides this whole bar behind a Tools toggle on
 * small screens. Desktop is unchanged.
 */
import { ChevronDown } from 'lucide-react'

/** A single action button belonging to the active tool layer. */
export interface ToolAction {
  id: string
  label: string
  /** Rendered as the primary (honey) button — the layer's main verb. */
  primary?: boolean
  /** Shown pressed/active, e.g. while a drawing mode is armed. */
  active?: boolean
  disabled?: boolean
  onClick: () => void
}

function Swatch({ def }: { def: LayerDef }) {
  const c = def.color
  if (def.swatch === 'pin') {
    return <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c, border: '1px solid #1A1A1A' }} />
  }
  if (def.swatch === 'ring') {
    return <span className="inline-block h-2.5 w-2.5" style={{ border: `1.5px solid ${c}` }} />
  }
  if (def.swatch === 'box') {
    return <span className="inline-block h-2.5 w-3.5" style={{ background: c, opacity: 0.55 }} />
  }
  if (def.swatch === 'dash') {
    return (
      <span
        className="inline-block h-0 w-3.5"
        style={{ borderTop: `2px dashed ${c}` }}
      />
    )
  }
  return <span className="inline-block h-0 w-3.5" style={{ borderTop: `2px solid ${c}` }} />
}

export function MapToolbar({
  visibility,
  onToggleLayer,
  tool,
  onTool,
  actions,
  status,
}: {
  visibility: LayerVisibility
  onToggleLayer: (id: LayerId) => void
  tool: LayerGroup
  onTool: (g: LayerGroup) => void
  actions: ToolAction[]
  /** Transient message — measurement readout, "click the map to…", etc. */
  status?: string | null
}) {
  const groupLayers = LAYER_DEFS.filter((d) => d.group === tool)
  const legend = activeLayers(visibility)

  return (
    <div className="border-b border-subtle bg-surface">
      {/* TOOL row */}
      <div className="flex flex-wrap items-center gap-1 px-3 pt-2">
        <span className="label mb-0 mr-1">Tool</span>
        {GROUPS.map((g) => (
          <button
            key={g}
            onClick={() => onTool(g)}
            className={`rounded-sm px-2.5 py-1 text-xs font-medium transition ${
 tool === g ? 'bg-brand text-on-brand' : 'text-secondary hover:bg-[color:var(--hover-wash)]'
            }`}
          >
            {GROUP_LABEL[g]}
          </button>
        ))}
      </div>

      {/* LAYERS row — the active tool's layers, so the row stays short */}
      <div className="flex flex-wrap items-center gap-1 px-3 pt-2">
        <span className="label mb-0 mr-1">Layers</span>
        {groupLayers.map((d) => {
          const on = visibility[d.id]
          return (
            <button
              key={d.id}
              onClick={() => onToggleLayer(d.id)}
              title={on ? `Hide ${d.label}` : `Show ${d.label}`}
              className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs transition ${
 on ? 'border-default text-primary' : 'border-subtle text-faint'
              }`}
              style={on ? undefined : { opacity: 0.6 }}
            >
              <Swatch def={d} />
              {d.label}
            </button>
          )
        })}
      </div>

      {/* ACTIONS row */}
      {actions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pt-2">
          <span className="label mb-0 mr-1">Actions</span>
          {actions.map((a) => (
            <button
              key={a.id}
              onClick={a.onClick}
              disabled={a.disabled}
              className={`${
 a.active || a.primary ? 'btn-primary' : 'btn-ghost'
              } min-h-0 px-2.5 py-1 text-xs disabled:opacity-40`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {status && (
        <div className="px-3 pt-2 text-xs" style={{ color: 'var(--info-fg)' }}>
          {status}
        </div>
      )}

      {/*
        LEGEND — only what's actually drawn (§6.8), and folded by default.

        It is reference rather than control, and it GROWS with every layer
        switched on: nine entries wrapped to three lines on a phone, above the
        map they describe. The count is on the summary so it is still obvious
        there is something to open.
      */}
      <details className="px-3 py-1.5">
        <summary className="group inline-flex cursor-pointer list-none items-center gap-1 text-xs text-muted">
          <ChevronDown size={13} className="shrink-0 transition-transform group-open:rotate-180" />
          Legend · {legend.length}
        </summary>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1 pt-2 text-xs text-muted">
          {legend.map((d) => (
            <span key={d.id} className="inline-flex items-center gap-1">
              <Swatch def={d} />
              {d.label}
            </span>
          ))}
        </div>
      </details>
    </div>
  )
}
