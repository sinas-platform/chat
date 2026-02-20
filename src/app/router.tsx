import { createBrowserRouter } from "react-router-dom";
import { RootLayout } from "./root-layout.tsx";
import { ChatPage } from "../pages/Chat/Chat.tsx";
import { AllChatsPage } from "../pages/AllChats/AllChats.tsx";
import HomePage from "../pages/HomePage/HomePage.tsx";
import { SettingsPage } from "../pages/Settings/Settings.tsx";
import { RequireAuth } from "../components/RequireAuth.tsx";
import { LoginPage } from "../pages/LoginPage/LoginPage.tsx";

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: "/login", element: <LoginPage /> },
      {
        path: "/",
        element: (
          <RequireAuth>
            <HomePage />
          </RequireAuth>
        ),
      },
      {
        path: "/chats",
        element: (
          <RequireAuth>
            <AllChatsPage />
          </RequireAuth>
        ),
      },
      {
        path: "/chats/:chatId",
        element: (
          <RequireAuth>
            <ChatPage />
          </RequireAuth>
        ),
      },
      {
        path: "/settings",
        element: (
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        ),
      },
    ],
  },
]);
