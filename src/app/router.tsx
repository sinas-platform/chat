import { createBrowserRouter } from "react-router-dom";
import { RootLayout } from "./root-layout.tsx";
import { ChatPage } from "../pages/Chat/Chat.tsx";
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
            <ChatPage />
          </RequireAuth>
        ),
      },
    ],
  },
]);
