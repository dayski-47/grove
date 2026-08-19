export function BellGlyph() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12.5 3c3.6 0.4 5.7 3.2 5.3 7.7c-0.2 3.1 0.9 4.9 2.4 6.3h-15.4c1.6-1.5 2.6-3.3 2.4-6.6c-0.3-4.2 2.1-7 5.3-7.4z"/>
            <circle cx="11" cy="19.3" r="1.15"/>
        </svg>
    );
}

export function BellIcon({ count }: { count: number }) {
    return (
        <div className="dw-bell-wrap">
            <BellGlyph />
            {count > 0 && (
                <span className="dw-bell-badge" aria-hidden="true">
                    {count > 99 ? "99+" : count}
                </span>
            )}
        </div>
    );
}

export function FriendsIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
            <path d="M12 2.2 C13.6 2.1 15 2.9 15.6 4.3 C17.1 4.6 18.2 5.9 18.1 7.5 C19.3 8.4 19.6 10 18.8 11.3 C18.9 12.8 17.6 13.9 16.1 13.8 C15.3 14.9 13.7 15.3 12.3 14.8 C10.9 15.4 9.2 15 8.3 13.9 C6.8 14 5.5 12.9 5.5 11.4 C4.6 10.2 4.8 8.5 6 7.5 C5.8 5.9 6.9 4.5 8.4 4.3 C8.9 2.9 10.3 2.1 12 2.2 Z M11.3 13.8 C11 15.5 11.2 17.3 10.7 19 C11.5 19.6 12.5 19.6 13.3 19 C12.8 17.3 13 15.5 12.7 13.8 C12.2 13.5 11.8 13.5 11.3 13.8 Z M10.7 19 C9 19.8 7.2 20 5.3 21.2 C5.6 21.6 6 21.7 6.4 21.5 C8 20.4 9.5 20 10.9 19.6 Z M11 19.3 C9.8 20.3 8.8 21.4 7.6 23 C8 23.2 8.4 23.1 8.7 22.8 C9.7 21.4 10.5 20.4 11.4 19.6 Z M11.6 19.5 C11.4 20.8 11.3 22.2 11.1 23.6 C11.5 23.7 11.9 23.7 12.3 23.6 C12.2 22.2 12.2 20.8 12.1 19.5 Z M13 19.3 C14.2 20.3 15.2 21.4 16.4 23 C16 23.2 15.6 23.1 15.3 22.8 C14.3 21.4 13.5 20.4 12.6 19.6 Z M13.3 19 C15 19.8 16.8 20 18.7 21.2 C18.4 21.6 18 21.7 17.6 21.5 C16 20.4 14.5 20 13.1 19.6 Z"/>
        </svg>
    );
}

export function SearchIcon() {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M13.5 4c3 0.5 4.9 2.9 4.5 6.1c-0.3 2.8-2.6 4.5-5.3 4.5c-2.9 0-5.2-2.1-5.2-5.1c0-3.2 2.7-5.7 6-5.5z"/>
            <path d="M9 15.5 C7.3 17.3 5.4 19.1 4 20.3"/>
        </svg>
    );
}

export function MsgIcon() {
    return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
}

export function PhoneIcon() {
    return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.18h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>;
}

export function RemoveIcon() {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6 Q14 10.5 18 18"/>
            <path d="M6 18 Q10.5 13.5 18 6"/>
        </svg>
    );
}

export function CloseIcon() {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6 Q14 10.5 18 18"/>
            <path d="M6 18 Q10.5 13.5 18 6"/>
        </svg>
    );
}

export function MessagesIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 4 C4.9 4 4 4.9 4 6 L4 12 C4 13.1 4.9 14 6 14 L8 14 L8 17.5 C8 17.9 8.5 18.1 8.8 17.8 L12.5 14 L18 14 C19.1 14 20 13.1 20 12 L20 6 C20 4.9 19.1 4 18 4 Z"/>
        </svg>
    );
}

export function SettingsIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="2.0"/>
            <circle cx="19" cy="12" r="1.2"/>
            <circle cx="15.5" cy="5.94" r="1.2"/>
            <circle cx="8.5" cy="5.94" r="1.2"/>
            <circle cx="5" cy="12" r="1.2"/>
            <circle cx="8.5" cy="18.06" r="1.2"/>
            <circle cx="15.5" cy="18.06" r="1.2"/>
            <path d="M13.9 12.3 L17.2 12.1"/>
            <path d="M13.1 10.3 L14.7 7.1"/>
            <path d="M10.9 10.3 L9.3 7.1"/>
            <path d="M9.9 12 L6.6 12"/>
            <path d="M10.9 13.7 L9.3 16.9"/>
            <path d="M13.1 13.7 L14.7 16.9"/>
        </svg>
    );
}

export function ActivityIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 12 C12 9.3 11.7 7 12.3 4.6"/>
            <circle cx="12.3" cy="4.2" r="0.9"/>
            <path d="M12 12 C14 10.6 16 9.6 18 8.1"/>
            <circle cx="18.3" cy="7.8" r="0.9"/>
            <path d="M12 12 C14 13.4 16.4 14.5 18.8 15.6"/>
            <circle cx="19.1" cy="15.9" r="0.9"/>
            <path d="M12 12 C10 13.4 8 15 6.5 17.4"/>
            <circle cx="6.2" cy="17.7" r="0.9"/>
            <path d="M12 12 C9.6 10.1 7.1 9.1 4.9 8.6"/>
            <circle cx="4.5" cy="8.5" r="0.9"/>
        </svg>
    );
}
