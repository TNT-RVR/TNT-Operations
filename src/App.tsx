import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import { Protected } from './components/Protected'
import Dashboard from './features/dashboard/Dashboard'
import MapsHome from './features/maps/MapsHome'
import IncubationHome from './features/incubation/IncubationHome'
import SensorsHome from './features/sensors/SensorsHome'
import UsersHome from './features/users/UsersHome'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Protected module="dashboard"><Dashboard /></Protected>} />
        <Route path="maps" element={<Protected module="maps"><MapsHome /></Protected>} />
        <Route path="incubation" element={<Protected module="incubation"><IncubationHome /></Protected>} />
        <Route path="sensors" element={<Protected module="sensors"><SensorsHome /></Protected>} />
        <Route path="users" element={<Protected module="users"><UsersHome /></Protected>} />
      </Route>
    </Routes>
  )
}
