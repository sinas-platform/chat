import { Outlet } from "react-router-dom";
import { ThemeSwitch } from "../components/ThemeSwitch/ThemeSwitch";

export function RootLayout() {
  return (
    <div className="app-root">
      <Outlet />
      <ThemeSwitch />
    </div>
  );
}
