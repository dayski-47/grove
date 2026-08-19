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
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
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
