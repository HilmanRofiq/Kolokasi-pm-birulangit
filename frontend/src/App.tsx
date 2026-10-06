import { BrowserRouter, Route, Routes } from "react-router-dom";
import DashboardLayout from "./components/layout/DashboardLayout";
import "./index.css";
import Analyze from "./pages/Analyze";
import Home from "./pages/Home";
import LabTest from "./pages/LabTest";

export default function App() {
    return (
        <BrowserRouter>
            <DashboardLayout>
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route path="/analyze" element={<Analyze />} />
                    <Route path="/labtest" element={<LabTest />} />
                </Routes>
            </DashboardLayout>
        </BrowserRouter>
    );
}
