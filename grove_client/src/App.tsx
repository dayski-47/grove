// src/App.tsx
import { useState } from "react";
import { LoginScreen } from "./components/LoginScreen";
import { ChatScreen } from "./components/ChatScreen";
import { isLoggedIn, getToken, getUserId, clearSession } from "./auth";
import "./styles/grove.css";

export default function App() {
    const [loggedIn, setLoggedIn] = useState(isLoggedIn());

    if (!loggedIn) {
      return <LoginScreen onLogin={() => setLoggedIn(true)} />;
    }

    return (
      <ChatScreen
        token={getToken()!}
        userId={getUserId()!}
        onLogout={() => {
          clearSession();
          setLoggedIn(false);
        }}
      />
    );
}