import { PageHeader, Badge, EmptyState } from '@/components/ui'
import { useData } from '@/data/context'

const TZ = 'America/Edmonton'
const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-CA', { timeZone: TZ, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function SensorsHome() {
  const { readings, incubators } = useData()
  const nameOf = (id: string) => incubators.find((i) => i.id === id)?.name ?? id
  const rows = [...readings].sort((a, b) => b.at.localeCompare(a.at))

  return (
    <div>
      <PageHeader title="Sensors" subtitle="Live temperature & humidity readings (Govee / ESP32)" />
      <div className="p-4 md:p-6">
        {rows.length === 0 ? (
          <EmptyState>No readings yet. Sensor polling lands in Phase 6.</EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-subtle">
            <table className="w-full border-collapse bg-raised text-sm">
              <thead>
                <tr>
                  <th className="th">When</th>
                  <th className="th">Incubator</th>
                  <th className="th">Temp</th>
                  <th className="th">Humidity</th>
                  <th className="th">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-subtle">
                    <td className="px-3 py-2">{fmt(r.at)}</td>
                    <td className="px-3 py-2">{nameOf(r.incubatorId)}</td>
                    <td className="px-3 py-2">{r.tempC.toFixed(1)}°C</td>
                    <td className="px-3 py-2">{r.humidityPct}%</td>
                    <td className="px-3 py-2">
                      <Badge tone={r.source === 'govee' ? 'blue' : 'green'}>{r.source}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
