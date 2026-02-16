import { createBrowserRouter } from "react-router-dom";
import { RootLayout } from "./root-layout";
import { LoginPage } from "../pages/Login/Login";
import { ChatPage } from "../pages/Chat/Chat";

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/", element: <ChatPage /> },
    ],
  },
]);
