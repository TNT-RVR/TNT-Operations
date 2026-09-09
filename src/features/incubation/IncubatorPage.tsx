import { Link, useParams } from 'react-router-dom'
import { PageHeader, EmptyState } from '@/components/ui'
import { useData } from '@/data/context'
import { IncubatorDetail } from './IncubatorDetail'
import { neighbours } from '@/domain/incubatorNav'

/**
 * The route wrapper for one incubator.
 *
 * Its whole job is turning a URL into an incubator, and saying so plainly when
 * it cannot. The interesting case is a link that outlives its subject — an
 * alert from last season, a bookmark, a push notification for an incubator
 * that has since been deleted — and landing on a blank screen for that is the
 * one outcome worth avoiding.
 */
export default function IncubatorPage() {
  const { id } = useParams<{ id: string }>()
  const { incubators } = useData()
  const incubator = incubators.find((i) => i.id === id)

  if (!incubator) {
    return (
      <div>
        <PageHeader title="Incubator" />
        <div className="p-4 md:p-6">
          <EmptyState>
            {/* Deliberately not "not found": the list may simply not have
                loaded yet on a cold open from a notification, and calling that
                a missing incubator would be a lie a third of the time. */}
            That incubator is not in the list.{' '}
            <Link to="/incubation" className="text-brand underline">
              Back to all incubators
            </Link>
            .
          </EmptyState>
        </div>
      </div>
    )
  }

  // Worked out here rather than inside the detail: the page owns the list and
  // the URL, and the detail should not have to know how it was reached.
  const { prev, next, index, total } = neighbours(incubators, incubator.id)
  return (
    <IncubatorDetail incubator={incubator} prev={prev} next={next} index={index} total={total} />
  )
}
