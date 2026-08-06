import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import { Protected } from './components/Protected'
import TasksHome from './features/tasks/TasksHome'
import ChecklistsHome from './features/tasks/ChecklistsHome'
import { EstimatesHome, InvoicesHome } from './features/sales/SalesOrders'
import { InventoryHome } from './features/sales/SalesInventory'
import { CustomersHome, ProductsHome } from './features/sales/SalesCatalogue'
import Dashboard from './features/dashboard/Dashboard'
import MapsHome from './features/maps/MapsHome'
import CostsHome from './features/maps/CostsHome'
import FieldMode from './features/field/FieldMode'
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
import SensorsHome from './features/sensors/SensorsHome'
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

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Protected module="dashboard"><Dashboard /></Protected>} />
        <Route path="maps" element={<Protected module="maps"><MapsHome /></Protected>} />
        <Route path="maps/costs" element={<Protected module="maps"><CostsHome /></Protected>} />
        <Route path="field" element={<Protected module="maps"><FieldMode /></Protected>} />
        <Route path="calendar" element={<Protected module="incubation"><CalendarHome /></Protected>} />
        <Route path="incubation" element={<Protected module="incubation"><IncubationHome /></Protected>} />
        <Route path="incubation/samples" element={<Protected module="incubation"><SamplesHome /></Protected>} />
        <Route path="incubation/trays" element={<Protected module="incubation"><TraysHome /></Protected>} />
        <Route path="incubation/lineage" element={<Protected module="incubation"><LineageHome /></Protected>} />
        <Route path="incubation/alerts" element={<Protected module="incubation"><AlertsHome /></Protected>} />
        <Route path="incubation/scan" element={<Protected module="incubation"><ScanHome /></Protected>} />
        <Route path="blocks" element={<Protected module="blocks"><BlocksHome /></Protected>} />
        <Route path="blocks/scan" element={<Protected module="blocks"><BlockScan /></Protected>} />
        <Route path="blocks/list" element={<Protected module="blocks"><BlockList /></Protected>} />
        <Route path="sensors" element={<Protected module="sensors"><SensorsHome /></Protected>} />
        <Route path="tasks" element={<Protected module="tasks"><TasksHome /></Protected>} />
        <Route path="tasks/checklists" element={<Protected module="tasks"><ChecklistsHome /></Protected>} />
        <Route path="sales" element={<Protected module="sales"><EstimatesHome /></Protected>} />
        <Route path="sales/invoices" element={<Protected module="sales"><InvoicesHome /></Protected>} />
        <Route path="sales/inventory" element={<Protected module="sales"><InventoryHome /></Protected>} />
        <Route path="sales/products" element={<Protected module="sales"><ProductsHome /></Protected>} />
        <Route path="sales/customers" element={<Protected module="sales"><CustomersHome /></Protected>} />
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
        {/* Notifications are visible to any signed-in user (no module gate). */}
        <Route path="notifications" element={<NotificationsHome />} />
      </Route>
    </Routes>
  )
}
