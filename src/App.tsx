import { Navigate, Routes, Route, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import { Protected } from './components/Protected'
import { useSession, type Module } from '@/auth/session'
import { NoAccess } from './components/ui'
import TasksHome from './features/tasks/TasksHome'
import ChecklistsHome from './features/tasks/ChecklistsHome'
import { EstimatesHome, InvoicesHome } from './features/sales/SalesOrders'
import { InventoryHome } from './features/sales/SalesInventory'
import { CustomersHome, ProductsHome } from './features/sales/SalesCatalogue'
import QuickBooksHome from './features/sales/QuickBooksHome'
import { AccessTab, AccountTab, ArchiveTab, CompanyTab, IntegrationsTab } from './features/users/SettingsTabs'
import Dashboard from './features/dashboard/Dashboard'
import MapsHome from './features/maps/MapsHome'
import CostsHome from './features/maps/CostsHome'
import ShelterPlacement from './features/field/ShelterPlacement'
import TrayPlacement from './features/field/TrayPlacement'
import CrewsView from './features/field/CrewsView'
import ScheduleHome from './features/field/ScheduleHome'
import WorkOrderDetail from './features/field/WorkOrderDetail'
import IncubationHome from './features/incubation/IncubationHome'
import SamplesHome from './features/incubation/SamplesHome'
import TraysHome from './features/incubation/TraysHome'
import LineageHome from './features/incubation/LineageHome'
import AlertsHome from './features/incubation/AlertsHome'
import ScanHome from './features/incubation/ScanHome'
import CalendarHome from './features/incubation/CalendarHome'
import BlocksHome from './features/blocks/BlocksHome'
import BlockScan from './features/blocks/BlockScan'
import BlockList from './features/blocks/BlockList'
import ReturnsMap from './features/blocks/ReturnsMap'
import UsersHome from './features/users/UsersHome'
import GrantsHome from './features/grants/GrantsHome'
import NotificationsHome from './features/notifications/NotificationsHome'
import AnalysisHome from './features/analysis/AnalysisHome'
import AnalysisFields from './features/analysis/AnalysisFields'
import AnalysisFieldDetail from './features/analysis/AnalysisFieldDetail'
import AnalysisCorrelations from './features/analysis/AnalysisCorrelations'
import AnalysisWeather from './features/analysis/AnalysisWeather'
import AnalysisGrowers from './features/analysis/AnalysisGrowers'
import AnalysisMap from './features/analysis/AnalysisMap'
import AnalysisUpload from './features/analysis/AnalysisUpload'

/**
 * A redirect that KEEPS the query string.
 *
 * `<Navigate to="/some/path">` drops search params. The QuickBooks OAuth
 * callback used to land on /sales/quickbooks carrying ?qbo=…&detail=…, so the
 * plain redirect threw the callback's own result away: a successful connect
 * lost its "now set the mappings" prompt, and a FAILED one lost the reason
 * entirely — the screen just said "Not connected" with no explanation of why.
 *
 * The callback now lands on the real path, but a redirect URI registered with
 * Intuit outlives our routing, so the old one has to keep working — intact.
 */
function RedirectKeepingQuery({ to }: { to: string }) {
  const { search } = useLocation()
  return <Navigate to={`${to}${search}`} replace />
}

/**
 * The first screen after signing in: the Dashboard for anyone who has it, and
 * otherwise the first section this user can reach.
 */
function Home() {
  const s = useSession()
  if (s.can('dashboard', 'view')) {
    return (
      <Protected module="dashboard">
        <Dashboard />
      </Protected>
    )
  }
  const first = LANDING.find((l) => s.can(l.module, 'view'))
  return first ? <Navigate to={first.to} replace /> : <NoAccess />
}

/**
 * Where to send someone with no Dashboard, in the order it makes sense to try.
 * Field first: the accounts without a dashboard are the ones out in a truck.
 */
const LANDING: Array<{ module: Module; to: string }> = [
  { module: 'field', to: '/field' },
  { module: 'blocks', to: '/blocks/scan' },
  { module: 'tasks', to: '/tasks' },
  { module: 'calendar', to: '/calendar' },
  { module: 'incubation', to: '/incubation' },
  { module: 'maps', to: '/maps' },
  { module: 'sales', to: '/sales' },
  { module: 'users', to: '/users' },
]

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Land somewhere the signed-in user can actually GO. A crew iPad has
            no Dashboard, so the app opened on "No access" and looked broken —
            the role was right, the landing page was wrong. */}
        <Route index element={<Home />} />
        <Route path="maps" element={<Protected module="maps"><MapsHome /></Protected>} />
        <Route path="maps/costs" element={<Protected module="maps"><CostsHome /></Protected>} />
        <Route path="field" element={<Protected module="field"><ScheduleHome /></Protected>} />
        <Route path="field/order/:id" element={<Protected module="field"><WorkOrderDetail /></Protected>} />
        <Route path="field/shelters" element={<Protected module="field"><ShelterPlacement /></Protected>} />
        <Route path="field/trays" element={<Protected module="field"><TrayPlacement /></Protected>} />
        <Route path="field/crews" element={<Protected module="field"><CrewsView /></Protected>} />
        {/* The old path, kept so a bookmarked link still lands somewhere sane. */}
        <Route path="field/schedule" element={<Navigate to="/field" replace />} />
        <Route path="calendar" element={<Protected module="calendar"><CalendarHome /></Protected>} />
        <Route path="incubation" element={<Protected module="incubation"><IncubationHome /></Protected>} />
        <Route path="incubation/samples" element={<Protected module="incubation"><SamplesHome /></Protected>} />
        <Route path="incubation/trays" element={<Protected module="incubation"><TraysHome /></Protected>} />
        <Route path="incubation/lineage" element={<Protected module="incubation"><LineageHome /></Protected>} />
        <Route path="incubation/alerts" element={<Protected module="incubation"><AlertsHome /></Protected>} />
        <Route path="incubation/scan" element={<Protected module="incubation"><ScanHome /></Protected>} />
        <Route path="blocks" element={<Protected module="blocks" denyRoles={['device']}><BlocksHome /></Protected>} />
        <Route path="blocks/scan" element={<Protected module="blocks"><BlockScan /></Protected>} />
        <Route path="blocks/list" element={<Protected module="blocks"><BlockList /></Protected>} />
        <Route path="blocks/map" element={<Protected module="blocks" denyRoles={['device']}><ReturnsMap /></Protected>} />
        <Route path="tasks" element={<Protected module="tasks"><TasksHome /></Protected>} />
        <Route path="tasks/checklists" element={<Protected module="tasks"><ChecklistsHome /></Protected>} />
        <Route path="sales" element={<Protected module="sales"><EstimatesHome /></Protected>} />
        <Route path="sales/invoices" element={<Protected module="sales"><InvoicesHome /></Protected>} />
        <Route path="sales/inventory" element={<Protected module="sales"><InventoryHome /></Protected>} />
        <Route path="sales/products" element={<Protected module="sales"><ProductsHome /></Protected>} />
        <Route path="sales/customers" element={<Protected module="sales"><CustomersHome /></Protected>} />
        <Route path="sales/quickbooks" element={<RedirectKeepingQuery to="/users/integrations/quickbooks" />} />
        <Route path="analysis" element={<Protected module="analysis"><AnalysisHome /></Protected>} />
        <Route path="analysis/fields" element={<Protected module="analysis"><AnalysisFields /></Protected>} />
        <Route path="analysis/fields/:id" element={<Protected module="analysis"><AnalysisFieldDetail /></Protected>} />
        <Route path="analysis/correlations" element={<Protected module="analysis"><AnalysisCorrelations /></Protected>} />
        <Route path="analysis/weather" element={<Protected module="analysis"><AnalysisWeather /></Protected>} />
        <Route path="analysis/growers" element={<Protected module="analysis"><AnalysisGrowers /></Protected>} />
        <Route path="analysis/map" element={<Protected module="analysis"><AnalysisMap /></Protected>} />
        <Route path="analysis/upload" element={<Protected module="analysis"><AnalysisUpload /></Protected>} />
        <Route path="grants" element={<Protected module="grants"><GrantsHome /></Protected>} />
        <Route path="users" element={<Protected module="users"><UsersHome /></Protected>} />
        <Route path="users/access" element={<Protected module="users"><AccessTab /></Protected>} />
        <Route path="users/company" element={<Protected module="users"><CompanyTab /></Protected>} />
        <Route path="users/integrations" element={<Protected module="users"><IntegrationsTab /></Protected>} />
        <Route path="users/integrations/quickbooks" element={<Protected module="users"><QuickBooksHome /></Protected>} />
        <Route path="users/archive" element={<Protected module="users"><ArchiveTab /></Protected>} />
        <Route path="users/account" element={<Protected module="users"><AccountTab /></Protected>} />
        {/* Notifications are visible to any signed-in user (no module gate). */}
        <Route path="notifications" element={<NotificationsHome />} />
      </Route>
    </Routes>
  )
}
