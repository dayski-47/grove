export function CallInline({ callState, remoteUserId, usernames, onAccept, onDecline, onHangup }: {
    callState:    string;
    remoteUserId: number | null;
    usernames:    Record<number, string>;
    onAccept:     () => void;
    onDecline:    () => void;
    onHangup:     () => void;
}) {
    const name = remoteUserId !== null ? (usernames[remoteUserId] ?? `user ${remoteUserId}`) : "";
    return (
        <div className="dw-call-inline" role="alertdialog">
            <span className="dw-call-ring" aria-hidden="true" />
            <span className="dw-call-label">
                {callState === "incoming"  && name}
                {callState === "outgoing"  && `Calling ${name}…`}
                {callState === "connected" && name}
            </span>
            {callState === "incoming" && (
                <>
                    <button className="dw-call-btn dw-call-accept"  onClick={onAccept}>Accept</button>
                    <button className="dw-call-btn dw-call-decline" onClick={onDecline}>Decline</button>
                </>
            )}
            {(callState === "outgoing" || callState === "connected") && (
                <button className="dw-call-btn dw-call-hangup" onClick={onHangup}>
                    {callState === "outgoing" ? "Cancel" : "End"}
                </button>
            )}
        </div>
    );
}
