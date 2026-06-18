import { useState } from "react";
import { LoginScreen } from "./components/LoginScreen";
import { AppShell } from "./components/AppShell";
import { isLoggedIn, getToken, getUserId, clearSession } from "./auth";
import "./styles/darkwood.css";

export default function App() {
    const [loggedIn, setLoggedIn] = useState(isLoggedIn());

    if (!loggedIn) {
        return <LoginScreen onLogin={() => setLoggedIn(true)} />;
    }

    return (
        <AppShell
            token={getToken()!}
            userId={getUserId()!}
            onLogout={() => {
                clearSession();
                setLoggedIn(false);
            }}
        />
    );
}