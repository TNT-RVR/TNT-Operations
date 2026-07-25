import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import { Protected } from './components/Protected'
import Dashboard from './features/dashboard/Dashboard'
import MapsHome from './features/maps/MapsHome'
import CostsHome from './features/maps/CostsHome'
import IncubationHome from './features/incubation/IncubationHome'
import SamplesHome from './features/incubation/SamplesHome'
import TraysHome from './features/incubation/TraysHome'
import LineageHome from './features/incubation/LineageHome'
import SensorsHome from './features/sensors/SensorsHome'
import UsersHome from './features/users/UsersHome'
import NotificationsHome from './features/notifications/NotificationsHome'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Protected module="dashboard"><Dashboard /></Protected>} />
        <Route path="maps" element={<Protected module="maps"><MapsHome /></Protected>} />
        <Route path="maps/costs" element={<Protected module="maps"><CostsHome /></Protected>} />
        <Route path="incubation" element={<Protected module="incubation"><IncubationHome /></Protected>} />
        <Route path="incubation/samples" element={<Protected module="incubation"><SamplesHome /></Protected>} />
        <Route path="incubation/trays" element={<Protected module="incubation"><TraysHome /></Protected>} />
        <Route path="incubation/lineage" element={<Protected module="incubation"><LineageHome /></Protected>} />
        <Route path="sensors" element={<Protected module="sensors"><SensorsHome /></Protected>} />
        <Route path="users" element={<Protected module="users"><UsersHome /></Protected>} />
        {/* Notifications are visible to any signed-in user (no module gate). */}
        <Route path="notifications" element={<NotificationsHome />} />
      </Route>
    </Routes>
  )
}
