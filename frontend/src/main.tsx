import { createRoot } from "react-dom/client";
import { App } from "./features/dashboard/App";
import "./styles/main.css";

createRoot(document.getElementById("root")!).render(<App />);
